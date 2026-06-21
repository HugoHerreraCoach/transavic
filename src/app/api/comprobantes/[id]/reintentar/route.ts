// src/app/api/comprobantes/[id]/reintentar/route.ts
// Reintenta enviar un comprobante a SUNAT cuando quedó en estado 'error' o
// 'rechazado'. Reutiliza el MISMO correlativo (serie+numero) — esto evita
// huecos en la numeración correlativa que SUNAT exige sin saltos.
//
// Pueden reintentar: el ADMIN y la ASESORA DUEÑA del comprobante (scope de
// `lib/comprobante-scope.ts` — mismo criterio que las guías; abierto el
// 12 jun 2026 por el caso F002-83, antes era solo-admin).
//
// Flujo:
//   1. Validar que el comprobante existe y está en estado error/rechazado
//   2. Reconstruir items desde pedido_items (si tiene pedido asociado)
//   3. Regenerar XML con MISMO serie+numero
//   4. Firmar + enviar a SUNAT
//   5. Si esta vez SUNAT acepta: UPDATE comprobantes con estado real + XML/CDR
//   6. Si vuelve a fallar: actualizar mensaje_sunat con nuevo error

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { getSunatConfig, CATALOGO } from "@/lib/sunat/config-transavic";
import { generarXMLComprobante } from "@/lib/sunat/xml-builder";
import { firmarXML } from "@/lib/sunat/xml-signer";
import { enviarComprobante } from "@/lib/sunat/soap-client";
import { horaActualLima } from "@/lib/sunat/fechas";
import {
  type EmpresaId,
  TipoComprobante,
  TipoOperacion,
  TipoAfectacionIGV,
  TipoDocumentoIdentidad,
  EstadoSunat,
} from "@/lib/sunat/types";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";

export const dynamic = "force-dynamic";
// El envío a SUNAT puede superar los ~15s default de Vercel (gotcha #30b).
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Admin o asesora dueña (scope real abajo, con el comprobante cargado).
  // Antes era solo-admin; se abrió el 12 jun 2026 (caso F002-83): un fallo de
  // conexión dejaba a la asesora bloqueada esperando al admin — para guías ya
  // podía reintentar ella misma.
  if (!["admin", "asesor"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso para reintentar" }, { status: 403 });
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // 1. Traer comprobante existente
  const rows = (await sql`
    SELECT
      c.id, c.pedido_id, c.empresa, c.tipo, c.serie, c.numero, c.serie_numero,
      c.cliente_doc_tipo, c.cliente_doc_num, c.cliente_razon_social,
      c.monto_subtotal, c.monto_igv, c.monto_total, c.estado, c.created_at, c.fecha_emision,
      c.hash_cpe, c.xml_firmado_base64, c.items_json, c.emitido_por,
      c.forma_pago, c.fecha_vencimiento, c.observacion_comprobante,
      p.asesor_id AS pedido_asesor_id, p.cliente_id AS pedido_cliente_id,
      p.cliente AS pedido_cliente
    FROM comprobantes c
    LEFT JOIN pedidos p ON p.id = c.pedido_id
    WHERE c.id = ${id}::uuid LIMIT 1
  `) as Array<{
    id: string;
    pedido_id: string | null;
    empresa: string;
    tipo: string;
    serie: string;
    numero: number;
    serie_numero: string;
    cliente_doc_tipo: string | null;
    cliente_doc_num: string | null;
    cliente_razon_social: string | null;
    monto_subtotal: string | number;
    monto_igv: string | number;
    monto_total: string | number;
    estado: string;
    created_at: string | Date;
    fecha_emision: string | Date | null;
    hash_cpe: string | null;
    xml_firmado_base64: string | null;
    items_json: unknown;
    emitido_por: string | null;
    forma_pago: string | null;
    fecha_vencimiento: string | Date | null;
    observacion_comprobante: string | null;
    pedido_asesor_id: string | null;
    pedido_cliente_id: string | null;
    pedido_cliente: string | null;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];

  // Scope: la asesora solo reintenta SUS comprobantes (mismo criterio que el
  // resto de endpoints por id). 404 — no revelar existencia de ajenos.
  if (
    !asesoraPuedeVerComprobante(session.user.role, session.user.id, session.user.name, {
      pedidoAsesorId: c.pedido_asesor_id,
      emitidoPor: c.emitido_por,
    })
  ) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }

  if (c.estado !== "error" && c.estado !== "rechazado") {
    return NextResponse.json(
      { error: `Solo se puede reintentar comprobantes en estado error/rechazado. Estado actual: ${c.estado}` },
      { status: 409 }
    );
  }

  // 2. Ítems para reconstruir el XML — SOLO se usan si el comprobante NO tiene
  //    su XML firmado original (caso raro). Prioridad:
  //      (1) items_json guardado al emitir (fiel, con código y afectación)
  //      (2) pedido_items (si viene de un pedido)
  //    Si no hay ninguno, NO se fabrica una línea genérica ("Venta a …"): el
  //    reintento aborta abajo con un error claro (mejor que re-emitir mal).
  type ItemReintento = {
    codigo?: string;
    descripcion: string;
    unidadMedida: string;
    cantidad: number;
    precioUnitario: number;
    tipoAfectacionIGV: TipoAfectacionIGV;
    porcentajeIGV: number;
  };
  let items: ItemReintento[] = [];

  if (Array.isArray(c.items_json) && c.items_json.length > 0) {
    items = (c.items_json as ItemReintento[]).map((it) => ({
      codigo: it.codigo,
      descripcion: it.descripcion,
      unidadMedida: it.unidadMedida || "NIU",
      cantidad: Number(it.cantidad),
      precioUnitario: Number(it.precioUnitario),
      tipoAfectacionIGV:
        it.tipoAfectacionIGV ?? TipoAfectacionIGV.GRAVADA_ONEROSA,
      porcentajeIGV: it.porcentajeIGV ?? 18,
    }));
  } else if (c.pedido_id) {
    const itemRows = (await sql`
      SELECT
        pi.producto_nombre AS descripcion,
        pi.unidad AS unidad_medida,
        COALESCE(pi.cantidad_real, pi.cantidad, 0)::numeric AS cantidad,
        COALESCE(pi.precio_unitario, 0)::numeric AS precio_unitario
      FROM pedido_items pi
      WHERE pi.pedido_id = ${c.pedido_id}::uuid
      ORDER BY pi.created_at
    `) as Array<{
      descripcion: string;
      unidad_medida: string | null;
      cantidad: string | number;
      precio_unitario: string | number;
    }>;
    items = itemRows
      .map((r) => ({
        descripcion: r.descripcion,
        unidadMedida: r.unidad_medida || "NIU",
        cantidad: Number(r.cantidad),
        precioUnitario: Number(r.precio_unitario),
        tipoAfectacionIGV: TipoAfectacionIGV.GRAVADA_ONEROSA,
        porcentajeIGV: 18,
      }))
      .filter((it) => it.cantidad > 0);
  }

  const empresaId = (c.empresa as EmpresaId) || "transavic";
  const config = getSunatConfig(empresaId);
  if (!config.certificateBase64) {
    return NextResponse.json(
      { error: "Certificado SUNAT no configurado — no se puede reintentar." },
      { status: 503 }
    );
  }

  // Preferir la fecha de emisión REAL del comprobante (puede ser retroactiva); solo
  // si está NULL (filas viejas) caer a created_at. Importa cuando se RECONSTRUYE el
  // XML: debe llevar la misma fecha que el original, no la de hoy.
  const fechaEmision = c.fecha_emision
    ? typeof c.fecha_emision === "string"
      ? c.fecha_emision.slice(0, 10)
      : c.fecha_emision.toISOString().slice(0, 10)
    : typeof c.created_at === "string"
      ? c.created_at.slice(0, 10)
      : c.created_at.toISOString().slice(0, 10);

  try {
    // 3+4. Obtener el XML firmado a enviar:
    //   (a) Si el comprobante YA tiene su XML firmado original → reenviarlo TAL
    //       CUAL (no se reconstruye → es IMPOSIBLE alterar los ítems). Cubre los
    //       casos típicos de reintento: rechazado, o error con respuesta SUNAT.
    //   (b) Si NO hay XML (error por excepción antes de firmar) → reconstruir
    //       desde los ítems guardados. Si no hay ítems, se ABORTA con error
    //       claro — NUNCA se fabrica una línea genérica equivocada.
    let xmlFirmado: string;
    let hashCpe: string | null;
    if (c.xml_firmado_base64) {
      xmlFirmado = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
      hashCpe = c.hash_cpe ?? null;
    } else {
      if (items.length === 0) {
        return NextResponse.json(
          {
            error:
              "No se puede reintentar automáticamente: este comprobante no guardó su XML ni sus ítems. Vuelve a emitirlo desde 'Emitir comprobante'.",
          },
          { status: 422 }
        );
      }
      const xmlSinFirma = generarXMLComprobante(
        {
          tipoComprobante: c.tipo as TipoComprobante,
          serie: c.serie,
          numero: c.numero,
          fechaEmision,
          horaEmision: horaActualLima(),
          tipoOperacion: TipoOperacion.VENTA_INTERNA,
          moneda: CATALOGO.MONEDA.SOLES,
          cliente: {
            tipoDocumento:
              (c.cliente_doc_tipo as TipoDocumentoIdentidad) ??
              TipoDocumentoIdentidad.RUC,
            numDocumento: c.cliente_doc_num || "00000000",
            razonSocial: c.cliente_razon_social || "Cliente",
          },
          items,
          formaPago: "Contado",
          observacionComprobante: c.observacion_comprobante,
        },
        config
      );
      const firmado = firmarXML(xmlSinFirma, config);
      xmlFirmado = firmado.xmlFirmado;
      hashCpe = firmado.hashCpe;
    }
    const resultadoEnvio = await enviarComprobante(
      xmlFirmado,
      c.tipo,
      c.serie,
      c.numero,
      config
    );

    // 5. Actualizar registro existente con nuevo resultado
    const estadoDB =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA
        ? "aceptado"
        : resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
          ? "observado"
          : resultadoEnvio.estado === EstadoSunat.RECHAZADA
            ? "rechazado"
            : "error";
    const observacionesStr = resultadoEnvio.observaciones?.join(" | ") ?? null;

    await sql`
      UPDATE comprobantes SET
        estado = ${estadoDB},
        hash_cpe = ${hashCpe ?? null},
        xml_firmado_base64 = ${Buffer.from(xmlFirmado).toString("base64")},
        cdr_base64 = ${resultadoEnvio.cdrBase64 ?? null},
        observaciones = ${observacionesStr},
        mensaje_sunat = ${resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null}
      WHERE id = ${id}::uuid
    `;

    // Si esta vez aceptó, asociar a factura
    const sunatAcepto =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA ||
      resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES;
    if (sunatAcepto && c.pedido_id) {
      await sql`
        UPDATE facturas SET numero_comprobante = ${c.serie_numero}
        WHERE pedido_id = ${c.pedido_id}::uuid AND numero_comprobante IS NULL
      `;
    }

    // Regla "TODA venta crea cobranza": la emisión original falló y por eso NO
    // creó cobranza; el reintento exitoso debe crearla (gap detectado con
    // F002-83, 12 jun 2026 — quedó aceptada sin deuda registrada). Solo
    // facturas/boletas (una NC no es deuda). `vincularCobranzaAComprobante` es
    // idempotente ("un pedido = una cobranza"); el caso standalone se guarda
    // contra duplicados por `comprobante_id`. Misma cascada de asesor que la
    // emisión: pedido → emisora asesora → cartera del cliente.
    if (sunatAcepto && (c.tipo === "01" || c.tipo === "03")) {
      try {
        const { vincularCobranzaAComprobante, crearFacturaStandalone, plazoDeCobranza } =
          await import("@/lib/cobranzas");
        // Plazo: si el comprobante fue a Crédito con vencimiento guardado, se
        // respetan los días que faltan hasta esa fecha; si no, el plazo del cliente.
        let plazoDias: number | null = null;
        if (c.forma_pago === "Credito" && c.fecha_vencimiento) {
          const venc =
            c.fecha_vencimiento instanceof Date
              ? c.fecha_vencimiento
              : new Date(`${String(c.fecha_vencimiento).slice(0, 10)}T00:00:00`);
          plazoDias = Math.max(0, Math.round((venc.getTime() - Date.now()) / 86_400_000));
        }
        if (c.pedido_id) {
          let cobranzaAsesorId: string | null = c.pedido_asesor_id ?? null;
          if (!cobranzaAsesorId && session.user.role === "asesor") {
            cobranzaAsesorId = session.user.id;
          }
          if (!cobranzaAsesorId && c.pedido_cliente_id) {
            const cliRows = (await sql`
              SELECT asesor_id FROM clientes WHERE id = ${c.pedido_cliente_id}::uuid
            `) as Array<{ asesor_id: string | null }>;
            cobranzaAsesorId = cliRows[0]?.asesor_id ?? null;
          }
          await vincularCobranzaAComprobante({
            pedidoId: c.pedido_id,
            clienteNombre: c.cliente_razon_social || c.pedido_cliente || "Cliente",
            clienteId: c.pedido_cliente_id,
            asesorId: cobranzaAsesorId,
            monto: Number(c.monto_total),
            plazoDias: plazoDias ?? (await plazoDeCobranza(c.pedido_cliente_id)),
            numeroComprobante: c.serie_numero,
          });
        } else {
          const ya = (await sql`
            SELECT id FROM facturas WHERE comprobante_id = ${id}::uuid LIMIT 1
          `) as Array<{ id: string }>;
          if (ya.length === 0) {
            await crearFacturaStandalone({
              clienteNombre: c.cliente_razon_social || "Cliente",
              asesorId: session.user.role === "asesor" ? session.user.id : null,
              monto: Number(c.monto_total),
              plazoDias: plazoDias ?? (await plazoDeCobranza(null)),
              numeroComprobante: c.serie_numero,
              comprobanteId: id,
            });
          }
        }
      } catch (errCobranza) {
        console.error(
          "Reintento aceptado pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
      }
    }

    // P2.10 — Si volvió a rechazar / errorear, re-notificar (admin + asesora).
    // El asesor_id del pedido (si lo hay) se busca por separado para no atar
    // este endpoint al schema completo del pedido.
    if (
      resultadoEnvio.estado === EstadoSunat.RECHAZADA ||
      resultadoEnvio.estado === EstadoSunat.ERROR
    ) {
      let asesorIdPedido: string | null = null;
      if (c.pedido_id) {
        const rows = (await sql`
          SELECT asesor_id FROM pedidos WHERE id = ${c.pedido_id}::uuid
        `) as Array<{ asesor_id: string | null }>;
        asesorIdPedido = rows[0]?.asesor_id ?? null;
      }
      await notificarComprobanteConProblema({
        comprobanteId: id,
        serieNumero: c.serie_numero,
        tipo: c.tipo,
        estado: resultadoEnvio.estado === EstadoSunat.RECHAZADA ? "RECHAZADA" : "ERROR",
        mensajeSunat: resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null,
        pedidoId: c.pedido_id ?? null,
        empresa: c.empresa,
        asesorId: asesorIdPedido,
      });
    }

    return NextResponse.json({
      exito: resultadoEnvio.exito,
      estado: estadoDB,
      serieNumero: c.serie_numero,
      sunatCaido: resultadoEnvio.sunatCaido,
      mensaje: resultadoEnvio.sunatCaido
        ? "SUNAT no está respondiendo (problema de sus servidores, no del sistema). El comprobante NO se emitió — intentá más tarde o emitilo manualmente desde el portal de SUNAT."
        : sunatAcepto
          ? "✅ SUNAT aceptó el comprobante en el reintento."
          : "SUNAT volvió a rechazar. Revisar mensaje_sunat para detalle.",
      mensajeSunat: resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null,
      observaciones: resultadoEnvio.observaciones,
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE comprobantes SET
        mensaje_sunat = ${`Reintento fallido: ${mensaje.slice(0, 1000)}`}
      WHERE id = ${id}::uuid
    `;
    return NextResponse.json(
      { error: "Reintento fallido", detalle: mensaje },
      { status: 500 }
    );
  }
}

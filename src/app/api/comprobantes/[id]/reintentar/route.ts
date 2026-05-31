// src/app/api/comprobantes/[id]/reintentar/route.ts
// Reintenta enviar un comprobante a SUNAT cuando quedó en estado 'error' o
// 'rechazado'. Reutiliza el MISMO correlativo (serie+numero) — esto evita
// huecos en la numeración correlativa que SUNAT exige sin saltos.
//
// Solo admin puede disparar reintento (para auditoría — la asesora pide al
// admin si su comprobante falló).
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
import {
  type EmpresaId,
  TipoComprobante,
  TipoOperacion,
  TipoAfectacionIGV,
  TipoDocumentoIdentidad,
  EstadoSunat,
} from "@/lib/sunat/types";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo admin puede reintentar" }, { status: 403 });
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
      c.monto_subtotal, c.monto_igv, c.monto_total, c.estado, c.created_at,
      c.hash_cpe, c.xml_firmado_base64, c.items_json
    FROM comprobantes c
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
    hash_cpe: string | null;
    xml_firmado_base64: string | null;
    items_json: unknown;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];

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
    items = itemRows.map((r) => ({
      descripcion: r.descripcion,
      unidadMedida: r.unidad_medida || "NIU",
      cantidad: Number(r.cantidad),
      precioUnitario: Number(r.precio_unitario),
      tipoAfectacionIGV: TipoAfectacionIGV.GRAVADA_ONEROSA,
      porcentajeIGV: 18,
    }));
  }

  const empresaId = (c.empresa as EmpresaId) || "transavic";
  const config = getSunatConfig(empresaId);
  if (!config.certificateBase64) {
    return NextResponse.json(
      { error: "Certificado SUNAT no configurado — no se puede reintentar." },
      { status: 503 }
    );
  }

  const fechaEmision =
    typeof c.created_at === "string"
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
          horaEmision: new Date().toLocaleTimeString("en-US", { hour12: false }),
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
        mensaje_sunat = ${resultadoEnvio.descripcion ?? null}
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
        mensajeSunat: resultadoEnvio.descripcion ?? null,
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
      mensajeSunat: resultadoEnvio.descripcion,
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

// src/app/api/comprobantes/[id]/reintentar/route.ts
// Reintenta enviar un comprobante a SUNAT SOLO cuando quedó en estado 'error'.
// Reutiliza el MISMO correlativo (serie+numero) porque un error de transporte no
// confirma que SUNAT lo haya evaluado. Un 'rechazado' ya tiene respuesta definitiva:
// su XML/CDR se conserva y se corrige con un CPE NUEVO, nunca reenviando lo mismo.
//
// Pueden reintentar: el ADMIN y la ASESORA DUEÑA del comprobante (scope de
// `lib/comprobante-scope.ts` — mismo criterio que las guías; abierto el
// 12 jun 2026 por el caso F002-83, antes era solo-admin).
//
// Flujo:
//   1. Validar que el comprobante existe y está en estado error
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
import { esNotaCreditoTotalXml } from "@/lib/sunat/nota-credito";
import {
  completarPostprocesoAceptadoPorId,
  conciliarComprobanteSunat,
} from "@/lib/sunat/reconciliacion-cpe";

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
      c.venta_avicola_id, c.referencia_comprobante_id,
      p.asesor_id AS pedido_asesor_id, p.cliente_id AS pedido_cliente_id,
      p.cliente AS pedido_cliente, p.origen AS pedido_origen,
      ref.pedido_id AS referencia_pedido_id,
      ref.venta_avicola_id AS referencia_venta_avicola_id,
      ref.serie_numero AS referencia_serie_numero,
      pr.origen AS referencia_pedido_origen
    FROM comprobantes c
    LEFT JOIN pedidos p ON p.id = c.pedido_id
    LEFT JOIN comprobantes ref ON ref.id = c.referencia_comprobante_id
    LEFT JOIN pedidos pr ON pr.id = ref.pedido_id
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
    venta_avicola_id: string | null;
    referencia_comprobante_id: string | null;
    pedido_asesor_id: string | null;
    pedido_cliente_id: string | null;
    pedido_cliente: string | null;
    pedido_origen: string | null;
    referencia_pedido_id: string | null;
    referencia_venta_avicola_id: string | null;
    referencia_serie_numero: string | null;
    referencia_pedido_origen: string | null;
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

  // Recién DESPUÉS del scope se puede mutar una reserva interrumpida. Antes,
  // una asesora con un UUID ajeno podía cambiar `emitiendo`→`error` aunque luego
  // recibiera 404. Si aún no pasaron 15 min, sigue siendo una llamada activa.
  if (c.estado === "emitiendo") {
    const creado = new Date(c.created_at).getTime();
    const estaAtascado =
      Number.isFinite(creado) && creado < Date.now() - 15 * 60 * 1000;
    if (!estaAtascado) {
      return NextResponse.json(
        { error: "Este comprobante todavía se está enviando a SUNAT." },
        { status: 409 }
      );
    }
    if (c.tipo === "01" || c.tipo === "03") {
      await sql`
        UPDATE comprobantes
        SET estado = 'por_confirmar',
            mensaje_sunat = 'La emisión se interrumpió y SUNAT puede haber recibido el comprobante. Primero verifica este mismo número; no emitas otro.',
            sunat_siguiente_consulta_at = NOW()
        WHERE id = ${id}::uuid AND estado = 'emitiendo'
      `;
      c.estado = "por_confirmar";
    } else {
      // NC/ND conservan el flujo histórico de reintento.
      await sql`
        UPDATE comprobantes
        SET estado = 'error',
            mensaje_sunat = 'La emisión se interrumpió. Reintenta este mismo comprobante; no emitas otro correlativo.'
        WHERE id = ${id}::uuid AND estado = 'emitiendo'
      `;
      c.estado = "error";
    }
  }

  const esFacturaOBoleta = c.tipo === "01" || c.tipo === "03";

  // Para 01/03, una fila con XML pudo llegar a SUNAT. Consultar SIEMPRE antes
  // de reenviar el mismo ZIP evita que un timeout/0140 termine en duplicado.
  if (
    esFacturaOBoleta &&
    (c.estado === "por_confirmar" ||
      (c.estado === "error" && !!c.xml_firmado_base64))
  ) {
    const conciliado = await conciliarComprobanteSunat(id, {
      forzar: true,
      incluirError: c.estado === "error",
    });
    if (conciliado.estado !== "no_registrado") {
      return NextResponse.json(
        {
          ...conciliado,
          exito: ["aceptado", "observado"].includes(conciliado.estado),
          serieNumero: c.serie_numero,
          mensajeSunat: conciliado.mensaje,
        },
        { status: conciliado.definitivo ? 200 : 202 }
      );
    }
    c.estado = "no_registrado";
  }

  if (c.estado === "rechazado") {
    return NextResponse.json(
      {
        codigo: "cpe_rechazado_no_reintentable",
        error:
          c.venta_avicola_id && (c.tipo === "01" || c.tipo === "03")
            ? "SUNAT ya rechazó este comprobante. Corrige la venta y usa \"Corregir y emitir nuevo\" para conservar el XML/CDR anterior y generar otro correlativo."
            : "SUNAT ya rechazó este comprobante. No se puede reenviar el mismo XML; emite un comprobante nuevo con los datos corregidos.",
      },
      { status: 409 }
    );
  }
  const estadoReintentable =
    c.estado === "error" ||
    (esFacturaOBoleta && c.estado === "no_registrado");
  if (!estadoReintentable) {
    return NextResponse.json(
      {
        error: `Este comprobante no se puede reenviar en su estado actual: ${c.estado}.`,
      },
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

  // Reintentar una NC compite con emitir una NC nueva sobre el mismo CPE base.
  // Ambos adquieren el MISMO claim para que la ruta nueva no consuma un
  // correlativo mientras la anterior se está reenviando.
  let claimNcBase: { baseId: string; token: string } | null = null;
  let envioIniciado = false;
  if (c.tipo === "07") {
    if (!c.referencia_comprobante_id) {
      return NextResponse.json(
        { error: "La Nota de Crédito no tiene comprobante de referencia vinculado." },
        { status: 422 }
      );
    }
    const token = crypto.randomUUID();
    const claimed = (await sql`
      UPDATE comprobantes base
      SET nota_credito_claim_token = ${token}::uuid,
          nota_credito_claim_at = NOW()
      WHERE base.id = ${c.referencia_comprobante_id}::uuid
        AND (
          base.nota_credito_claim_token IS NULL
          OR base.nota_credito_claim_at < NOW() - INTERVAL '15 minutes'
        )
        AND NOT EXISTS (
          SELECT 1 FROM comprobantes otra
          WHERE otra.referencia_comprobante_id = base.id
            AND otra.tipo = '07'
            AND otra.id <> ${id}::uuid
            AND (
              otra.estado NOT IN ('error', 'rechazado', 'anulado')
              OR (otra.estado = 'error' AND otra.xml_firmado_base64 IS NOT NULL)
            )
        )
      RETURNING base.id
    `) as Array<{ id: string }>;
    if (claimed.length === 0) {
      return NextResponse.json(
        { error: "El comprobante base ya tiene otra Nota de Crédito activa o en proceso." },
        { status: 409 }
      );
    }
    claimNcBase = { baseId: c.referencia_comprobante_id, token };
  }

  try {
    // 3+4. Obtener el XML firmado a enviar:
    //   (a) Si el comprobante YA tiene su XML firmado original → reenviarlo TAL
    //       CUAL (no se reconstruye → es IMPOSIBLE alterar los ítems). Cubre los
    //       casos típicos de reintento: error con XML ya firmado/respuesta parcial.
    //   (b) Si NO hay XML (error por excepción antes de firmar) → reconstruir
    //       desde los ítems guardados. Si no hay ítems, se ABORTA con error
    //       claro — NUNCA se fabrica una línea genérica equivocada.
    let xmlFirmado: string;
    let hashCpe: string | null;
    if (c.xml_firmado_base64) {
      xmlFirmado = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
      hashCpe = c.hash_cpe ?? null;
    } else {
      if (c.tipo === "07") {
        return NextResponse.json(
          {
            error:
              "Esta Nota de Crédito falló antes de guardar su XML y no se puede reconstruir de forma legal. Emite una nueva Nota de Crédito desde el comprobante original.",
          },
          { status: 422 }
        );
      }
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

    // Si una NC anterior falló pero ya existe otra NC activa/aceptada para la
    // misma referencia, la fallida no debe volver a enviarse.
    if (c.tipo === "07" && c.referencia_comprobante_id) {
      const otraNc = (await sql`
        SELECT id, serie_numero, estado
        FROM comprobantes
        WHERE referencia_comprobante_id = ${c.referencia_comprobante_id}::uuid
          AND tipo = '07'
          AND id <> ${id}::uuid
          AND (
            estado NOT IN ('error', 'rechazado', 'anulado')
            OR (estado = 'error' AND xml_firmado_base64 IS NOT NULL)
          )
        ORDER BY created_at DESC
        LIMIT 1
      `) as Array<{ id: string; serie_numero: string; estado: string }>;
      if (otraNc.length > 0) {
        return NextResponse.json(
          {
            error: `La referencia ya tiene la Nota de Crédito ${otraNc[0].serie_numero} en estado ${otraNc[0].estado}. No se reenviará esta nota anterior.`,
          },
          { status: 409 }
        );
      }
    }
    // Claim atómico del reintento: dos pestañas nunca reenvían el mismo XML a
    // SUNAT al mismo tiempo. El catch lo devuelve a `error` si la llamada falla.
    const claim = (await sql`
      UPDATE comprobantes
      SET estado = 'emitiendo',
          mensaje_sunat = 'Reintentando envío a SUNAT con el mismo correlativo.'
      WHERE id = ${id}::uuid
        AND estado = ${c.estado}
        AND (
          estado = 'error'
          OR (${esFacturaOBoleta} AND estado = 'no_registrado')
        )
      RETURNING id
    `) as Array<{ id: string }>;
    if (claim.length === 0) {
      return NextResponse.json(
        { error: "Este comprobante ya está siendo reintentado en otra pestaña." },
        { status: 409 }
      );
    }

    envioIniciado = true;
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
            : resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
              ? "por_confirmar"
            : "error";
    const observacionesStr = resultadoEnvio.observaciones?.join(" | ") ?? null;
    const cdrLegible =
      resultadoEnvio.tieneCdr ??
      (!!resultadoEnvio.cdrBase64 &&
        [
          EstadoSunat.ACEPTADA,
          EstadoSunat.ACEPTADA_CON_OBSERVACIONES,
          EstadoSunat.RECHAZADA,
        ].includes(resultadoEnvio.estado));
    const mensajeResultado =
      resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
        ? "SUNAT todavía no confirmó el resultado. El sistema verificará este mismo número automáticamente; no emitas otro comprobante."
        : resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null;
    const siguienteConsulta =
      resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
        ? new Date(Date.now() + 15 * 60_000)
        : null;

    await sql`
      UPDATE comprobantes SET
        estado = ${estadoDB},
        hash_cpe = ${hashCpe ?? null},
        xml_firmado_base64 = ${Buffer.from(xmlFirmado).toString("base64")},
        cdr_base64 = ${resultadoEnvio.cdrBase64 ?? null},
        sunat_cdr_legible = ${cdrLegible},
        observaciones = ${observacionesStr},
        mensaje_sunat = ${mensajeResultado},
        sunat_codigo_envio = ${resultadoEnvio.codigoRespuesta ?? null},
        sunat_mensaje_envio = ${
          resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null
        },
        sunat_siguiente_consulta_at = ${siguienteConsulta},
        sunat_no_existe_consecutivos = 0,
        sunat_postproceso_estado = CASE
          WHEN ${esFacturaOBoleta}
            AND ${
              resultadoEnvio.estado === EstadoSunat.ACEPTADA ||
              resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
            }
            THEN 'pendiente'
          ELSE sunat_postproceso_estado
        END
      WHERE id = ${id}::uuid
    `;

    const esPosPlanta =
      c.pedido_origen === "pos_planta" ||
      c.referencia_pedido_origen === "pos_planta";

    // Una aceptacion 01/03 pasa por el postproceso central, que deriva de sus
    // vinculos si corresponde a Ejecutivas, Planta o Campo.
    const sunatAcepto =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA ||
      resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES;
    if (
      sunatAcepto &&
      (c.tipo === "01" || c.tipo === "03")
    ) {
      try {
        // Mismo helper que la aceptacion inmediata y la conciliacion tardia:
        // reclama `pendiente→aplicando` antes de tocar cualquier cartera.
        await completarPostprocesoAceptadoPorId(id);
      } catch (errorPostproceso) {
        console.error(
          "Reintento aceptado, pero el postproceso quedo pendiente:",
          errorPostproceso
        );
      }
    }

    // Una NC total aceptada en reintento debe producir el mismo efecto interno
    // que una NC aceptada en el primer envío. La operación del CPE base decide
    // qué cartera/venta retirar; este paso es idempotente y no toca pagadas.
    if (
      sunatAcepto &&
      c.tipo === "07" &&
      esNotaCreditoTotalXml(xmlFirmado) &&
      c.referencia_comprobante_id
    ) {
      try {
        const motivoNc = `Anulada por Nota de Crédito ${c.serie_numero}`;
        const ventaCampoId =
          c.venta_avicola_id ?? c.referencia_venta_avicola_id;
        if (ventaCampoId) {
          await sql`
            UPDATE ventas_avicola
            SET anulada = TRUE,
                anulada_at = NOW(),
                anulada_por = ${session.user.id}::uuid,
                anulacion_motivo = ${motivoNc}
            WHERE id = ${ventaCampoId}::uuid
              AND NOT anulada
          `;
        } else if (esPosPlanta) {
          const { anularCobranzasPlantaDeComprobante } =
            await import("@/lib/planta/saldos");
          await anularCobranzasPlantaDeComprobante(sql, {
            comprobanteId: c.referencia_comprobante_id,
            pedidoId: c.referencia_pedido_id,
            motivo: motivoNc,
            anuladaPor: session.user.id,
          });
        } else {
          const { anularCobranzasDeComprobante } =
            await import("@/lib/cobranzas");
          await anularCobranzasDeComprobante({
            comprobanteId: c.referencia_comprobante_id,
            pedidoId: c.referencia_pedido_id,
            serieNumero: c.referencia_serie_numero ?? "",
            motivo: motivoNc,
            anuladaPor: session.user.name?.trim() || "Sistema (NC)",
          });
        }
      } catch (errEfectoNc) {
        console.error(
          "Reintento de NC aceptado pero no se pudo aplicar su efecto interno:",
          errEfectoNc
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
      try {
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
      } catch (errorNotificacion) {
        console.error("No se pudo notificar el resultado del reintento:", errorNotificacion);
      }
    }

    return NextResponse.json({
      exito: resultadoEnvio.exito,
      estado: estadoDB,
      serieNumero: c.serie_numero,
      sunatCaido: resultadoEnvio.sunatCaido,
      mensaje:
        resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
          ? "SUNAT todavía no confirmó el resultado. El sistema verificará este mismo número; no emitas otro comprobante."
          : sunatAcepto
          ? "✅ SUNAT aceptó el comprobante en el reintento."
          : resultadoEnvio.estado === EstadoSunat.RECHAZADA
            ? "SUNAT rechazó el comprobante. Revisa el detalle antes de corregirlo."
            : "No se pudo completar el reintento. Revisa el detalle y conserva el mismo correlativo.",
      mensajeSunat: resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null,
      observaciones: resultadoEnvio.observaciones,
      proximaConsultaAt: siguienteConsulta?.toISOString(),
      tieneCdr: cdrLegible,
    });
  } catch (err) {
    const dbError = err as { code?: string; constraint?: string };
    if (
      dbError?.code === "23505" &&
      dbError.constraint === "ux_comprobantes_nc_referencia_activa"
    ) {
      return NextResponse.json(
        { error: "La referencia ya tiene otra Nota de Crédito activa o en emisión." },
        { status: 409 }
      );
    }
    const mensaje = err instanceof Error ? err.message : String(err);
    const quedaPorConfirmar = esFacturaOBoleta && envioIniciado;
    await sql`
      UPDATE comprobantes SET
        estado = CASE
          WHEN estado IN ('aceptado', 'observado', 'rechazado') THEN estado
          WHEN ${quedaPorConfirmar} THEN 'por_confirmar'
          ELSE 'error'
        END,
        mensaje_sunat = CASE
          WHEN estado IN ('aceptado', 'observado', 'rechazado') THEN mensaje_sunat
          WHEN ${quedaPorConfirmar} THEN
            'El reintento se interrumpió y SUNAT puede haber recibido el comprobante. El sistema verificará este mismo número; no emitas otro.'
          ELSE ${`Reintento fallido: ${mensaje.slice(0, 1000)}`}
        END,
        sunat_siguiente_consulta_at = CASE
          WHEN ${quedaPorConfirmar} THEN NOW() + INTERVAL '15 minutes'
          ELSE sunat_siguiente_consulta_at
        END
      WHERE id = ${id}::uuid
    `;
    return NextResponse.json(
      { error: "Reintento fallido", detalle: mensaje },
      { status: 500 }
    );
  } finally {
    if (claimNcBase) {
      try {
        await sql`
          UPDATE comprobantes
          SET nota_credito_claim_token = NULL,
              nota_credito_claim_at = NULL
          WHERE id = ${claimNcBase.baseId}::uuid
            AND nota_credito_claim_token = ${claimNcBase.token}::uuid
        `;
      } catch (error) {
        console.error("No se pudo liberar el claim del reintento de NC:", error);
      }
    }
  }
}

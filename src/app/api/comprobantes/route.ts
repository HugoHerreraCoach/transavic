// src/app/api/comprobantes/route.ts
// GET — listar comprobantes (con scoping por rol)
// Soporta tipo=09 (Guías de Remisión) via UNION ALL con comprobantes_guias.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get("tipo"); // '01'|'03'|'07'|'08'|'09'|null
    const empresa = searchParams.get("empresa");
    const pedidoId = searchParams.get("pedido_id");
    const clienteDocNum = searchParams.get("cliente_doc_num")?.trim();
    // Búsqueda SERVER-SIDE (toda la BD, no solo lo cargado) + rango de fechas.
    const searchRaw = searchParams.get("search");
    const desdeRaw = searchParams.get("desde"); // YYYY-MM-DD
    const hastaRaw = searchParams.get("hasta"); // YYYY-MM-DD
    const esFecha = (s: string | null): s is string =>
      !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    // Saneo del término: trim, máx 60, escapar comodines LIKE (\ % _) → patrón %term%.
    const searchTerm = (() => {
      const t = (searchRaw ?? "").trim().slice(0, 60);
      if (!t) return null;
      return `%${t.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    })();

    const sql = neon(process.env.DATABASE_URL!);

    // Una factura/boleta reservada puede haber llegado a SUNAT aunque la función
    // haya muerto. Después de 15 min pasa a consulta, NUNCA directamente a
    // rechazo/error ni a una emisión con otro correlativo.
    try {
      await sql`
        UPDATE comprobantes
        SET estado = 'por_confirmar',
            mensaje_sunat = 'La emisión se interrumpió y SUNAT puede haber recibido el comprobante. El sistema verificará este mismo número; no emitas otro.',
            sunat_siguiente_consulta_at = NOW()
        WHERE estado = 'emitiendo'
          AND tipo IN ('01', '03')
          AND created_at < NOW() - INTERVAL '15 minutes'
      `;

      // NC/ND conservan exactamente el flujo de reintento previo.
      await sql`
        UPDATE comprobantes
        SET estado = 'error',
            mensaje_sunat = 'La emisión se interrumpió. Reintenta este mismo comprobante; no emitas otro correlativo.'
        WHERE estado = 'emitiendo'
          AND tipo NOT IN ('01', '03')
          AND created_at < NOW() - INTERVAL '15 minutes'
      `;
    } catch (e) {
      console.error("No se pudieron sanear CPE atascados en 'emitiendo':", e);
    }

    // ── Saneo lazy: una guía en 'emitiendo' por más de 15 min es una emisión
    // INTERRUMPIDA (la función murió a mitad del polling SUNAT — caso T002-10,
    // 10 jun 2026). Se marca 'error' con instrucción de usar "Reintentar emisión"
    // (mismo número) para que la fila no quede "emitiendo" para siempre en la UI.
    try {
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'error',
            mensaje_sunat = 'La emisión se interrumpió y no se sabe si SUNAT la recibió. Usa "Reintentar emisión" (conserva el mismo número) — NO emitas otra guía para este documento.',
            updated_at = NOW()
        WHERE estado = 'emitiendo' AND created_at < NOW() - INTERVAL '15 minutes'
      `;
    } catch (e) {
      console.error("No se pudo sanear guías atascadas en 'emitiendo':", e);
    }

    // ── Helper: cláusula WHERE desde filtros comunes aplicados a una subconsulta ──
    // Los parámetros se acumulan en `params`; el índice `i` arranca en el valor
    // que se pasa (mutable por referencia via objeto).
    const ctx = { i: 1 };
    const params: unknown[] = [];
    const outerConditions: string[] = [];

    if (pedidoId && /^[0-9a-f-]{36}$/i.test(pedidoId)) {
      outerConditions.push(`t.pedido_id = $${ctx.i++}::uuid`);
      params.push(pedidoId);
    }

    if (session.user.role === "asesor") {
      outerConditions.push(
        `(t.pedido_id IN (SELECT id FROM pedidos WHERE asesor_id = $${ctx.i}) OR LOWER(TRIM(t.emitido_por)) = LOWER(TRIM($${ctx.i + 1})))`
      );
      params.push(session.user.id, session.user.name ?? "");
      ctx.i += 2;
    }

    if (empresa && (empresa === "transavic" || empresa === "avicola")) {
      outerConditions.push(`t.empresa = $${ctx.i++}`);
      params.push(empresa);
    }

    // Filtro por OPERACIÓN de venta (derivada de los vínculos, no de una columna
    // aparte): campo = venta_avicola_id; planta = pedido origen pos_planta; ejecutivas
    // = el resto (pedido de asesora o suelto). Sin params (condiciones literales).
    const operacion = searchParams.get("operacion");
    if (operacion === "campo") {
      outerConditions.push(`t.venta_avicola_id IS NOT NULL`);
    } else if (operacion === "planta") {
      outerConditions.push(`t.venta_avicola_id IS NULL AND p.origen = 'pos_planta'`);
    } else if (operacion === "ejecutivas") {
      outerConditions.push(
        `t.venta_avicola_id IS NULL AND (p.origen IS NULL OR p.origen <> 'pos_planta')`
      );
    }

    if (clienteDocNum && /^\d{8,11}$/.test(clienteDocNum)) {
      outerConditions.push(`t.cliente_doc_num = $${ctx.i++}`);
      params.push(clienteDocNum);
    }

    // Búsqueda libre: número / razón social / RUC-DNI / nombre del cliente del pedido.
    // Un solo placeholder reutilizado en las 4 columnas (PG posicional lo permite).
    if (searchTerm) {
      const n = ctx.i++;
      outerConditions.push(
        `(t.serie_numero ILIKE $${n} ESCAPE '\\' OR t.cliente_razon_social ILIKE $${n} ESCAPE '\\' OR t.cliente_doc_num ILIKE $${n} ESCAPE '\\' OR COALESCE(p.cliente, '') ILIKE $${n} ESCAPE '\\')`
      );
      params.push(searchTerm);
    }
    // Rango de fechas por la fecha de emisión real (o created_at Lima de fallback),
    // expuesta como `t.fecha_filtro` en las subconsultas.
    if (esFecha(desdeRaw)) {
      outerConditions.push(`t.fecha_filtro >= $${ctx.i++}`);
      params.push(desdeRaw);
    }
    if (esFecha(hastaRaw)) {
      outerConditions.push(`t.fecha_filtro <= $${ctx.i++}`);
      params.push(hastaRaw);
    }

    const outerWhere =
      outerConditions.length > 0
        ? `WHERE ${outerConditions.join(" AND ")}`
        : "";

    // NC emitidas antes de `referencia_comprobante_id`: el backend también las
    // reconoce por la auditoría escrita en `observaciones`. La lista replica esa
    // evidencia para no volver a ofrecer una NC que el endpoint rechazaría con 409.
    const ncHistoricaSerieSql =
      "substring(c.observaciones FROM '(?i)nota de cr[eé]dito[[:space:]]+([^[:space:]]+)[[:space:]]+[(]ACEPTADA')";
    const ncHistoricaAceptadaSql = `(${ncHistoricaSerieSql}) IS NOT NULL`;

    // Columnas comunes de CPE/GRE se mantienen alineadas en las dos
    // subconsultas que siguen para que el UNION ALL sea estable.
    const guiaSelect = `
      SELECT
        g.id,
        g.serie_numero,
        '09'::text                          AS tipo,
        g.empresa,
        g.cliente_razon_social              AS cliente_razon_social,
        g.cliente_doc_num                   AS cliente_doc_num,
        0::numeric                          AS monto_total,
        g.estado,
        g.created_at,
        g.mensaje_sunat,
        COALESCE(g.pedido_id, ref.pedido_id) AS pedido_id,
        g.emitido_por,
        ref.venta_avicola_id                AS venta_avicola_id,
        g.comprobante_id                    AS referencia_comprobante_id,
        ref.serie_numero                    AS referencia_serie_numero,
        ref.tipo                            AS referencia_tipo,
        ref.cliente_razon_social            AS referencia_cliente_razon_social,
        ref.monto_total::numeric            AS referencia_monto_total,
        FALSE                               AS tiene_nc,
        FALSE                               AS tiene_nc_bloqueante,
        NULL::uuid                          AS nota_credito_id,
        NULL::text                          AS nota_credito_serie_numero,
        g.peso_bruto_total::numeric         AS peso_bruto_total,
        g.total_bultos::integer             AS total_bultos,
        NULL::text                          AS guia_serie_numero,
        (g.created_at AT TIME ZONE 'America/Lima')::date AS fecha_filtro,
        NULL::text                          AS reemplazada_por,
        NULL::text                          AS codigo_respuesta_sunat,
        NULL::timestamptz                   AS ultima_consulta_sunat_at,
        NULL::timestamptz                   AS proxima_consulta_sunat_at,
        FALSE                               AS tiene_cdr,
        FALSE                               AS requiere_revision_sunat,
        NULL::text                          AS revision_motivo_sunat
      FROM comprobantes_guias g
      LEFT JOIN comprobantes ref ON g.comprobante_id = ref.id`;

    // LIMIT con margen: 500 cuando hay búsqueda o rango de fechas (el usuario espera
    // ver todo el rango), 300 en la vista normal (la paginación client-side es de 15).
    const LIMITE =
      searchTerm || esFecha(desdeRaw) || esFecha(hastaRaw) ? 500 : 300;

    let query: string;

    if (tipo === "09") {
      // Solo guías
      query = `
        SELECT t.*, p.cliente AS pedido_cliente, p.origen AS pedido_origen
        FROM (${guiaSelect}) t
        LEFT JOIN pedidos p ON t.pedido_id = p.id
        ${outerWhere}
        ORDER BY t.created_at DESC
        LIMIT ${LIMITE}`;
    } else if (
      tipo === "01" ||
      tipo === "03" ||
      tipo === "07" ||
      tipo === "08"
    ) {
      // Solo comprobantes del tipo indicado — añadir filtro de tipo DENTRO de la subconsulta
      const cpeSelectWithTipo = `
        SELECT
          c.id, c.serie_numero, c.tipo, c.empresa, c.cliente_razon_social,
          c.cliente_doc_num, c.monto_total::numeric AS monto_total, c.estado,
          c.created_at, c.mensaje_sunat,
          COALESCE(c.pedido_id, ref.pedido_id) AS pedido_id,
          c.emitido_por,
          COALESCE(c.venta_avicola_id, ref.venta_avicola_id) AS venta_avicola_id,
          c.referencia_comprobante_id,
          ref.serie_numero AS referencia_serie_numero,
          ref.tipo         AS referencia_tipo,
          ref.cliente_razon_social AS referencia_cliente_razon_social,
          ref.monto_total::numeric AS referencia_monto_total,
          (
            EXISTS (
              SELECT 1 FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND nc.estado IN ('aceptado', 'observado')
            )
            OR ${ncHistoricaAceptadaSql}
          ) AS tiene_nc,
          (
            EXISTS (
              SELECT 1 FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND (
                  nc.estado NOT IN ('error', 'rechazado', 'anulado')
                  OR (nc.estado = 'error' AND nc.xml_firmado_base64 IS NOT NULL)
                )
            )
            OR ${ncHistoricaAceptadaSql}
          ) AS tiene_nc_bloqueante,
          COALESCE(
            (
              SELECT nc.id FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND nc.estado IN ('aceptado', 'observado')
              ORDER BY nc.created_at DESC, nc.id DESC
              LIMIT 1
            ),
            (
              SELECT nc_hist.id FROM comprobantes nc_hist
              WHERE nc_hist.empresa = c.empresa
                AND nc_hist.tipo = '07'
                AND nc_hist.estado IN ('aceptado', 'observado')
                AND nc_hist.serie_numero = ${ncHistoricaSerieSql}
              ORDER BY nc_hist.created_at DESC, nc_hist.id DESC
              LIMIT 1
            )
          ) AS nota_credito_id,
          COALESCE(
            (
              SELECT nc.serie_numero FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND nc.estado IN ('aceptado', 'observado')
              ORDER BY nc.created_at DESC, nc.id DESC
              LIMIT 1
            ),
            ${ncHistoricaSerieSql}
          ) AS nota_credito_serie_numero,
          NULL::numeric  AS peso_bruto_total,
          NULL::integer  AS total_bultos,
          (
            SELECT string_agg(g.serie_numero, ', ')
            FROM comprobantes_guias g
            WHERE g.comprobante_id = c.id
          )              AS guia_serie_numero,
          COALESCE(c.fecha_emision, (c.created_at AT TIME ZONE 'America/Lima')::date) AS fecha_filtro,
          COALESCE(
            (SELECT hijo.serie_numero FROM comprobantes hijo
               WHERE hijo.reemplaza_comprobante_id = c.id
                 AND hijo.tipo IN ('01','03')
               ORDER BY hijo.created_at DESC, hijo.id DESC LIMIT 1),
            (SELECT nc2.serie_numero FROM comprobantes nc2
               WHERE c.tipo = '07' AND nc2.tipo = '07' AND nc2.estado IN ('aceptado','observado')
                 AND nc2.referencia_comprobante_id = c.referencia_comprobante_id AND nc2.id <> c.id
               ORDER BY nc2.created_at DESC LIMIT 1)
          ) AS reemplazada_por,
          COALESCE(c.sunat_codigo_consulta, c.sunat_codigo_envio)
            AS codigo_respuesta_sunat,
          c.sunat_ultima_consulta_at AS ultima_consulta_sunat_at,
          c.sunat_siguiente_consulta_at AS proxima_consulta_sunat_at,
          c.sunat_cdr_legible AS tiene_cdr,
          c.sunat_requiere_revision AS requiere_revision_sunat,
          c.sunat_revision_motivo AS revision_motivo_sunat
        FROM comprobantes c
        LEFT JOIN comprobantes ref ON c.referencia_comprobante_id = ref.id
        WHERE c.tipo = $${ctx.i++}`;
      params.push(tipo);

      query = `
        SELECT t.*, p.cliente AS pedido_cliente, p.origen AS pedido_origen
        FROM (${cpeSelectWithTipo}) t
        LEFT JOIN pedidos p ON t.pedido_id = p.id
        ${outerWhere}
        ORDER BY t.created_at DESC
        LIMIT ${LIMITE}`;
    } else {
      // Todos (UNION ALL): comprobantes + guías
      // Para comprobantes necesitamos los JOINs de referencia y tiene_nc;
      // los hacemos dentro de la subconsulta.
      const cpeSelectFull = `
        SELECT
          c.id, c.serie_numero, c.tipo, c.empresa, c.cliente_razon_social,
          c.cliente_doc_num, c.monto_total::numeric AS monto_total, c.estado,
          c.created_at, c.mensaje_sunat,
          COALESCE(c.pedido_id, ref.pedido_id) AS pedido_id,
          c.emitido_por,
          COALESCE(c.venta_avicola_id, ref.venta_avicola_id) AS venta_avicola_id,
          c.referencia_comprobante_id,
          ref.serie_numero AS referencia_serie_numero,
          ref.tipo         AS referencia_tipo,
          ref.cliente_razon_social AS referencia_cliente_razon_social,
          ref.monto_total::numeric AS referencia_monto_total,
          (
            EXISTS (
              SELECT 1 FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND nc.estado IN ('aceptado', 'observado')
            )
            OR ${ncHistoricaAceptadaSql}
          ) AS tiene_nc,
          (
            EXISTS (
              SELECT 1 FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND (
                  nc.estado NOT IN ('error', 'rechazado', 'anulado')
                  OR (nc.estado = 'error' AND nc.xml_firmado_base64 IS NOT NULL)
                )
            )
            OR ${ncHistoricaAceptadaSql}
          ) AS tiene_nc_bloqueante,
          COALESCE(
            (
              SELECT nc.id FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND nc.estado IN ('aceptado', 'observado')
              ORDER BY nc.created_at DESC, nc.id DESC
              LIMIT 1
            ),
            (
              SELECT nc_hist.id FROM comprobantes nc_hist
              WHERE nc_hist.empresa = c.empresa
                AND nc_hist.tipo = '07'
                AND nc_hist.estado IN ('aceptado', 'observado')
                AND nc_hist.serie_numero = ${ncHistoricaSerieSql}
              ORDER BY nc_hist.created_at DESC, nc_hist.id DESC
              LIMIT 1
            )
          ) AS nota_credito_id,
          COALESCE(
            (
              SELECT nc.serie_numero FROM comprobantes nc
              WHERE nc.referencia_comprobante_id = c.id
                AND nc.tipo = '07'
                AND nc.estado IN ('aceptado', 'observado')
              ORDER BY nc.created_at DESC, nc.id DESC
              LIMIT 1
            ),
            ${ncHistoricaSerieSql}
          ) AS nota_credito_serie_numero,
          NULL::numeric  AS peso_bruto_total,
          NULL::integer  AS total_bultos,
          (
            SELECT string_agg(g.serie_numero, ', ')
            FROM comprobantes_guias g
            WHERE g.comprobante_id = c.id
          )              AS guia_serie_numero,
          COALESCE(c.fecha_emision, (c.created_at AT TIME ZONE 'America/Lima')::date) AS fecha_filtro,
          COALESCE(
            (SELECT hijo.serie_numero FROM comprobantes hijo
               WHERE hijo.reemplaza_comprobante_id = c.id
                 AND hijo.tipo IN ('01','03')
               ORDER BY hijo.created_at DESC, hijo.id DESC LIMIT 1),
            (SELECT nc2.serie_numero FROM comprobantes nc2
               WHERE c.tipo = '07' AND nc2.tipo = '07' AND nc2.estado IN ('aceptado','observado')
                 AND nc2.referencia_comprobante_id = c.referencia_comprobante_id AND nc2.id <> c.id
               ORDER BY nc2.created_at DESC LIMIT 1)
          ) AS reemplazada_por,
          COALESCE(c.sunat_codigo_consulta, c.sunat_codigo_envio)
            AS codigo_respuesta_sunat,
          c.sunat_ultima_consulta_at AS ultima_consulta_sunat_at,
          c.sunat_siguiente_consulta_at AS proxima_consulta_sunat_at,
          c.sunat_cdr_legible AS tiene_cdr,
          c.sunat_requiere_revision AS requiere_revision_sunat,
          c.sunat_revision_motivo AS revision_motivo_sunat
        FROM comprobantes c
        LEFT JOIN comprobantes ref ON c.referencia_comprobante_id = ref.id`;

      query = `
        SELECT t.*, p.cliente AS pedido_cliente, p.origen AS pedido_origen
        FROM (
          ${cpeSelectFull}
          UNION ALL
          ${guiaSelect}
        ) t
        LEFT JOIN pedidos p ON t.pedido_id = p.id
        ${outerWhere}
        ORDER BY t.created_at DESC
        LIMIT ${LIMITE}`;
    }

    const rows = await sql.query(query, params);
    return NextResponse.json({ data: rows, alcanzoTope: rows.length >= LIMITE });
  } catch (error) {
    console.error("Error en GET /api/comprobantes:", error);
    return NextResponse.json(
      { error: "Error al cargar comprobantes" },
      { status: 500 }
    );
  }
}

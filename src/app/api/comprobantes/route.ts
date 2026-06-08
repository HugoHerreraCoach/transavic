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

    const sql = neon(process.env.DATABASE_URL!);

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

    if (clienteDocNum && /^\d{8,11}$/.test(clienteDocNum)) {
      outerConditions.push(`t.cliente_doc_num = $${ctx.i++}`);
      params.push(clienteDocNum);
    }

    const outerWhere =
      outerConditions.length > 0
        ? `WHERE ${outerConditions.join(" AND ")}`
        : "";

    // ── Columnas comunes de la subconsulta (misma forma para ambas tablas) ────
    // comprobantes tiene: monto_total, estado, mensaje_sunat, referencia_comprobante_id, emitido_por
    // comprobantes_guias: peso_bruto_total, total_bultos (extras); sin monto real
    const cpeSelect = `
      SELECT
        c.id,
        c.serie_numero,
        c.tipo,
        c.empresa,
        c.cliente_razon_social,
        c.cliente_doc_num,
        c.monto_total::numeric             AS monto_total,
        c.estado,
        c.created_at,
        c.mensaje_sunat,
        c.pedido_id,
        c.emitido_por,
        c.referencia_comprobante_id,
        NULL::text                          AS referencia_serie_numero,
        NULL::text                          AS referencia_tipo,
        NULL::text                          AS referencia_cliente_razon_social,
        NULL::numeric                       AS referencia_monto_total,
        FALSE                               AS tiene_nc,
        NULL::numeric                       AS peso_bruto_total,
        NULL::integer                       AS total_bultos,
        (
          SELECT string_agg(g.serie_numero, ', ')
          FROM comprobantes_guias g
          WHERE g.comprobante_id = c.id
        )                                   AS guia_serie_numero
      FROM comprobantes c`;

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
        g.pedido_id,
        g.emitido_por,
        g.comprobante_id                    AS referencia_comprobante_id,
        ref.serie_numero                    AS referencia_serie_numero,
        ref.tipo                            AS referencia_tipo,
        ref.cliente_razon_social            AS referencia_cliente_razon_social,
        ref.monto_total::numeric            AS referencia_monto_total,
        FALSE                               AS tiene_nc,
        g.peso_bruto_total::numeric         AS peso_bruto_total,
        g.total_bultos::integer             AS total_bultos,
        NULL::text                          AS guia_serie_numero
      FROM comprobantes_guias g
      LEFT JOIN comprobantes ref ON g.comprobante_id = ref.id`;

    let query: string;

    if (tipo === "09") {
      // Solo guías
      query = `
        SELECT t.*, p.cliente AS pedido_cliente
        FROM (${guiaSelect}) t
        LEFT JOIN pedidos p ON t.pedido_id = p.id
        ${outerWhere}
        ORDER BY t.created_at DESC
        LIMIT 100`;
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
          c.created_at, c.mensaje_sunat, c.pedido_id, c.emitido_por,
          c.referencia_comprobante_id,
          ref.serie_numero AS referencia_serie_numero,
          ref.tipo         AS referencia_tipo,
          ref.cliente_razon_social AS referencia_cliente_razon_social,
          ref.monto_total::numeric AS referencia_monto_total,
          EXISTS (
            SELECT 1 FROM comprobantes nc
            WHERE nc.referencia_comprobante_id = c.id
              AND nc.tipo = '07'
              AND nc.estado IN ('aceptado', 'observado')
          ) AS tiene_nc,
          NULL::numeric  AS peso_bruto_total,
          NULL::integer  AS total_bultos,
          (
            SELECT string_agg(g.serie_numero, ', ')
            FROM comprobantes_guias g
            WHERE g.comprobante_id = c.id
          )              AS guia_serie_numero
        FROM comprobantes c
        LEFT JOIN comprobantes ref ON c.referencia_comprobante_id = ref.id
        WHERE c.tipo = $${ctx.i++}`;
      params.push(tipo);

      query = `
        SELECT t.*, p.cliente AS pedido_cliente
        FROM (${cpeSelectWithTipo}) t
        LEFT JOIN pedidos p ON t.pedido_id = p.id
        ${outerWhere}
        ORDER BY t.created_at DESC
        LIMIT 100`;
    } else {
      // Todos (UNION ALL): comprobantes + guías
      // Para comprobantes necesitamos los JOINs de referencia y tiene_nc;
      // los hacemos dentro de la subconsulta.
      const cpeSelectFull = `
        SELECT
          c.id, c.serie_numero, c.tipo, c.empresa, c.cliente_razon_social,
          c.cliente_doc_num, c.monto_total::numeric AS monto_total, c.estado,
          c.created_at, c.mensaje_sunat, c.pedido_id, c.emitido_por,
          c.referencia_comprobante_id,
          ref.serie_numero AS referencia_serie_numero,
          ref.tipo         AS referencia_tipo,
          ref.cliente_razon_social AS referencia_cliente_razon_social,
          ref.monto_total::numeric AS referencia_monto_total,
          EXISTS (
            SELECT 1 FROM comprobantes nc
            WHERE nc.referencia_comprobante_id = c.id
              AND nc.tipo = '07'
              AND nc.estado IN ('aceptado', 'observado')
          ) AS tiene_nc,
          NULL::numeric  AS peso_bruto_total,
          NULL::integer  AS total_bultos,
          (
            SELECT string_agg(g.serie_numero, ', ')
            FROM comprobantes_guias g
            WHERE g.comprobante_id = c.id
          )              AS guia_serie_numero
        FROM comprobantes c
        LEFT JOIN comprobantes ref ON c.referencia_comprobante_id = ref.id`;

      query = `
        SELECT t.*, p.cliente AS pedido_cliente
        FROM (
          ${cpeSelectFull}
          UNION ALL
          ${guiaSelect}
        ) t
        LEFT JOIN pedidos p ON t.pedido_id = p.id
        ${outerWhere}
        ORDER BY t.created_at DESC
        LIMIT 100`;
    }

    const rows = await sql.query(query, params);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("Error en GET /api/comprobantes:", error);
    return NextResponse.json(
      { error: "Error al cargar comprobantes" },
      { status: 500 }
    );
  }
}

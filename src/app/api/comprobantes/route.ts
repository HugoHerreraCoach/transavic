// src/app/api/comprobantes/route.ts
// GET — listar comprobantes (con scoping por rol)
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
    const tipo = searchParams.get("tipo"); // '01' | '03' | null
    const empresa = searchParams.get("empresa"); // 'transavic' | 'avicola' | null
    const pedidoId = searchParams.get("pedido_id"); // UUID | null (para verificar si pedido ya tiene comprobante)

    const sql = neon(process.env.DATABASE_URL!);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    // Filtro por pedido específico (lazy check de "ya facturado")
    if (pedidoId && /^[0-9a-f-]{36}$/i.test(pedidoId)) {
      conditions.push(`c.pedido_id = $${i++}::uuid`);
      params.push(pedidoId);
    }

    // Scoping por rol (Antonio, jun 2026): la asesora ve SOLO SUS comprobantes —
    // los de SUS pedidos (pedidos.asesor_id) o los que ELLA emitió (emitido_por,
    // match por nombre con TRIM+lower por la data legacy con espacios). El admin ve
    // todos. (La asesora conserva permisos completos sobre los suyos: PDF/XML/NC/etc.)
    if (session.user.role === "asesor") {
      conditions.push(
        `(c.pedido_id IN (SELECT id FROM pedidos WHERE asesor_id = $${i}) OR LOWER(TRIM(c.emitido_por)) = LOWER(TRIM($${i + 1})))`
      );
      params.push(session.user.id, session.user.name ?? "");
      i += 2;
    }

    if (tipo && (tipo === "01" || tipo === "03" || tipo === "07" || tipo === "08")) {
      conditions.push(`c.tipo = $${i++}`);
      params.push(tipo);
    }

    if (empresa && (empresa === "transavic" || empresa === "avicola")) {
      conditions.push(`c.empresa = $${i++}`);
      params.push(empresa);
    }

    // Filtro por documento del cliente — usado por el modal "Cobranza manual"
    // para mostrar SOLO las facturas/boletas emitidas a ese cliente.
    const clienteDocNum = searchParams.get("cliente_doc_num")?.trim();
    if (clienteDocNum && /^\d{8,11}$/.test(clienteDocNum)) {
      conditions.push(`c.cliente_doc_num = $${i++}`);
      params.push(clienteDocNum);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await sql.query(
      `SELECT c.id, c.serie_numero, c.tipo, c.empresa, c.cliente_razon_social,
        c.cliente_doc_num, c.monto_total, c.estado, c.created_at, c.mensaje_sunat,
        p.cliente AS pedido_cliente,
        c.emitido_por,
        c.referencia_comprobante_id,
        ref.serie_numero AS referencia_serie_numero,
        ref.tipo         AS referencia_tipo,
        EXISTS (
          SELECT 1 FROM comprobantes nc
          WHERE nc.referencia_comprobante_id = c.id
            AND nc.tipo = '07'
            AND nc.estado IN ('aceptado', 'observado')
        ) AS tiene_nc
      FROM comprobantes c
      LEFT JOIN pedidos p ON c.pedido_id = p.id
      LEFT JOIN comprobantes ref ON c.referencia_comprobante_id = ref.id
      ${where}
      ORDER BY c.created_at DESC
      LIMIT 100`,
      params
    );

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("Error en GET /api/comprobantes:", error);
    return NextResponse.json(
      { error: "Error al cargar comprobantes" },
      { status: 500 }
    );
  }
}

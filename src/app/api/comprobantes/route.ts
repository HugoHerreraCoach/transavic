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

    // Scoping: asesor solo ve comprobantes de sus pedidos
    if (session.user.role === "asesor") {
      conditions.push(
        `c.pedido_id IN (SELECT id FROM pedidos WHERE asesor_id = $${i++})`
      );
      params.push(session.user.id);
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
        p.cliente AS pedido_cliente
      FROM comprobantes c
      LEFT JOIN pedidos p ON c.pedido_id = p.id
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

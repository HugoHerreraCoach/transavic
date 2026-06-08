// src/app/api/guias/route.ts
// GET — listar Guías de Remisión Electrónicas (con scoping por rol)

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
    const empresa = searchParams.get("empresa"); // 'transavic' | 'avicola' | null
    const pedidoId = searchParams.get("pedido_id"); // UUID | null

    const sql = neon(process.env.DATABASE_URL!);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    // Filtro por pedido
    if (pedidoId && /^[0-9a-f-]{36}$/i.test(pedidoId)) {
      conditions.push(`c.pedido_id = $${i++}::uuid`);
      params.push(pedidoId);
    }

    // Scoping por rol: Asesora ve solo sus guías de remisión
    if (session.user.role === "asesor") {
      conditions.push(
        `(c.pedido_id IN (SELECT id FROM pedidos WHERE asesor_id = $${i}) OR LOWER(TRIM(c.emitido_por)) = LOWER(TRIM($${i + 1})))`
      );
      params.push(session.user.id, session.user.name ?? "");
      i += 2;
    }

    if (empresa && (empresa === "transavic" || empresa === "avicola")) {
      conditions.push(`c.empresa = $${i++}`);
      params.push(empresa);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await sql.query(
      `SELECT c.id, c.pedido_id, c.ruc_emisor, c.empresa, c.serie_numero, c.serie, c.numero,
              c.cliente_doc_num, c.cliente_razon_social, c.peso_bruto_total, c.total_bultos,
              c.fecha_inicio_traslado, c.vehiculo_placa, c.chofer_doc_num, c.chofer_licencia,
              c.estado, c.mensaje_sunat, c.emitido_por, c.created_at,
              p.cliente AS pedido_cliente
       FROM comprobantes_guias c
       LEFT JOIN pedidos p ON c.pedido_id = p.id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT 100`,
      params
    );

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("Error en GET /api/guias:", error);
    return NextResponse.json(
      { error: "Error al cargar guías de remisión" },
      { status: 500 }
    );
  }
}

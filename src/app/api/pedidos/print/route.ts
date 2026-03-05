// src/app/api/pedidos/print/route.ts
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
    const fechaInicio = searchParams.get("fecha_inicio") || "";
    const fechaFin = searchParams.get("fecha_fin") || "";
    const empresa = searchParams.get("empresa") || "";
    const asesorId = searchParams.get("asesor_id") || "";
    const countOnly = searchParams.get("count_only") === "true";

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Excluir fallidos siempre
    whereClauses.push(`p.estado != 'Fallido'`);

    // Filtro por fecha inicio
    if (fechaInicio) {
      whereClauses.push(`p.fecha_pedido >= $${paramIndex}`);
      params.push(fechaInicio);
      paramIndex++;
    }

    // Filtro por fecha fin
    if (fechaFin) {
      whereClauses.push(`p.fecha_pedido <= $${paramIndex}`);
      params.push(fechaFin);
      paramIndex++;
    }

    // Filtro por empresa
    if (empresa) {
      whereClauses.push(`p.empresa = $${paramIndex}`);
      params.push(empresa);
      paramIndex++;
    }

    // Filtro por asesor (admin) o restricción por rol
    if (session.user.role === "asesor") {
      whereClauses.push(`p.asesor_id = $${paramIndex}`);
      params.push(session.user.id);
      paramIndex++;
    } else if (asesorId) {
      whereClauses.push(`p.asesor_id = $${paramIndex}`);
      params.push(asesorId);
      paramIndex++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Si solo pidió conteo
    if (countOnly) {
      const countQuery = `SELECT COUNT(*) as total FROM pedidos AS p ${whereString}`;
      const countResult = await sql.query(countQuery, params);
      return NextResponse.json({ count: Number((countResult[0] as { total: string }).total) });
    }

    // Consulta completa sin LIMIT/OFFSET
    const query = `
      SELECT
        p.id, p.cliente, p.whatsapp, p.empresa, p.direccion, p.distrito,
        p.tipo_cliente, p.hora_entrega, p.razon_social, p.ruc_dni, p.notas,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        p.detalle, p.detalle_final, p.created_at, p.latitude, p.longitude,
        p.asesor_id, p.entregado, p.entregado_por, p.entregado_at,
        p.estado, p.repartidor_id, p.orden_ruta,
        u.name as asesor_name,
        r.name as repartidor_name
      FROM pedidos AS p
      LEFT JOIN users AS u ON p.asesor_id = u.id
      LEFT JOIN users AS r ON p.repartidor_id = r.id
      ${whereString}
      ORDER BY p.created_at ASC
    `;

    const data = await sql.query(query, params);

    const pedidos = (data as Array<Record<string, unknown>>).map((p) => ({
      ...p,
      detalle_final: p.detalle_final || null,
      created_at: new Date(p.created_at as string),
      latitude: p.latitude ? parseFloat(p.latitude as string) : null,
      longitude: p.longitude ? parseFloat(p.longitude as string) : null,
    }));

    return NextResponse.json({ data: pedidos, count: pedidos.length });
  } catch (error) {
    console.error("Error GET /api/pedidos/print:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

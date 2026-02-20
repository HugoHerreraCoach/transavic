// src/app/api/resumen-diario/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/auth";

type ItemRow = { pedido_id: string; producto_nombre: string; cantidad: string; unidad: string };

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no está definida");

    const sql = neon(connectionString);
    const searchParams = request.nextUrl.searchParams;
    const fechaParam = searchParams.get("fecha");

    // Default: yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const fecha = fechaParam || yesterday.toISOString().split("T")[0];

    // ── Pedidos del día ──
    const pedidos = await sql`
      SELECT
        p.id, p.cliente, p.whatsapp, p.empresa, p.direccion, p.distrito,
        p.hora_entrega, p.notas, p.detalle, p.detalle_final, p.entregado,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        u.name as asesor_name
      FROM pedidos p
      LEFT JOIN users u ON p.asesor_id = u.id
      WHERE p.fecha_pedido = ${fecha}::date
      ORDER BY p.entregado ASC, p.created_at ASC
    `;

    // ── Items de los pedidos del día ──
    const pedidoIds = pedidos.map((p) => p.id as string);
    let items: ItemRow[] = [];
    if (pedidoIds.length > 0) {
      items = await sql`
        SELECT pedido_id, producto_nombre, cantidad, unidad
        FROM pedido_items
        WHERE pedido_id = ANY(${pedidoIds}::uuid[])
        ORDER BY producto_nombre ASC
      ` as ItemRow[];
    }

    // ── Totales por producto ──
    const totalesPorProducto = await sql`
      SELECT 
        pi.producto_nombre as nombre,
        pi.unidad,
        SUM(pi.cantidad) as total
      FROM pedido_items pi
      JOIN pedidos p ON pi.pedido_id = p.id
      WHERE p.fecha_pedido = ${fecha}::date
      GROUP BY pi.producto_nombre, pi.unidad
      ORDER BY pi.producto_nombre ASC
    `;

    // ── KPIs del día ──
    const kpis = {
      total: pedidos.length,
      entregados: pedidos.filter((p) => p.entregado).length,
      pendientes: pedidos.filter((p) => !p.entregado).length,
    };

    // Group items by pedido_id
    const itemsByPedido: Record<string, ItemRow[]> = {};
    for (const item of items) {
      if (!itemsByPedido[item.pedido_id]) {
        itemsByPedido[item.pedido_id] = [];
      }
      itemsByPedido[item.pedido_id].push(item);
    }

    // Attach items to pedidos
    const pedidosConItems = pedidos.map((p) => ({
      ...p,
      items: itemsByPedido[p.id as string] || [],
    }));

    return NextResponse.json({
      fecha,
      kpis,
      pedidos: pedidosConItems,
      totalesPorProducto,
    });
  } catch (error) {
    console.error("Error en resumen diario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

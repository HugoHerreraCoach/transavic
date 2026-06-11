// src/app/api/produccion/pedidos/route.ts
// GET /api/produccion/pedidos — cola de pedidos del día para la asistente
// Aplica "No me hagas pensar": ya viene ordenado por urgencia (hora de entrega más temprana primero)
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { derivarEInsertarItemsDesdeDetalle } from "@/lib/parse-detalle-pedido";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "produccion"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Producción o Admin pueden acceder" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fecha = searchParams.get("fecha"); // formato YYYY-MM-DD
    const search = searchParams.get("q")?.trim();

    const sql = neon(process.env.DATABASE_URL!);

    // Filtros base: solo pedidos que producción puede tocar
    const conditions: string[] = [
      "p.estado IN ('Pendiente', 'En_Produccion', 'Listo_Para_Despacho')",
    ];
    const params: unknown[] = [];
    let i = 1;

    if (fecha) {
      conditions.push(`p.fecha_pedido = $${i++}::date`);
      params.push(fecha);
    } else {
      conditions.push(`p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date`);
    }

    if (search) {
      conditions.push(`(p.cliente ILIKE $${i} OR p.distrito ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // Trae pedido + items con precio + asesor
    const pedidos = await sql.query(
      `SELECT
        p.id, p.cliente, p.distrito, p.hora_entrega, p.empresa,
        p.detalle, p.notas, p.estado,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        u.name as asesor_name
      FROM pedidos p
      LEFT JOIN users u ON p.asesor_id = u.id
      ${where}
      ORDER BY
        CASE p.estado
          WHEN 'Pendiente' THEN 0
          WHEN 'En_Produccion' THEN 1
          WHEN 'Listo_Para_Despacho' THEN 2
        END,
        p.hora_entrega NULLS LAST,
        p.created_at ASC`,
      params
    );

    // Para cada pedido, traer sus items
    const pedidoIds = pedidos.map((p) => p.id as string);
    let items: Array<Record<string, unknown>> = [];
    if (pedidoIds.length > 0) {
      items = (await sql`
        SELECT id, pedido_id, producto_id, producto_nombre, cantidad, unidad,
          precio_unitario, subtotal, cantidad_real, subtotal_real, notas
        FROM pedido_items
        WHERE pedido_id = ANY(${pedidoIds}::uuid[])
        ORDER BY producto_nombre ASC
      `) as Array<Record<string, unknown>>;
    }

    // Agrupar items por pedido
    const itemsPorPedido: Record<string, Array<Record<string, unknown>>> = {};
    for (const it of items) {
      const pid = it.pedido_id as string;
      if (!itemsPorPedido[pid]) itemsPorPedido[pid] = [];
      itemsPorPedido[pid].push(it);
    }

    // ── Backfill lazy: un pedido SIN pedido_items no se puede pesar (modal vacío,
    // S/ 0.00 — caso Manuel lince/Nikuya 11 jun 2026, creados por "Duplicar pedido"
    // que solo copiaba el texto). Derivamos los ítems del texto del detalle, los
    // persistimos y los servimos en esta misma respuesta. Idempotente: solo corre
    // para pedidos con 0 ítems y detalle no vacío.
    const sinItems = pedidos.filter(
      (p) => !itemsPorPedido[p.id as string] && String(p.detalle || "").trim()
    );
    for (const p of sinItems) {
      try {
        const n = await derivarEInsertarItemsDesdeDetalle(
          sql,
          p.id as string,
          p.detalle as string
        );
        if (n > 0) {
          const nuevos = (await sql`
            SELECT id, pedido_id, producto_id, producto_nombre, cantidad, unidad,
              precio_unitario, subtotal, cantidad_real, subtotal_real, notas
            FROM pedido_items
            WHERE pedido_id = ${p.id}::uuid
            ORDER BY producto_nombre ASC
          `) as Array<Record<string, unknown>>;
          itemsPorPedido[p.id as string] = nuevos;
        }
      } catch (e) {
        console.error(`Backfill de ítems falló para pedido ${p.id}:`, e);
      }
    }

    const data = pedidos.map((p) => ({
      ...p,
      items: itemsPorPedido[p.id as string] || [],
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Error en GET /api/produccion/pedidos:", error);
    return NextResponse.json(
      { error: "Error al obtener pedidos de producción" },
      { status: 500 }
    );
  }
}

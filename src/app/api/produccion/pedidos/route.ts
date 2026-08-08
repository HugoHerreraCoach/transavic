// src/app/api/produccion/pedidos/route.ts
// GET /api/produccion/pedidos — cola de pedidos del día para la asistente
// Aplica "No me hagas pensar": ya viene ordenado por urgencia (hora de entrega más temprana primero)
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { reconciliarItemsDesdeDetalle } from "@/lib/parse-detalle-pedido";

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
    // Con `incluir_despachados=1` entran también los pedidos que ya salieron
    // (Asignado / En_Camino / Entregado). Producción no puede TOCARLOS —sus
    // endpoints /pesos, /listo y /reabrir devuelven 400 fuera de los 3 estados
    // de abajo—, pero sí necesita poder REIMPRIMIR su guía: antes había que
    // devolver el pedido a producción, imprimir y reasignarlo (doble trabajo).
    const incluirDespachados = searchParams.get("incluir_despachados") === "1";

    const sql = neon(process.env.DATABASE_URL!);

    // Filtros base: por defecto, solo pedidos que producción puede tocar. El
    // default NO cambia: la cola de trabajo del día se sigue viendo igual.
    const conditions: string[] = [
      incluirDespachados
        ? "p.estado IN ('Pendiente', 'En_Produccion', 'Listo_Para_Despacho', 'Asignado', 'En_Camino', 'Entregado')"
        : "p.estado IN ('Pendiente', 'En_Produccion', 'Listo_Para_Despacho')",
      // Las ventas del POS de planta nacen en estado 'Entregado', así que sin
      // este filtro aparecerían en la cola de Producción al incluir despachados.
      // No son pedidos de asesora: se preparan y cobran en el mostrador.
      "COALESCE(p.origen, 'asesor') <> 'pos_planta'",
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
        TO_CHAR(p.reprogramado_de, 'DD/MM') as reprogramado_de,
        p.reprogramado_at, p.reprogramado_motivo,
        u.name as asesor_name
      FROM pedidos p
      LEFT JOIN users u ON p.asesor_id = u.id
      ${where}
      ORDER BY
        CASE p.estado
          WHEN 'Pendiente' THEN 0
          WHEN 'En_Produccion' THEN 1
          WHEN 'Listo_Para_Despacho' THEN 2
          ELSE 3
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
        SELECT id, pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido,
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

    // ── Reconciliación lazy de ítems con el texto del detalle ──
    // Cubre dos casos en una sola pasada (ver reconciliarItemsDesdeDetalle):
    //  (a) Pedido SIN pedido_items → se derivan del detalle (caso histórico
    //      "Duplicar pedido"/detalle a mano — Manuel lince/Nikuya, 11 jun 2026).
    //  (b) Pedido con ítems FUSIONADOS (el mismo producto sumado en una sola fila
    //      por el ProductSelector) y AÚN SIN PESAR → se separan según el detalle,
    //      para que Producción pese cada línea (ej. 2 kg + 3 kg en bolsas separadas).
    // El desglose real solo vive en el texto del detalle; pedido_items lo perdió al
    // sumar. Idempotente y nunca toca pedidos ya pesados.
    // Solo sobre los pedidos que Producción todavía trabaja: al listar fechas
    // pasadas con `incluir_despachados` entrarían cientos de pedidos ya cerrados
    // y este GET se pondría a escribir sobre el histórico. Un pedido ya
    // despachado no se va a pesar, así que reconciliarlo no aporta nada.
    const ESTADOS_RECONCILIABLES = ["Pendiente", "En_Produccion", "Listo_Para_Despacho"];
    for (const p of pedidos) {
      if (!ESTADOS_RECONCILIABLES.includes(String(p.estado))) continue;
      if (!String(p.detalle || "").trim()) continue;
      const actuales = (itemsPorPedido[p.id as string] || []).map((it) => ({
        cantidad_real: (it.cantidad_real as number | string | null) ?? null,
      }));
      try {
        const n = await reconciliarItemsDesdeDetalle(
          sql,
          p.id as string,
          p.detalle as string,
          actuales
        );
        if (n > 0) {
          const nuevos = (await sql`
            SELECT id, pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido,
              precio_unitario, subtotal, cantidad_real, subtotal_real, notas
            FROM pedido_items
            WHERE pedido_id = ${p.id}::uuid
            ORDER BY producto_nombre ASC
          `) as Array<Record<string, unknown>>;
          itemsPorPedido[p.id as string] = nuevos;
        }
      } catch (e) {
        console.error(`Reconciliación de ítems falló para pedido ${p.id}:`, e);
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

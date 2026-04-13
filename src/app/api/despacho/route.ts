// src/app/api/despacho/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // 0. Obtener ubicación base
    const baseResult = await sql`SELECT value FROM settings WHERE key = 'base_location'`;
    const baseLocation = baseResult.length > 0
      ? baseResult[0].value
      : { lat: -12.0464, lng: -77.0428, address: "Centro de Lima", name: "Local Principal" };

    // 1. Pedidos del día de hoy sin asignar (Pendientes)
    const pendientes = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.distancia_km, p.duracion_estimada_min
      FROM pedidos p
      WHERE p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
        AND p.estado = 'Pendiente'
        AND p.repartidor_id IS NULL
        AND (p.es_delivery_externo = false OR p.es_delivery_externo IS NULL)
      ORDER BY p.created_at ASC
    `;

    // 2. Pedidos de la semana (lunes a ayer) sin completar y sin asignar
    const pendientesAnteriores = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.distancia_km, p.duracion_estimada_min
      FROM pedidos p
      WHERE p.fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND p.fecha_pedido < (NOW() AT TIME ZONE 'America/Lima')::date
        AND p.estado NOT IN ('Entregado', 'Fallido')
        AND p.repartidor_id IS NULL
        AND (p.es_delivery_externo = false OR p.es_delivery_externo IS NULL)
      ORDER BY p.fecha_pedido DESC, p.created_at ASC
    `;

    // 2b. Pedidos asignados a delivery externo (hoy + semana)
    const pedidosExternos = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.es_delivery_externo, p.delivery_externo_nombre,
        p.distancia_km, p.duracion_estimada_min
      FROM pedidos p
      WHERE p.fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND p.es_delivery_externo = true
        AND p.estado NOT IN ('Entregado', 'Fallido')
      ORDER BY p.created_at DESC
    `;

    // 3. Repartidores activos con sus pedidos del día
    const repartidores = await sql`
      SELECT id, name, role FROM users WHERE role = 'repartidor' ORDER BY name ASC
    `;

    const pedidosAsignados = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.repartidor_id, p.distancia_km, p.duracion_estimada_min
      FROM pedidos p
      WHERE p.fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND p.repartidor_id IS NOT NULL
      ORDER BY
        CASE p.estado
          WHEN 'En_Camino' THEN 0
          WHEN 'Asignado' THEN 1
          WHEN 'Pendiente' THEN 2
          WHEN 'Entregado' THEN 3
          WHEN 'Fallido' THEN 4
        END,
        p.orden_ruta ASC NULLS LAST,
        p.created_at ASC
    `;

    const parseCoords = (p: Record<string, unknown>) => ({
      ...p,
      latitude: p.latitude ? parseFloat(p.latitude as string) : null,
      longitude: p.longitude ? parseFloat(p.longitude as string) : null,
      distancia_km: p.distancia_km ? parseFloat(p.distancia_km as string) : null,
      duracion_estimada_min: p.duracion_estimada_min ? parseInt(p.duracion_estimada_min as string) : null,
    });

    // Agrupar pedidos por repartidor
    const repartidoresConPedidos = repartidores.map((r) => ({
      ...r,
      pedidos: pedidosAsignados
        .filter((p) => p.repartidor_id === r.id)
        .map(parseCoords),
    }));

    return NextResponse.json({
      pendientes: pendientes.map(parseCoords),
      pendientesAnteriores: pendientesAnteriores.map(parseCoords),
      pedidosExternos: pedidosExternos.map(parseCoords),
      repartidores: repartidoresConPedidos,
      baseLocation,
    });
  } catch (error) {
    console.error("Error en despacho:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}


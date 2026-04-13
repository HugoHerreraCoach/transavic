// src/app/api/despacho/optimizar-ruta/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const OptimizarSchema = z.object({
  repartidor_id: z.string().uuid("ID de repartidor inválido."),
});

interface DirectionsLeg {
  distance: { value: number; text: string };
  duration: { value: number; text: string };
}

interface DirectionsResponse {
  status: string;
  routes: Array<{
    waypoint_order: number[];
    legs: DirectionsLeg[];
  }>;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = OptimizarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { repartidor_id } = parsed.data;

    if (session.user.role !== "admin" && session.user.id !== repartidor_id) {
        return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const googleKey = process.env.Maps_SERVER_KEY;

    if (!googleKey) {
      return NextResponse.json({ error: "Maps_SERVER_KEY no configurada" }, { status: 500 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // 1. Obtener ubicación base
    const baseResult = await sql`SELECT value FROM settings WHERE key = 'base_location'`;
    let baseLocation = {
      lat: parseFloat(process.env.BASE_LATITUDE || "-12.0464"),
      lng: parseFloat(process.env.BASE_LONGITUDE || "-77.0428"),
    };
    if (baseResult.length > 0) {
      const val = baseResult[0].value as { lat: number; lng: number };
      baseLocation = { lat: val.lat, lng: val.lng };
    }

    // 2. Obtener pedidos activos del repartidor (no completados)
    const pedidos = await sql`
      SELECT id, cliente, latitude, longitude, orden_ruta
      FROM pedidos
      WHERE repartidor_id = ${repartidor_id}
        AND fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND estado NOT IN ('Entregado', 'Fallido')
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY orden_ruta ASC NULLS LAST, created_at ASC
    `;

    if (pedidos.length === 0) {
      return NextResponse.json({ error: "No hay pedidos activos con coordenadas para optimizar." }, { status: 400 });
    }

    if (pedidos.length === 1) {
      // Con solo 1 pedido, calcular distancia directa
      const singlePedido = pedidos[0];
      const directUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${baseLocation.lat},${baseLocation.lng}&destination=${singlePedido.latitude},${singlePedido.longitude}&key=${googleKey}&language=es&region=pe&mode=driving`;

      const directRes = await fetch(directUrl);
      const directData = (await directRes.json()) as DirectionsResponse;

      let distKm = 0;
      let durMin = 0;
      if (directData.status === "OK" && directData.routes.length > 0) {
        distKm = Math.round((directData.routes[0].legs[0].distance.value / 1000) * 100) / 100;
        durMin = Math.round(directData.routes[0].legs[0].duration.value / 60);
      }

      await sql`
        UPDATE pedidos SET orden_ruta = 1, distancia_km = ${distKm}, duracion_estimada_min = ${durMin}
        WHERE id = ${singlePedido.id}
      `;

      return NextResponse.json({
        message: "Ruta optimizada (1 pedido).",
        orden_optimizado: [{ pedido_id: singlePedido.id, orden_ruta: 1, distancia_km: distKm, duracion_min: durMin }],
        distancia_total_km: distKm,
        duracion_total_min: durMin,
      });
    }

    // 3. Google Directions con waypoint optimization (max 25 waypoints)
    const maxWaypoints = 23; // Google allows 25 total stops (origin + destination + 23 waypoints)
    const pedidosToOptimize = pedidos.slice(0, maxWaypoints + 2);

    // Origin = base location
    // Destination = last waypoint (Google will optimize order)
    // We use the first pedido as destination and remaining as waypoints
    const origin = `${baseLocation.lat},${baseLocation.lng}`;

    // All pedidos as waypoints, let Google optimize
    const waypointCoords = pedidosToOptimize.map(
      (p) => `${p.latitude},${p.longitude}`
    );

    // Use first waypoint as "destination" and rest as waypoints for optimization
    // The destination can be the last delivery point (no return to base needed)
    const destination = waypointCoords[waypointCoords.length - 1];
    const intermediateWaypoints = waypointCoords.slice(0, -1);

    const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=optimize:true|${intermediateWaypoints.join("|")}&key=${googleKey}&language=es&region=pe&mode=driving`;

    const directionsRes = await fetch(directionsUrl);
    const directionsData = (await directionsRes.json()) as DirectionsResponse;

    if (directionsData.status !== "OK" || directionsData.routes.length === 0) {
      return NextResponse.json({ error: `Google Directions error: ${directionsData.status}` }, { status: 502 });
    }

    const route = directionsData.routes[0];
    const waypointOrder = route.waypoint_order; // Optimized order of intermediate waypoints
    const legs = route.legs; // legs[0] = origin to first waypoint, etc.

    // Build the optimized order
    // waypointOrder gives us the order of INTERMEDIATE waypoints (indices 0..n-2)
    // The last pedido (destination) is always last
    const orderedPedidos: Array<{
      pedido_id: string;
      orden_ruta: number;
      distancia_km: number;
      duracion_min: number;
      cliente: string;
    }> = [];

    let totalDistKm = 0;
    let totalDurMin = 0;

    // Map waypoint_order back to pedidos
    // intermediate pedidos = pedidosToOptimize[0..n-2], destination = pedidosToOptimize[n-1]
    const intermediatePedidos = pedidosToOptimize.slice(0, -1);
    const destinationPedido = pedidosToOptimize[pedidosToOptimize.length - 1];

    for (let i = 0; i < waypointOrder.length; i++) {
      const originalIndex = waypointOrder[i];
      const pedido = intermediatePedidos[originalIndex];
      const leg = legs[i]; // leg from previous point to this waypoint

      const legDistKm = Math.round((leg.distance.value / 1000) * 100) / 100;
      const legDurMin = Math.round(leg.duration.value / 60);
      totalDistKm += legDistKm;
      totalDurMin += legDurMin;

      // Guardar distancia ACUMULADA desde la base (no el tramo individual)
      // Así el repartidor/admin sabe: "este cliente está a X km del local"
      orderedPedidos.push({
        pedido_id: pedido.id,
        orden_ruta: i + 1,
        distancia_km: Math.round(totalDistKm * 100) / 100,
        duracion_min: totalDurMin,
        cliente: pedido.cliente as string,
      });
    }

    // Add final destination
    const lastLeg = legs[legs.length - 1];
    const lastDistKm = Math.round((lastLeg.distance.value / 1000) * 100) / 100;
    const lastDurMin = Math.round(lastLeg.duration.value / 60);
    totalDistKm += lastDistKm;
    totalDurMin += lastDurMin;

    orderedPedidos.push({
      pedido_id: destinationPedido.id,
      orden_ruta: waypointOrder.length + 1,
      distancia_km: Math.round(totalDistKm * 100) / 100,
      duracion_min: totalDurMin,
      cliente: destinationPedido.cliente as string,
    });

    // Round totals
    totalDistKm = Math.round(totalDistKm * 100) / 100;

    // 4. Persist to database
    // Solo actualizamos orden_ruta y duracion_estimada_min (ETA acumulado).
    // NO sobreescribimos distancia_km porque ya tiene la distancia directa
    // desde la base calculada al momento de asignar el pedido.
    for (const item of orderedPedidos) {
      await sql`
        UPDATE pedidos 
        SET orden_ruta = ${item.orden_ruta},
            duracion_estimada_min = ${item.duracion_min}
        WHERE id = ${item.pedido_id}
          AND repartidor_id = ${repartidor_id}
      `;
    }

    // Handle remaining pedidos (beyond 25 waypoint limit) - assign sequentially after
    if (pedidos.length > maxWaypoints + 2) {
      const remaining = pedidos.slice(maxWaypoints + 2);
      let nextOrder = orderedPedidos.length + 1;
      for (const p of remaining) {
        await sql`
          UPDATE pedidos SET orden_ruta = ${nextOrder} WHERE id = ${p.id} AND repartidor_id = ${repartidor_id}
        `;
        nextOrder++;
      }
    }

    return NextResponse.json({
      message: `Ruta optimizada: ${orderedPedidos.length} pedidos reordenados.`,
      orden_optimizado: orderedPedidos,
      distancia_total_km: totalDistKm,
      duracion_total_min: totalDurMin,
    });
  } catch (error) {
    console.error("Error al optimizar ruta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

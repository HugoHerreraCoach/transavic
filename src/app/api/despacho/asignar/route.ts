// src/app/api/despacho/asignar/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const AsignarSchema = z.object({
  pedido_ids: z.array(z.string().uuid()).min(1, "Debes seleccionar al menos un pedido."),
  repartidor_id: z.string().uuid("ID de repartidor inválido."),
});

interface DirectionsLeg {
  distance: { value: number; text: string };
  duration: { value: number; text: string };
}

interface DirectionsResponse {
  status: string;
  routes: Array<{
    legs: DirectionsLeg[];
  }>;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = AsignarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { pedido_ids, repartidor_id } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);
    const googleKey = process.env.Maps_SERVER_KEY;

    // Obtener ubicación base para cálculo de distancia
    let baseLocation = {
      lat: parseFloat(process.env.BASE_LATITUDE || "-12.0464"),
      lng: parseFloat(process.env.BASE_LONGITUDE || "-77.0428"),
    };
    const baseResult = await sql`SELECT value FROM settings WHERE key = 'base_location'`;
    if (baseResult.length > 0) {
      const val = baseResult[0].value as { lat: number; lng: number };
      baseLocation = { lat: val.lat, lng: val.lng };
    }

    // Obtener el máximo orden_ruta actual del repartidor para hoy
    const maxOrden = await sql`
      SELECT COALESCE(MAX(orden_ruta), 0) as max_orden
      FROM pedidos
      WHERE repartidor_id = ${repartidor_id}
        AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
    `;
    let currentOrden = Number(maxOrden[0]?.max_orden || 0);

    // Obtener coordenadas de los pedidos a asignar
    const pedidosInfo = await sql`
      SELECT id, latitude, longitude
      FROM pedidos
      WHERE id = ANY(${pedido_ids})
    `;

    // Crear mapa rápido de pedido -> coords
    const coordsMap = new Map<string, { lat: number; lng: number }>();
    for (const p of pedidosInfo) {
      if (p.latitude && p.longitude) {
        coordsMap.set(p.id as string, {
          lat: parseFloat(p.latitude as string),
          lng: parseFloat(p.longitude as string),
        });
      }
    }

    // Asignar cada pedido y calcular distancia/tiempo desde base
    for (const pedidoId of pedido_ids) {
      currentOrden++;
      const coords = coordsMap.get(pedidoId);

      let distanciaKm: number | null = null;
      let duracionMin: number | null = null;

      // Calcular distancia con Google Directions si tenemos coordenadas y API key
      if (coords && googleKey) {
        try {
          const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${baseLocation.lat},${baseLocation.lng}&destination=${coords.lat},${coords.lng}&key=${googleKey}&language=es&region=pe&mode=driving`;
          const directionsRes = await fetch(directionsUrl);
          const directionsData = (await directionsRes.json()) as DirectionsResponse;

          if (directionsData.status === "OK" && directionsData.routes.length > 0) {
            const leg = directionsData.routes[0].legs[0];
            distanciaKm = Math.round((leg.distance.value / 1000) * 100) / 100;
            duracionMin = Math.round(leg.duration.value / 60);
          }
        } catch {
          // Si falla Google, usar estimación por fórmula Haversine
          if (coords) {
            distanciaKm = haversineKm(baseLocation.lat, baseLocation.lng, coords.lat, coords.lng);
            // Estimar ~30 km/h promedio en Lima urbano
            duracionMin = Math.round((distanciaKm / 30) * 60);
          }
        }
      } else if (coords) {
        // Sin API key: usar Haversine como fallback
        distanciaKm = haversineKm(baseLocation.lat, baseLocation.lng, coords.lat, coords.lng);
        duracionMin = Math.round((distanciaKm / 30) * 60);
      }

      await sql`
        UPDATE pedidos
        SET repartidor_id = ${repartidor_id},
            estado = 'Asignado',
            orden_ruta = ${currentOrden},
            distancia_km = ${distanciaKm},
            duracion_estimada_min = ${duracionMin}
        WHERE id = ${pedidoId}
          AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      `;
    }

    return NextResponse.json({
      message: `${pedido_ids.length} pedido(s) asignado(s) exitosamente.`,
      asignados: pedido_ids.length,
    });
  } catch (error) {
    console.error("Error al asignar pedidos:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

/**
 * Calcula distancia en km entre dos puntos usando fórmula Haversine.
 * Fallback cuando Google API no está disponible.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

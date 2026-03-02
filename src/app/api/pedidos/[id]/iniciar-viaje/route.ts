// src/app/api/pedidos/[id]/iniciar-viaje/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    // URL: /api/pedidos/[id]/iniciar-viaje → id is at segments[-2]
    const id = segments[segments.length - 2];

    if (!id) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Obtener el pedido y verificar que pertenece al repartidor
    const pedidoResult = await sql`
      SELECT id, estado, latitude, longitude, repartidor_id, cliente, direccion
      FROM pedidos WHERE id = ${id}
    `;

    if (pedidoResult.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const pedido = pedidoResult[0];

    // Verificar que el repartidor es el asignado (o es admin)
    if (session.user.role !== "admin" && pedido.repartidor_id !== session.user.id) {
      return NextResponse.json({ error: "Este pedido no está asignado a ti." }, { status: 403 });
    }

    // Verificar estado válido para iniciar viaje
    if (pedido.estado !== "Asignado" && pedido.estado !== "Pendiente") {
      return NextResponse.json(
        { error: `No se puede iniciar viaje desde estado "${pedido.estado}".` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let horaLlegadaEstimada: string | null = null;

    // Leer ubicación GPS del repartidor desde el body (si se envió)
    let driverLat: string | null = null;
    let driverLng: string | null = null;
    try {
      const body = await request.json();
      if (body.driverLat && body.driverLng) {
        driverLat = String(body.driverLat);
        driverLng = String(body.driverLng);
      }
    } catch {
      // No body o JSON inválido — continuar sin GPS
    }

    // Calcular ETA con Google Directions
    const googleMapsServerKey = process.env.Maps_SERVER_KEY;
    if (googleMapsServerKey && pedido.latitude && pedido.longitude) {
      try {
        // Prioridad de origen para ETA:
        // 1. GPS real del repartidor (más preciso)
        // 2. Último pedido entregado del día
        // 3. Ubicación base del almacén (env vars)
        // 4. Centro de Lima (fallback final)
        let origenLat = driverLat;
        let origenLng = driverLng;

        if (!origenLat || !origenLng) {
          const pedidoAnterior = await sql`
            SELECT latitude, longitude FROM pedidos
            WHERE repartidor_id = ${session.user.id}
              AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
              AND estado = 'Entregado'
              AND latitude IS NOT NULL
            ORDER BY entregado_at DESC
            LIMIT 1
          `;
          if (pedidoAnterior.length > 0) {
            origenLat = pedidoAnterior[0].latitude;
            origenLng = pedidoAnterior[0].longitude;
          }
        }

        if (!origenLat || !origenLng) {
          // Usar base del almacén o centro de Lima
          origenLat = process.env.BASE_LATITUDE || "-12.0553";
          origenLng = process.env.BASE_LONGITUDE || "-77.0451";
        }

        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origenLat},${origenLng}&destination=${pedido.latitude},${pedido.longitude}&key=${googleMapsServerKey}&language=es&region=pe&mode=driving`;

        const directionsRes = await fetch(directionsUrl);
        const directionsData = await directionsRes.json();

        if (directionsData.status === "OK" && directionsData.routes.length > 0) {
          const durationSeconds = directionsData.routes[0].legs[0].duration.value;
          const etaDate = new Date(Date.now() + durationSeconds * 1000);
          horaLlegadaEstimada = etaDate.toISOString();
        }
      } catch (etaError) {
        console.warn("No se pudo calcular tiempo de llegada:", etaError);
      }
    }

    // Actualizar el pedido
    await sql`
      UPDATE pedidos
      SET estado = 'En_Camino',
          inicio_viaje_at = ${now},
          hora_llegada_estimada = ${horaLlegadaEstimada},
          entregado = FALSE
      WHERE id = ${id}
    `;

    // Generar URLs de navegación
    const lat = pedido.latitude;
    const lng = pedido.longitude;
    const navUrls = lat && lng ? {
      googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
      waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    } : null;

    return NextResponse.json({
      message: "Viaje iniciado",
      estado: "En_Camino",
      inicio_viaje_at: now,
      hora_llegada_estimada: horaLlegadaEstimada,
      navegacion: navUrls,
    });
  } catch (error) {
    console.error("Error al iniciar viaje:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

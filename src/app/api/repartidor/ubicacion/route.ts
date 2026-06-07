// src/app/api/repartidor/ubicacion/route.ts
// Recibe la posición GPS del motorizado y la guarda como "última posición viva"
// en rider_locations (UPSERT por repartidor_id). Lo llama /mi-ruta (web + app nativa).
//
// Idempotente por diseño: si llega dos veces seguidas (offline-queue / reintento del
// plugin), simplemente sobreescribe la misma fila. No rompe nada (gotcha §11.1).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { haversineKm } from "@/lib/utils";
import { crearNotificacion } from "@/lib/notificaciones";



export const dynamic = "force-dynamic";

const Schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().optional(),
  capturedAt: z.string().datetime().optional(), // ISO; si no viene, usamos ahora
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  // Solo el motorizado reporta su propia ubicación. El scoping es por sesión:
  // siempre se guarda contra session.user.id, nunca contra un id del body.
  if (session.user.role !== "repartidor") {
    return NextResponse.json({ error: "Solo los motorizados reportan ubicación." }, { status: 403 });
  }

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { lat, lng, accuracy, heading, speed, capturedAt } = parsed.data;
  const captured = capturedAt ?? new Date().toISOString();
  // accuracy (radio de confianza del GPS, en metros) puede venir enorme con señal mala
  // (posicionamiento por celda/WiFi, interiores). La columna es NUMERIC(10,2); recortamos
  // por las dudas para que un fix degradado NUNCA tumbe el INSERT y se pierda el ping.
  const accuracyClamp = accuracy != null ? Math.min(accuracy, 99999999.99) : null;

    try {
      const sql = neon(process.env.DATABASE_URL!);
      await sql`
        INSERT INTO rider_locations
          (repartidor_id, latitude, longitude, accuracy, heading, speed, captured_at, updated_at)
        VALUES
          (${session.user.id}, ${lat}, ${lng}, ${accuracyClamp}, ${heading ?? null}, ${speed ?? null}, ${captured}, now())
        ON CONFLICT (repartidor_id) DO UPDATE SET
          latitude    = EXCLUDED.latitude,
          longitude   = EXCLUDED.longitude,
          accuracy    = EXCLUDED.accuracy,
          heading     = EXCLUDED.heading,
          speed       = EXCLUDED.speed,
          captured_at = EXCLUDED.captured_at,
          updated_at  = now()
      `;

      try {
        // Recalcular ETA dinámico para el pedido activo En_Camino
        const activePedido = await sql`
          SELECT id, latitude, longitude, asesor_id, cliente, notificado_por_llegar, notificado_llegada
          FROM pedidos
          WHERE repartidor_id = ${session.user.id}
            AND estado = 'En_Camino'
            AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
          LIMIT 1
        `;

        if (activePedido.length > 0) {
          const p = activePedido[0];
          if (p.latitude && p.longitude && (accuracy == null || accuracy <= 150)) {
            const destLat = parseFloat(p.latitude as string);
            const destLng = parseFloat(p.longitude as string);
            const dCurrent = haversineKm(lat, lng, destLat, destLng);

            // Si la distancia es menor a 150m (0.15 km), ya llegó (0 minutos)
            let durationRemaining = 0;
            if (dCurrent > 0.15) {
              // Estimar 3 minutos por km lineal (velocidad efectiva de 20 km/h en Lima)
              durationRemaining = Math.max(1, Math.round(dCurrent * 3.0));
            }

            const newEta = new Date(Date.now() + durationRemaining * 60 * 1000);

            // 1. Alerta 5 minutos antes
            let flagPorLlegar = p.notificado_por_llegar;
            if (durationRemaining <= 5 && !p.notificado_por_llegar) {
              if (p.asesor_id) {
                await crearNotificacion({
                  userId: p.asesor_id as string,
                  tipo: "pedido_por_llegar",
                  titulo: "⏳ Pedido por llegar",
                  mensaje: `${p.cliente} — el motorizado está a unos 5 minutos de llegar.`,
                  link: "/dashboard",
                  pedidoId: p.id,
                });
              }
              flagPorLlegar = true;
            }

            // 2. Alerta de llegada (umbral 150 metros)
            let flagLlegada = p.notificado_llegada;
            if (dCurrent <= 0.15 && !p.notificado_llegada) {
              if (p.asesor_id) {
                await crearNotificacion({
                  userId: p.asesor_id as string,
                  tipo: "pedido_llegado",
                  titulo: "📍 Pedido en destino",
                  mensaje: `${p.cliente} — el motorizado ha llegado al destino.`,
                  link: "/dashboard",
                  pedidoId: p.id,
                });
              }
              flagLlegada = true;
            }

            await sql`
              UPDATE pedidos
              SET hora_llegada_estimada = ${newEta.toISOString()},
                  notificado_por_llegar = ${flagPorLlegar},
                  notificado_llegada = ${flagLlegada}
              WHERE id = ${p.id}
            `;
          }
        }
      } catch (etaError) {
        console.warn("Error al recalcular ETA dinámico:", etaError);
        // Continuamos sin fallar la petición de ubicación principal
      }

      return NextResponse.json({ ok: true });
    } catch (error) {
    console.error("Error guardando ubicación del motorizado:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

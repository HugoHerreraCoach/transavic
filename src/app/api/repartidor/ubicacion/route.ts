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
import {
  MAX_ACCURACY_M,
  decidirAlertasArribo,
  esCapturaFresca,
  estimarEtaMin,
} from "@/lib/eta-reparto";



export const dynamic = "force-dynamic";

const Schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().optional(),
  capturedAt: z.string().datetime().optional(), // ISO; si no viene, usamos ahora
  // GPS falso (mock provider) detectado por el plugin nativo. Lo decide el SERVIDOR:
  // marca el estado y NO usa la coordenada falsa. No se confía en el cliente para
  // filtrarlo (un APK modificado lo saltaría) — acá está la fuente de verdad.
  simulated: z.boolean().optional(),
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

  const { lat, lng, accuracy, heading, speed, capturedAt, simulated } = parsed.data;
  const captured = capturedAt ?? new Date().toISOString();
  // accuracy (radio de confianza del GPS, en metros) puede venir enorme con señal mala
  // (posicionamiento por celda/WiFi, interiores). La columna es NUMERIC(10,2); recortamos
  // por las dudas para que un fix degradado NUNCA tumbe el INSERT y se pierda el ping.
  const accuracyClamp = accuracy != null ? Math.min(accuracy, 99999999.99) : null;

    try {
      const sql = neon(process.env.DATABASE_URL!);

      if (simulated) {
        // GPS FALSO (mock): NO pisamos la última posición real con el punto falso
        // (no contaminamos el mapa). Solo marcamos el estado para que el mapa lo
        // pinte en rojo y el cron/beacon alerten al admin. Respondemos 200 (NO 4xx)
        // a propósito: un 4xx dejaría esta posición "pendiente" en la cola offline
        // del repartidor y se reintentaría para siempre. Tampoco recalculamos ETA
        // con una posición falsa. (Es UPDATE: no-op si el rider aún no tiene fila;
        // ese caso lo cubre el cron por ausencia de reportes.)
        await sql`
          UPDATE rider_locations
          SET simulated = TRUE,
              gps_status = 'mock',
              gps_status_changed_at = CASE WHEN gps_status IS DISTINCT FROM 'mock' THEN now() ELSE gps_status_changed_at END,
              updated_at = now()
          WHERE repartidor_id = ${session.user.id}
        `;
        return NextResponse.json({ ok: true, rejected: true });
      }

      await sql`
        INSERT INTO rider_locations
          (repartidor_id, latitude, longitude, accuracy, heading, speed, captured_at, updated_at, simulated, gps_status, gps_status_changed_at)
        VALUES
          (${session.user.id}, ${lat}, ${lng}, ${accuracyClamp}, ${heading ?? null}, ${speed ?? null}, ${captured}, now(), FALSE, 'activo', now())
        ON CONFLICT (repartidor_id) DO UPDATE SET
          latitude    = EXCLUDED.latitude,
          longitude   = EXCLUDED.longitude,
          accuracy    = EXCLUDED.accuracy,
          heading     = EXCLUDED.heading,
          speed       = EXCLUDED.speed,
          captured_at = EXCLUDED.captured_at,
          updated_at  = now(),
          simulated   = FALSE,
          gps_status  = 'activo',
          gps_status_changed_at = CASE WHEN rider_locations.gps_status IS DISTINCT FROM 'activo' THEN now() ELSE rider_locations.gps_status_changed_at END
        WHERE EXCLUDED.captured_at >= rider_locations.captured_at
           OR rider_locations.captured_at > now() + interval '5 minutes'
      `;
      // El WHERE del DO UPDATE evita que un replay de la cola offline RETROCEDA
      // la posición viva del mapa; la 2ª cláusula deja sanar una fila envenenada
      // por un capturedAt futuro (reloj del celular roto).

      try {
        // Recalcular ETA dinámico + alertas de arribo para los pedidos En_Camino.
        // La decisión pura vive en lib/eta-reparto.ts (testeada en vitest).
        const ahoraMs = Date.now();
        if (!esCapturaFresca(captured, ahoraMs)) {
          // Ping rancio (cola offline) o reloj roto: la posición ya quedó en el
          // mapa, pero notificar/estimar con una coordenada vieja es mentirle a
          // la asesora ("hace 1 min" de algo que pasó hace 10).
          console.warn(
            `[ubicacion] Ping no fresco (capturedAt=${captured}, delta=${ahoraMs - Date.parse(captured)} ms) — sin evaluar alertas ni ETA.`
          );
        } else if (accuracy == null || accuracy <= MAX_ACCURACY_M) {
          const activos = await sql`
            SELECT id, latitude, longitude, asesor_id, cliente,
                   notificado_por_llegar, notificado_llegada,
                   eta_factor_ruta, eta_velocidad_kmh
            FROM pedidos
            WHERE repartidor_id = ${session.user.id}
              AND estado = 'En_Camino'
              AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
            ORDER BY orden_ruta NULLS LAST, inicio_viaje_at
          `;

          const aNumero = (v: unknown): number | null =>
            v == null ? null : Number.parseFloat(String(v));

          for (const p of activos) {
            const dActual = haversineKm(
              lat,
              lng,
              parseFloat(p.latitude as string),
              parseFloat(p.longitude as string)
            );
            // Calibración por-viaje (Directions de iniciar-viaje); NULL → defaults.
            const etaMin = estimarEtaMin(dActual, aNumero(p.eta_factor_ruta), aNumero(p.eta_velocidad_kmh));
            const nuevaEta = new Date(ahoraMs + etaMin * 60_000).toISOString();

            const decision = decidirAlertasArribo({
              etaMin,
              distanciaKm: dActual,
              notificadoPorLlegar: Boolean(p.notificado_por_llegar),
              notificadoLlegada: Boolean(p.notificado_llegada),
            });

            if (decision.dispararLlegada) {
              // CLAIM atómico (una sola sentencia): gana exactamente UN ping
              // concurrente. Consume AMBOS flags → "por llegar" jamás sale junto
              // ni después de "llegado". El guard de estado cubre la carrera con
              // entregar/cancelar-viaje (que resetean los flags).
              const claim = await sql`
                UPDATE pedidos
                SET notificado_llegada = TRUE,
                    notificado_por_llegar = TRUE,
                    hora_llegada_estimada = ${nuevaEta}
                WHERE id = ${p.id}
                  AND notificado_llegada = FALSE
                  AND estado = 'En_Camino'
                RETURNING id
              `;
              if (claim.length > 0 && p.asesor_id) {
                await crearNotificacion({
                  userId: p.asesor_id as string,
                  tipo: "pedido_llegado",
                  titulo: "📍 Pedido en destino",
                  mensaje: `${p.cliente} — el motorizado ya está en la dirección de entrega.`,
                  link: "/dashboard",
                  pedidoId: p.id,
                });
              }
              continue;
            }

            if (decision.dispararPorLlegar) {
              const claim = await sql`
                UPDATE pedidos
                SET notificado_por_llegar = TRUE,
                    hora_llegada_estimada = ${nuevaEta}
                WHERE id = ${p.id}
                  AND notificado_por_llegar = FALSE
                  AND notificado_llegada = FALSE
                  AND estado = 'En_Camino'
                RETURNING id
              `;
              if (claim.length > 0 && p.asesor_id) {
                const m = decision.minutosMensaje;
                await crearNotificacion({
                  userId: p.asesor_id as string,
                  tipo: "pedido_por_llegar",
                  titulo: "⏳ Pedido por llegar",
                  mensaje: `${p.cliente} — el motorizado está a unos ${m} ${m === 1 ? "minuto" : "minutos"} de llegar.`,
                  link: "/dashboard",
                  pedidoId: p.id,
                });
              }
              continue;
            }

            // Sin alertas: solo refrescar el ETA visible en despacho/mi-ruta.
            // (Los flags NO se tocan acá — escribirlos con valores del SELECT
            // podía REVERTIR un flag recién marcado por un ping concurrente.)
            await sql`
              UPDATE pedidos
              SET hora_llegada_estimada = ${nuevaEta}
              WHERE id = ${p.id} AND estado = 'En_Camino'
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

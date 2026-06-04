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
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error guardando ubicación del motorizado:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

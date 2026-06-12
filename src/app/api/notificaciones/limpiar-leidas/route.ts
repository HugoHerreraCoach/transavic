// src/app/api/notificaciones/limpiar-leidas/route.ts
// POST — borra de un golpe TODAS las notificaciones YA LEÍDAS del usuario.
// Las no leídas se conservan (todavía no las vio). Complemento de la "x"
// individual para mantener la campanita limpia sin cerrar una por una.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      DELETE FROM notificaciones
      WHERE user_id = ${session.user.id} AND leida = TRUE
      RETURNING id
    `) as Array<{ id: string }>;
    return NextResponse.json({ ok: true, eliminadas: rows.length });
  } catch (error) {
    console.error("Error en POST /api/notificaciones/limpiar-leidas:", error);
    return NextResponse.json({ error: "Error al limpiar notificaciones" }, { status: 500 });
  }
}

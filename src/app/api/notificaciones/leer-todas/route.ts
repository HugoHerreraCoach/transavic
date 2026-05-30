// src/app/api/notificaciones/leer-todas/route.ts
// POST — marcar todas las notificaciones del usuario como leídas
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
    await sql`
      UPDATE notificaciones
      SET leida = TRUE
      WHERE user_id = ${session.user.id} AND leida = FALSE
    `;

    return NextResponse.json({ message: "Todas marcadas como leídas" });
  } catch (error) {
    console.error("Error en POST /api/notificaciones/leer-todas:", error);
    return NextResponse.json(
      { error: "Error al marcar leídas" },
      { status: 500 }
    );
  }
}

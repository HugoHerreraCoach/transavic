// src/app/api/notificaciones/[id]/leida/route.ts
// PATCH — marcar una notificación como leída
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    // /api/notificaciones/[id]/leida → id está en posición -2
    const notifId = segments[segments.length - 2];

    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      UPDATE notificaciones
      SET leida = TRUE
      WHERE id = ${notifId} AND user_id = ${session.user.id}
    `;

    return NextResponse.json({ message: "Marcada como leída" });
  } catch (error) {
    console.error("Error en PATCH /api/notificaciones/[id]/leida:", error);
    return NextResponse.json(
      { error: "Error al marcar leída" },
      { status: 500 }
    );
  }
}

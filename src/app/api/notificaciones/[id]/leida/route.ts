// src/app/api/notificaciones/[id]/leida/route.ts
// PATCH — marcar una notificación como leída
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: notifId } = await params;
    if (!UUID_RE.test(notifId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    // RETURNING: sin él, un id que no existe o de otro usuario devolvía 200 y el
    // popup se cerraba creyendo que había persistido, para reaparecer después.
    const filas = (await sql`
      UPDATE notificaciones
      SET leida = TRUE
      WHERE id = ${notifId}::uuid AND user_id = ${session.user.id}::uuid
      RETURNING id
    `) as Array<{ id: string }>;

    if (filas.length === 0) {
      return NextResponse.json({ error: "Notificación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ message: "Marcada como leída" });
  } catch (error) {
    console.error("Error en PATCH /api/notificaciones/[id]/leida:", error);
    return NextResponse.json(
      { error: "Error al marcar leída" },
      { status: 500 }
    );
  }
}

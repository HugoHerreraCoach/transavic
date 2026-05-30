// src/app/api/notificaciones/route.ts
// GET — últimas 30 notificaciones del usuario + contador de no leídas
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const sql = neon(process.env.DATABASE_URL!);

    const [notifs, unreadRow] = await Promise.all([
      sql`
        SELECT id, tipo, titulo, mensaje, link, pedido_id, leida, created_at
        FROM notificaciones
        WHERE user_id = ${session.user.id}
        ORDER BY created_at DESC
        LIMIT 30
      `,
      sql`
        SELECT COUNT(*)::int AS cnt FROM notificaciones
        WHERE user_id = ${session.user.id} AND leida = FALSE
      `,
    ]);

    return NextResponse.json({
      data: notifs,
      unreadCount: (unreadRow as Array<{ cnt: number }>)[0]?.cnt ?? 0,
    });
  } catch (error) {
    console.error("Error en GET /api/notificaciones:", error);
    return NextResponse.json(
      { error: "Error al cargar notificaciones" },
      { status: 500 }
    );
  }
}

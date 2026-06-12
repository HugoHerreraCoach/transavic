// src/app/api/notificaciones/[id]/route.ts
// DELETE — descarta (borra) UNA notificación del propio usuario.
// Decisión UX (12 jun 2026): TODA notificación se puede cerrar con la "x",
// incluso las importantes — el dato de fondo vive en su módulo (la cobranza
// vencida está en /cobranzas, el comprobante rechazado en /comprobantes, la
// autorización aprobada en /autorizaciones). Las importantes se DESTACAN
// visualmente en la campanita, no se vuelven imposibles de cerrar.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    // Solo las propias: el user_id en el WHERE es el control de acceso.
    const rows = (await sql`
      DELETE FROM notificaciones
      WHERE id = ${id}::uuid AND user_id = ${session.user.id}
      RETURNING id
    `) as Array<{ id: string }>;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Notificación no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error en DELETE /api/notificaciones/[id]:", error);
    return NextResponse.json({ error: "Error al eliminar la notificación" }, { status: 500 });
  }
}

// src/app/api/pedidos/[id]/ediciones/route.ts
// Historial de ediciones/correcciones de un pedido. SOLO admin (es una vista
// de auditoría para el dueño). Devuelve las ediciones del más reciente al más
// antiguo, con quién las hizo y el detalle de cada campo cambiado.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    // Solo el admin ve el historial de cambios.
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un administrador puede ver el historial de cambios." },
        { status: 403 }
      );
    }

    // El id del pedido es el penúltimo segmento: /api/pedidos/<id>/ediciones
    const segmentos = new URL(request.url).pathname.split("/");
    const id = segmentos[segmentos.length - 2];
    if (!id) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT id, usuario_nombre, usuario_rol, cambios, created_at
      FROM pedido_ediciones
      WHERE pedido_id = ${id}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ ediciones: rows });
  } catch (error) {
    console.error("Error en API GET ediciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

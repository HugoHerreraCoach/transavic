// src/app/api/pedidos/[id]/cancelar-viaje/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2];

    if (!id) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Verificar pedido
    const pedidoResult = await sql`
      SELECT id, estado, repartidor_id FROM pedidos WHERE id = ${id}
    `;

    if (pedidoResult.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const pedido = pedidoResult[0];

    // Solo el repartidor asignado o admin pueden cancelar
    if (session.user.role !== "admin" && pedido.repartidor_id !== session.user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    // Solo se puede cancelar si está En_Camino
    if (pedido.estado !== "En_Camino") {
      return NextResponse.json(
        { error: `Solo se puede cancelar desde estado "En_Camino". Estado actual: "${pedido.estado}"` },
        { status: 400 }
      );
    }

    // Revertir a Asignado
    await sql`
      UPDATE pedidos
      SET estado = 'Asignado',
          inicio_viaje_at = NULL,
          hora_llegada_estimada = NULL
      WHERE id = ${id}
    `;

    return NextResponse.json({
      message: "Viaje cancelado. El pedido vuelve a Asignado.",
      estado: "Asignado",
    });
  } catch (error) {
    console.error("Error al cancelar viaje:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

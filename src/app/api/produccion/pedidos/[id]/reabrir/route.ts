// src/app/api/produccion/pedidos/[id]/reabrir/route.ts
// POST — revierte un pedido de Listo_Para_Despacho de vuelta a En_Produccion.
// Para cuando producción lo marcó listo por error y necesita seguir ajustándolo.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "produccion"].includes(session.user.role)) {
      return NextResponse.json({ error: "Solo Producción o Admin" }, { status: 403 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const pedidoId = segments[segments.length - 2];
    if (!pedidoId) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const pedidoRows = await sql`SELECT estado FROM pedidos WHERE id = ${pedidoId}`;
    if (pedidoRows.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    const estadoActual = pedidoRows[0].estado as string;
    // Solo tiene sentido reabrir si está listo para despacho (aún no asignado/entregado).
    if (estadoActual !== "Listo_Para_Despacho") {
      return NextResponse.json(
        {
          error: `Solo se puede reabrir un pedido "Listo para despacho". Estado actual: "${estadoActual}".`,
        },
        { status: 400 }
      );
    }

    await sql`
      UPDATE pedidos
      SET estado = 'En_Produccion'
      WHERE id = ${pedidoId} AND estado = 'Listo_Para_Despacho'
    `;

    return NextResponse.json({
      message: "Pedido reabierto — volvió a En Producción",
      estado: "En_Produccion",
    });
  } catch (error) {
    console.error("Error en POST /api/produccion/pedidos/[id]/reabrir:", error);
    return NextResponse.json({ error: "Error al reabrir el pedido" }, { status: 500 });
  }
}

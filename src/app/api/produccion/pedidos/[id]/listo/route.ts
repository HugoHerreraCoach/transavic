// src/app/api/produccion/pedidos/[id]/listo/route.ts
// POST — marcar pedido como Listo_Para_Despacho (requiere que todos los items tengan peso real)
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crearNotificacion } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "produccion"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Producción o Admin" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const pedidoId = segments[segments.length - 2];
    if (!pedidoId) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Verificar estado actual
    const pedidoRows = await sql`
      SELECT estado FROM pedidos WHERE id = ${pedidoId}
    `;
    if (pedidoRows.length === 0) {
      return NextResponse.json(
        { error: "Pedido no encontrado" },
        { status: 404 }
      );
    }
    const estadoActual = pedidoRows[0].estado;
    if (!["Pendiente", "En_Produccion"].includes(estadoActual as string)) {
      return NextResponse.json(
        {
          error: `No se puede marcar listo desde estado "${estadoActual}".`,
        },
        { status: 400 }
      );
    }

    // Verificar que TODOS los items tienen cantidad_real
    const sinPeso = await sql`
      SELECT COUNT(*)::int as cnt
      FROM pedido_items
      WHERE pedido_id = ${pedidoId} AND cantidad_real IS NULL
    `;
    if ((sinPeso[0].cnt as number) > 0) {
      return NextResponse.json(
        {
          error: `Faltan ${sinPeso[0].cnt} producto(s) sin peso registrado. Registra todos los pesos antes de marcar listo.`,
        },
        { status: 400 }
      );
    }

    await sql`
      UPDATE pedidos
      SET estado = 'Listo_Para_Despacho'
      WHERE id = ${pedidoId}
    `;

    // Notificar a la asesora del pedido
    const pedidoInfo = await sql`
      SELECT cliente, asesor_id FROM pedidos WHERE id = ${pedidoId}
    `;
    if (pedidoInfo.length > 0 && pedidoInfo[0].asesor_id) {
      await crearNotificacion({
        userId: pedidoInfo[0].asesor_id as string,
        tipo: "listo_para_despacho",
        titulo: "Pedido listo para despacho",
        mensaje: `Cliente: ${pedidoInfo[0].cliente} · Producción terminó el pesado`,
        link: "/dashboard",
        pedidoId,
      });
    }

    return NextResponse.json({
      message: "Pedido listo para despacho",
      estado: "Listo_Para_Despacho",
    });
  } catch (error) {
    console.error("Error en POST /api/produccion/pedidos/[id]/listo:", error);
    return NextResponse.json(
      { error: "Error al marcar como listo" },
      { status: 500 }
    );
  }
}

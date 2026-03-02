// src/app/api/despacho/asignar/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const AsignarSchema = z.object({
  pedido_ids: z.array(z.string().uuid()).min(1, "Debes seleccionar al menos un pedido."),
  repartidor_id: z.string().uuid("ID de repartidor inválido."),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = AsignarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { pedido_ids, repartidor_id } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Obtener el máximo orden_ruta actual del repartidor para hoy
    const maxOrden = await sql`
      SELECT COALESCE(MAX(orden_ruta), 0) as max_orden
      FROM pedidos
      WHERE repartidor_id = ${repartidor_id}
        AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
    `;
    let currentOrden = Number(maxOrden[0]?.max_orden || 0);

    // Asignar cada pedido
    for (const pedidoId of pedido_ids) {
      currentOrden++;
      await sql`
        UPDATE pedidos
        SET repartidor_id = ${repartidor_id},
            estado = 'Asignado',
            orden_ruta = ${currentOrden}
        WHERE id = ${pedidoId}
          AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      `;
    }

    return NextResponse.json({
      message: `${pedido_ids.length} pedido(s) asignado(s) exitosamente.`,
      asignados: pedido_ids.length,
    });
  } catch (error) {
    console.error("Error al asignar pedidos:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

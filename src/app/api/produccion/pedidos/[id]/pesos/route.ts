// src/app/api/produccion/pedidos/[id]/pesos/route.ts
// PATCH — registrar pesos reales para un pedido. Recalcula subtotal_real automáticamente.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PesosSchema = z.object({
  items: z.array(
    z.object({
      item_id: z.string().uuid(),
      cantidad_real: z.number().positive("La cantidad debe ser mayor a 0"),
      // Producción puede ajustar la unidad y el precio al pesar/preparar
      // (ej. el pedido vino en "uni" pero se cobra por kg, o cambió el precio del día).
      unidad: z.string().trim().min(1).max(20).optional(),
      precio_unitario: z.number().min(0).max(100000).optional(),
    })
  ).min(1),
});

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "produccion"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Producción o Admin pueden registrar pesos" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    // URL: /api/produccion/pedidos/[id]/pesos → id está en posición -2
    const pedidoId = segments[segments.length - 2];
    if (!pedidoId) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = PesosSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Verificar que el pedido existe y está en estado válido
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
          error: `No se pueden registrar pesos desde estado "${estadoActual}". Solo desde Pendiente o En_Produccion.`,
        },
        { status: 400 }
      );
    }

    // Actualizar cada item con su cantidad real (+ unidad/precio si producción los
    // ajustó) y recalcular subtotal_real.
    for (const item of parsed.data.items) {
      const itemRow = await sql`
        SELECT precio_unitario, unidad FROM pedido_items
        WHERE id = ${item.item_id} AND pedido_id = ${pedidoId}
      `;
      if (itemRow.length === 0) continue; // ítem no pertenece al pedido — ignorar
      // Precio/unidad: usar lo que mandó producción si vino; si no, lo que ya tenía.
      const precio_unitario =
        item.precio_unitario != null
          ? item.precio_unitario
          : itemRow[0].precio_unitario
            ? Number(itemRow[0].precio_unitario)
            : 0;
      const unidad = item.unidad ?? (itemRow[0].unidad as string);
      const subtotal_real = Number(
        (precio_unitario * item.cantidad_real).toFixed(2)
      );
      await sql`
        UPDATE pedido_items
        SET cantidad_real = ${item.cantidad_real},
            unidad = ${unidad},
            precio_unitario = ${precio_unitario},
            subtotal_real = ${subtotal_real}
        WHERE id = ${item.item_id} AND pedido_id = ${pedidoId}
      `;
    }

    // Marcar el pedido como En_Produccion + tracking
    await sql`
      UPDATE pedidos
      SET estado = 'En_Produccion',
          pesado_por = ${session.user.id},
          pesado_at = NOW()
      WHERE id = ${pedidoId} AND estado IN ('Pendiente', 'En_Produccion')
    `;

    // Calcular total para devolverlo a la UI
    const totalRow = await sql`
      SELECT COALESCE(SUM(subtotal_real), 0)::numeric as total
      FROM pedido_items
      WHERE pedido_id = ${pedidoId} AND cantidad_real IS NOT NULL
    `;
    const total = Number(totalRow[0].total);

    return NextResponse.json({
      message: "Pesos registrados",
      total_real: total,
    });
  } catch (error) {
    console.error("Error en PATCH /api/produccion/pedidos/[id]/pesos:", error);
    return NextResponse.json(
      { error: "Error al registrar pesos" },
      { status: 500 }
    );
  }
}

// src/app/api/compras/[id]/anular/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { esLineaSinPeso } from "@/lib/compras-lineas";
import { consultaBloqueoProveedor } from "@/lib/proveedores/pagos";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const AnularCompraSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, { message: "El motivo de la anulación debe tener al menos 5 caracteres" })
    .max(500, { message: "El motivo no puede exceder los 500 caracteres" }),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID de compra inválido" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => null);
    const result = AnularCompraSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { motivo } = result.data;

    const sql = neon(process.env.DATABASE_URL!);

    // 1. Obtener la compra y verificar su existencia y estado actual
    const comprasRows = await sql`
      SELECT id, proveedor_id, estado, total
      FROM compras
      WHERE id = ${id}
    `;

    if (comprasRows.length === 0) {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }

    const compra = comprasRows[0];
    if (compra.estado === "Anulado") {
      return NextResponse.json({ error: "Esta compra ya ha sido anulada anteriormente" }, { status: 409 });
    }

    // 2. Verificar el estado de la cuenta por pagar vinculada
    const cxpRows = await sql`
      SELECT id, monto_pagado::float8 AS monto_pagado, estado
      FROM cuentas_por_pagar
      WHERE compra_id = ${id}
    `;

    // Si existe deuda asociada y ya tiene pagos cargados, se bloquea la anulación
    if (cxpRows.length > 0 && cxpRows[0].monto_pagado > 0.009) {
      return NextResponse.json(
        {
          error: `No se puede anular la compra porque ya tiene ${cxpRows[0].monto_pagado} S/ pagados. Revierte primero los abonos en la Ficha del Proveedor.`,
        },
        { status: 409 }
      );
    }

    // 3. Obtener los productos (ítems) ingresados en la compra
    const items = await sql`
      SELECT ci.id, ci.producto_id, ci.peso_neto::float8 AS peso_neto, ci.tipo,
             p.categoria
      FROM compra_items ci
      JOIN productos p ON ci.producto_id = p.id
      WHERE ci.compra_id = ${id}
    `;

    // 4. Todo en una única transacción SQL
    await sql.transaction([
      // Bloquear al proveedor para evitar escrituras concurrentes o doble-taps
      consultaBloqueoProveedor(sql, compra.proveedor_id),

      // Anular la cabecera de la compra
      sql`
        UPDATE compras
        SET estado = 'Anulado',
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${id}
      `,

      // Eliminar la deuda de cuentas por pagar asociada
      sql`
        DELETE FROM cuentas_por_pagar
        WHERE compra_id = ${id}
      `,

      // Reversión de stock de inventario y registro de movimientos de Kardex
      ...items.flatMap((item) => {
        const esServicio = esLineaSinPeso(item.categoria);
        if (esServicio) return []; // Los servicios no entran al inventario, no se revierten

        // Determinamos el signo opuesto al movimiento original:
        // Si ingresó mercadería (+peso), la anulación resta (-peso).
        // Si fue una devolución (-peso), la anulación vuelve a sumarlo (+peso).
        const cambioInventario = item.tipo === "devolucion" ? item.peso_neto : -item.peso_neto;

        return [
          // Actualizar lote de inventario (restar o sumar según corresponda)
          sql`
            INSERT INTO inventario_lotes (producto_id, cantidad)
            VALUES (${item.producto_id}, ${cambioInventario})
            ON CONFLICT (producto_id) DO UPDATE SET
              cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          `,
          // Insertar movimiento de anulación en Kardex
          sql`
            INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, motivo, usuario_id, referencia_id)
            VALUES (${item.producto_id}, ${cambioInventario}, 'anulacion_compra', ${motivo}, ${session.user.id}, ${id})
          `,
        ];
      }),
    ]);

    return NextResponse.json({ success: true, message: "Compra anulada correctamente." });
  } catch (error: unknown) {
    console.error("Error al anular compra:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno del servidor" },
      { status: 500 }
    );
  }
}

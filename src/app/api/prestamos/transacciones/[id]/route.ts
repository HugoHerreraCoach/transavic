// src/app/api/prestamos/transacciones/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export const dynamic = "force-dynamic";

const TransaccionUpdateSchema = z.object({
  proveedorId: z.string().uuid(),
  productoId: z.string().uuid(),
  tipoMovimiento: z.enum(['PRESTAMO_RECIBIDO', 'PRESTAMO_OTORGADO', 'DEVOLUCION_RECIBIDA', 'DEVOLUCION_OTORGADA']),
  jabas: z.number().int().min(0),
  pesoKg: z.number().min(0),
  fecha: z.string(),
  notas: z.string().optional(),
});

// Helper para recalcular el saldo acumulado en prestamos_saldos
export async function recalcularSaldo(proveedorId: string, productoId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN tipo_movimiento IN ('PRESTAMO_OTORGADO', 'DEVOLUCION_OTORGADA') THEN jabas 
          WHEN tipo_movimiento IN ('PRESTAMO_RECIBIDO', 'DEVOLUCION_RECIBIDA') THEN -jabas 
          ELSE 0 
        END
      ), 0)::int AS total_jabas,
      COALESCE(SUM(
        CASE 
          WHEN tipo_movimiento IN ('PRESTAMO_OTORGADO', 'DEVOLUCION_OTORGADA') THEN peso_kg 
          WHEN tipo_movimiento IN ('PRESTAMO_RECIBIDO', 'DEVOLUCION_RECIBIDA') THEN -peso_kg 
          ELSE 0 
        END
      ), 0)::numeric AS total_peso
    FROM prestamos_transacciones
    WHERE proveedor_id = ${proveedorId} AND producto_id = ${productoId}
  `;

  const jabas = Number(result[0].total_jabas);
  const pesoKg = Number(result[0].total_peso);

  await sql`
    INSERT INTO prestamos_saldos (proveedor_id, producto_id, jabas, peso_kg, updated_at)
    VALUES (${proveedorId}, ${productoId}, ${jabas}, ${pesoKg}, NOW())
    ON CONFLICT (proveedor_id, producto_id) DO UPDATE SET
      jabas = EXCLUDED.jabas,
      peso_kg = EXCLUDED.peso_kg,
      updated_at = NOW()
  `;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID no proporcionado" }, { status: 400 });

  try {
    const body = await req.json();
    const result = TransaccionUpdateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // Obtener movimiento previo para saber si cambio de proveedor o producto
    const prevRows = await sql`
      SELECT proveedor_id, producto_id FROM prestamos_transacciones WHERE id = ${id}
    `;

    if (prevRows.length === 0) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }

    const prevProveedorId = prevRows[0].proveedor_id;
    const prevProductoId = prevRows[0].producto_id;

    // Actualizar transacción
    await sql`
      UPDATE prestamos_transacciones
      SET
        proveedor_id = ${data.proveedorId},
        producto_id = ${data.productoId},
        tipo_movimiento = ${data.tipoMovimiento},
        jabas = ${data.jabas},
        peso_kg = ${data.pesoKg},
        fecha = ${data.fecha}::date,
        notas = ${data.notas || null}
      WHERE id = ${id}
    `;

    // Recalcular saldo para el par nuevo
    await recalcularSaldo(data.proveedorId, data.productoId);

    // Si cambió proveedor o producto, recalcular también el anterior
    if (prevProveedorId !== data.proveedorId || prevProductoId !== data.productoId) {
      await recalcularSaldo(prevProveedorId, prevProductoId);
    }

    return NextResponse.json({ success: true, message: "Movimiento actualizado exitosamente." });
  } catch (error: unknown) {
    console.error("Error actualizando movimiento:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID no proporcionado" }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Obtener movimiento previo
    const prevRows = await sql`
      SELECT proveedor_id, producto_id FROM prestamos_transacciones WHERE id = ${id}
    `;

    if (prevRows.length === 0) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }

    const { proveedor_id, producto_id } = prevRows[0];

    // Eliminar
    await sql`
      DELETE FROM prestamos_transacciones WHERE id = ${id}
    `;

    // Recalcular saldo
    await recalcularSaldo(proveedor_id, producto_id);

    return NextResponse.json({ success: true, message: "Movimiento eliminado exitosamente." });
  } catch (error: unknown) {
    console.error("Error eliminando movimiento:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

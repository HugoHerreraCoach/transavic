// src/app/api/cuentas-por-pagar/[id]/route.ts
// PATCH/DELETE de una deuda MANUAL mal digitada (solo si no viene de una compra y no
// tiene ni un sol pagado). Las deudas de compras y las que ya recibieron pagos son
// intocables — para eso está la trazabilidad. Admin-only.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PatchDeudaSchema = z
  .object({
    monto: z.number().positive({ message: "El monto debe ser mayor a 0" }).optional(),
    fecha_vencimiento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha inválida" })
      .nullable()
      .optional(),
    concepto: z.string().trim().min(1).max(200).optional(),
  })
  .refine((d) => d.monto !== undefined || d.fecha_vencimiento !== undefined || d.concepto !== undefined, {
    message: "Nada que actualizar",
  });

// PATCH: corrige monto/vencimiento/concepto de una deuda manual. Mismos guards que
// el DELETE: solo deudas SIN compra de origen y SIN pagos (una vez pagada, la
// corrección es contable, no un edit).
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const result = PatchDeudaSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { monto, fecha_vencimiento, concepto } = result.data;

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const filas = (await sql`
      SELECT compra_id, monto_pagado::float8 AS monto_pagado,
             monto_deuda::float8 AS monto_deuda,
             to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
             concepto
      FROM cuentas_por_pagar WHERE id = ${id}
    `) as Array<{
      compra_id: string | null;
      monto_pagado: number;
      monto_deuda: number;
      fecha_vencimiento: string | null;
      concepto: string | null;
    }>;

    if (filas.length === 0) {
      return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
    }
    if (filas[0].compra_id !== null) {
      return NextResponse.json(
        { error: "Esta deuda viene de una compra registrada: no se puede editar." },
        { status: 409 }
      );
    }
    if (filas[0].monto_pagado > 0) {
      return NextResponse.json(
        { error: "Esta deuda ya tiene pagos registrados: no se puede editar." },
        { status: 409 }
      );
    }

    // Los valores finales se resuelven en JS (el driver de Neon no anida
    // fragmentos sql): lo no enviado conserva su valor; el vencimiento sí
    // acepta NULL explícito (deuda sin fecha).
    const montoFinal = monto ?? filas[0].monto_deuda;
    const vencimientoFinal =
      fecha_vencimiento === undefined ? filas[0].fecha_vencimiento : fecha_vencimiento;
    const conceptoFinal = concepto ?? filas[0].concepto;

    const actualizadas = (await sql`
      UPDATE cuentas_por_pagar SET
        monto_deuda = ${montoFinal},
        fecha_vencimiento = ${vencimientoFinal}::date,
        concepto = ${conceptoFinal}
      WHERE id = ${id} AND compra_id IS NULL AND monto_pagado = 0
      RETURNING id
    `) as Array<{ id: string }>;

    if (actualizadas.length === 0) {
      return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error al editar deuda manual:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const filas = (await sql`
      SELECT compra_id, monto_pagado::float8 AS monto_pagado
      FROM cuentas_por_pagar WHERE id = ${id}
    `) as Array<{ compra_id: string | null; monto_pagado: number }>;

    if (filas.length === 0) {
      return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
    }
    if (filas[0].compra_id !== null) {
      return NextResponse.json(
        { error: "Esta deuda viene de una compra registrada: no se puede borrar." },
        { status: 409 }
      );
    }
    if (filas[0].monto_pagado > 0) {
      return NextResponse.json(
        { error: "Esta deuda ya tiene pagos registrados: no se puede borrar." },
        { status: 409 }
      );
    }

    await sql`DELETE FROM cuentas_por_pagar WHERE id = ${id} AND compra_id IS NULL AND monto_pagado = 0`;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error al borrar deuda manual:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

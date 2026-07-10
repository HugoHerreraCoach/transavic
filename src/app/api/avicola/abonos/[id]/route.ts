// src/app/api/avicola/abonos/[id]/route.ts
// PATCH — corregir un abono avícola mal digitado (monto/medio de pago/observaciones).
// Se BLOQUEA si el abono está anulado (mismo criterio que editar una venta,
// gotcha #41). El saldo NUNCA se persiste (única fuente: lib/avicola/saldos.ts),
// así que corregir el monto es seguro: todo lector lo recalcula. Admin-only.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MEDIOS_PAGO_AVICOLA } from "@/lib/avicola/types";
import { estadoCuentaCliente } from "@/lib/avicola/saldos";

export const dynamic = "force-dynamic";

const PatchAbonoSchema = z
  .object({
    monto: z.number().positive().optional(),
    medio_pago: z.enum(MEDIOS_PAGO_AVICOLA).optional(),
    observaciones: z.string().optional().nullable(),
  })
  .refine(
    (d) =>
      d.monto !== undefined || d.medio_pago !== undefined || d.observaciones !== undefined,
    { message: "Nada que actualizar" }
  );

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = PatchAbonoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { monto, medio_pago, observaciones } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);

    const rows = (await sql`
      SELECT id, cliente_id, anulado, monto::float8 AS monto, medio_pago, observaciones
      FROM abonos_avicola WHERE id = ${id}
    `) as Array<{
      id: string;
      cliente_id: string;
      anulado: boolean;
      monto: number;
      medio_pago: string;
      observaciones: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Abono no encontrado" }, { status: 404 });
    }
    if (rows[0].anulado) {
      return NextResponse.json(
        { error: "Este abono está anulado: no se puede editar" },
        { status: 409 }
      );
    }

    // Valores finales resueltos en JS (el driver de Neon no anida fragmentos sql).
    // `observaciones: null` explícito SÍ limpia el campo.
    const montoFinal = monto ?? rows[0].monto;
    const medioFinal = medio_pago ?? rows[0].medio_pago;
    const obsFinal =
      observaciones === undefined ? rows[0].observaciones : observaciones;

    await sql`
      UPDATE abonos_avicola
      SET monto = ${montoFinal},
          medio_pago = ${medioFinal},
          observaciones = ${obsFinal}
      WHERE id = ${id} AND NOT anulado
    `;

    const estado = await estadoCuentaCliente(sql, rows[0].cliente_id);
    return NextResponse.json({ ok: true, saldo_actual: estado?.saldo_actual ?? 0 });
  } catch (error: unknown) {
    console.error("Error al editar abono avícola:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

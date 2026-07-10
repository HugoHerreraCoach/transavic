// src/app/api/cobranzas-planta/abonos/[id]/route.ts
// PATCH — corregir un abono de planta mal digitado (monto/medio de pago/observaciones).
// Se BLOQUEA si el abono o su cobranza están anulados. Como el monto cambia el
// saldo, al final se recalcula el estado de la cobranza (Pagada/Parcial/…).
// admin + produccion (los mismos roles que registran abonos en el mostrador).
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MEDIOS_PAGO_PLANTA } from "@/lib/planta/types";
import { recalcularEstadoCobranza } from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

const PatchAbonoSchema = z
  .object({
    monto: z.number().positive().optional(),
    medio_pago: z.enum(MEDIOS_PAGO_PLANTA).optional(),
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
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
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
      SELECT a.id, a.cobranza_id, a.anulado, a.monto::float8 AS monto,
             a.medio_pago, a.observaciones, co.anulada AS cobranza_anulada
      FROM abonos_planta a
      JOIN cobranzas_planta co ON co.id = a.cobranza_id
      WHERE a.id = ${id}
    `) as Array<{
      id: string;
      cobranza_id: string;
      anulado: boolean;
      monto: number;
      medio_pago: string;
      observaciones: string | null;
      cobranza_anulada: boolean;
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
    if (rows[0].cobranza_anulada) {
      return NextResponse.json(
        { error: "La cobranza de este abono está anulada: no se puede editar" },
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
      UPDATE abonos_planta
      SET monto = ${montoFinal},
          medio_pago = ${medioFinal},
          observaciones = ${obsFinal}
      WHERE id = ${id} AND NOT anulado
    `;

    // El monto cambió el saldo → re-derivar el estado de la cobranza.
    await recalcularEstadoCobranza(sql, rows[0].cobranza_id);

    const saldoRows = (await sql`
      SELECT (co.monto - COALESCE((
        SELECT SUM(a.monto) FROM abonos_planta a
        WHERE a.cobranza_id = co.id AND NOT a.anulado
      ), 0))::float8 AS saldo
      FROM cobranzas_planta co
      WHERE co.id = ${rows[0].cobranza_id}
    `) as Array<{ saldo: number }>;

    return NextResponse.json({ ok: true, saldo: saldoRows[0]?.saldo ?? 0 });
  } catch (error: unknown) {
    console.error("Error al editar abono de planta:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

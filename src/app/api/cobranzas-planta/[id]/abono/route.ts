// src/app/api/cobranzas-planta/[id]/abono/route.ts
// POST — registrar un abono (pago parcial del "saldito") a UNA cobranza de planta.
// [id] = cobranza_id; el `id` del body = id del ABONO generado client-side
// (idempotencia contra el doble-tap en campo: si ya existe, se responde 200 con el
// saldo, nunca se duplica). admin + produccion. Aislado de `facturas`.
// Patrón de foto: base64 en DB (comprobante_data/mime), como abonos_avicola.
import { auth } from "@/auth";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MEDIOS_PAGO_PLANTA } from "@/lib/planta/types";
import { recalcularEstadoCobranza } from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

// La foto viene comprimida a webp en el cliente; ~2.8M chars base64 ≈ 2 MB.
const MAX_BASE64_CHARS = 2_800_000;
const MIMES_COMPROBANTE = ["image/jpeg", "image/png", "image/webp"] as const;

const AbonoSchema = z
  .object({
    // Id del ABONO generado en el cliente (idempotencia).
    id: z.string().uuid(),
    monto: z.number().positive(),
    medio_pago: z.enum(MEDIOS_PAGO_PLANTA),
    // Opcional: default (hoy Lima) lo pone la DB. No puede ser futura (se valida por SQL).
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD")
      .optional(),
    observaciones: z.string().optional().nullable(),
    comprobante_base64: z
      .string()
      .max(MAX_BASE64_CHARS, "La foto del comprobante es muy grande (máx. ~2 MB)")
      .optional(),
    comprobante_mime: z.enum(MIMES_COMPROBANTE).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.comprobante_base64 && !data.comprobante_mime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comprobante_mime"],
        message: "Falta el tipo de imagen del comprobante",
      });
    }
  });

interface RouteParams {
  params: Promise<{ id: string }>;
}

type Sql = NeonQueryFunction<false, false>;

/** Saldo de la cobranza = monto − Σ abonos NOT anulado. Fuente: ::float8. */
async function saldoDeCobranza(sql: Sql, cobranzaId: string): Promise<number> {
  const rows = (await sql`
    SELECT (co.monto - COALESCE((
      SELECT SUM(a.monto) FROM abonos_planta a
      WHERE a.cobranza_id = co.id AND NOT a.anulado
    ), 0))::float8 AS saldo
    FROM cobranzas_planta co
    WHERE co.id = ${cobranzaId}
  `) as Array<{ saldo: number }>;
  return rows[0]?.saldo ?? 0;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const { id: cobranzaId } = await params;
    if (!cobranzaId || !/^[0-9a-f-]{36}$/i.test(cobranzaId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = AbonoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      id,
      monto,
      medio_pago,
      fecha,
      observaciones,
      comprobante_base64,
      comprobante_mime,
    } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);

    // (a) La cobranza debe existir y NO estar anulada.
    const cobRows = (await sql`
      SELECT id, anulada FROM cobranzas_planta WHERE id = ${cobranzaId}
    `) as Array<{ id: string; anulada: boolean }>;
    if (cobRows.length === 0) {
      return NextResponse.json({ error: "Cobranza no encontrada" }, { status: 404 });
    }
    if (cobRows[0].anulada) {
      return NextResponse.json(
        { error: "Esta cobranza está anulada" },
        { status: 409 }
      );
    }

    // (b) Idempotencia: si el abono ya existe (doble-tap / reintento offline),
    // responder 200 con el saldo actual — nunca duplicar.
    const existente = (await sql`
      SELECT id FROM abonos_planta WHERE id = ${id}
    `) as Array<{ id: string }>;
    if (existente.length > 0) {
      return NextResponse.json(
        { ok: true, saldo: await saldoDeCobranza(sql, cobranzaId) },
        { status: 200 }
      );
    }

    // (c) Fecha no futura (validada contra hoy Lima por SQL — nunca new Date()).
    if (fecha) {
      const chk = (await sql`
        SELECT (${fecha}::date > (NOW() AT TIME ZONE 'America/Lima')::date) AS futura
      `) as Array<{ futura: boolean }>;
      if (chk[0]?.futura) {
        return NextResponse.json(
          { error: "La fecha del abono no puede ser futura" },
          { status: 400 }
        );
      }
    }

    // (d) INSERT. Si la fecha no vino, la pone la DB (hoy Lima) vía COALESCE.
    // Se permite el sobrepago (saldo negativo = a favor); NO se bloquea.
    try {
      await sql`
        INSERT INTO abonos_planta (
          id, cobranza_id, monto, medio_pago, fecha, observaciones,
          comprobante_data, comprobante_mime, creado_por
        ) VALUES (
          ${id},
          ${cobranzaId},
          ${monto},
          ${medio_pago},
          COALESCE(${fecha ?? null}::date, (NOW() AT TIME ZONE 'America/Lima')::date),
          ${observaciones ?? null},
          ${comprobante_base64 ?? null},
          ${comprobante_base64 ? (comprobante_mime ?? null) : null},
          ${session.user.id}
        )
      `;
    } catch (insertError: unknown) {
      // Carrera con un reintento simultáneo: el UNIQUE del PK ganó primero.
      if ((insertError as { code?: string })?.code === "23505") {
        return NextResponse.json(
          { ok: true, saldo: await saldoDeCobranza(sql, cobranzaId) },
          { status: 200 }
        );
      }
      throw insertError;
    }

    // (e) Recalcular el estado de la cobranza (Pagada/Parcial/…) tras el abono.
    await recalcularEstadoCobranza(sql, cobranzaId);

    return NextResponse.json(
      { ok: true, saldo: await saldoDeCobranza(sql, cobranzaId) },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error al registrar abono de planta:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

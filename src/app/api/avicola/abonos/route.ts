// src/app/api/avicola/abonos/route.ts
// POST — registrar un abono a la CUENTA de un cliente avícola (no a una venta).
// Módulo "Clientes Avícola" (admin-only). Los abonos NO tocan
// cuentas_bancarias/transacciones/caja (decisión 7 jul 2026).
// El `id` del abono lo genera el CLIENTE (crypto.randomUUID) como mecanismo de
// idempotencia contra el doble-tap en campo: si ya existe, se responde 200 con
// el saldo recalculado en vez de duplicar.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MEDIOS_PAGO_AVICOLA } from "@/lib/avicola/types";
import { estadoCuentaCliente, UMBRAL_DEUDA } from "@/lib/avicola/saldos";

export const dynamic = "force-dynamic";

// La foto viene comprimida a webp en el cliente; ~2.8M chars base64 ≈ 2 MB.
const MAX_BASE64_CHARS = 2_800_000;
const MIMES_COMPROBANTE = ["image/jpeg", "image/png", "image/webp"] as const;

const AbonoSchema = z
  .object({
    // Id del ABONO generado en el cliente (idempotencia).
    id: z.string().uuid(),
    cliente_id: z.string().uuid(),
    monto: z.number().positive(),
    medio_pago: z.enum(MEDIOS_PAGO_AVICOLA),
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
    permitir_sobrepago: z.boolean().optional(),
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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
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
      cliente_id,
      monto,
      medio_pago,
      fecha,
      observaciones,
      comprobante_base64,
      comprobante_mime,
      permitir_sobrepago,
    } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);

    // (a) Idempotencia: si el abono ya existe (doble-tap / reintento offline),
    // responder 200 con el saldo recalculado — nunca duplicar.
    const existente = (await sql`
      SELECT id, cliente_id FROM abonos_avicola WHERE id = ${id}
    `) as Array<{ id: string; cliente_id: string }>;
    if (existente.length > 0) {
      const estado = await estadoCuentaCliente(sql, existente[0].cliente_id);
      return NextResponse.json(
        { abono_id: id, saldo_actual: estado?.saldo_actual ?? 0 },
        { status: 200 }
      );
    }

    // Fecha no futura (validada contra hoy Lima por SQL — nunca new Date()).
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

    // (b) El cliente debe existir. OJO: abonar a un cliente INACTIVO SÍ se
    // permite — cobrar la deuda de un inactivo es legítimo.
    const estadoPrevio = await estadoCuentaCliente(sql, cliente_id);
    if (!estadoPrevio) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // (c) Sobrepago: 409 BLANDO (patrón permitir_duplicado de clientes) — el
    // frontend confirma con el usuario y reenvía con permitir_sobrepago: true.
    const saldo = estadoPrevio.saldo_actual;
    if (monto > saldo + UMBRAL_DEUDA && !permitir_sobrepago) {
      return NextResponse.json(
        {
          requiere_confirmacion: true,
          saldo_actual: saldo,
          error: "El monto supera el saldo pendiente.",
        },
        { status: 409 }
      );
    }

    // (d) INSERT. Si fecha no vino, la pone la DB (hoy Lima) vía COALESCE.
    try {
      await sql`
        INSERT INTO abonos_avicola (
          id, cliente_id, fecha, monto, medio_pago, observaciones,
          comprobante_data, comprobante_mime, creado_por
        ) VALUES (
          ${id},
          ${cliente_id},
          COALESCE(${fecha ?? null}::date, (NOW() AT TIME ZONE 'America/Lima')::date),
          ${monto},
          ${medio_pago},
          ${observaciones ?? null},
          ${comprobante_base64 ?? null},
          ${comprobante_base64 ? (comprobante_mime ?? null) : null},
          ${session.user.id}
        )
      `;
    } catch (insertError: unknown) {
      // Carrera con un reintento simultáneo: el UNIQUE del PK ganó primero.
      if ((insertError as { code?: string })?.code === "23505") {
        const estado = await estadoCuentaCliente(sql, cliente_id);
        return NextResponse.json(
          { abono_id: id, saldo_actual: estado?.saldo_actual ?? 0 },
          { status: 200 }
        );
      }
      throw insertError;
    }

    // (e) Saldo recalculado POST-insert (única fuente: saldos.ts).
    const estadoPost = await estadoCuentaCliente(sql, cliente_id);
    return NextResponse.json(
      { abono_id: id, saldo_actual: estadoPost?.saldo_actual ?? saldo - monto },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error al registrar abono avícola:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

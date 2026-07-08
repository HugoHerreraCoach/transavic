// src/app/api/clientes-planta/[id]/route.ts
// Ficha y edición de un cliente de planta (operación 3 / POS, admin + produccion).
// GET   → 200 { cliente: ClientePlantaConSaldo, cobranzas: CobranzaPlanta[] } | 404
// PATCH → 200 { cliente: ClientePlantaConSaldo } (recalculado) | 404
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EMPRESAS_PLANTA } from "@/lib/planta/types";
import { saldoClientePlanta, listaCobranzasPlanta } from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ActualizarSchema = z
  .object({
    nombre: z.string().trim().min(1),
    razon_social: z.string().nullable(),
    ruc_dni: z.string().nullable(),
    telefono: z.string().nullable(),
    direccion: z.string().nullable(),
    plazo_pago_dias: z.number().int().min(0),
    empresa: z.enum(EMPRESAS_PLANTA),
    activo: z.boolean(),
  })
  .partial();

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "produccion") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const cliente = await saldoClientePlanta(sql, id);
    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const cobranzas = await listaCobranzasPlanta(sql, id);
    return NextResponse.json({ cliente, cobranzas });
  } catch (error) {
    console.error("Error GET /api/clientes-planta/[id]:", error);
    return NextResponse.json({ error: "Error al obtener el cliente" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "produccion") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = ActualizarSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    // UPDATE por campo: COALESCE para los NOT NULL (nunca reciben null válido);
    // CASE WHEN para los nullable — así un null EXPLÍCITO sí limpia el campo
    // (con COALESCE puro sería imposible vaciar razón social/teléfono/etc.).
    const rows = await sql`
      UPDATE clientes_planta SET
        nombre          = COALESCE(${d.nombre ?? null}, nombre),
        razon_social    = CASE WHEN ${d.razon_social !== undefined}::boolean
                               THEN ${d.razon_social ?? null} ELSE razon_social END,
        ruc_dni         = CASE WHEN ${d.ruc_dni !== undefined}::boolean
                               THEN ${d.ruc_dni ?? null} ELSE ruc_dni END,
        telefono        = CASE WHEN ${d.telefono !== undefined}::boolean
                               THEN ${d.telefono ?? null} ELSE telefono END,
        direccion       = CASE WHEN ${d.direccion !== undefined}::boolean
                               THEN ${d.direccion ?? null} ELSE direccion END,
        plazo_pago_dias = COALESCE(${d.plazo_pago_dias ?? null}, plazo_pago_dias),
        empresa         = COALESCE(${d.empresa ?? null}, empresa),
        activo          = COALESCE(${d.activo ?? null}, activo),
        updated_at      = NOW()
      WHERE id = ${id}
      RETURNING id
    `;
    if (!rows[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Responder con el saldo recalculado (misma forma que la lista).
    const cliente = await saldoClientePlanta(sql, id);
    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ cliente });
  } catch (error) {
    console.error("Error PATCH /api/clientes-planta/[id]:", error);
    return NextResponse.json({ error: "Error al actualizar el cliente" }, { status: 500 });
  }
}

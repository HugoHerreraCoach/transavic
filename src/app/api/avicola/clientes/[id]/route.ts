// src/app/api/avicola/clientes/[id]/route.ts
// Ficha 360 y edición de un cliente del módulo "Clientes Avícola" (ADMIN-only).
// GET   → 200 FichaClienteAvicola { cliente, historial } | 404
// PATCH → 200 { cliente: ClienteAvicolaConSaldo } (recalculado) | 404
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EMPRESAS_AVICOLA, type FichaClienteAvicola } from "@/lib/avicola/types";
import { estadoCuentaCliente } from "@/lib/avicola/saldos";
import { historialCliente } from "@/lib/avicola/historial";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ActualizarSchema = z
  .object({
    nombre: z.string().trim().min(1),
    mercado: z.string().trim().min(1),
    numero_puesto: z.string().nullable(),
    telefono: z.string().nullable(),
    direccion: z.string().nullable(),
    observaciones: z.string().nullable(),
    empresa: z.enum(EMPRESAS_AVICOLA),
    saldo_anterior: z.number(),
    activo: z.boolean(),
  })
  .partial();

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const cliente = await estadoCuentaCliente(sql, id);
    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const historial = await historialCliente(sql, id);
    const ficha: FichaClienteAvicola = { cliente, historial };
    return NextResponse.json(ficha);
  } catch (error) {
    console.error("Error GET /api/avicola/clientes/[id]:", error);
    return NextResponse.json({ error: "Error al obtener el cliente" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
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
    // (con COALESCE puro sería imposible vaciar teléfono/puesto/etc.).
    const rows = await sql`
      UPDATE clientes_avicola SET
        nombre         = COALESCE(${d.nombre ?? null}, nombre),
        mercado        = COALESCE(${d.mercado ?? null}, mercado),
        numero_puesto  = CASE WHEN ${d.numero_puesto !== undefined}::boolean
                              THEN ${d.numero_puesto ?? null} ELSE numero_puesto END,
        telefono       = CASE WHEN ${d.telefono !== undefined}::boolean
                              THEN ${d.telefono ?? null} ELSE telefono END,
        direccion      = CASE WHEN ${d.direccion !== undefined}::boolean
                              THEN ${d.direccion ?? null} ELSE direccion END,
        observaciones  = CASE WHEN ${d.observaciones !== undefined}::boolean
                              THEN ${d.observaciones ?? null} ELSE observaciones END,
        empresa        = COALESCE(${d.empresa ?? null}, empresa),
        saldo_anterior = COALESCE(${d.saldo_anterior ?? null}, saldo_anterior),
        activo         = COALESCE(${d.activo ?? null}, activo),
        updated_at     = NOW()
      WHERE id = ${id}
      RETURNING id
    `;
    if (!rows[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Responder con el estado de cuenta recalculado (misma forma que la lista).
    const cliente = await estadoCuentaCliente(sql, id);
    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ cliente });
  } catch (error) {
    console.error("Error PATCH /api/avicola/clientes/[id]:", error);
    return NextResponse.json({ error: "Error al actualizar el cliente" }, { status: 500 });
  }
}

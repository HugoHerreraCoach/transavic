import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CuentaSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  tipo: z.enum(["banco", "efectivo", "billetera"]),
});

// Cuentas cuyo nombre usa la Caja Diaria como get-or-create POR NOMBRE
// (src/app/api/caja-diaria/route.ts:nombreCuentaEfectivo). Renombrarlas o
// desactivarlas rompería la apertura/cierre de caja, así que se bloquea.
const NOMBRES_RESERVADOS_CAJA = ["Caja Efectivo Planta", "Caja Efectivo Campo"];

const CuentaPatchSchema = z
  .object({
    id: z.string().uuid("Id de cuenta inválido"),
    nombre: z.string().trim().min(1, "El nombre es obligatorio").optional(),
    activa: z.boolean().optional(),
  })
  .refine((d) => d.nombre !== undefined || d.activa !== undefined, {
    message: "Nada que actualizar: envía nombre y/o activa",
  });

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  try {
    const cuentas = await sql`
      SELECT id, nombre, tipo, saldo, activa, created_at, updated_at
      FROM cuentas_bancarias
      ORDER BY created_at ASC
    `;
    return NextResponse.json(cuentas);
  } catch (error) {
    console.error("Error al obtener cuentas:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo el admin puede crear cuentas" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = CuentaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { nombre, tipo } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    const result = await sql`
      INSERT INTO cuentas_bancarias (nombre, tipo, saldo)
      VALUES (${nombre}, ${tipo}, 0)
      RETURNING id, nombre, tipo, saldo, activa
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error("Error al crear cuenta:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

// Editar cuenta: renombrar y/o desactivar/reactivar (id en el body, patrón del módulo).
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo el admin puede editar cuentas" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = CuentaPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { id, nombre, activa } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    const existentes = await sql`
      SELECT id, nombre, activa FROM cuentas_bancarias WHERE id = ${id} LIMIT 1
    `;
    if (existentes.length === 0) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }
    const cuenta = existentes[0];

    // Guards del string mágico de Caja Diaria (get-or-create por nombre).
    if (nombre !== undefined && nombre !== cuenta.nombre) {
      if (NOMBRES_RESERVADOS_CAJA.includes(cuenta.nombre)) {
        return NextResponse.json(
          { error: "Esta cuenta la usa la Caja Diaria; no se puede renombrar" },
          { status: 409 }
        );
      }
      if (NOMBRES_RESERVADOS_CAJA.includes(nombre)) {
        return NextResponse.json(
          { error: "Ese nombre está reservado para la Caja Diaria; elige otro" },
          { status: 409 }
        );
      }
    }
    if (activa === false && NOMBRES_RESERVADOS_CAJA.includes(cuenta.nombre)) {
      return NextResponse.json(
        { error: "Esta cuenta la usa la Caja Diaria; no se puede desactivar" },
        { status: 409 }
      );
    }

    const result = await sql`
      UPDATE cuentas_bancarias
      SET nombre = COALESCE(${nombre ?? null}, nombre),
          activa = COALESCE(${activa ?? null}, activa),
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      WHERE id = ${id}
      RETURNING id, nombre, tipo, saldo, activa
    `;

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Error al editar cuenta:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

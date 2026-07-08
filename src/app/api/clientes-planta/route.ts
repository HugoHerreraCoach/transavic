// src/app/api/clientes-planta/route.ts
// Directorio del módulo "Clientes de Planta" (operación 3 / POS, admin + produccion).
// GET  → { clientes: ClientePlantaConSaldo[] } con filtros en TS (volumen: decenas)
// POST → 201 { cliente: ClientePlanta } (idempotente por id generado en el cliente)
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EMPRESAS_PLANTA, type ClientePlanta } from "@/lib/planta/types";
import { listaClientesPlantaConSaldo, UMBRAL_DEUDA_PLANTA } from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

const CrearSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(1),
  razon_social: z.string().optional().nullable(),
  ruc_dni: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  plazo_pago_dias: z.number().int().min(0).default(0),
  empresa: z.enum(EMPRESAS_PLANTA).default("Avícola de Tony"),
});

/** Normaliza para búsqueda: minúsculas y sin tildes. */
const normalizar = (valor: string | null | undefined): string =>
  (valor ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const soloDigitos = (valor: string | null | undefined): string =>
  (valor ?? "").replace(/\D/g, "");

/** Detecta el unique violation de Postgres (código 23505). */
function esUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; message?: string };
  return (
    e.code === "23505" ||
    (e.message ?? "").includes("23505") ||
    (e.message ?? "").includes("duplicate key")
  );
}

/** El choque es por RUC/DNI (índice ux_clientes_planta_ruc), no por PK (id). */
function esViolacionRuc(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { constraint?: string; message?: string };
  return (
    (e.constraint ?? "").includes("ruc") ||
    (e.message ?? "").includes("ux_clientes_planta_ruc")
  );
}

type Sql = NeonQueryFunction<false, false>;

/** Devuelve el ClientePlanta base por id (forma de la fila, sin saldo). */
async function clientePlantaPorId(sql: Sql, id: string): Promise<ClientePlanta | null> {
  const rows = (await sql`
    SELECT
      id, nombre, razon_social, ruc_dni, telefono, direccion,
      plazo_pago_dias, activo, empresa,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM clientes_planta
    WHERE id = ${id}
  `) as unknown as ClientePlanta[];
  return rows[0] ?? null;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "produccion") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    let clientes = await listaClientesPlantaConSaldo(sql);

    // Filtros en TS sobre el resultado (decisión saldos.ts: volumen de decenas).
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();
    const activo = searchParams.get("activo");
    const conDeuda = searchParams.get("con_deuda");

    if (q) {
      const qNorm = normalizar(q);
      const qDigitos = soloDigitos(q);
      const esNumerico = /^\d+$/.test(q);
      clientes = clientes.filter((c) => {
        const matchTexto =
          normalizar(c.nombre).includes(qNorm) ||
          normalizar(c.razon_social).includes(qNorm) ||
          normalizar(c.ruc_dni).includes(qNorm) ||
          normalizar(c.telefono).includes(qNorm);
        // q numérico: además matchea teléfono y RUC/DNI comparando SOLO dígitos
        // (ignora espacios/guiones guardados).
        const matchNumerico =
          esNumerico &&
          (soloDigitos(c.telefono).includes(qDigitos) ||
            soloDigitos(c.ruc_dni).includes(qDigitos));
        return matchTexto || matchNumerico;
      });
    }
    if (activo === "true" || activo === "false") {
      const valor = activo === "true";
      clientes = clientes.filter((c) => c.activo === valor);
    }
    if (conDeuda === "true") {
      clientes = clientes.filter((c) => c.saldo_actual > UMBRAL_DEUDA_PLANTA);
    }

    return NextResponse.json({ clientes });
  } catch (error) {
    console.error("Error GET /api/clientes-planta:", error);
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "produccion") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = CrearSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const d = parsed.data;

    // Pre-check por id: si ya existe (reintento offline), responder el existente (idempotente).
    const existente = await clientePlantaPorId(sql, d.id);
    if (existente) {
      return NextResponse.json({ cliente: existente });
    }

    // ruc_dni vacío ("") → NULL (para no chocar con el índice único parcial).
    const rucDni = d.ruc_dni && d.ruc_dni.trim() !== "" ? d.ruc_dni.trim() : null;

    try {
      const rows = (await sql`
        INSERT INTO clientes_planta
          (id, nombre, razon_social, ruc_dni, telefono, direccion,
           plazo_pago_dias, empresa, created_by)
        VALUES
          (${d.id}, ${d.nombre}, ${d.razon_social ?? null}, ${rucDni},
           ${d.telefono ?? null}, ${d.direccion ?? null},
           ${d.plazo_pago_dias}, ${d.empresa}, ${session.user.id})
        RETURNING
          id, nombre, razon_social, ruc_dni, telefono, direccion,
          plazo_pago_dias, activo, empresa,
          created_at::text AS created_at, updated_at::text AS updated_at
      `) as unknown as ClientePlanta[];

      return NextResponse.json({ cliente: rows[0] }, { status: 201 });
    } catch (insertError) {
      if (esUniqueViolation(insertError)) {
        if (esViolacionRuc(insertError)) {
          return NextResponse.json(
            { error: "Ya existe un cliente de planta con ese RUC/DNI." },
            { status: 409 }
          );
        }
        // Choque por id (race con otro reintento): re-SELECT y devolver el existente.
        const cliente = await clientePlantaPorId(sql, d.id);
        if (cliente) {
          return NextResponse.json({ cliente });
        }
      }
      throw insertError;
    }
  } catch (error) {
    console.error("Error POST /api/clientes-planta:", error);
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}

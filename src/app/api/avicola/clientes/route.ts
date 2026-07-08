// src/app/api/avicola/clientes/route.ts
// Directorio del módulo "Clientes Avícola" (venta en campo, ADMIN-only).
// GET  → { clientes: ClienteAvicolaConSaldo[] } con filtros en TS (volumen: decenas)
// POST → 201 { cliente: ClienteAvicola }
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EMPRESAS_AVICOLA, type ClienteAvicola } from "@/lib/avicola/types";
import { listaClientesConSaldo, UMBRAL_DEUDA } from "@/lib/avicola/saldos";

export const dynamic = "force-dynamic";

const CrearSchema = z.object({
  nombre: z.string().trim().min(1),
  mercado: z.string().trim().min(1),
  numero_puesto: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  empresa: z.enum(EMPRESAS_AVICOLA).default("Transavic"),
  saldo_anterior: z.number().default(0),
});

/** Normaliza para búsqueda: minúsculas y sin tildes. */
const normalizar = (valor: string | null | undefined): string =>
  (valor ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const soloDigitos = (valor: string | null | undefined): string =>
  (valor ?? "").replace(/\D/g, "");

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    let clientes = await listaClientesConSaldo(sql);

    // Filtros en TS sobre el resultado (decisión saldos.ts: volumen de decenas).
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();
    const mercado = searchParams.get("mercado")?.trim();
    const activo = searchParams.get("activo");
    const conDeuda = searchParams.get("con_deuda");

    if (q) {
      const qNorm = normalizar(q);
      const qDigitos = soloDigitos(q);
      const esNumerico = /^\d+$/.test(q);
      clientes = clientes.filter((c) => {
        const matchTexto =
          normalizar(c.nombre).includes(qNorm) ||
          normalizar(c.mercado).includes(qNorm) ||
          normalizar(c.numero_puesto).includes(qNorm) ||
          normalizar(c.telefono).includes(qNorm);
        // q numérico: además matchea el teléfono comparando SOLO dígitos
        // (ignora espacios/guiones guardados) y el número de puesto.
        const matchNumerico =
          esNumerico &&
          (soloDigitos(c.telefono).includes(qDigitos) ||
            soloDigitos(c.numero_puesto).includes(qDigitos));
        return matchTexto || matchNumerico;
      });
    }
    if (mercado) {
      clientes = clientes.filter((c) => c.mercado === mercado);
    }
    if (activo === "true" || activo === "false") {
      const valor = activo === "true";
      clientes = clientes.filter((c) => c.activo === valor);
    }
    if (conDeuda === "true") {
      clientes = clientes.filter((c) => c.saldo_actual > UMBRAL_DEUDA);
    }

    return NextResponse.json({ clientes });
  } catch (error) {
    console.error("Error GET /api/avicola/clientes:", error);
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
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
    const rows = (await sql`
      INSERT INTO clientes_avicola
        (nombre, mercado, numero_puesto, telefono, direccion, observaciones, empresa, saldo_anterior)
      VALUES
        (${d.nombre}, ${d.mercado}, ${d.numero_puesto ?? null}, ${d.telefono ?? null},
         ${d.direccion ?? null}, ${d.observaciones ?? null}, ${d.empresa}, ${d.saldo_anterior})
      RETURNING
        id, nombre, mercado, numero_puesto, telefono, direccion, observaciones, empresa,
        saldo_anterior::float8 AS saldo_anterior, activo,
        created_at::text AS created_at, updated_at::text AS updated_at
    `) as ClienteAvicola[];

    return NextResponse.json({ cliente: rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Error POST /api/avicola/clientes:", error);
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}

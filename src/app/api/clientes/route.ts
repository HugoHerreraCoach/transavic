// src/app/api/clientes/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  nombre: z.string().min(1),
  razon_social: z.string().optional().nullable(),
  ruc_dni: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  direccion_mapa: z.string().optional().nullable(),
  distrito: z.string().optional().nullable(),
  tipo_cliente: z.string().optional().nullable(),
  hora_entrega: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  empresa: z.string().optional().nullable(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    if (q && q.trim()) {
      // Búsqueda autocomplete — flat array, no pagination
      const clientes = await sql`
        SELECT * FROM clientes
        WHERE nombre ILIKE ${'%' + q.trim() + '%'}
        ORDER BY nombre ASC
        LIMIT 8
      `;
      return NextResponse.json(clientes);
    }

    // Paginated list
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "15")));
    const search = searchParams.get("search")?.trim();
    const offset = (page - 1) * limit;

    let clientes;
    let countResult;

    if (search) {
      clientes = await sql`
        SELECT * FROM clientes
        WHERE nombre ILIKE ${'%' + search + '%'}
          OR ruc_dni ILIKE ${'%' + search + '%'}
          OR whatsapp ILIKE ${'%' + search + '%'}
          OR distrito ILIKE ${'%' + search + '%'}
          OR razon_social ILIKE ${'%' + search + '%'}
        ORDER BY nombre ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) FROM clientes
        WHERE nombre ILIKE ${'%' + search + '%'}
          OR ruc_dni ILIKE ${'%' + search + '%'}
          OR whatsapp ILIKE ${'%' + search + '%'}
          OR distrito ILIKE ${'%' + search + '%'}
          OR razon_social ILIKE ${'%' + search + '%'}
      `;
    } else {
      clientes = await sql`SELECT * FROM clientes ORDER BY nombre ASC LIMIT ${limit} OFFSET ${offset}`;
      countResult = await sql`SELECT COUNT(*) FROM clientes`;
    }

    const total = Number(countResult[0].count);
    return NextResponse.json({
      data: clientes,
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      }
    });
  } catch (error) {
    console.error("Error GET /api/clientes:", error);
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const { nombre, razon_social, ruc_dni, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, hora_entrega, notas, empresa, latitude, longitude } = parsed.data;

    const result = await sql`
      INSERT INTO clientes (nombre, razon_social, ruc_dni, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, hora_entrega, notas, empresa, latitude, longitude)
      VALUES (${nombre}, ${razon_social ?? null}, ${ruc_dni ?? null}, ${whatsapp ?? null}, ${direccion ?? null}, ${direccion_mapa ?? null}, ${distrito ?? 'La Victoria'}, ${tipo_cliente ?? 'Frecuente'}, ${hora_entrega ?? null}, ${notas ?? null}, ${empresa ?? 'Transavic'}, ${latitude ?? null}, ${longitude ?? null})
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error("Error POST /api/clientes:", error);
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}

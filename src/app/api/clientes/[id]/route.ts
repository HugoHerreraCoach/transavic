// src/app/api/clientes/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  nombre: z.string().min(1).optional(),
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
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "ID no encontrado" }, { status: 400 });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const result = await sql`SELECT * FROM clientes WHERE id = ${id}`;
    if (result.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Error GET /api/clientes/[id]:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "ID no encontrado" }, { status: 400 });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    // Agregar updated_at
    entries.push(['updated_at', new Date().toISOString()]);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`).join(", ");
    const params = entries.map(([, v]) => v);
    params.push(id);

    const query = `UPDATE clientes SET ${setClauses} WHERE id = $${params.length} RETURNING *`;
    const result = await sql.query(query, params);

    if (result.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Error PATCH /api/clientes/[id]:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "ID no encontrado" }, { status: 400 });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const result = await sql`DELETE FROM clientes WHERE id = ${id} RETURNING id`;
    if (result.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ message: "Cliente eliminado" });
  } catch (error) {
    console.error("Error DELETE /api/clientes/[id]:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

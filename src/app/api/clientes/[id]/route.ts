// src/app/api/clientes/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

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
  asesor_id: z.string().uuid().optional().nullable(), // Para transferencia
});

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "ID no encontrado" }, { status: 400 });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const result = await sql`SELECT * FROM clientes WHERE id = ${id}`;
    if (!result[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const cliente = result[0];
    // Verificar propiedad: asesora solo ve sus clientes
    if (session.user.role !== "admin" && cliente.asesor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes acceso a este cliente" }, { status: 403 });
    }

    return NextResponse.json(cliente);
  } catch (error) {
    console.error("Error GET /api/clientes/[id]:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "ID no encontrado" }, { status: 400 });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    // Verificar propiedad
    const existing = await sql`SELECT * FROM clientes WHERE id = ${id}`;
    if (!existing[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    if (session.user.role !== "admin" && existing[0].asesor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes acceso a este cliente" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    // Validar transferencia: verificar que el asesor destino existe
    if (parsed.data.asesor_id) {
      const targetUser = await sql`SELECT id FROM users WHERE id = ${parsed.data.asesor_id}`;
      if (!targetUser[0]) {
        return NextResponse.json({ error: "El asesor destino no existe" }, { status: 400 });
      }
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

    const query = `UPDATE clientes SET ${setClauses} WHERE id = $${params.length} RETURNING *, (SELECT name FROM users WHERE id = clientes.asesor_id) as asesor_name`;
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
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "ID no encontrado" }, { status: 400 });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    // Verificar propiedad
    const existing = await sql`SELECT asesor_id FROM clientes WHERE id = ${id}`;
    if (!existing[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    if (session.user.role !== "admin" && existing[0].asesor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes acceso a este cliente" }, { status: 403 });
    }

    const result = await sql`DELETE FROM clientes WHERE id = ${id} RETURNING id`;
    if (!result[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ message: "Cliente eliminado" });
  } catch (error) {
    console.error("Error DELETE /api/clientes/[id]:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

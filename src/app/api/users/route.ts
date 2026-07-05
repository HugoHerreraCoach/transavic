// src/app/api/users/route.ts

import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import bcrypt from 'bcrypt';
import { z } from 'zod';

export const dynamic = "force-dynamic";

const CreateUserSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  role: z.enum(['admin', 'asesor', 'repartidor', 'produccion']),
  chofer_dni: z.string().trim().optional().nullable(),
  chofer_licencia: z.string().trim().optional().nullable(),
  vehiculo_placa: z.string().trim().optional().nullable(),
  chofer_nombres: z.string().trim().optional().nullable(),
  chofer_apellidos: z.string().trim().optional().nullable(),
  activo_rotacion: z.boolean().default(true),
  orden_rotacion: z.number().int().default(1),
  leads_recibidos_hoy: z.number().int().default(0),
});

// Función para obtener usuarios
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get("role");

    // No-admin: solo puede obtener lista filtrada por rol (id + name, sin datos sensibles)
    // Esto permite a las asesoras ver la lista de asesoras para transferir clientes
    if (session.user.role !== "admin") {
      if (!roleFilter) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      const users = await sql`
        SELECT id, name, role, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy FROM users WHERE role = ${roleFilter} ORDER BY name ASC
      `;
      return NextResponse.json(users);
    }

    // Admin: lista completa o filtrada
    let users;
    if (roleFilter) {
      users = await sql`
        SELECT id, name, role, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy FROM users WHERE role = ${roleFilter} ORDER BY name ASC
      `;
    } else {
      users = await sql`
        SELECT id, name, role, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy FROM users ORDER BY name ASC
      `;
    }

    return NextResponse.json(users);
  } catch (error) {
    console.error("Error al obtener usuarios:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}


export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsedData = CreateUserSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    const { name, password, role, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy } = parsedData.data;

    const connectionString = process.env.DATABASE_URL!;
    const sql = neon(connectionString);

    // Verificar si el usuario ya existe
    const existingUser = await sql`SELECT id FROM users WHERE name = ${name}`;
    if (existingUser.length > 0) {
      return NextResponse.json({ error: 'El nombre de usuario ya está en uso.' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await sql`
      INSERT INTO users (name, password, role, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy)
      VALUES (${name}, ${hashedPassword}, ${role}, ${chofer_dni ?? null}, ${chofer_licencia ?? null}, ${vehiculo_placa ?? null}, ${chofer_nombres ?? null}, ${chofer_apellidos ?? null}, ${activo_rotacion}, ${orden_rotacion}, ${leads_recibidos_hoy})
      RETURNING id, name, role, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy
    `;

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

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
  role: z.enum(['admin', 'asesor', 'repartidor']),
});

// Función para obtener todos los usuarios (excepto contraseñas)
export async function GET() {
  const session = await auth();

  // 1. Proteger la ruta: solo los admins pueden acceder
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    // 2. Consultar usuarios sin la columna de la contraseña
    const users = await sql`
      SELECT id, name, role FROM users ORDER BY name ASC
    `;

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

    const { name, password, role } = parsedData.data;

    const connectionString = process.env.DATABASE_URL!;
    const sql = neon(connectionString);

    // Verificar si el usuario ya existe
    const existingUser = await sql`SELECT id FROM users WHERE name = ${name}`;
    if (existingUser.length > 0) {
      return NextResponse.json({ error: 'El nombre de usuario ya está en uso.' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await sql`
      INSERT INTO users (name, password, role)
      VALUES (${name}, ${hashedPassword}, ${role})
      RETURNING id, name, role
    `;

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

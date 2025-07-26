// src/app/api/users/[id]/route.ts

import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import bcrypt from 'bcrypt';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Esquema para actualizar: todos los campos son opcionales
const UpdateUserSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres.").optional(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").optional().or(z.literal('')),
  role: z.enum(['admin', 'asesor', 'repartidor']).optional(),
});


// Función para ACTUALIZAR un usuario
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  try {
    const id = params.id; // Se extrae el id de los params desestructurados
    const body = await request.json();
    const parsedData = UpdateUserSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }
    
    const { name, password, role } = parsedData.data;
    const connectionString = process.env.DATABASE_URL!;
    const sql = neon(connectionString);

    const updates: Record<string, string> = {};
    if (name) updates.name = name;
    if (role) updates.role = role;
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No se proporcionaron campos para actualizar." }, { status: 400 });
    }

    const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`).join(', ');
    const values = Object.values(updates);

    const [updatedUser] = await sql.query(
      `UPDATE users SET ${setClauses} WHERE id = $${values.length + 1} RETURNING id, name, role`,
      [...values, id]
    );

    if (!updatedUser) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

// ✅ CAMBIO: Se revierte a la firma estándar de Next.js con desestructuración.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  try {
    const id = params.id; // Se extrae el id de los params desestructurados
    const connectionString = process.env.DATABASE_URL!;
    const sql = neon(connectionString);

    const [result] = await sql`SELECT COUNT(*) as count FROM pedidos WHERE asesor_id = ${id}`;
    const pedidoCount = Number(result.count);

    if (pedidoCount > 0) {
      return NextResponse.json(
        { error: `Este usuario tiene ${pedidoCount} pedido(s) asignado(s) y no puede ser eliminado.` },
        { status: 409 }
      );
    }

    await sql`DELETE FROM users WHERE id = ${id}`;

    return new NextResponse(null, { status: 204 });

  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
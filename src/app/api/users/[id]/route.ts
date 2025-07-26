// src/app/api/users/[id]/route.ts

import { neon } from '@neondatabase/serverless';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import bcrypt from 'bcrypt';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Esquema para validar los datos de entrada al actualizar un usuario.
const UpdateUserSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres.").optional(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").optional().or(z.literal('')),
  role: z.enum(['admin', 'asesor', 'repartidor']).optional(),
});

/**
 * Manejador PATCH para actualizar un usuario existente por su ID.
 * ✅ CAMBIO FINAL: Se usa el mismo patrón que en el archivo `pedidos` que sí funciona.
 * Se elimina el segundo parámetro `context` y se obtiene el ID manualmente desde la URL.
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  try {
    // Se extrae el ID manualmente desde la URL, igual que en tu archivo `pedidos`.
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
        return NextResponse.json({ error: "ID de usuario no proporcionado en la URL" }, { status: 400 });
    }

    const body = await request.json();
    const parsedData = UpdateUserSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }
    
    const { name, password, role } = parsedData.data;
    
    if (!name && !password && !role) {
      return NextResponse.json({ error: "No se proporcionaron campos para actualizar." }, { status: 400 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error("La variable de entorno DATABASE_URL no está definida.");
      return NextResponse.json({ error: "Error de configuración del servidor." }, { status: 500 });
    }
    const sql = neon(connectionString);

    const updates: Record<string, string> = {};
    if (name) updates.name = name;
    if (role) updates.role = role;
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    const setClauses = Object.keys(updates).map((key, i) => `"${key}" = $${i + 1}`).join(', ');
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

/**
 * Manejador DELETE para eliminar un usuario por su ID.
 * ✅ CAMBIO FINAL: Se alinea con el patrón que sí funciona en tu proyecto.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  try {
    // Se extrae el ID manualmente desde la URL.
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
        return NextResponse.json({ error: "ID de usuario no proporcionado en la URL" }, { status: 400 });
    }
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error("La variable de entorno DATABASE_URL no está definida.");
      return NextResponse.json({ error: "Error de configuración del servidor." }, { status: 500 });
    }
    const sql = neon(connectionString);

    const result = await sql`SELECT COUNT(*) as count FROM pedidos WHERE asesor_id = ${id}`;
    const pedidoCount = Number(result[0].count);

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

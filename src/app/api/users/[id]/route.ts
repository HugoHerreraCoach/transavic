// src/app/api/users/[id]/route.ts

import { neon } from '@neondatabase/serverless';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { sanearVistas } from '@/lib/vistas';

export const dynamic = 'force-dynamic';

// Esquema para validar los datos de entrada al actualizar un usuario.
const UpdateUserSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres.").optional(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").optional().or(z.literal('')),
  role: z.enum(['admin', 'asesor', 'repartidor', 'produccion']).optional(),
  solo_lectura: z.boolean().optional(),
  vistas_permitidas: z.array(z.string()).nullable().optional(),
  chofer_dni: z.string().trim().optional().nullable(),
  chofer_licencia: z.string().trim().optional().nullable(),
  vehiculo_placa: z.string().trim().optional().nullable(),
  chofer_nombres: z.string().trim().optional().nullable(),
  chofer_apellidos: z.string().trim().optional().nullable(),
  activo_rotacion: z.boolean().optional(),
  orden_rotacion: z.number().int().optional(),
  leads_recibidos_hoy: z.number().int().optional(),
  // Desactivar = apagar el acceso de un ex-empleado (el login lo rechaza en auth.ts).
  // Se usa en vez de DELETE cuando el usuario tiene historial. JAMÁS borrar la fila.
  activo: z.boolean().optional(),
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
    
    const { name, password, role, solo_lectura, vistas_permitidas, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy, activo } = parsedData.data;

    // Nadie puede desactivarse a sí mismo (evita dejar el sistema sin admins por accidente).
    if (activo === false && session.user.id === (new URL(request.url)).pathname.split("/").pop()) {
      return NextResponse.json({ error: "No puedes desactivar tu propio usuario." }, { status: 400 });
    }

    if (
      !name &&
      !password &&
      !role &&
      solo_lectura === undefined &&
      vistas_permitidas === undefined &&
      chofer_dni === undefined &&
      chofer_licencia === undefined &&
      vehiculo_placa === undefined &&
      chofer_nombres === undefined &&
      chofer_apellidos === undefined &&
      activo_rotacion === undefined &&
      orden_rotacion === undefined &&
      leads_recibidos_hoy === undefined &&
      activo === undefined
    ) {
      return NextResponse.json({ error: "No se proporcionaron campos para actualizar." }, { status: 400 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error("La variable de entorno DATABASE_URL no está definida.");
      return NextResponse.json({ error: "Error de configuración del servidor." }, { status: 500 });
    }
    const sql = neon(connectionString);

    const updates: Record<string, string | number | boolean | null | string[]> = {};
    if (name) updates.name = name;
    if (role) updates.role = role;
    if (solo_lectura !== undefined) updates.solo_lectura = solo_lectura;
    if (vistas_permitidas !== undefined) updates.vistas_permitidas = sanearVistas(vistas_permitidas);
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }
    if (chofer_dni !== undefined) updates.chofer_dni = chofer_dni;
    if (chofer_licencia !== undefined) updates.chofer_licencia = chofer_licencia;
    if (vehiculo_placa !== undefined) updates.vehiculo_placa = vehiculo_placa;
    if (chofer_nombres !== undefined) updates.chofer_nombres = chofer_nombres;
    if (chofer_apellidos !== undefined) updates.chofer_apellidos = chofer_apellidos;
    if (activo_rotacion !== undefined) updates.activo_rotacion = activo_rotacion;
    if (orden_rotacion !== undefined) updates.orden_rotacion = orden_rotacion;
    if (leads_recibidos_hoy !== undefined) updates.leads_recibidos_hoy = leads_recibidos_hoy;
    if (activo !== undefined) updates.activo = activo;

    // vistas_permitidas es text[]: se castea explícito para que el driver HTTP de Neon
    // no infiera mal el tipo (gotcha #45c).
    const setClauses = Object.keys(updates)
      .map((key, i) => `"${key}" = $${i + 1}${key === 'vistas_permitidas' ? '::text[]' : ''}`)
      .join(', ');
    const values = Object.values(updates);

    const [updatedUser] = await sql.query(
      `UPDATE users SET ${setClauses} WHERE id = $${values.length + 1} RETURNING id, name, role, solo_lectura, vistas_permitidas, chofer_dni, chofer_licencia, vehiculo_placa, chofer_nombres, chofer_apellidos, activo_rotacion, orden_rotacion, leads_recibidos_hoy, activo`,
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

    // Bloquea la eliminación si el usuario tiene historial que la base protege
    // (FKs NO ACTION): pedidos (como asesor o repartidor), comprobantes y cambios de precio.
    const [ped, fac, pre] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM pedidos WHERE asesor_id = ${id} OR repartidor_id = ${id}`,
      sql`SELECT COUNT(*)::int AS n FROM facturas WHERE asesor_id = ${id}`,
      sql`SELECT COUNT(*)::int AS n FROM precios_productos WHERE created_by = ${id}`,
    ]);
    const partes: string[] = [];
    if (Number(ped[0].n) > 0) partes.push(`${ped[0].n} pedido(s)`);
    if (Number(fac[0].n) > 0) partes.push(`${fac[0].n} comprobante(s)`);
    if (Number(pre[0].n) > 0) partes.push(`${pre[0].n} cambio(s) de precio`);

    if (partes.length > 0) {
      return NextResponse.json(
        { error: `No se puede eliminar: este usuario tiene ${partes.join(", ")} en su historial. Usa "Desactivar" para quitarle el acceso sin perder los datos.` },
        { status: 409 }
      );
    }

    await sql`DELETE FROM users WHERE id = ${id}`;

    return new NextResponse(null, { status: 204 });

  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    // Si una FK aún bloquea (código Postgres 23503), avisar claro en vez de un 500 genérico.
    const msg = error instanceof Error ? error.message : String(error);
    if (/foreign key|23503/i.test(msg)) {
      return NextResponse.json(
        { error: 'No se puede eliminar: este usuario tiene movimientos registrados en el sistema.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

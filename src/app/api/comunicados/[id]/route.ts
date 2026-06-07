// src/app/api/comunicados/[id]/route.ts
// GET — administrador: obtiene detalles del comunicado, listado de imágenes y reporte de lecturas.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID de comunicado inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // 1. Obtener datos del comunicado
    const [comunicado] = (await sql`
      SELECT id, titulo, cuerpo, creado_por, destinatarios, created_at
      FROM comunicados
      WHERE id = ${id}::uuid
    `) as Array<{
      id: string;
      titulo: string;
      cuerpo: string;
      creado_por: string;
      destinatarios: string[]; // UUID strings
      created_at: string;
    }>;

    if (!comunicado) {
      return NextResponse.json({ error: "Comunicado no encontrado" }, { status: 404 });
    }

    // 2. Obtener lista de imágenes (sin base64 para no saturar la respuesta)
    const imagenes = await sql`
      SELECT id, orden, imagen_mime
      FROM comunicado_imagenes
      WHERE comunicado_id = ${id}::uuid
      ORDER BY orden ASC
    `;

    // 3. Obtener usuarios que ya leyeron el comunicado
    const lecturas = await sql`
      SELECT cl.user_id, u.name, u.role, cl.leido_at
      FROM comunicado_lecturas cl
      JOIN users u ON u.id = cl.user_id
      WHERE cl.comunicado_id = ${id}::uuid
      ORDER BY cl.leido_at DESC
    `;

    // 4. Obtener usuarios pendientes de lectura
    const destinatariosArray = comunicado.destinatarios;
    let pendientes: Array<{ id: string; name: string; role: string }> = [];

    if (destinatariosArray && destinatariosArray.length > 0) {
      // Postgres: buscamos usuarios cuyos IDs estén en destinatarios y no hayan leído
      pendientes = (await sql`
        SELECT id, name, role
        FROM users
        WHERE id::text = ANY(${destinatariosArray})
          AND id NOT IN (
            SELECT user_id FROM comunicado_lecturas
            WHERE comunicado_id = ${id}::uuid
          )
        ORDER BY name ASC
      `) as Array<{ id: string; name: string; role: string }>;
    }

    return NextResponse.json({
      comunicado,
      imagenes,
      lecturas,
      pendientes
    });
  } catch (error) {
    console.error("Error GET /api/comunicados/[id]:", error);
    return NextResponse.json({ error: "Error al obtener detalles del comunicado" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID de comunicado inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Eliminar comunicado
    const result = await sql`
      DELETE FROM comunicados
      WHERE id = ${id}::uuid
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: "Comunicado no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Comunicado eliminado exitosamente" });
  } catch (error) {
    console.error("Error DELETE /api/comunicados/[id]:", error);
    return NextResponse.json({ error: "Error al eliminar el comunicado" }, { status: 500 });
  }
}

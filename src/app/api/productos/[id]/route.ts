// src/app/api/productos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no está definida");

    const body = await request.json();
    const sql = neon(connectionString);

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | boolean)[] = [];
    let paramIdx = 1;

    if (body.nombre !== undefined) {
      updates.push(`nombre = $${paramIdx++}`);
      values.push(body.nombre);
    }
    if (body.categoria !== undefined) {
      updates.push(`categoria = $${paramIdx++}`);
      values.push(body.categoria);
    }
    if (body.unidad !== undefined) {
      updates.push(`unidad = $${paramIdx++}`);
      values.push(body.unidad);
    }
    if (body.activo !== undefined) {
      updates.push(`activo = $${paramIdx++}`);
      values.push(body.activo);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    values.push(id);
    const query = `
      UPDATE productos SET ${updates.join(", ")}
      WHERE id = $${paramIdx}
      RETURNING id, nombre, categoria, unidad, activo
    `;

    const result = await sql.query(query, values);

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: result[0] });
  } catch (error) {
    console.error("Error al actualizar producto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no está definida");

    const sql = neon(connectionString);

    // Soft delete: mark as inactive
    const result = await sql`
      UPDATE productos SET activo = FALSE WHERE id = ${id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "Producto desactivado" });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}

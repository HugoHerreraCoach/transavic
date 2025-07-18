// src/app/api/pedidos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  pesoExacto: z.number().nullable(),
});

export async function PATCH(request: Request) {
  try {
    // Extraemos el ID directamente de la URL
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const body = await request.json();
    const parsedData = UpdateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const { pesoExacto } = parsedData.data;
    const sql = neon(connectionString);

    await sql`
      UPDATE pedidos
      SET peso_exacto = ${pesoExacto}
      WHERE id = ${id}
    `;

    return NextResponse.json(
      { message: "Pedido actualizado" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error en API PATCH:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    // ✅ Se extrae el ID directamente desde la URL de la petición
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return NextResponse.json({ error: 'ID del pedido no encontrado' }, { status: 400 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);
    
    const result = await sql`
      DELETE FROM pedidos
      WHERE id = ${id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Pedido no encontrado para eliminar' }, { status: 404 });
    }

    return NextResponse.json({ message: "Pedido eliminado exitosamente" }, { status: 200 });
  } catch (error) {
    console.error("Error en API DELETE:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
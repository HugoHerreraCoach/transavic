// src/app/api/pedidos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  cliente: z.string().min(1).optional(),
  whatsapp: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  distrito: z.string().optional(),
  tipo_cliente: z.string().optional(),
  detalle: z.string().min(1).optional(),
  hora_entrega: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  detalle_final: z.string().optional().nullable(),
  entregado: z.boolean().optional(),
  empresa: z.string().optional(),
  fecha_pedido: z.string().optional(), 
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
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

    const sql = neon(connectionString);
    const body = await request.json();
    const parsedData = UpdateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const dataToUpdate = parsedData.data;

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json(
        { error: "No se proporcionaron campos para actualizar." },
        { status: 400 }
      );
    }

    const updateEntries = Object.entries(dataToUpdate).filter(entry => entry[1] !== undefined);

    if (updateEntries.length === 0) {
      return NextResponse.json(
        { error: "No se proporcionaron campos para actualizar." },
        { status: 400 }
      );
    }

    // Construimos la consulta SET dinámicamente
    const setClauses = updateEntries
      .map(([key], index) => `${key} = $${index + 1}`)
      .join(", ");

    const params = updateEntries.map(entry => entry[1]);
    const query = `UPDATE pedidos SET ${setClauses} WHERE id = $${
      params.length + 1
    }`;
    params.push(id);
    await sql.query(query, params);

    return NextResponse.json(
      { message: "Pedido actualizado exitosamente" },
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

    const sql = neon(connectionString);

    const result = await sql`
      DELETE FROM pedidos
      WHERE id = ${id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Pedido no encontrado para eliminar" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "Pedido eliminado exitosamente" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error en API DELETE:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

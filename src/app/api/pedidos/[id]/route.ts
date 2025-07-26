// src/app/api/pedidos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  pesoExacto: z.number().nullable().optional(),
  entregado: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

     // --- INICIO DE DEPURACIÓN ---
    console.log("--- INICIANDO PETICIÓN PATCH ---");
    console.log("ID recibido:", id);
    // --- FIN DE DEPURACIÓN ---

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

    // --- INICIO DE DEPURACIÓN ---
    console.log("Cuerpo de la petición (parseado):", parsedData.data);
    // --- FIN DE DEPURACIÓN ---

    const { pesoExacto, entregado } = parsedData.data;

    // ⚙️ Definimos un tipo específico para los valores que podemos actualizar.
    type UpdateValue = string | number | boolean | null;
    const updates: Record<string, UpdateValue> = {};

    if (pesoExacto !== undefined) {
      updates.peso_exacto = pesoExacto;
    }
    if (entregado !== undefined) {
      updates.entregado = entregado;
    }

    // --- INICIO DE DEPURACIÓN ---
    console.log("Objeto 'updates' construido:", updates);
    // --- FIN DE DEPURACIÓN ---

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No se proporcionaron campos para actualizar." },
        { status: 400 }
      );
    }

    // Construimos la consulta SET dinámicamente
    const setClauses = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 1}`)
      .join(', ');

    // ⚙️ El array de parámetros ahora tiene un tipo estricto.
    const params: UpdateValue[] = Object.values(updates);
    
    const query = `UPDATE pedidos SET ${setClauses} WHERE id = $${params.length + 1}`;
    params.push(id);

    // --- INICIO DE DEPURACIÓN ---
    console.log("Consulta SQL a ejecutar:", query);
    console.log("Parámetros para la consulta:", params);
    // --- FIN DE DEPURACIÓN ---
    
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
// src/app/api/pedidos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateSchema = z.object({
  pesoExacto: z.number().nullable(),
});

interface RouteContext {
  params: { id: string };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = params;
  try {
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

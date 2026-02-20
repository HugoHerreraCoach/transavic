// src/app/api/productos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const ProductoSchema = z.object({
  nombre: z.string().min(1, { message: "El nombre es requerido." }),
  categoria: z.string().min(1, { message: "La categoría es requerida." }),
  unidad: z.string().min(1, { message: "La unidad es requerida." }),
});

export async function GET() {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }

    const sql = neon(connectionString);
    const productos = await sql`
      SELECT id, nombre, categoria, unidad, activo
      FROM productos
      WHERE activo = TRUE
      ORDER BY 
        CASE categoria 
          WHEN 'Pollo' THEN 1 
          WHEN 'Carnes' THEN 2 
          WHEN 'Huevos' THEN 3 
        END,
        nombre ASC
    `;

    return NextResponse.json({ data: productos });
  } catch (error) {
    console.error("Error al obtener productos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }

    const body = await request.json();
    const parsedData = ProductoSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { error: parsedData.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { nombre, categoria, unidad } = parsedData.data;
    const sql = neon(connectionString);

    const result = await sql`
      INSERT INTO productos (nombre, categoria, unidad)
      VALUES (${nombre}, ${categoria}, ${unidad})
      RETURNING id, nombre, categoria, unidad, activo
    `;

    return NextResponse.json(
      { data: result[0], message: "Producto creado exitosamente" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error al crear producto:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}

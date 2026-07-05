// src/app/api/proveedores/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ProveedorSchema = z.object({
  ruc: z.string().length(11, { message: "El RUC debe tener exactamente 11 dígitos" }).regex(/^\d+$/, { message: "El RUC solo debe contener números" }),
  razon_social: z.string().min(3, { message: "La razón social debe tener al menos 3 caracteres" }),
  direccion: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const proveedores = await sql`
      SELECT id, ruc, razon_social, direccion, telefono, created_at
      FROM proveedores
      ORDER BY razon_social ASC
    `;
    return NextResponse.json(proveedores);
  } catch (error: unknown) {
    console.error("Error al obtener proveedores:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = ProveedorSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { ruc, razon_social, direccion, telefono } = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // Validar si ya existe el RUC
    const existe = await sql`
      SELECT id FROM proveedores WHERE ruc = ${ruc}
    `;

    if (existe.length > 0) {
      return NextResponse.json({ error: "Ya existe un proveedor registrado con este RUC" }, { status: 409 });
    }

    const nuevo = await sql`
      INSERT INTO proveedores (ruc, razon_social, direccion, telefono)
      VALUES (${ruc}, ${razon_social}, ${direccion || null}, ${telefono || null})
      RETURNING id, ruc, razon_social, direccion, telefono
    `;

    return NextResponse.json(nuevo[0], { status: 201 });
  } catch (error: unknown) {
    console.error("Error al crear proveedor:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

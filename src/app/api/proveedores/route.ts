// src/app/api/proveedores/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Antonio (7 jul 2026): solo nombre (razon_social) y teléfono obligatorios.
// El RUC es OPCIONAL (proveedores secundarios informales); si viene, 11 dígitos.
const ProveedorSchema = z.object({
  ruc: z
    .string()
    .regex(/^\d{11}$/, { message: "El RUC debe tener exactamente 11 dígitos" })
    .optional()
    .nullable()
    .or(z.literal("")),
  razon_social: z.string().min(3, { message: "El nombre debe tener al menos 3 caracteres" }),
  telefono: z.string().min(6, { message: "El teléfono es obligatorio" }),
  direccion: z.string().optional().nullable(),
  tipo: z.enum(["principal", "secundario"]).default("principal"),
  plazo_pago_dias: z.number().int().min(0).max(365).default(30),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const proveedores = await sql`
      SELECT id, ruc, razon_social, direccion, telefono, tipo, plazo_pago_dias, COALESCE(activo, TRUE) AS activo, created_at
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

    const { razon_social, direccion, telefono, tipo, plazo_pago_dias } = result.data;
    // RUC vacío o ausente → NULL (proveedor informal sin RUC).
    const ruc = result.data.ruc && result.data.ruc.trim() !== "" ? result.data.ruc : null;
    const sql = neon(process.env.DATABASE_URL!);

    // El anti-duplicado por RUC solo aplica cuando SÍ hay RUC.
    if (ruc) {
      const existe = await sql`SELECT id FROM proveedores WHERE ruc = ${ruc}`;
      if (existe.length > 0) {
        return NextResponse.json({ error: "Ya existe un proveedor registrado con este RUC" }, { status: 409 });
      }
    }

    const nuevo = await sql`
      INSERT INTO proveedores (ruc, razon_social, direccion, telefono, tipo, plazo_pago_dias)
      VALUES (${ruc}, ${razon_social}, ${direccion || null}, ${telefono || null}, ${tipo}, ${plazo_pago_dias})
      RETURNING id, ruc, razon_social, direccion, telefono, tipo, plazo_pago_dias, activo
    `;

    return NextResponse.json(nuevo[0], { status: 201 });
  } catch (error: unknown) {
    console.error("Error al crear proveedor:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

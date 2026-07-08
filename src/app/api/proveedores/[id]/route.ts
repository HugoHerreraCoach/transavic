// src/app/api/proveedores/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

const ProveedorEditSchema = z.object({
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
});

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = params;

  try {
    const body = await req.json();
    const result = ProveedorEditSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { razon_social, direccion, telefono, tipo } = result.data;
    const ruc = result.data.ruc && result.data.ruc.trim() !== "" ? result.data.ruc : null;
    const sql = neon(process.env.DATABASE_URL!);

    // El anti-duplicado por RUC solo aplica cuando SÍ hay RUC.
    if (ruc) {
      const existe = await sql`
        SELECT id FROM proveedores WHERE ruc = ${ruc} AND id <> ${id}
      `;
      if (existe.length > 0) {
        return NextResponse.json({ error: "Ya existe otro proveedor registrado con este RUC" }, { status: 409 });
      }
    }

    const actualizado = await sql`
      UPDATE proveedores
      SET ruc = ${ruc},
          razon_social = ${razon_social},
          direccion = ${direccion || null},
          telefono = ${telefono || null},
          tipo = ${tipo},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, ruc, razon_social, direccion, telefono, tipo
    `;

    if (actualizado.length === 0) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }

    return NextResponse.json(actualizado[0]);
  } catch (error: unknown) {
    console.error("Error al actualizar proveedor:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores pueden eliminar proveedores" }, { status: 403 });
  }

  const { id } = params;

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Verificar si tiene compras asociadas
    const comprasAsociadas = await sql`
      SELECT id FROM compras WHERE proveedor_id = ${id} LIMIT 1
    `;

    if (comprasAsociadas.length > 0) {
      return NextResponse.json(
        { error: "No se puede eliminar el proveedor porque tiene compras registradas en el historial." },
        { status: 409 }
      );
    }

    // Verificar si tiene prestamos asociados
    const prestamosAsociados = await sql`
      SELECT id FROM prestamos_saldos WHERE proveedor_id = ${id} LIMIT 1
    `;
    if (prestamosAsociados.length > 0) {
       return NextResponse.json(
         { error: "No se puede eliminar el proveedor porque tiene préstamos de mercadería asociados." },
         { status: 409 }
       );
    }

    const eliminado = await sql`
      DELETE FROM proveedores WHERE id = ${id} RETURNING id
    `;

    if (eliminado.length === 0) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Proveedor eliminado correctamente" });
  } catch (error: unknown) {
    console.error("Error al eliminar proveedor:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

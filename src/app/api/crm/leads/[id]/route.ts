// src/app/api/crm/leads/[id]/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateLeadSchema = z.object({
  nombre: z.string().min(1).optional(),
  telefono: z.string().min(6).optional(),
  negocio: z.string().optional().nullable(),
  ciudad: z.string().optional().nullable(),
  estado: z.enum(["Nuevo", "Contactado", "Calificado", "Propuesta", "Cerrado", "Perdido"]).optional(),
  vendedor_id: z.string().uuid().optional().nullable(),
  chatbot_activo: z.boolean().optional(),
  notas: z.string().optional().nullable(),
  empresa: z.enum(["Transavic", "Avícola de Tony"]).optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { role } = session.user;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Obtener los datos del lead uniendo con users para obtener el nombre del vendedor
    const leads = await sql`
      SELECT l.*, u.name as vendedor_name
      FROM public.leads l
      LEFT JOIN public.users u ON l.vendedor_id = u.id
      WHERE l.id = ${id}
    `;

    if (leads.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }

    const lead = leads[0];

    // Si es asesor, verificar que el lead le pertenezca o esté libre
    if (role === "asesor" && lead.vendedor_id && lead.vendedor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes permiso para ver este prospecto" }, { status: 403 });
    }

    return NextResponse.json({ success: true, lead });
  } catch (error) {
    console.error("Error en GET /api/crm/leads/[id]:", error);
    return NextResponse.json({ error: "Error al obtener detalles del lead" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { role } = session.user;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const body = await req.json();
    const result = UpdateLeadSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // Verificar existencia del lead
    const existing = await sql`
      SELECT id, vendedor_id FROM public.leads WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }

    // Si es asesor, verificar que sea el dueño del lead o que sea libre (vendedor_id null)
    if (role === "asesor" && existing[0].vendedor_id && existing[0].vendedor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes permiso para editar este prospecto" }, { status: 403 });
    }

    // Construir consulta dinámica de actualización.
    // Lista blanca EXPLÍCITA de columnas: aunque el schema zod ya restringe las
    // claves, jamás interpolar nombres de campo que vengan del request en el SQL.
    const COLUMNAS_ACTUALIZABLES = new Set([
      "nombre", "telefono", "negocio", "ciudad", "estado",
      "vendedor_id", "chatbot_activo", "notas", "empresa", "tags",
    ]);
    const fieldsToUpdate: string[] = [];
    const values: unknown[] = [];
    let placeholderCounter = 1;

    Object.entries(data).forEach(([key, val]) => {
      if (!COLUMNAS_ACTUALIZABLES.has(key) || val === undefined) return;
      fieldsToUpdate.push(`${key} = $${placeholderCounter}`);
      values.push(val);
      placeholderCounter++;
    });

    if (fieldsToUpdate.length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    // Añadir updated_at y el ID del lead al final
    fieldsToUpdate.push(`updated_at = NOW()`);
    values.push(id);
    const idPlaceholder = placeholderCounter;

    const queryText = `
      UPDATE public.leads
      SET ${fieldsToUpdate.join(", ")}
      WHERE id = $${idPlaceholder}
      RETURNING *
    `;

    const updateResult = await sql.query(queryText, values);

    return NextResponse.json({ success: true, lead: updateResult[0] });
  } catch (error) {
    console.error("Error en PATCH /api/crm/leads/[id]:", error);
    return NextResponse.json({ error: "Error al actualizar lead" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Solo el administrador puede eliminar prospectos
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Permiso denegado. Solo administradores pueden eliminar leads." }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      DELETE FROM public.leads WHERE id = ${id}
    `;

    return NextResponse.json({ success: true, message: "Prospecto eliminado correctamente." });
  } catch (error) {
    console.error("Error en DELETE /api/crm/leads/[id]:", error);
    return NextResponse.json({ error: "Error al eliminar lead" }, { status: 500 });
  }
}

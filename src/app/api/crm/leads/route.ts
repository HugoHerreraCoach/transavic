// src/app/api/crm/leads/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateLeadSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  telefono: z.string().min(6, "El teléfono debe tener al menos 6 caracteres"),
  negocio: z.string().optional().nullable(),
  ciudad: z.string().optional().nullable(),
  origen: z.string().default("manual"),
  empresa: z.enum(["Transavic", "Avícola de Tony"]).default("Transavic"),
  estado: z.enum(["Nuevo", "Contactado", "Calificado", "Propuesta", "Cerrado", "Perdido"]).default("Nuevo"),
  vendedor_id: z.string().uuid().optional().nullable(),
  notas: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { role, id: userId } = session.user;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Query leads joining with users to get vendor name
    // Admin sees everything. Asesor sees their own leads OR unassigned leads.
    let leads;
    if (role === "admin") {
      leads = await sql`
        SELECT l.*, u.name as vendedor_name
        FROM public.leads l
        LEFT JOIN public.users u ON l.vendedor_id = u.id
        ORDER BY l.updated_at DESC
      `;
    } else {
      leads = await sql`
        SELECT l.*, u.name as vendedor_name
        FROM public.leads l
        LEFT JOIN public.users u ON l.vendedor_id = u.id
        WHERE l.vendedor_id = ${userId} OR l.vendedor_id IS NULL
        ORDER BY l.updated_at DESC
      `;
    }

    return NextResponse.json({ success: true, leads });
  } catch (error) {
    console.error("Error en GET /api/crm/leads:", error);
    return NextResponse.json({ error: "Error al listar leads" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { role } = session.user;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const body = await req.json();
    const result = CreateLeadSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = result.data;
    // Limpiar número de teléfono (dejar solo dígitos)
    const limpioTelefono = data.telefono.replace(/\D/g, "");

    const sql = neon(process.env.DATABASE_URL!);

    // Verificar si ya existe un lead con ese teléfono
    const existing = await sql`
      SELECT id FROM public.leads WHERE telefono = ${limpioTelefono}
    `;

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Ya existe un prospecto registrado con este número de teléfono." },
        { status: 409 }
      );
    }

    const insertResult = await sql`
      INSERT INTO public.leads (
        nombre, telefono, negocio, ciudad, origen, empresa, estado, vendedor_id, notas, chatbot_activo
      )
      VALUES (
        ${data.nombre},
        ${limpioTelefono},
        ${data.negocio || null},
        ${data.ciudad || null},
        ${data.origen},
        ${data.empresa},
        ${data.estado},
        ${data.vendedor_id || null},
        ${data.notas || null},
        FALSE -- Los leads manuales nacen con chatbot inactivo para que la asesora responda
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, lead: insertResult[0] });
  } catch (error) {
    console.error("Error en POST /api/crm/leads:", error);
    return NextResponse.json({ error: "Error al crear lead" }, { status: 500 });
  }
}

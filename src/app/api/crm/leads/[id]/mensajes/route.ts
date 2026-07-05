// src/app/api/crm/leads/[id]/mensajes/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateMessageSchema = z.object({
  body: z.string().min(1, "El mensaje no puede estar vacío"),
  type: z.string().default("text"),
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

    // Verificar si el lead existe y el asesor tiene acceso
    const lead = await sql`
      SELECT id, vendedor_id FROM public.leads WHERE id = ${id}
    `;

    if (lead.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }

    if (role === "asesor" && lead[0].vendedor_id && lead[0].vendedor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes permiso para ver esta conversación" }, { status: 403 });
    }

    const mensajes = await sql`
      SELECT *
      FROM public.lead_mensajes
      WHERE lead_id = ${id}
      ORDER BY created_at ASC
    `;

    return NextResponse.json({ success: true, mensajes });
  } catch (error) {
    console.error("Error en GET /api/crm/leads/[id]/mensajes:", error);
    return NextResponse.json({ error: "Error al cargar mensajes" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { role, name: userName } = session.user;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const body = await req.json();
    const result = CreateMessageSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // Verificar existencia del lead
    const lead = await sql`
      SELECT id, telefono, chatbot_activo FROM public.leads WHERE id = ${id}
    `;

    if (lead.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }

    // Insertar el mensaje enviado por la asesora
    const insertResult = await sql`
      INSERT INTO public.lead_mensajes (
        lead_id, sender, body, type
      )
      VALUES (
        ${id},
        ${userName || 'asesora'},
        ${data.body},
        ${data.type}
      )
      RETURNING *
    `;

    // Si la asesora responde manualmente, desactivamos el chatbot automáticamente para que
    // la IA no interrumpa la conversación humana (flujo de Handoff manual).
    if (lead[0].chatbot_activo) {
      await sql`
        UPDATE public.leads
        SET chatbot_activo = FALSE, updated_at = NOW()
        WHERE id = ${id}
      `;
    }

    // MOCK: Aquí se integraría el envío de WhatsApp vía Meta Cloud API.
    // fetch('https://graph.facebook.com/v21.0/.../messages', { ... })
    console.log(`[Meta Cloud API Mock] Enviando WhatsApp a ${lead[0].telefono}: "${data.body}"`);

    return NextResponse.json({ success: true, mensaje: insertResult[0] });
  } catch (error) {
    console.error("Error en POST /api/crm/leads/[id]/mensajes:", error);
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 });
  }
}

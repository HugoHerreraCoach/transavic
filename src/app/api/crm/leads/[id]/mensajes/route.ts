// src/app/api/crm/leads/[id]/mensajes/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isWhatsAppConfigured, normalizarEmpresa } from "@/lib/whatsapp/config";
import {
  enviarTexto,
  enviarMedia,
  enviarPlantilla,
  type TipoMediaWhatsApp,
} from "@/lib/whatsapp/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // subida de media a Meta puede pasar los ~15s default

const CreateMessageSchema = z.object({
  body: z.string().min(1, "El mensaje no puede estar vacío"),
  type: z.string().default("text"),
  // Solo para type === "template":
  templateName: z.string().optional(),
  language: z.string().optional(),
  variables: z.array(z.string()).optional(),
});

const VENTANA_24H_MS = 24 * 60 * 60 * 1000;
const TIPOS_MEDIA = new Set(["image", "audio", "video", "document"]);

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

    // Traer datos del lead necesarios para el envío y el scoping.
    const leadRows = await sql`
      SELECT id, telefono, empresa, chatbot_activo, last_inbound_at, vendedor_id
      FROM public.leads WHERE id = ${id}
    `;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }
    const lead = leadRows[0];

    // Scoping: una asesora solo escribe en sus leads (o en los sin asignar).
    if (role === "asesor" && lead.vendedor_id && lead.vendedor_id !== session.user.id) {
      return NextResponse.json({ error: "No tienes permiso para esta conversación" }, { status: 403 });
    }

    const empresa = normalizarEmpresa(lead.empresa);
    const configurado = isWhatsAppConfigured(empresa);
    const esPlantilla = data.type === "template";
    const esMedia = TIPOS_MEDIA.has(data.type);

    // Ventana de servicio de 24h: fuera de ella SOLO se puede enviar una plantilla.
    // (Si WhatsApp no está configurado aún —modo mock—, no bloqueamos para no frenar
    // las pruebas del CRM.)
    if (configurado && !esPlantilla) {
      const lastInbound = lead.last_inbound_at ? new Date(lead.last_inbound_at).getTime() : 0;
      const dentroVentana = lastInbound > 0 && Date.now() - lastInbound < VENTANA_24H_MS;
      if (!dentroVentana) {
        return NextResponse.json(
          {
            error:
              "Pasaron más de 24 horas desde el último mensaje del cliente. Para reabrir la conversación tienes que enviar una plantilla aprobada.",
            fueraDeVentana: true,
          },
          { status: 409 }
        );
      }
    }

    // Envío real a WhatsApp (o mock si la marca no está configurada).
    let whatsappMessageId: string | null = null;
    let estado: string | null = null;
    let errorMsg: string | null = null;

    if (configurado) {
      const envio = esPlantilla
        ? await enviarPlantilla(empresa, lead.telefono, {
            name: data.templateName || data.body,
            language: data.language || "es",
            variables: data.variables,
          })
        : esMedia
        ? await enviarMedia(empresa, lead.telefono, data.body, data.type as TipoMediaWhatsApp)
        : await enviarTexto(empresa, lead.telefono, data.body);

      if (envio.fueraDeVentana) {
        return NextResponse.json(
          {
            error:
              "El mensaje no se pudo entregar: la ventana de 24 horas está cerrada. Envía una plantilla aprobada.",
            fueraDeVentana: true,
          },
          { status: 409 }
        );
      }

      whatsappMessageId = envio.whatsappMessageId ?? null;
      estado = envio.ok ? "enviado" : "fallido";
      errorMsg = envio.ok ? null : envio.error ?? null;
    } else {
      console.log(`[WhatsApp mock] (${empresa}) → ${lead.telefono} [${data.type}]: "${data.body.slice(0, 60)}"`);
    }

    // Registrar el mensaje enviado por la asesora (siempre se persiste, aunque el
    // envío a Meta haya fallado, para que quede el rastro con su estado).
    const insertResult = await sql`
      INSERT INTO public.lead_mensajes (
        lead_id, sender, body, type, whatsapp_message_id, estado, error_msg
      )
      VALUES (
        ${id},
        ${userName || "asesora"},
        ${data.body},
        ${data.type},
        ${whatsappMessageId},
        ${estado},
        ${errorMsg}
      )
      RETURNING *
    `;

    // Si la asesora responde manualmente, desactivamos el chatbot automáticamente para que
    // la IA no interrumpa la conversación humana (flujo de Handoff manual).
    if (lead.chatbot_activo) {
      await sql`
        UPDATE public.leads
        SET chatbot_activo = FALSE, updated_at = NOW()
        WHERE id = ${id}
      `;
    }

    return NextResponse.json({
      success: true,
      mensaje: insertResult[0],
      entregado: estado !== "fallido",
      warning: estado === "fallido" ? errorMsg : undefined,
    });
  } catch (error) {
    console.error("Error en POST /api/crm/leads/[id]/mensajes:", error);
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 });
  }
}

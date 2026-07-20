// src/app/api/crm/leads/[id]/pasar/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { escalateLead } from "@/lib/chatbot/bot-orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: userId } = session.user;
    const sql = neon(process.env.DATABASE_URL!);

    // Buscar el lead
    const leadRows = await sql`
      SELECT id, nombre, estado_asignacion, candidatos_nivel, candidato_actual, golden_ticket_phase
      FROM public.leads
      WHERE id = ${leadId}
    `;

    if (leadRows.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }

    const lead = leadRows[0];

    // Verificar si sigue en cola
    if (lead.estado_asignacion !== "en_cola") {
      return NextResponse.json({ error: "El lead ya no está en cola de reparto." }, { status: 400 });
    }

    // Solo el candidato actual puede "pasar" (saltar su turno de 15s)
    if (lead.candidato_actual !== userId) {
      return NextResponse.json({ error: "No eres el candidato en turno de este prospecto." }, { status: 403 });
    }

    // Escalar inmediatamente al siguiente nivel
    console.log(`⏩ Asesora ${session.user.name} pasó el lead ${leadId}. Escalando fase...`);
    await escalateLead(sql, leadId, lead);

    return NextResponse.json({ success: true, message: "Turno omitido y escalado correctamente." });
  } catch (error) {
    console.error("Error en POST /api/crm/leads/[id]/pasar:", error);
    return NextResponse.json({ error: "Error interno al omitir lead" }, { status: 500 });
  }
}

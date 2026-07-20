// src/app/api/crm/leads/cola/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { checkAndEscalateLeads } from "@/lib/chatbot/bot-orchestrator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: userId, role } = session.user;
    if (role !== "asesor" && role !== "admin") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Escalar proactivamente cualquier lead expirado en la cola
    await checkAndEscalateLeads(sql);

    // Si es asesor, busca leads donde esté en cola y sea candidato actual o elegible
    // Si es admin, ve todos los leads en cola
    let leads;
    if (role === "admin") {
      leads = await sql`
        SELECT id, nombre, telefono, estado_asignacion, candidatos_nivel, candidato_actual, inicio_turno, timeout_nivel, golden_ticket_phase
        FROM public.leads
        WHERE estado_asignacion = 'en_cola'
        ORDER BY inicio_turno ASC
      `;
    } else {
      leads = await sql`
        SELECT id, nombre, telefono, estado_asignacion, candidatos_nivel, candidato_actual, inicio_turno, timeout_nivel, golden_ticket_phase
        FROM public.leads
        WHERE estado_asignacion = 'en_cola'
          AND (
            candidato_actual = ${userId}::uuid
            OR ${userId}::uuid = ANY(candidatos_nivel)
          )
        ORDER BY inicio_turno ASC
      `;
    }

    return NextResponse.json({ success: true, leads });
  } catch (error) {
    console.error("Error en GET /api/crm/leads/cola:", error);
    return NextResponse.json({ error: "Error al obtener leads en cola" }, { status: 500 });
  }
}

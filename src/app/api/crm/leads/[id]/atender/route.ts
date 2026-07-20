// src/app/api/crm/leads/[id]/atender/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

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

    const { id: userId, role } = session.user;
    if (role !== "asesor" && role !== "admin") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Buscar el lead
    const leadRows = await sql`
      SELECT id, nombre, estado_asignacion, candidatos_nivel, candidato_actual
      FROM public.leads
      WHERE id = ${leadId}
    `;

    if (leadRows.length === 0) {
      return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    }

    const lead = leadRows[0];

    // Verificar si ya fue tomado
    if (lead.estado_asignacion !== "en_cola") {
      return NextResponse.json({
        success: false,
        reason: "already_claimed",
        message: "Este lead ya fue tomado por otra asesora."
      });
    }

    // Verificar si el usuario actual es elegible para tomarlo
    const esCandidatoActual = lead.candidato_actual === userId;
    const esCandidatoNivel = lead.candidatos_nivel && lead.candidatos_nivel.includes(userId);
    const esAdmin = role === "admin";

    if (!esCandidatoActual && !esCandidatoNivel && !esAdmin) {
      return NextResponse.json({
        success: false,
        reason: "not_eligible",
        message: "No eres elegible para reclamar este prospecto en este momento."
      });
    }

    // Reclamar el lead de forma atómica
    await sql`
      UPDATE public.leads
      SET vendedor_id = ${userId},
          estado_asignacion = 'asignado',
          candidato_actual = NULL,
          candidatos_nivel = '{}',
          inicio_turno = NULL,
          golden_ticket_phase = NULL,
          updated_at = NOW()
      WHERE id = ${leadId}
    `;

    // Incrementar contadores si es asesor
    if (role === "asesor") {
      await sql`
        UPDATE public.users
        SET leads_recibidos_hoy = COALESCE(leads_recibidos_hoy, 0) + 1
        WHERE id = ${userId}
      `;
    }

    console.log(`🎫 Lead ${leadId} reclamado exitosamente por ${session.user.name}`);
    return NextResponse.json({ success: true, message: "Prospecto asignado correctamente." });
  } catch (error) {
    console.error("Error en POST /api/crm/leads/[id]/atender:", error);
    return NextResponse.json({ error: "Error interno al atender lead" }, { status: 500 });
  }
}

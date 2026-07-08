// src/app/api/cobranzas-planta/abonos/[id]/anular/route.ts
// POST — anulación SOFT de un abono de planta (nunca DELETE): errores de dedo en
// campo + auditoría. La foto del comprobante NO se borra. Tras anular, se recalcula
// el estado de su cobranza (puede volver de Pagada a Parcial/Pendiente). admin + produccion.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recalcularEstadoCobranza } from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

const AnularSchema = z.object({
  motivo: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = AnularSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    const rows = (await sql`
      SELECT id, cobranza_id, anulado FROM abonos_planta WHERE id = ${id}
    `) as Array<{ id: string; cobranza_id: string; anulado: boolean }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Abono no encontrado" }, { status: 404 });
    }
    if (rows[0].anulado) {
      return NextResponse.json(
        { error: "Este abono ya está anulado" },
        { status: 409 }
      );
    }

    // Anulación soft: la foto (comprobante_data/mime) se CONSERVA para auditoría.
    await sql`
      UPDATE abonos_planta
      SET anulado = TRUE,
          anulado_at = NOW(),
          anulado_por = ${session.user.id},
          anulacion_motivo = ${parsed.data.motivo}
      WHERE id = ${id} AND NOT anulado
    `;

    // Al retirar el abono, la cobranza puede volver de Pagada a Parcial/Pendiente.
    await recalcularEstadoCobranza(sql, rows[0].cobranza_id);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error al anular abono de planta:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

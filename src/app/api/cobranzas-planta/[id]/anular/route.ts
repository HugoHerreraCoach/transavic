// src/app/api/cobranzas-planta/[id]/anular/route.ts
// POST — anulación SOFT de una cobranza de planta (nunca DELETE): auditoría.
// Sus abonos NO se tocan (auditoría); la cobranza deja de contar en el saldo del
// cliente porque `listaClientesPlantaConSaldo` excluye anuladas. admin + produccion.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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
      SELECT id, anulada FROM cobranzas_planta WHERE id = ${id}
    `) as Array<{ id: string; anulada: boolean }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Cobranza no encontrada" }, { status: 404 });
    }
    if (rows[0].anulada) {
      return NextResponse.json(
        { error: "Esta cobranza ya está anulada" },
        { status: 409 }
      );
    }

    await sql`
      UPDATE cobranzas_planta
      SET anulada = TRUE,
          anulada_at = NOW(),
          anulada_por = ${session.user.id},
          anulacion_motivo = ${parsed.data.motivo},
          estado = 'Anulada',
          updated_at = NOW()
      WHERE id = ${id} AND NOT anulada
    `;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error al anular cobranza de planta:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

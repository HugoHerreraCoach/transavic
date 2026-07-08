// src/app/api/avicola/ventas/[id]/anular/route.ts
// POST: anula (soft) una venta del módulo Clientes Avícola (admin-only).
// Nunca DELETE: errores de dedo en campo + auditoría. Toda query de saldo ya
// filtra NOT anulada (src/lib/avicola/saldos.ts), así que anular corrige el
// estado de cuenta al instante sin tocar nada más.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Mismo criterio que razon_fallo del proyecto: mínimo 5 caracteres.
const AnularSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "El motivo debe tener al menos 5 caracteres."),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = AnularSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const ventas = (await sql`
      SELECT anulada FROM ventas_avicola WHERE id = ${id}
    `) as Array<{ anulada: boolean }>;
    if (ventas.length === 0) {
      return NextResponse.json(
        { error: "Venta no encontrada." },
        { status: 404 }
      );
    }
    if (ventas[0].anulada) {
      return NextResponse.json(
        { error: "La venta ya está anulada." },
        { status: 409 }
      );
    }

    await sql`
      UPDATE ventas_avicola
      SET anulada = TRUE,
          anulada_at = NOW(),
          anulada_por = ${session.user.id},
          anulacion_motivo = ${parsed.data.motivo}
      WHERE id = ${id}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error al anular la venta avícola:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

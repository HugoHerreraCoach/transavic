// src/app/api/autorizaciones-precio/[id]/route.ts
// PATCH — solo admin: aprueba o rechaza una solicitud de autorización de precio.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { crearNotificacion } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  estado: z.enum(["aprobada", "rechazada"]),
  razon_rechazo: z.string().trim().max(500).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo el admin puede resolver autorizaciones" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.estado === "rechazada" && !parsed.data.razon_rechazo?.trim()) {
      return NextResponse.json(
        { error: "Debes indicar el motivo del rechazo" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    const rows = (await sql`
      SELECT id, asesora_id, asesora_nombre, estado, tipo, empresa
      FROM autorizaciones_precio
      WHERE id = ${id}
    `) as Array<{
      id: string;
      asesora_id: string;
      asesora_nombre: string;
      estado: string;
      tipo: string;
      empresa: string;
    }>;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Autorización no encontrada" }, { status: 404 });
    }

    const auth_ = rows[0];
    if (auth_.estado !== "pendiente") {
      return NextResponse.json(
        { error: "Esta solicitud ya fue resuelta" },
        { status: 409 }
      );
    }

    await sql`
      UPDATE autorizaciones_precio
      SET
        estado = ${parsed.data.estado},
        razon_rechazo = ${parsed.data.razon_rechazo ?? null},
        aprobada_por = ${session.user.name?.trim() ?? "Admin"},
        resuelta_at = NOW()
      WHERE id = ${id}
    `;

    const tipoLabel: Record<string, string> = { "01": "Factura", "03": "Boleta" };
    const empresaLabel: Record<string, string> = {
      transavic: "Transavic",
      avicola: "Avícola de Tony",
    };

    // Notificar a la asesora con el resultado
    if (parsed.data.estado === "aprobada") {
      await crearNotificacion({
        userId: auth_.asesora_id,
        tipo: "autorizacion_resuelta",
        titulo: "Autorización de precio aprobada",
        mensaje: `El admin aprobó tu solicitud de precio para la ${tipoLabel[auth_.tipo] ?? auth_.tipo} (${empresaLabel[auth_.empresa] ?? auth_.empresa}). Puedes emitir el comprobante.`,
        link: `/dashboard/comprobantes/nuevo?autorizacion_id=${id}`,
      });
    } else {
      await crearNotificacion({
        userId: auth_.asesora_id,
        tipo: "autorizacion_resuelta",
        titulo: "Solicitud de precio rechazada",
        mensaje: `El admin rechazó tu solicitud de precio. Motivo: ${parsed.data.razon_rechazo}`,
        link: `/dashboard/autorizaciones`,
      });
    }

    return NextResponse.json({ ok: true, estado: parsed.data.estado });
  } catch (error) {
    console.error("Error PATCH /api/autorizaciones-precio/[id]:", error);
    return NextResponse.json({ error: "Error al resolver autorización" }, { status: 500 });
  }
}

// src/app/api/guias/[id]/comprobante/route.ts
// PATCH { comprobanteId: string|null } — vincula (o desvincula) una guía de remisión a un comprobante (factura/boleta/NC).
//
// Permisos: admin siempre; asesores solo si pueden ver la guía (es de su pedido o la emitieron ellos).

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";

export const dynamic = "force-dynamic";

const Schema = z.object({
  // null = desvincular (deja la guía sin comprobante).
  comprobanteId: z.string().uuid().nullable(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const parsed = Schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const { comprobanteId } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);

    // 1. Obtener la guía y los datos del pedido asociado para control de acceso
    const guias = await sql`
      SELECT g.empresa, g.emitido_por, p.asesor_id AS pedido_asesor_id
      FROM comprobantes_guias g
      LEFT JOIN pedidos p ON g.pedido_id = p.id
      WHERE g.id = ${id}::uuid
      LIMIT 1
    `;
    if (guias.length === 0) {
      return NextResponse.json({ error: "Guía de remisión no encontrada." }, { status: 404 });
    }
    const guia = guias[0];

    // Permisos: admin siempre; asesora solo si puede ver la guía.
    const puedeVer = asesoraPuedeVerComprobante(
      session.user.role,
      session.user.id,
      session.user.name,
      { pedidoAsesorId: guia.pedido_asesor_id, emitidoPor: guia.emitido_por }
    );
    if (!puedeVer) {
      return NextResponse.json(
        { error: "No tienes permiso para modificar esta guía." },
        { status: 403 }
      );
    }

    // 2. Si se vincula a un comprobante, validar que exista y que coincida la empresa
    if (comprobanteId) {
      const comps = await sql`
        SELECT id, empresa FROM comprobantes WHERE id = ${comprobanteId}::uuid LIMIT 1
      `;
      if (comps.length === 0) {
        return NextResponse.json({ error: "Comprobante no encontrado." }, { status: 404 });
      }
      const comp = comps[0];

      if (comp.empresa !== guia.empresa) {
        return NextResponse.json(
          { error: "La guía y el comprobante pertenecen a empresas distintas." },
          { status: 400 }
        );
      }
    }

    // 3. Vincular / Desvincular en base de datos
    await sql`
      UPDATE comprobantes_guias
      SET comprobante_id = ${comprobanteId}
      WHERE id = ${id}::uuid
    `;

    return NextResponse.json({ ok: true, comprobanteId });
  } catch (error) {
    console.error("Error PATCH /api/guias/[id]/comprobante:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: `Error al vincular: ${msg}` }, { status: 500 });
  }
}

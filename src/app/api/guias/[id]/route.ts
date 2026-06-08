// src/app/api/guias/[id]/route.ts
// GET — obtener detalles de una Guía de Remisión específica.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    
    // Cargar la guía con su asesor_id del pedido para validar permisos
    const rows = await sql`
      SELECT c.*, p.asesor_id AS pedido_asesor_id, p.cliente AS pedido_cliente
      FROM comprobantes_guias c
      LEFT JOIN pedidos p ON c.pedido_id = p.id
      WHERE c.id = ${id}::uuid LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    const g = rows[0];

    // Scoping por rol
    if (!asesoraPuedeVerComprobante(session.user.role, session.user.id, session.user.name, {
      pedidoAsesorId: g.pedido_asesor_id,
      emitidoPor: g.emitido_por,
    })) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    return NextResponse.json(g);
  } catch (error) {
    console.error("Error en GET /api/guias/[id]:", error);
    return NextResponse.json({ error: "Error al obtener la guía" }, { status: 500 });
  }
}

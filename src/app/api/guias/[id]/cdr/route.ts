// src/app/api/guias/[id]/cdr/route.ts
// Descarga el CDR (Constancia de Recepción) que SUNAT devuelve al ACEPTAR una guía.

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

    const role = session.user.role;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    
    const rows = await sql`
      SELECT c.serie_numero, c.cdr_base64, c.ruc_emisor,
             c.emitido_por, p.asesor_id AS pedido_asesor_id
      FROM comprobantes_guias c
      LEFT JOIN pedidos p ON p.id = c.pedido_id
      WHERE c.id = ${id}::uuid LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    const g = rows[0];

    // Scoping por rol
    if (!asesoraPuedeVerComprobante(role, session.user.id, session.user.name, {
      pedidoAsesorId: g.pedido_asesor_id,
      emitidoPor: g.emitido_por,
    })) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    if (!g.cdr_base64) {
      return NextResponse.json(
        {
          error:
            "Esta guía de remisión no tiene CDR: SUNAT lo entrega solo cuando la guía fue procesada y ACEPTADA. Revisa el estado de la guía.",
        },
        { status: 404 }
      );
    }

    const cdrBuffer = Buffer.from(g.cdr_base64, "base64");
    if (cdrBuffer.length === 0) {
      return NextResponse.json(
        { error: "El CDR almacenado está vacío o corrupto." },
        { status: 422 }
      );
    }

    const filename = `R-${g.ruc_emisor}-09-${g.serie_numero}.zip`;

    return new NextResponse(new Uint8Array(cdrBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(cdrBuffer.length),
      },
    });
  } catch (error) {
    console.error("Error en GET /api/guias/[id]/cdr:", error);
    return NextResponse.json({ error: "Error al descargar el CDR" }, { status: 500 });
  }
}

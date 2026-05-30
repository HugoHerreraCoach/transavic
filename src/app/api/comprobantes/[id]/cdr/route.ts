// src/app/api/comprobantes/[id]/cdr/route.ts
// Descarga el CDR (Constancia de Recepción) que SUNAT devuelve al ACEPTAR un
// comprobante. El CDR es un ZIP (contiene R-<nombre>.xml). Se guarda en
// `comprobantes.cdr_base64`. Si no hay CDR (no aceptado / sin envío), 404.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { descomprimirCDR } from "@/lib/sunat/soap-client";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
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
  const userId = session.user.id;

  const sql = neon(process.env.DATABASE_URL!);
  // Privacy boundary: admin ve todo, asesor SOLO los CDR de SUS comprobantes.
  const rows = (role === "admin"
    ? ((await sql`
        SELECT c.serie_numero, c.cdr_base64, c.ruc_emisor, c.tipo
        FROM comprobantes c
        WHERE c.id = ${id}::uuid LIMIT 1
      `) as unknown)
    : ((await sql`
        SELECT c.serie_numero, c.cdr_base64, c.ruc_emisor, c.tipo
        FROM comprobantes c
        INNER JOIN pedidos p ON p.id = c.pedido_id
        WHERE c.id = ${id}::uuid AND p.asesor_id = ${userId}::uuid LIMIT 1
      `) as unknown)) as Array<{
    serie_numero: string;
    cdr_base64: string | null;
    ruc_emisor: string;
    tipo: string;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];
  if (!c.cdr_base64) {
    return NextResponse.json(
      {
        error:
          "Este comprobante no tiene CDR: SUNAT lo entrega solo cuando el comprobante fue ACEPTADO. Revisá el estado del comprobante.",
      },
      { status: 404 }
    );
  }

  // Servimos el XML del CDR (la constancia en sí), extraído del ZIP de SUNAT, para
  // que el usuario reciba UN solo archivo limpio. (El ZIP de SUNAT incluye una
  // carpeta "dummy/" vacía que confunde; el XML es lo legalmente relevante.)
  try {
    const cdrXml = await descomprimirCDR(c.cdr_base64);
    const xmlBuffer = Buffer.from(cdrXml, "utf-8");
    const filename = `R-${c.ruc_emisor}-${c.tipo}-${c.serie_numero}.xml`;
    return new NextResponse(new Uint8Array(xmlBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(xmlBuffer.length),
      },
    });
  } catch {
    // Fallback: si no se pudo extraer, servimos el ZIP original tal cual.
    const cdrBuffer = Buffer.from(c.cdr_base64, "base64");
    const filename = `R-${c.ruc_emisor}-${c.tipo}-${c.serie_numero}.zip`;
    return new NextResponse(new Uint8Array(cdrBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(cdrBuffer.length),
      },
    });
  }
}

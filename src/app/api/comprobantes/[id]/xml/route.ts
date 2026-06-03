// src/app/api/comprobantes/[id]/xml/route.ts
// Descarga el XML firmado del comprobante (lo que se envió a SUNAT).
// Si no se envió a SUNAT, devuelve 404.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

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
  const sql = neon(process.env.DATABASE_URL!);
  // Acceso (jun 2026): admin y asesoras descargan el XML de CUALQUIER comprobante
  // (transparencia total del equipo, igual que la lista). No se filtra por asesor.
  const rows = (await sql`
        SELECT c.serie_numero, c.xml_firmado_base64, c.ruc_emisor, c.tipo
        FROM comprobantes c
        WHERE c.id = ${id}::uuid LIMIT 1
      `) as Array<{
    serie_numero: string;
    xml_firmado_base64: string | null;
    ruc_emisor: string;
    tipo: string;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];
  if (!c.xml_firmado_base64) {
    return NextResponse.json(
      {
        error:
          "Este comprobante no tiene XML firmado (no se envió a SUNAT — modo testing sin certificado configurado)",
      },
      { status: 404 }
    );
  }

  const xmlBuffer = Buffer.from(c.xml_firmado_base64, "base64");
  const filename = `${c.ruc_emisor}-${c.tipo}-${c.serie_numero}.xml`;

  return new NextResponse(new Uint8Array(xmlBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(xmlBuffer.length),
    },
  });
}

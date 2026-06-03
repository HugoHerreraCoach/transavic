// src/app/api/comprobantes/[id]/cdr/route.ts
// Descarga el CDR (Constancia de Recepción) que SUNAT devuelve al ACEPTAR un
// comprobante. El CDR es un ZIP (contiene R-<nombre>.xml). Se guarda en
// `comprobantes.cdr_base64`. Si no hay CDR (no aceptado / sin envío), 404.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";

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
  // Scoping (Antonio jun 2026): admin ve todo; la asesora SOLO sus comprobantes.
  const rows = (await sql`
        SELECT c.serie_numero, c.cdr_base64, c.ruc_emisor, c.tipo,
               c.emitido_por, p.asesor_id AS pedido_asesor_id
        FROM comprobantes c
        LEFT JOIN pedidos p ON p.id = c.pedido_id
        WHERE c.id = ${id}::uuid LIMIT 1
      `) as Array<{
    serie_numero: string;
    cdr_base64: string | null;
    ruc_emisor: string;
    tipo: string;
    emitido_por: string | null;
    pedido_asesor_id: string | null;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];
  if (!asesoraPuedeVerComprobante(role, session.user.id, session.user.name, {
    pedidoAsesorId: c.pedido_asesor_id,
    emitidoPor: c.emitido_por,
  })) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  if (!c.cdr_base64) {
    return NextResponse.json(
      {
        error:
          "Este comprobante no tiene CDR: SUNAT lo entrega solo cuando el comprobante fue ACEPTADO. Revisa el estado del comprobante.",
      },
      { status: 404 }
    );
  }

  // Servimos el ZIP de la CDR TAL CUAL lo entrega SUNAT (la constancia oficial).
  // Antes intentábamos extraer solo el XML con un parser PKZip casero, pero con
  // los ZIP de SUNAT (formato "data descriptor") ese parser calculaba mal el
  // tamaño y devolvía un string VACÍO → el usuario descargaba 0 bytes. El ZIP
  // crudo siempre es válido, abre bien y contiene R-<ruc>-<tipo>-<serie>.xml con
  // el ResponseCode de aceptación. Es lo que un contador espera recibir.
  const cdrBuffer = Buffer.from(c.cdr_base64, "base64");
  if (cdrBuffer.length === 0) {
    return NextResponse.json(
      { error: "El CDR almacenado está vacío o corrupto." },
      { status: 422 }
    );
  }
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

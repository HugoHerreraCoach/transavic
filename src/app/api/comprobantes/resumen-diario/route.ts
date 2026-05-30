// src/app/api/comprobantes/resumen-diario/route.ts
// Envía a SUNAT el Resumen Diario de Boletas (RC-) del día indicado.
// Obligatorio según SUNAT: al día siguiente de la emisión.
//
// GET  /api/comprobantes/resumen-diario?fecha=YYYY-MM-DD&empresa=transavic
//   → consulta qué boletas hay pendientes de incluir en el resumen del día
// POST /api/comprobantes/resumen-diario { fecha: "YYYY-MM-DD", empresa: "transavic" }
//   → genera, firma y envía el resumen. Devuelve ticket SUNAT.
// POST /api/comprobantes/resumen-diario/ticket { ticket: "...", empresa: "..." }
//   → consulta estado del ticket (aceptado/rechazado).
//
// Solo admin (es operación administrativa).

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enviarResumenDiario } from "@/lib/sunat/resumen-diario";
import { type EmpresaId } from "@/lib/sunat/types";

export const dynamic = "force-dynamic";

const PostSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha YYYY-MM-DD requerida"),
  empresa: z.enum(["transavic", "avicola"]).default("transavic"),
  // forzar: ignora la idempotencia y emite un resumen complementario el mismo día.
  forzar: z.boolean().default(false),
});

/**
 * GET: lista las boletas del día que aún no están incluidas en un resumen.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const fecha = req.nextUrl.searchParams.get("fecha");
  const empresa = (req.nextUrl.searchParams.get("empresa") || "transavic") as EmpresaId;
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Falta ?fecha=YYYY-MM-DD" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const boletas = (await sql`
    SELECT id, serie, numero, serie_numero,
      cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
      monto_subtotal, monto_igv, monto_total, estado
    FROM comprobantes
    WHERE empresa = ${empresa}
      AND tipo = '03'
      AND DATE(created_at AT TIME ZONE 'America/Lima') = ${fecha}::date
      AND estado IN ('aceptado','observado','rechazado','pendiente')
    ORDER BY numero ASC
  `) as Array<Record<string, unknown>>;

  return NextResponse.json({ fecha, empresa, total: boletas.length, boletas });
}

/**
 * POST: genera, firma y envía el resumen diario a SUNAT. Devuelve ticket.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  let body;
  try {
    body = PostSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Datos inválidos", detalle: (err as Error).message },
      { status: 400 }
    );
  }

  // La idempotencia y todo el flujo (boletas → XML → firma → envío → registro)
  // vive en enviarResumenDiario (compartido con el cron).
  const r = await enviarResumenDiario({
    empresa: body.empresa,
    fecha: body.fecha,
    forzar: body.forzar,
  });

  if (!r.ok && r.error?.includes("Certificado")) {
    return NextResponse.json(
      { error: "Certificado SUNAT no configurado para esta empresa" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    exito: r.ok,
    skipped: r.skipped ?? false,
    ticket: r.ticket ?? null,
    mensaje: r.mensaje ?? r.error,
    correlativo: r.correlativo,
    boletasIncluidas: r.boletas,
    resumenId: r.resumenId,
    xmlFirmadoBase64: r.xmlFirmadoBase64,
  });
}

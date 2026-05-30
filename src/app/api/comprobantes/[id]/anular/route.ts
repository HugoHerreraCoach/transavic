// src/app/api/comprobantes/[id]/anular/route.ts
// Genera Comunicación de Baja (RA-) para anular un comprobante ya emitido y aceptado.
// SUNAT solo permite dar de baja una factura aceptada hasta 7 días después de emisión.
// Para boletas usar Resumen Diario con estadoItem=3.
//
// POST { motivo: "texto explicando por qué se anula" }
// Devuelve ticket SUNAT (consultar después).
//
// Solo admin.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSunatConfig,
  generarNombreBaja,
} from "@/lib/sunat/config-transavic";
import { generarXMLComunicacionBaja } from "@/lib/sunat/xml-builder";
import { firmarXML } from "@/lib/sunat/xml-signer";
import { enviarResumen } from "@/lib/sunat/soap-client";
import { type EmpresaId, TipoComprobante } from "@/lib/sunat/types";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  motivo: z
    .string()
    .min(10, "Motivo debe tener al menos 10 caracteres")
    .max(200, "Motivo máximo 200 caracteres"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin puede anular" }, { status: 403 });

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Datos inválidos", detalle: (err as Error).message },
      { status: 400 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT empresa, tipo, serie, numero, estado, ruc_emisor, created_at
    FROM comprobantes WHERE id = ${id}::uuid LIMIT 1
  `) as Array<{
    empresa: string;
    tipo: string;
    serie: string;
    numero: number;
    estado: string;
    ruc_emisor: string;
    created_at: string | Date;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];

  // Solo se anulan facturas/notas. Boletas se anulan via Resumen Diario.
  if (c.tipo === "03") {
    return NextResponse.json(
      {
        error:
          "Las boletas no se anulan con Comunicación de Baja — usar Resumen Diario con estadoItem=3",
      },
      { status: 400 }
    );
  }

  if (c.estado !== "aceptado" && c.estado !== "observado") {
    return NextResponse.json(
      {
        error: `Solo se anulan comprobantes aceptados u observados. Estado actual: ${c.estado}`,
      },
      { status: 409 }
    );
  }

  // SUNAT permite anular hasta 7 días después
  const fechaEmision =
    typeof c.created_at === "string" ? new Date(c.created_at) : c.created_at;
  const diasDesdeEmision =
    Math.floor((Date.now() - fechaEmision.getTime()) / (1000 * 60 * 60 * 24));
  if (diasDesdeEmision > 7) {
    return NextResponse.json(
      {
        error: `Han pasado ${diasDesdeEmision} días desde la emisión. SUNAT solo permite anular dentro de los 7 días. Considerar emitir una Nota de Crédito.`,
      },
      { status: 409 }
    );
  }

  const empresaId = c.empresa as EmpresaId;
  const config = getSunatConfig(empresaId);
  if (!config.certificateBase64) {
    return NextResponse.json(
      { error: "Certificado SUNAT no configurado" },
      { status: 503 }
    );
  }

  // Correlativo de la comunicación de baja (1 por día por RUC)
  const hoyLima = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
  const yyyymmdd = hoyLima.replace(/-/g, "");

  const correlativoResult = (await sql`
    INSERT INTO comprobantes_contador (ruc, serie, ultimo_numero)
    VALUES (${config.ruc}, ${`RA-${yyyymmdd}`}, 1)
    ON CONFLICT (ruc, serie) DO UPDATE
      SET ultimo_numero = comprobantes_contador.ultimo_numero + 1
    RETURNING ultimo_numero
  `) as Array<{ ultimo_numero: number }>;
  const correlativoBaja = correlativoResult[0].ultimo_numero;

  try {
    const xmlSinFirma = generarXMLComunicacionBaja(
      {
        fechaEmision: hoyLima,
        fechaReferencia:
          typeof c.created_at === "string"
            ? c.created_at.slice(0, 10)
            : c.created_at.toISOString().slice(0, 10),
        correlativo: correlativoBaja,
        items: [
          {
            tipoComprobante: c.tipo as TipoComprobante,
            serie: c.serie,
            numero: c.numero,
            motivo: body.motivo,
          },
        ],
      },
      config
    );

    const { xmlFirmado } = firmarXML(xmlSinFirma, config);

    const nombreArchivo = generarNombreBaja(config.ruc, hoyLima, correlativoBaja);
    const resultado = await enviarResumen(xmlFirmado, nombreArchivo, config);

    if (resultado.ticket) {
      // Marcar comprobante como "anulado_pendiente" hasta confirmar ticket
      await sql`
        UPDATE comprobantes
        SET observaciones = COALESCE(observaciones || ' | ', '') ||
            ${`Baja solicitada el ${hoyLima} — ticket ${resultado.ticket} — motivo: ${body.motivo}`}
        WHERE id = ${id}::uuid
      `;
    }

    return NextResponse.json({
      exito: resultado.exito,
      ticket: resultado.ticket,
      mensaje:
        resultado.ticket
          ? "Baja enviada a SUNAT. Consultar ticket en unos minutos para confirmar."
          : resultado.error,
      correlativoBaja,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Error generando baja", detalle: (err as Error).message },
      { status: 500 }
    );
  }
}

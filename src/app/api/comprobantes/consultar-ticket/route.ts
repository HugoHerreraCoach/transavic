// src/app/api/comprobantes/consultar-ticket/route.ts
// Consulta el estado de un ticket SUNAT (getStatus). SUNAT entrega un *ticket*
// al recibir un Resumen Diario (RC-) o una Comunicación de Baja (RA-); luego hay
// que consultarlo para saber si lo aceptó o rechazó.
//
// POST { empresa, ticket, resumenId?, comprobanteId? }
//   - resumenId    → actualiza la fila de resumenes_diarios con el resultado.
//   - comprobanteId→ (baja) anota el resultado en el comprobante; si aceptan, lo
//                    marca 'anulado'.
//
// Solo admin.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSunatConfig } from "@/lib/sunat/config-transavic";
import { consultarTicket } from "@/lib/sunat/soap-client";
import { type EmpresaId, EstadoSunat } from "@/lib/sunat/types";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  empresa: z.enum(["transavic", "avicola"]),
  ticket: z.string().trim().min(1, "Ticket requerido"),
  resumenId: z.string().uuid().optional(),
  comprobanteId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin puede consultar tickets" }, { status: 403 });

  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Datos inválidos", detalle: (err as Error).message },
      { status: 400 }
    );
  }

  const config = getSunatConfig(body.empresa as EmpresaId);
  if (!config.certificateBase64) {
    return NextResponse.json(
      { error: "Certificado SUNAT no configurado para esta empresa" },
      { status: 503 }
    );
  }

  const resultado = await consultarTicket(body.ticket, config);

  // Mapear el estado SUNAT a un estado de DB legible.
  const estadoDB =
    resultado.estado === EstadoSunat.ACEPTADA
      ? "aceptado"
      : resultado.estado === EstadoSunat.RECHAZADA
        ? "rechazado"
        : resultado.estado === EstadoSunat.PENDIENTE
          ? "enviado" // sigue en proceso
          : "error";

  const detalle =
    resultado.descripcion ||
    resultado.error ||
    (resultado.observaciones?.join(" | ") ?? null);

  const sql = neon(process.env.DATABASE_URL!);

  // Persistir el resultado donde corresponda.
  if (body.resumenId) {
    await sql`
      UPDATE resumenes_diarios SET
        estado = ${estadoDB},
        mensaje_sunat = ${detalle},
        cdr_base64 = ${resultado.cdrBase64 ?? null},
        updated_at = NOW()
      WHERE id = ${body.resumenId}::uuid
    `;
  }

  if (body.comprobanteId) {
    const nota = `Consulta ticket ${body.ticket} (${estadoDB})${detalle ? `: ${detalle}` : ""}`;
    if (resultado.estado === EstadoSunat.ACEPTADA) {
      // La baja fue aceptada → el comprobante queda anulado.
      await sql`
        UPDATE comprobantes SET
          estado = 'anulado',
          observaciones = COALESCE(observaciones || ' | ', '') || ${nota}
        WHERE id = ${body.comprobanteId}::uuid
      `;
    } else {
      await sql`
        UPDATE comprobantes SET
          observaciones = COALESCE(observaciones || ' | ', '') || ${nota}
        WHERE id = ${body.comprobanteId}::uuid
      `;
    }
  }

  return NextResponse.json({
    exito: resultado.exito,
    estado: estadoDB,
    codigoRespuesta: resultado.codigoRespuesta ?? null,
    descripcion: resultado.descripcion ?? null,
    observaciones: resultado.observaciones ?? [],
    mensaje: detalle,
    ticket: body.ticket,
  });
}

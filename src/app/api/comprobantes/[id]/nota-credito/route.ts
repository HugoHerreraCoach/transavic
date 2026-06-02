// src/app/api/comprobantes/[id]/nota-credito/route.ts
// POST { motivo, tipoNotaCredito? } — emite una Nota de Crédito (07) que
// modifica/anula un comprobante (factura o boleta) ya aceptado.
//
// A diferencia de la Comunicación de Baja (/anular, solo facturas, ≤7 días),
// la Nota de Crédito sirve para facturas Y boletas y es el mecanismo general.
//
// V1: reconstruye el crédito como una línea consolidada por el neto del original
// (la tabla comprobantes guarda monto_subtotal/igv/total). Suficiente para
// anulación total (motivo 01). La emite el admin o la ASESORA dueña del
// comprobante (de sus pedidos) — las asesoras son las que facturan.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emitirComprobante } from "@/lib/sunat";
import {
  TipoComprobante,
  TipoNotaCredito,
  TipoDocIdentidad,
  EstadoSunat,
  type EmpresaId,
} from "@/lib/sunat/types";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

const Schema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "Motivo mínimo 5 caracteres")
    .max(250, "Motivo máximo 250 caracteres"),
  tipoNotaCredito: z
    .enum(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"])
    .default("01"), // 01 = Anulación de la operación (catálogo 09)
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!["asesor", "admin"].includes(session.user.role))
    return NextResponse.json(
      { error: "Solo asesores o admin pueden emitir notas de crédito" },
      { status: 403 }
    );

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT c.empresa, c.tipo, c.serie, c.numero, c.serie_numero, c.estado,
           c.monto_subtotal, c.cliente_doc_num, c.cliente_razon_social,
           c.observaciones, c.pedido_id, p.asesor_id
    FROM comprobantes c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    WHERE c.id = ${id}::uuid LIMIT 1
  `) as Array<{
    empresa: string;
    tipo: string;
    serie: string;
    numero: number;
    serie_numero: string;
    estado: string;
    monto_subtotal: string | number;
    cliente_doc_num: string | null;
    cliente_razon_social: string | null;
    observaciones: string | null;
    pedido_id: string | null;
    asesor_id: string | null;
  }>;
  if (rows.length === 0)
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  const c = rows[0];

  // Acceso (decisión de negocio jun 2026): todas las asesoras y el admin pueden
  // emitir nota de crédito sobre CUALQUIER comprobante (el equipo se cubre entre
  // sí cuando una falta). Antes la asesora solo podía sobre los suyos; se abrió a
  // pedido de Antonio. Queda registrado quién la emite en `emitido_por` (rastro).
  // El check de rol asesor/admin ya se hizo arriba.

  if (c.tipo !== "01" && c.tipo !== "03")
    return NextResponse.json(
      { error: "Solo se emite Nota de Crédito sobre una factura o boleta." },
      { status: 400 }
    );
  if (c.estado !== "aceptado" && c.estado !== "observado")
    return NextResponse.json(
      {
        error: `Solo se acredita un comprobante aceptado u observado. Estado actual: ${c.estado}.`,
      },
      { status: 409 }
    );

  // Anti-duplicado: bloquear una SEGUNDA nota de crédito si el comprobante ya tiene
  // una NC aceptada/observada que lo acredita. (Pasó en prod: una factura quedó con
  // DOS NC por el total → doble anulación.) Se detecta por la referencia estructurada
  // (NC emitidas con el sistema nuevo) y por las observaciones del comprobante (NC
  // históricas, anteriores a la columna referencia_comprobante_id).
  const ncPrevias = (await sql`
    SELECT serie_numero FROM comprobantes
    WHERE referencia_comprobante_id = ${id}::uuid
      AND tipo = '07' AND estado IN ('aceptado', 'observado')
    ORDER BY created_at LIMIT 1
  `) as Array<{ serie_numero: string }>;
  const ncHistorica = /nota de cr[eé]dito\s+(\S+)\s+\(ACEPTADA/i.exec(c.observaciones ?? "");
  if (ncPrevias.length > 0 || ncHistorica) {
    const ncRef = ncPrevias[0]?.serie_numero ?? ncHistorica?.[1] ?? "una previa";
    return NextResponse.json(
      {
        error: `Este comprobante (${c.serie_numero}) ya tiene la nota de crédito ${ncRef}; no se puede emitir otra sobre el mismo comprobante. Si hay un caso especial, coordínalo con el admin.`,
      },
      { status: 409 }
    );
  }

  const subtotalNeto = Number(c.monto_subtotal);
  if (!Number.isFinite(subtotalNeto) || subtotalNeto <= 0)
    return NextResponse.json({ error: "El comprobante no tiene monto válido." }, { status: 400 });

  const docNum = c.cliente_doc_num ?? "00000000";
  const esRuc = /^\d{11}$/.test(docNum);
  const refNumero = String(c.numero).padStart(8, "0");

  try {
    const resultado = await emitirComprobante({
      empresa: c.empresa as EmpresaId,
      tipo: TipoComprobante.NOTA_CREDITO,
      cliente: {
        tipoDocumento: esRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
        numDocumento: docNum,
        razonSocial: c.cliente_razon_social ?? "CLIENTE",
      },
      items: [
        {
          descripcion: `${parsed.data.motivo} (ref. ${c.serie}-${refNumero})`.slice(0, 250),
          unidadMedida: "NIU",
          cantidad: 1,
          precioUnitario: Number(subtotalNeto.toFixed(2)),
          igvPorcentaje: 18,
        },
      ],
      documentoReferencia: {
        tipoComprobante: c.tipo as TipoComprobante,
        serie: c.serie,
        numero: c.numero,
        tipoNotaCredito: parsed.data.tipoNotaCredito as TipoNotaCredito,
        motivo: parsed.data.motivo,
      },
      // Vincula la NC con la fila del comprobante original (factura/boleta): se
      // guarda en `comprobantes.referencia_comprobante_id`. Sirve para mostrar el
      // enlace "anula F001-5" en la lista y para que la factura aparezca "con N. Crédito".
      referenciaComprobanteId: id,
      // Rastro: quién emitió esta nota de crédito (cualquier asesora/admin puede).
      emitidoPor: session.user.name?.trim() || undefined,
    });

    // Vincular la NC con el comprobante original (auditoría)
    if (resultado.serieNumero) {
      await sql`
        UPDATE comprobantes
        SET observaciones = COALESCE(observaciones || ' | ', '') ||
          ${`Nota de crédito ${resultado.serieNumero} (${resultado.estado}) — ${parsed.data.motivo}`}
        WHERE id = ${id}::uuid
      `;
    }

    // P2.10 — Si la NC fue rechazada o falló, avisar. La NC ahora también la puede
    // emitir la asesora dueña, así que notificamos al admin y a la asesora del
    // comprobante (si lo tiene) para que se entere de que su nota de crédito falló.
    if (
      resultado.estado === EstadoSunat.RECHAZADA ||
      resultado.estado === EstadoSunat.ERROR
    ) {
      await notificarComprobanteConProblema({
        comprobanteId: id,
        serieNumero: resultado.serieNumero ?? null,
        tipo: "07",
        estado: resultado.estado === EstadoSunat.RECHAZADA ? "RECHAZADA" : "ERROR",
        mensajeSunat: resultado.mensaje ?? null,
        pedidoId: c.pedido_id ?? null,
        empresa: c.empresa,
        asesorId: c.asesor_id ?? null,
      });
    }

    return NextResponse.json(resultado);
  } catch (err) {
    console.error("Error emitiendo nota de crédito:", err);
    const mensaje = err instanceof Error ? err.message : "Error al emitir nota de crédito";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

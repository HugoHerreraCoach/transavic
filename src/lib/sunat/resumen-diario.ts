// src/lib/sunat/resumen-diario.ts
// Lógica compartida del Resumen Diario de Boletas (RC-) entre el cron automático
// y el endpoint manual. Concentra acá la IDEMPOTENCIA: antes de enviar a SUNAT
// revisa la tabla resumenes_diarios y NO reenvía si ya hay un resumen del mismo
// día (evita RC duplicados si el cron se dispara dos veces o se hace doble click).
//
// Convenciones:
//   - `fecha` es la fecha de las boletas a resumir (fechaReferencia), YYYY-MM-DD.
//   - Un resumen 'enviado'/'aceptado' (o 'enviando' reciente) bloquea reenvíos.
//   - Un resumen previo en 'error'/'rechazado' SÍ se puede reintentar (reusa la fila).
//   - `forzar: true` ignora el guard (para resúmenes complementarios deliberados).

import { neon } from "@neondatabase/serverless";
import {
  getSunatConfig,
  generarNombreResumen,
} from "@/lib/sunat/config-transavic";
import { generarXMLResumenDiario } from "@/lib/sunat/xml-builder";
import { firmarXML } from "@/lib/sunat/xml-signer";
import { enviarResumen } from "@/lib/sunat/soap-client";
import {
  type EmpresaId,
  TipoComprobante,
  TipoDocumentoIdentidad,
} from "@/lib/sunat/types";

export interface ResultadoResumenDiario {
  empresa: EmpresaId;
  ok: boolean;
  /** true si ya existía un resumen del día y no se reenvió (idempotencia). */
  skipped?: boolean;
  boletas: number;
  correlativo?: number;
  nombreArchivo?: string;
  ticket?: string | null;
  /** estado en resumenes_diarios: enviando|enviado|aceptado|rechazado|error */
  estado?: string;
  resumenId?: string;
  mensaje?: string;
  error?: string;
  xmlFirmadoBase64?: string;
}

const VENTANA_ENVIANDO_MS = 15 * 60 * 1000; // 'enviando' más viejo que esto se considera colgado

export async function enviarResumenDiario(opts: {
  empresa: EmpresaId;
  fecha: string; // YYYY-MM-DD (día de las boletas a resumir)
  forzar?: boolean;
}): Promise<ResultadoResumenDiario> {
  const { empresa, fecha, forzar = false } = opts;

  const config = getSunatConfig(empresa);
  if (!config.certificateBase64) {
    return { empresa, ok: false, boletas: 0, error: "Certificado .p12 no configurado" };
  }

  const sql = neon(process.env.DATABASE_URL!);

  // 1. Idempotencia: ¿ya hay un resumen para este RUC + día?
  let reuseId: string | null = null;
  if (!forzar) {
    const existentes = (await sql`
      SELECT id, estado, ticket, correlativo, boletas_incluidas, updated_at
      FROM resumenes_diarios
      WHERE ruc = ${config.ruc} AND fecha_referencia = ${fecha}::date
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<{
      id: string;
      estado: string;
      ticket: string | null;
      correlativo: number | null;
      boletas_incluidas: number | null;
      updated_at: string | Date;
    }>;
    if (existentes.length > 0) {
      const e = existentes[0];
      const updatedMs = new Date(e.updated_at).getTime();
      const enviandoVivo =
        e.estado === "enviando" && Date.now() - updatedMs < VENTANA_ENVIANDO_MS;
      if (e.estado === "enviado" || e.estado === "aceptado" || enviandoVivo) {
        return {
          empresa,
          ok: true,
          skipped: true,
          boletas: Number(e.boletas_incluidas ?? 0),
          correlativo: e.correlativo ?? undefined,
          ticket: e.ticket ?? null,
          estado: e.estado,
          resumenId: e.id,
          mensaje:
            "Ya existe un resumen para este día — no se reenvía (idempotencia).",
        };
      }
      // 'error' / 'rechazado' / 'enviando' colgado → reintentar reusando la fila
      reuseId = e.id;
    }
  }

  // 2. Boletas del día (mismas reglas que el flujo original)
  const boletas = (await sql`
    SELECT serie, numero, cliente_doc_tipo, cliente_doc_num,
      monto_subtotal, monto_igv, monto_total, estado
    FROM comprobantes
    WHERE empresa = ${empresa}
      AND ruc_emisor = ${config.ruc}
      AND tipo = '03'
      AND DATE(created_at AT TIME ZONE 'America/Lima') = ${fecha}::date
    ORDER BY numero ASC
  `) as Array<{
    serie: string;
    numero: number;
    cliente_doc_tipo: string | null;
    cliente_doc_num: string | null;
    monto_subtotal: string | number;
    monto_igv: string | number;
    monto_total: string | number;
    estado: string;
  }>;

  if (boletas.length === 0) {
    return { empresa, ok: true, boletas: 0, mensaje: `Sin boletas para ${fecha}` };
  }

  // 3. Reservar/crear la fila 'enviando' (antes de enviar → evita doble envío concurrente)
  let resumenId: string;
  if (reuseId) {
    await sql`
      UPDATE resumenes_diarios
      SET estado = 'enviando', boletas_incluidas = ${boletas.length}, updated_at = NOW()
      WHERE id = ${reuseId}::uuid
    `;
    resumenId = reuseId;
  } else {
    const ins = (await sql`
      INSERT INTO resumenes_diarios (empresa, ruc, fecha_referencia, estado, boletas_incluidas)
      VALUES (${empresa}, ${config.ruc}, ${fecha}::date, 'enviando', ${boletas.length})
      RETURNING id
    `) as Array<{ id: string }>;
    resumenId = ins[0].id;
  }

  // 4. Correlativo del resumen (RC-YYYYMMDD, atómico por RUC)
  const yyyymmdd = fecha.replace(/-/g, "");
  const correlativoResult = (await sql`
    INSERT INTO comprobantes_contador (ruc, serie, ultimo_numero)
    VALUES (${config.ruc}, ${`RC-${yyyymmdd}`}, 1)
    ON CONFLICT (ruc, serie) DO UPDATE SET ultimo_numero = comprobantes_contador.ultimo_numero + 1
    RETURNING ultimo_numero
  `) as Array<{ ultimo_numero: number }>;
  const correlativo = correlativoResult[0].ultimo_numero;

  try {
    const items = boletas.map((b) => ({
      tipoComprobante: TipoComprobante.BOLETA,
      serie: b.serie,
      numeroInicio: b.numero,
      numeroFin: b.numero,
      tipoDocumentoCliente:
        (b.cliente_doc_tipo as TipoDocumentoIdentidad) ?? TipoDocumentoIdentidad.DNI,
      numDocumentoCliente: b.cliente_doc_num ?? "00000000",
      estadoItem: (b.estado === "rechazado" ? "3" : "1") as "1" | "2" | "3",
      totalGravadas: Number(b.monto_subtotal),
      totalExoneradas: 0,
      totalInafectas: 0,
      totalIGV: Number(b.monto_igv),
      totalISC: 0,
      totalOtrosCargos: 0,
      importeTotal: Number(b.monto_total),
      moneda: "PEN",
    }));

    const xmlSinFirma = generarXMLResumenDiario(
      {
        fechaEmision: new Date().toISOString().slice(0, 10),
        fechaReferencia: fecha,
        correlativo,
        items,
      },
      config
    );

    const { xmlFirmado } = firmarXML(xmlSinFirma, config);
    const xmlFirmadoBase64 = Buffer.from(xmlFirmado).toString("base64");
    const nombreArchivo = generarNombreResumen(config.ruc, fecha, correlativo);
    const resultado = await enviarResumen(xmlFirmado, nombreArchivo, config);

    const estadoDB = resultado.exito && resultado.ticket ? "enviado" : "error";
    await sql`
      UPDATE resumenes_diarios SET
        correlativo = ${correlativo},
        nombre_archivo = ${nombreArchivo},
        ticket = ${resultado.ticket ?? null},
        estado = ${estadoDB},
        boletas_incluidas = ${boletas.length},
        mensaje_sunat = ${resultado.error ?? null},
        xml_firmado_base64 = ${xmlFirmadoBase64},
        updated_at = NOW()
      WHERE id = ${resumenId}::uuid
    `;

    return {
      empresa,
      ok: resultado.exito,
      boletas: boletas.length,
      correlativo,
      nombreArchivo,
      ticket: resultado.ticket ?? null,
      estado: estadoDB,
      resumenId,
      mensaje: resultado.ticket
        ? "Resumen enviado. Consultá el ticket en unos segundos para ver si SUNAT lo aceptó."
        : resultado.error,
      error: resultado.exito ? undefined : resultado.error,
      xmlFirmadoBase64,
    };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE resumenes_diarios
      SET estado = 'error', mensaje_sunat = ${mensaje.slice(0, 1000)}, updated_at = NOW()
      WHERE id = ${resumenId}::uuid
    `;
    return {
      empresa,
      ok: false,
      boletas: boletas.length,
      correlativo,
      estado: "error",
      resumenId,
      error: mensaje,
    };
  }
}

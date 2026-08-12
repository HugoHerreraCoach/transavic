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
import { fechaHoyLima } from "@/lib/sunat/fechas";
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
  /** true si solo se contó qué se enviaría, sin tocar SUNAT ni la DB. */
  dryRun?: boolean;
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

/**
 * Estados de boleta que SÍ se declaran en el Resumen Diario.
 *
 * Se excluyen a propósito los INCIERTOS (`por_confirmar`, `emitiendo`, `error`,
 * `no_registrado`): declarar como alta una boleta que no sabemos si SUNAT
 * recibió es exactamente cómo se fabrica una declaración duplicada.
 *
 * FUENTE ÚNICA — la usan el envío y el preview de `GET /api/comprobantes/
 * resumen-diario`. Antes divergían: el preview filtraba y el envío no, así que
 * la pantalla mostraba menos boletas de las que realmente se habrían mandado.
 */
export const ESTADOS_BOLETA_EN_RESUMEN = [
  "aceptado",
  "observado",
  "rechazado",
  "pendiente",
] as const;

/**
 * Cierra las filas que quedaron colgadas en 'enviando'.
 *
 * Por qué existe: hasta el 11 ago 2026 el cron no declaraba `maxDuration`, así
 * que Vercel lo mataba por timeout DESPUÉS de crear la fila 'enviando' y ANTES
 * del `catch` — quedaban 60 filas sin ticket, sin XML y sin causa registrada,
 * y nadie se enteró en 70 días. Un fallo tiene que dejar rastro.
 *
 * No se presume que SUNAT no lo recibió: el mensaje dice que es indeterminado y
 * NO se reintenta solo (el reintento es una decisión manual).
 */
export async function sanearResumenesColgados(): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  // 15 minutos = VENTANA_ENVIANDO_MS. Literal en SQL a propósito: el driver HTTP
  // de Neon infiere mal el tipo de un parámetro dentro de make_interval (gotcha #45c).
  const filas = (await sql`
    UPDATE resumenes_diarios
    SET estado = 'error',
        mensaje_sunat = COALESCE(
          mensaje_sunat,
          'Corrida interrumpida (la funcion se corto por timeout). No se pudo confirmar si SUNAT recibio este resumen; no se reintenta automaticamente.'
        ),
        updated_at = NOW()
    WHERE estado = 'enviando'
      AND updated_at < NOW() - interval '15 minutes'
    RETURNING id
  `) as Array<{ id: string }>;
  return filas.length;
}

export async function enviarResumenDiario(opts: {
  empresa: EmpresaId;
  fecha: string; // YYYY-MM-DD (día de las boletas a resumir)
  forzar?: boolean;
  /**
   * Solo cuenta qué boletas entrarían. NO consume correlativo, NO escribe en
   * `resumenes_diarios` y NO llama a SUNAT. Es el modo por defecto del cron
   * (ver `SUNAT_RESUMEN_DIARIO_AUTO`).
   */
  dryRun?: boolean;
}): Promise<ResultadoResumenDiario> {
  const { empresa, fecha, forzar = false, dryRun = false } = opts;

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

  // 2. Boletas del día. El filtro de estado es el MISMO que usa el preview
  //    (ESTADOS_BOLETA_EN_RESUMEN): nunca se declara una boleta incierta.
  const boletas = (await sql`
    SELECT serie, numero, cliente_doc_tipo, cliente_doc_num,
      monto_subtotal, monto_igv, monto_total, estado
    FROM comprobantes
    WHERE empresa = ${empresa}
      AND ruc_emisor = ${config.ruc}
      AND tipo = '03'
      AND COALESCE(fecha_emision, DATE(created_at AT TIME ZONE 'America/Lima')) = ${fecha}::date
      AND estado = ANY(${[...ESTADOS_BOLETA_EN_RESUMEN]}::text[])
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

  // 2b. Modo simulación: cortamos ANTES de consumir correlativo, de escribir la
  //     fila 'enviando' y de llamar a SUNAT. Solo deja constancia en el log de
  //     cuántas boletas entrarían. Ver `SUNAT_RESUMEN_DIARIO_AUTO` en el cron.
  if (dryRun) {
    return {
      empresa,
      ok: true,
      dryRun: true,
      boletas: boletas.length,
      mensaje:
        `Simulacion: ${boletas.length} boleta(s) de ${fecha} entrarian en el resumen. ` +
        `No se envio nada a SUNAT (envio automatico apagado).`,
    };
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
        fechaEmision: fechaHoyLima(),
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

// src/lib/sunat/index.ts
// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO SUNAT — Emisión real de comprobantes electrónicos
//
// Flujo end-to-end:
//   1) Obtener correlativo atómico desde DB (tabla comprobantes_contador)
//   2) Construir XML UBL 2.1 con xml-builder
//   3) Firmar XML con xml-signer + certificado .p12 (env var)
//   4) Enviar a webservice SOAP de SUNAT (beta o producción)
//   5) Parsear CDR (Constancia de Recepción) y guardar estado en DB
//
// Si NO hay certificado configurado, retorna estado "pendiente" sin enviar a
// SUNAT (modo testing local — útil mientras Antonio descarga su .p12).
// ═══════════════════════════════════════════════════════════════════════════════

import { neon } from "@neondatabase/serverless";
import { siguienteNumeroComprobante, formatSerieNumero } from "./contador";
import {
  getSunatConfig,
  CATALOGO,
} from "./config-transavic";
import { generarXMLComprobante, calcularTotales, r2 } from "./xml-builder";
import { firmarXML } from "./xml-signer";
import { enviarComprobante } from "./soap-client";
import { horaActualLima, fechaHoyLima } from "./fechas";
import { completarPostprocesoAceptadoPorId } from "./reconciliacion-cpe";
import {
  MAX_OBSERVACION_CPE,
  normalizarObservacionSunat,
} from "./observaciones";
import {
  type EmpresaId,
  type ClienteComprobante,
  type ComprobanteItem,
  type ItemComprobante,
  type ResultadoEmision,
  TipoComprobante,
  TipoOperacion,
  TipoAfectacionIGV,
  TipoNotaCredito,
  EstadoSunat,
} from "./types";

export interface OpcionesEmision {
  empresa: EmpresaId;
  tipo: TipoComprobante;
  serie?: string;
  cliente: ClienteComprobante;
  /** Acepta tanto el shape simple antiguo como el completo de SUNAT */
  items: (ComprobanteItem | ItemComprobante)[];
  pedidoId?: string;
  /** Fecha de emisión (default: hoy en Lima) */
  fechaEmision?: string;
  /** Forma de pago — afecta XML (Contado por defecto) */
  formaPago?: "Contado" | "Credito";
  /** Plazo en días para crédito (genera la cuota con fecha de vencimiento en el XML). */
  plazoDias?: number;
  /** Observación libre visible en PDF y enviada en XML (factura/boleta). */
  observacionComprobante?: string | null;
  /** Para NOTA_CREDITO (07): documento que se modifica/anula. */
  documentoReferencia?: {
    tipoComprobante: TipoComprobante;
    serie: string;
    numero: number;
    tipoNotaCredito?: TipoNotaCredito;
    motivo: string;
  };
  /**
   * Para NOTA_CREDITO (07): id (UUID) de la fila `comprobantes` del comprobante
   * original que se acredita. Se persiste en `comprobantes.referencia_comprobante_id`
   * para enlazar la NC con su factura/boleta en la lista y para que la asesora
   * dueña del original vea también la NC (ver scoping en GET /api/comprobantes).
   */
  referenciaComprobanteId?: string;
  /**
   * Nombre de la persona (asesora/admin) que emite el comprobante. Se guarda en
   * `comprobantes.emitido_por` para mostrar la atribución en la lista (todas las
   * asesoras ven todos los comprobantes). Lo pasa cada endpoint de emisión desde
   * `session.user.name`.
   */
  emitidoPor?: string;
  /**
   * Cliente interno para conservar el vinculo de cobranza en emisiones
   * standalone. No forma parte del XML ni se envia a SUNAT.
   */
  clienteId?: string | null;
  /**
   * Para VENTA EN CAMPO (módulo Clientes Avícola): id de la fila `ventas_avicola`
   * que se está facturando. Se persiste en `comprobantes.venta_avicola_id` — único
   * nexo comprobante ↔ venta de campo. Su presencia hace que el endpoint NO cree
   * cobranza en `facturas` (la deuda ya vive en el saldo avícola) y excluye el
   * comprobante de la vista `ventas_facturadas` (metas de asesoras). Ver gotcha #47.
   */
  ventaAvicolaId?: string | null;
  /**
   * Reemisión de Campo después de un rechazo definitivo de SUNAT. Apunta al
   * CPE rechazado inmediato; el nuevo comprobante consume OTRO correlativo y
   * conserva intactos XML/CDR de toda la cadena.
   */
  reemplazaComprobanteId?: string | null;
}

/** Conflicto de concurrencia: otra solicitud ya reservó/facturó esta venta. */
export class VentaCampoYaFacturadaError extends Error {
  readonly ventaAvicolaId: string;

  constructor(ventaAvicolaId: string) {
    super("La venta de campo ya tiene un comprobante reservado o emitido.");
    this.name = "VentaCampoYaFacturadaError";
    this.ventaAvicolaId = ventaAvicolaId;
  }
}

/** Conflicto de concurrencia: otra solicitud ya reservó una NC para la referencia. */
export class NotaCreditoYaReservadaError extends Error {
  readonly referenciaComprobanteId: string;

  constructor(referenciaComprobanteId: string) {
    super("El comprobante ya tiene una Nota de Crédito reservada o emitida.");
    this.name = "NotaCreditoYaReservadaError";
    this.referenciaComprobanteId = referenciaComprobanteId;
  }
}

function esDuplicadoVentaCampo(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; message?: string };
  return (
    e?.code === "23505" &&
    (e.constraint === "ux_comprobantes_venta_avicola_cpe" ||
      e.constraint === "ux_comprobantes_reemplaza_cpe" ||
      (e.message ?? "").includes("ux_comprobantes_venta_avicola_cpe") ||
      (e.message ?? "").includes("ux_comprobantes_reemplaza_cpe") ||
      (e.message ?? "").includes("venta_avicola_id"))
  );
}

function esDuplicadoNotaCredito(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; message?: string };
  return (
    e?.code === "23505" &&
    (e.constraint === "ux_comprobantes_nc_referencia_activa" ||
      (e.message ?? "").includes("ux_comprobantes_nc_referencia_activa"))
  );
}

/**
 * Normaliza un item al shape ComprobanteItem completo.
 */
function normalizarItem(item: ComprobanteItem | ItemComprobante): ComprobanteItem {
  if ("tipoAfectacionIGV" in item) return item as ComprobanteItem;
  // Es ItemComprobante (shape simple) — convertir
  const simple = item as ItemComprobante;
  return {
    codigo: simple.codigo,
    descripcion: simple.descripcion,
    unidadMedida: simple.unidadMedida,
    cantidad: simple.cantidad,
    precioUnitario: simple.precioUnitario,
    tipoAfectacionIGV: TipoAfectacionIGV.GRAVADA_ONEROSA,
    porcentajeIGV: simple.igvPorcentaje ?? CATALOGO.IGV_PORCENTAJE,
  };
}

/**
 * Fecha de emisión por defecto: hoy en zona horaria Lima.
 */
function fechaEmisionDefault(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

/**
 * Emite un comprobante electrónico (factura o boleta) a SUNAT.
 *
 * - Si SUNAT_xxx_CERT_B64 está configurado: genera XML → firma → envía a SUNAT → guarda CDR.
 * - Si NO: registra solo correlativo en DB con estado "pendiente" (modo testing).
 */
export async function emitirComprobante(
  opts: OpcionesEmision
): Promise<ResultadoEmision> {
  const config = getSunatConfig(opts.empresa);
  if (!config.ruc || config.ruc.startsWith("20X") || config.ruc.startsWith("20Y")) {
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      serieNumero: "",
      error: `RUC no configurado para empresa "${opts.empresa}". Definí SUNAT_${
        opts.empresa === "transavic" ? "TRA" : "AVI"
      }_RUC en .env.local`,
    };
  }

  // Barrera defensiva: si el caller pasó una fecha de emisión FUTURA, abortar ANTES
  // de consumir el correlativo atómico (un número quemado deja hueco). SUNAT rechaza
  // las fechas futuras con 2329. El rango completo (3/7 días atrás según tipo) lo
  // valida el endpoint, que conoce el tipo; acá solo cubrimos lo que SUNAT rechaza
  // siempre. La NC y la emisión "hoy" no pasan fechaEmision → no se ven afectadas.
  if (opts.fechaEmision && opts.fechaEmision > fechaHoyLima()) {
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      serieNumero: "",
      error: "No se permiten fechas de emisión futuras (SUNAT rechaza con 2329).",
    };
  }

  const observacionComprobante =
    opts.tipo === TipoComprobante.NOTA_CREDITO
      ? null
      : normalizarObservacionSunat(
          opts.observacionComprobante,
          MAX_OBSERVACION_CPE
        );

  // 1) Serie + correlativo atómico.
  //    Convención multi-empresa: cada empresa tiene su propia familia de series
  //    para que Antonio pueda distinguir visualmente comprobantes por origen.
  //      Transavic    → F001 (facturas), B001 (boletas)
  //      Avícola Tony → F002 (facturas), B002 (boletas)
  //    El correlativo está en `comprobantes_contador` con PRIMARY KEY (ruc, serie),
  //    así que aunque las series fueran iguales los números no se mezclan,
  //    pero usar series distintas hace que sea evidente a simple vista.
  // Series por empresa y tipo. Las Notas de Crédito usan su propia familia
  // (FC0x si modifican una factura, BC0x si modifican una boleta) — exigido por
  // SUNAT: el correlativo de NC es independiente del de facturas/boletas.
  let defaultSerie: string;
  if (opts.tipo === TipoComprobante.NOTA_CREDITO) {
    const refEsBoleta =
      opts.documentoReferencia?.tipoComprobante === TipoComprobante.BOLETA;
    defaultSerie =
      opts.empresa === "avicola"
        ? refEsBoleta
          ? "BC02"
          : "FC02"
        : refEsBoleta
          ? "BC01"
          : "FC01";
  } else {
    defaultSerie =
      opts.empresa === "avicola"
        ? opts.tipo === TipoComprobante.BOLETA
          ? "B002"
          : "F002"
        : opts.tipo === TipoComprobante.BOLETA
          ? "B001"
          : "F001";
  }
  const serie = opts.serie ?? defaultSerie;
  const numero = await siguienteNumeroComprobante(config.ruc, serie);
  const serieNumero = formatSerieNumero(serie, numero);
  const fechaEmision = opts.fechaEmision ?? fechaEmisionDefault();

  const itemsNorm = opts.items.map(normalizarItem);

  // Totales para DB: se calculan con la MISMA función que arma el XML
  // (`calcularTotales`) — fuente ÚNICA de verdad. Antes había un cálculo paralelo
  // que sumaba sin redondear por línea y divergía 1-2 céntimos del cbc:PayableAmount
  // del XML → el PDF/lista mostraban un total que no validaba en SUNAT. Ahora
  // monto_total/subtotal/igv == lo que SUNAT registra. (`totales` se reusa al
  // generar el XML para que NO se recalcule y queden idénticos por construcción.)
  const totales = calcularTotales(itemsNorm);
  const subtotal = r2(
    totales.totalGravadas + totales.totalExoneradas + totales.totalInafectas
  );
  const igv = totales.totalIGV;
  const total = totales.importeTotal;

  const sql = neon(process.env.DATABASE_URL!);

  // 2) Si NO hay certificado, queda en modo testing
  const hayCertificado =
    !!config.certificateBase64 && !!config.certificatePassword;

  // Forma de pago + vencimiento: se persisten en `comprobantes` (para que el PDF
  // arme la sección de crédito) y se usan en el XML de crédito. Para CRÉDITO,
  // SUNAT exige ≥1 cuota con fecha de vencimiento (rechaza con error 3249 si
  // falta); vencimiento = fecha de emisión + plazoDias (default 7).
  const formaPagoDB = opts.formaPago ?? "Contado";
  let fechaVencimiento: string | undefined;
  if (opts.formaPago === "Credito") {
    const dias = opts.plazoDias && opts.plazoDias > 0 ? opts.plazoDias : 7;
    const [vy, vm, vd] = fechaEmision.split("-").map(Number);
    const base = new Date(Date.UTC(vy, vm - 1, vd));
    base.setUTCDate(base.getUTCDate() + dias);
    fechaVencimiento = base.toISOString().slice(0, 10);
  }

  if (!hayCertificado) {
    try {
      await sql`
        INSERT INTO comprobantes (
          pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
          cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
          monto_subtotal, monto_igv, monto_total, estado, mensaje_sunat,
          forma_pago, fecha_vencimiento, fecha_emision, items_json, referencia_comprobante_id, emitido_por,
          cobranza_cliente_id,
          venta_avicola_id, reemplaza_comprobante_id, observacion_comprobante
        ) VALUES (
          ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
          ${serie}, ${numero}, ${serieNumero},
          ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
          ${subtotal}, ${igv}, ${total}, 'pendiente',
          ${"Comprobante registrado localmente. Certificado .p12 no configurado en env vars — no se envió a SUNAT."},
          ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date, ${JSON.stringify(itemsNorm)}::jsonb,
          ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
          ${opts.clienteId ?? null},
          ${opts.ventaAvicolaId ?? null}, ${opts.reemplazaComprobanteId ?? null}, ${observacionComprobante}
        )
      `;
    } catch (error) {
      if (opts.ventaAvicolaId && esDuplicadoVentaCampo(error)) {
        throw new VentaCampoYaFacturadaError(opts.ventaAvicolaId);
      }
      if (opts.referenciaComprobanteId && esDuplicadoNotaCredito(error)) {
        throw new NotaCreditoYaReservadaError(opts.referenciaComprobanteId);
      }
      throw error;
    }
    if (opts.pedidoId) {
      await sql`
        UPDATE facturas SET numero_comprobante = ${serieNumero}
        WHERE pedido_id = ${opts.pedidoId} AND numero_comprobante IS NULL
      `;
    }
    return {
      exito: true,
      estado: EstadoSunat.PENDIENTE,
      serieNumero,
      total,
      mensaje:
        "Comprobante registrado con correlativo atómico. Pendiente de envío a SUNAT (configurar certificado .p12 en SUNAT_*_CERT_B64).",
    };
  }

  // 3) Hay certificado → flujo SUNAT real
  let reservaPreSunatId: string | null = null;
  try {
    // 3.1) Construir XML UBL 2.1 (formaPago/fechaVencimiento ya calculados arriba).
    const xmlSinFirma = generarXMLComprobante(
      {
        tipoComprobante: opts.tipo,
        serie,
        numero,
        fechaEmision,
        horaEmision: horaActualLima(),
        tipoOperacion: TipoOperacion.VENTA_INTERNA,
        moneda: CATALOGO.MONEDA.SOLES,
        cliente: opts.cliente,
        items: itemsNorm,
        // Reusar los totales ya calculados → el XML y la DB quedan idénticos.
        totales,
        formaPago: opts.formaPago ?? "Contado",
        fechaVencimiento,
        observacionComprobante,
        documentoReferencia: opts.documentoReferencia,
      },
      config
    );

    // 3.2) Firmar XML
    const { xmlFirmado, hashCpe } = firmarXML(xmlSinFirma, config);

    // Reservar la fila en DB ANTES de llamar al SOAP. Además de Campo/NC, esto se
    // hace para TODA factura/boleta: si Vercel termina después de que SUNAT recibió
    // el ZIP, la misma fila/XML/correlativo queda disponible para CONSULTAR, en vez
    // de perder el rastro y permitir que la asesora genere otro número.
    const debeReservarAntesDeSunat =
      opts.tipo === TipoComprobante.FACTURA ||
      opts.tipo === TipoComprobante.BOLETA ||
      !!opts.ventaAvicolaId ||
      (opts.tipo === TipoComprobante.NOTA_CREDITO &&
        !!opts.referenciaComprobanteId);
    if (debeReservarAntesDeSunat) {
      try {
        const reservas = (await sql`
          INSERT INTO comprobantes (
            pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
            cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
            monto_subtotal, monto_igv, monto_total, estado,
            hash_cpe, xml_firmado_base64, mensaje_sunat,
            forma_pago, fecha_vencimiento, fecha_emision, items_json,
            referencia_comprobante_id, emitido_por, cobranza_cliente_id,
            venta_avicola_id,
            reemplaza_comprobante_id,
            observacion_comprobante
          ) VALUES (
            ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
            ${serie}, ${numero}, ${serieNumero},
            ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
            ${subtotal}, ${igv}, ${total}, 'emitiendo',
            ${hashCpe ?? null}, ${Buffer.from(xmlFirmado).toString("base64")},
            ${"Enviando comprobante a SUNAT. No emitas otro para esta venta."},
            ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date,
            ${JSON.stringify(itemsNorm)}::jsonb,
            ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
            ${opts.clienteId ?? null},
            ${opts.ventaAvicolaId}, ${opts.reemplazaComprobanteId ?? null},
            ${observacionComprobante}
          )
          RETURNING id
        `) as Array<{ id: string }>;
        reservaPreSunatId = reservas[0]?.id ?? null;
      } catch (error) {
        if (opts.ventaAvicolaId && esDuplicadoVentaCampo(error)) {
          throw new VentaCampoYaFacturadaError(opts.ventaAvicolaId);
        }
        if (opts.referenciaComprobanteId && esDuplicadoNotaCredito(error)) {
          throw new NotaCreditoYaReservadaError(opts.referenciaComprobanteId);
        }
        throw error;
      }
    }

    // 3.3) Enviar a SUNAT vía SOAP
    const resultadoEnvio = await enviarComprobante(
      xmlFirmado,
      opts.tipo,
      serie,
      numero,
      config
    );

    // 3.4) Guardar en DB con estado real
    const estadoDB =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA
        ? "aceptado"
        : resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
          ? "observado"
          : resultadoEnvio.estado === EstadoSunat.RECHAZADA
            ? "rechazado"
            : resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
              ? "por_confirmar"
            : "error";

    const observacionesStr = resultadoEnvio.observaciones?.join(" | ") ?? null;
    const cdrLegible =
      resultadoEnvio.tieneCdr ??
      (!!resultadoEnvio.cdrBase64 &&
        [
          EstadoSunat.ACEPTADA,
          EstadoSunat.ACEPTADA_CON_OBSERVACIONES,
          EstadoSunat.RECHAZADA,
        ].includes(resultadoEnvio.estado));
    const mensajeEnvio =
      resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null;
    const mensajeVisible =
      resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
        ? `SUNAT todavía está procesando ${serieNumero}. No emitas otro comprobante; el sistema verificará este mismo número automáticamente.`
        : mensajeEnvio;
    const proximaConsultaAt =
      resultadoEnvio.estado === EstadoSunat.POR_CONFIRMAR
        ? new Date(Date.now() + 15 * 60_000)
        : null;

    if (reservaPreSunatId) {
      await sql`
        UPDATE comprobantes SET
          estado = ${estadoDB},
          hash_cpe = ${hashCpe ?? null},
          xml_firmado_base64 = ${Buffer.from(xmlFirmado).toString("base64")},
          cdr_base64 = ${resultadoEnvio.cdrBase64 ?? null},
          sunat_cdr_legible = ${cdrLegible},
          observaciones = ${observacionesStr},
          mensaje_sunat = ${mensajeVisible},
          sunat_codigo_envio = ${resultadoEnvio.codigoRespuesta ?? null},
          sunat_mensaje_envio = ${mensajeEnvio},
          sunat_siguiente_consulta_at = ${proximaConsultaAt},
          sunat_no_existe_consecutivos = 0,
          sunat_postproceso_estado = ${
            [TipoComprobante.FACTURA, TipoComprobante.BOLETA].includes(opts.tipo) &&
            [EstadoSunat.ACEPTADA, EstadoSunat.ACEPTADA_CON_OBSERVACIONES].includes(
              resultadoEnvio.estado
            )
              ? "pendiente"
              : null
          }
        WHERE id = ${reservaPreSunatId}::uuid
      `;
    } else {
      await sql`
        INSERT INTO comprobantes (
          pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
          cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
          monto_subtotal, monto_igv, monto_total, estado,
          hash_cpe, xml_firmado_base64, cdr_base64, observaciones, mensaje_sunat,
          forma_pago, fecha_vencimiento, fecha_emision, items_json, referencia_comprobante_id, emitido_por,
          cobranza_cliente_id,
          venta_avicola_id, reemplaza_comprobante_id, observacion_comprobante,
          sunat_codigo_envio, sunat_mensaje_envio, sunat_siguiente_consulta_at,
          sunat_cdr_legible, sunat_postproceso_estado
        ) VALUES (
          ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
          ${serie}, ${numero}, ${serieNumero},
          ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
          ${subtotal}, ${igv}, ${total}, ${estadoDB},
          ${hashCpe ?? null},
          ${Buffer.from(xmlFirmado).toString("base64")},
          ${resultadoEnvio.cdrBase64 ?? null},
          ${observacionesStr},
          ${mensajeVisible},
          ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date, ${JSON.stringify(itemsNorm)}::jsonb,
          ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
          ${opts.clienteId ?? null},
          ${opts.ventaAvicolaId ?? null}, ${opts.reemplazaComprobanteId ?? null}, ${observacionComprobante},
          ${resultadoEnvio.codigoRespuesta ?? null}, ${mensajeEnvio}, ${proximaConsultaAt},
          ${cdrLegible}, ${
            [TipoComprobante.FACTURA, TipoComprobante.BOLETA].includes(opts.tipo) &&
            [EstadoSunat.ACEPTADA, EstadoSunat.ACEPTADA_CON_OBSERVACIONES].includes(
              resultadoEnvio.estado
            )
              ? "pendiente"
              : null
          }
        )
      `;
    }

    const sunatAcepto =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA ||
      resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES;

    // Toda aceptacion 01/03, inmediata o tardia, pasa por el MISMO helper con
    // claim atomico. Si la funcion cae aqui, el cron retomara el estado
    // `pendiente`; los endpoints no repiten estos efectos por su cuenta.
    if (
      sunatAcepto &&
      reservaPreSunatId &&
      (opts.tipo === TipoComprobante.FACTURA ||
        opts.tipo === TipoComprobante.BOLETA)
    ) {
      try {
        await completarPostprocesoAceptadoPorId(reservaPreSunatId);
      } catch (errorPostproceso) {
        console.error(
          `SUNAT acepto ${serieNumero}, pero el postproceso quedo pendiente:`,
          errorPostproceso
        );
      }
    }

    return {
      ...resultadoEnvio,
      serieNumero,
      total,
      hashCpe,
      xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
      proximaConsultaAt: proximaConsultaAt?.toISOString(),
      tieneCdr: cdrLegible,
    };
  } catch (err) {
    if (
      err instanceof VentaCampoYaFacturadaError ||
      err instanceof NotaCreditoYaReservadaError
    ) {
      throw err;
    }
    const mensaje = err instanceof Error ? err.message : String(err);
    // Igual registrar el intento fallido para auditoría. Si ya había una
    // reserva, se actualiza ESA fila (mismo correlativo) en vez de insertar.
    if (reservaPreSunatId) {
      if (
        opts.tipo === TipoComprobante.FACTURA ||
        opts.tipo === TipoComprobante.BOLETA
      ) {
        // Con fila/XML ya reservados, una excepción pudo ocurrir después de que
        // SUNAT recibió el ZIP. El único estado seguro es indeterminado: primero
        // se consulta este mismo número y jamás se consume otro correlativo.
        await sql`
          UPDATE comprobantes
          SET estado = 'por_confirmar',
              mensaje_sunat =
                'La comunicación se interrumpió y SUNAT puede haber recibido el comprobante. No emitas otro; el sistema verificará este mismo número.',
              sunat_mensaje_envio = ${`Error de emisión: ${mensaje.slice(0, 1000)}`},
              sunat_siguiente_consulta_at = NOW() + INTERVAL '15 minutes'
          WHERE id = ${reservaPreSunatId}::uuid
        `;
      } else {
        await sql`
          UPDATE comprobantes
          SET estado = 'error',
              mensaje_sunat = ${`Error de emisión: ${mensaje.slice(0, 1000)}`}
          WHERE id = ${reservaPreSunatId}::uuid
        `;
      }
    } else {
      try {
        await sql`
          INSERT INTO comprobantes (
            pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
            cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
            monto_subtotal, monto_igv, monto_total, estado, mensaje_sunat,
            forma_pago, fecha_vencimiento, fecha_emision, items_json, referencia_comprobante_id, emitido_por,
            cobranza_cliente_id,
            venta_avicola_id, reemplaza_comprobante_id, observacion_comprobante
          ) VALUES (
            ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
            ${serie}, ${numero}, ${serieNumero},
            ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
            ${subtotal}, ${igv}, ${total}, 'error',
            ${`Error de emisión: ${mensaje.slice(0, 1000)}`},
            ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date, ${JSON.stringify(itemsNorm)}::jsonb,
            ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
            ${opts.clienteId ?? null},
            ${opts.ventaAvicolaId ?? null}, ${opts.reemplazaComprobanteId ?? null}, ${observacionComprobante}
          )
        `;
      } catch (insertError) {
        if (opts.ventaAvicolaId && esDuplicadoVentaCampo(insertError)) {
          throw new VentaCampoYaFacturadaError(opts.ventaAvicolaId);
        }
        if (opts.referenciaComprobanteId && esDuplicadoNotaCredito(insertError)) {
          throw new NotaCreditoYaReservadaError(opts.referenciaComprobanteId);
        }
        throw insertError;
      }
    }
    const estadoIncierto =
      !!reservaPreSunatId &&
      (opts.tipo === TipoComprobante.FACTURA ||
        opts.tipo === TipoComprobante.BOLETA);
    return {
      exito: false,
      estado: estadoIncierto
        ? EstadoSunat.POR_CONFIRMAR
        : EstadoSunat.ERROR,
      serieNumero,
      error: estadoIncierto
        ? "No se pudo confirmar la respuesta de SUNAT. No emitas otro comprobante; el sistema verificará este mismo número."
        : mensaje,
      proximaConsultaAt: estadoIncierto
        ? new Date(Date.now() + 15 * 60_000).toISOString()
        : undefined,
      tieneCdr: false,
    };
  }
}

// Re-exports para que callers solo importen "@/lib/sunat"
export {
  TipoComprobante,
  TipoOperacion,
  TipoAfectacionIGV,
  EstadoSunat,
  type EmpresaId,
  type ClienteComprobante,
  type ComprobanteItem,
  type ItemComprobante,
  type ResultadoEmision,
} from "./types";
export { getSunatConfig } from "./config-transavic";

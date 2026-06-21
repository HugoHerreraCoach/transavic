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
  generarNombreArchivo,
  CATALOGO,
} from "./config-transavic";
import { generarXMLComprobante, calcularTotales, r2 } from "./xml-builder";
import { firmarXML } from "./xml-signer";
import { enviarComprobante } from "./soap-client";
import { horaActualLima, fechaHoyLima } from "./fechas";
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
    await sql`
      INSERT INTO comprobantes (
        pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
        cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
        monto_subtotal, monto_igv, monto_total, estado, mensaje_sunat,
        forma_pago, fecha_vencimiento, fecha_emision, items_json, referencia_comprobante_id, emitido_por,
        observacion_comprobante
      ) VALUES (
        ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
        ${serie}, ${numero}, ${serieNumero},
        ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
        ${subtotal}, ${igv}, ${total}, 'pendiente',
        ${"Comprobante registrado localmente. Certificado .p12 no configurado en env vars — no se envió a SUNAT."},
        ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date, ${JSON.stringify(itemsNorm)}::jsonb,
        ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
        ${observacionComprobante}
      )
    `;
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
            : "error";

    const observacionesStr = resultadoEnvio.observaciones?.join(" | ") ?? null;

    await sql`
      INSERT INTO comprobantes (
        pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
        cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
        monto_subtotal, monto_igv, monto_total, estado,
        hash_cpe, xml_firmado_base64, cdr_base64, observaciones, mensaje_sunat,
        forma_pago, fecha_vencimiento, fecha_emision, items_json, referencia_comprobante_id, emitido_por,
        observacion_comprobante
      ) VALUES (
        ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
        ${serie}, ${numero}, ${serieNumero},
        ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
        ${subtotal}, ${igv}, ${total}, ${estadoDB},
        ${hashCpe ?? null},
        ${Buffer.from(xmlFirmado).toString("base64")},
        ${resultadoEnvio.cdrBase64 ?? null},
        ${observacionesStr},
        ${resultadoEnvio.descripcion ?? resultadoEnvio.error ?? null},
        ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date, ${JSON.stringify(itemsNorm)}::jsonb,
        ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
        ${observacionComprobante}
      )
    `;

    // Solo asociar el número a la factura si SUNAT lo ACEPTÓ (aceptado u
    // observado son válidos; rechazado/error NO debe ensuciar la cobranza).
    const sunatAcepto =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA ||
      resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES;
    if (sunatAcepto && opts.pedidoId) {
      await sql`
        UPDATE facturas SET numero_comprobante = ${serieNumero}
        WHERE pedido_id = ${opts.pedidoId} AND numero_comprobante IS NULL
      `;
    }

    return {
      ...resultadoEnvio,
      serieNumero,
      total,
      hashCpe,
      xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
    };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    // Igual registrar el intento fallido para auditoría
    await sql`
      INSERT INTO comprobantes (
        pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
        cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
        monto_subtotal, monto_igv, monto_total, estado, mensaje_sunat,
        forma_pago, fecha_vencimiento, fecha_emision, items_json, referencia_comprobante_id, emitido_por,
        observacion_comprobante
      ) VALUES (
        ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
        ${serie}, ${numero}, ${serieNumero},
        ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
        ${subtotal}, ${igv}, ${total}, 'error',
        ${`Error de emisión: ${mensaje.slice(0, 1000)}`},
        ${formaPagoDB}, ${fechaVencimiento ?? null}, ${fechaEmision}::date, ${JSON.stringify(itemsNorm)}::jsonb,
        ${opts.referenciaComprobanteId ?? null}, ${opts.emitidoPor ?? null},
        ${observacionComprobante}
      )
    `;
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      serieNumero,
      error: mensaje,
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

// src/lib/sunat/types.ts
// Tipos para emisión de comprobantes electrónicos SUNAT.
// Portado de conexipema-eventos (sin la capa Firestore — Transavic usa Postgres).

// ════════════════════════════════════════════════════════════════════════
// Enums — Catálogos SUNAT
// ════════════════════════════════════════════════════════════════════════

/** Catálogo N° 01: Tipo de Documento */
export enum TipoComprobante {
  FACTURA = "01",
  BOLETA = "03",
  NOTA_CREDITO = "07",
  NOTA_DEBITO = "08",
}

/** Catálogo N° 06: Tipo de Documento de Identidad */
export enum TipoDocumentoIdentidad {
  DNI = "1",
  CARNET_EXTRANJERIA = "4",
  RUC = "6",
  PASAPORTE = "7",
  CEDULA_DIPLOMATICA = "A",
  SIN_DOCUMENTO = "0",
}

/** Alias retrocompatible con el stub anterior */
export const TipoDocIdentidad = TipoDocumentoIdentidad;

/** Catálogo N° 05: Tipo de Tributo */
export enum CodigoTributo {
  IGV = "1000",
  IVAP = "1016",
  ISC = "2000",
  EXPORTACION = "9995",
  GRATUITA = "9996",
  EXONERADA = "9997",
  INAFECTA = "9998",
  OTROS = "9999",
}

/** Catálogo N° 07: Tipo de Afectación del IGV */
export enum TipoAfectacionIGV {
  GRAVADA_ONEROSA = "10",
  GRAVADA_RETIRO_PREMIO = "11",
  GRAVADA_RETIRO_DONACION = "12",
  GRAVADA_RETIRO = "13",
  GRAVADA_RETIRO_PUBLICIDAD = "14",
  GRAVADA_BONIFICACIONES = "15",
  GRAVADA_RETIRO_ENTREGA = "16",
  GRAVADA_IVAP = "17",
  EXONERADA_ONEROSA = "20",
  INAFECTA_ONEROSA = "30",
  EXPORTACION = "40",
}

/** Catálogo N° 09: Tipo de Nota de Crédito */
export enum TipoNotaCredito {
  ANULACION = "01",
  ANULACION_ERROR_RUC = "02",
  CORRECCION_DESCRIPCION = "03",
  DESCUENTO_GLOBAL = "04",
  DESCUENTO_POR_ITEM = "05",
  DEVOLUCION_TOTAL = "06",
  DEVOLUCION_PARCIAL = "07",
  BONIFICACION = "08",
  DISMINUCION_VALOR = "09",
  OTROS = "10",
}

/** Catálogo N° 10: Tipo de Nota de Débito */
export enum TipoNotaDebito {
  INTERESES_MORA = "01",
  AUMENTO_VALOR = "02",
  PENALIDADES = "03",
  OTROS = "10",
}

/** Catálogo N° 51: Tipo de Operación */
export enum TipoOperacion {
  VENTA_INTERNA = "0101",
  EXPORTACION = "0200",
  VENTA_NO_DOMICILIADOS = "0201",
  VENTA_INTERNA_ANTICIPO = "0112",
  VENTA_ITINERANTE = "0113",
}

/** Catálogo N° 59: Medio de Pago */
export enum MedioPago {
  EFECTIVO = "001",
  DEPOSITO = "003",
  TARJETA_DEBITO = "005",
  TARJETA_CREDITO = "006",
  TRANSFERENCIA = "007",
  OTROS = "999",
}

/** Estado SUNAT del comprobante */
export enum EstadoSunat {
  PENDIENTE = "PENDIENTE",
  ACEPTADA = "ACEPTADA",
  ACEPTADA_CON_OBSERVACIONES = "ACEPTADA_CON_OBSERVACIONES",
  RECHAZADA = "RECHAZADA",
  ANULADA = "ANULADA",
  ERROR = "ERROR",
}

// ════════════════════════════════════════════════════════════════════════
// Identificador de empresa (Transavic-specific)
// ════════════════════════════════════════════════════════════════════════

/** Identificador de empresa emisora. 2 RUCs gestionados por Antonio. */
export type EmpresaId = "transavic" | "avicola";

// ════════════════════════════════════════════════════════════════════════
// Interfaces para emisión
// ════════════════════════════════════════════════════════════════════════

/** Item individual del comprobante */
export interface ComprobanteItem {
  codigo?: string;
  codigoProductoSunat?: string;
  descripcion: string;
  unidadMedida: string;
  cantidad: number;
  precioUnitario: number;
  tipoAfectacionIGV: TipoAfectacionIGV;
  porcentajeIGV: number;
  valorVenta?: number;
  montoIGV?: number;
  precioTotal?: number;
}

/** Alias retrocompatible con el stub anterior */
export interface ItemComprobante {
  codigo?: string;
  descripcion: string;
  unidadMedida: string;
  cantidad: number;
  precioUnitario: number;
  igvPorcentaje: number;
}

/** Datos del cliente/receptor del comprobante */
export interface ClienteComprobante {
  tipoDocumento: TipoDocumentoIdentidad;
  numDocumento: string;
  razonSocial: string;
  direccion?: string;
  email?: string;
}

/** Totales del comprobante (calculados automáticamente si no se pasan) */
export interface TotalesComprobante {
  totalGravadas: number;
  totalExoneradas: number;
  totalInafectas: number;
  totalGratuitas: number;
  totalIGV: number;
  totalISC: number;
  totalOtrosCargos: number;
  totalDescuentos: number;
  importeTotal: number;
  montoRedondeo?: number;
}

/** Datos completos para generar un comprobante */
export interface DatosComprobante {
  tipoComprobante: TipoComprobante;
  serie: string;
  numero: number;
  fechaEmision: string;
  horaEmision?: string;
  tipoOperacion: TipoOperacion;
  moneda: string;
  cliente: ClienteComprobante;
  items: ComprobanteItem[];
  totales?: TotalesComprobante;
  formaPago?: "Contado" | "Credito";
  fechaVencimiento?: string;
  /**
   * Observación libre visible en el PDF y enviada en el XML como cbc:Note.
   * Factura/boleta: nota libre sin languageLocaleID, máximo 200 caracteres.
   * No se usa en Nota de Crédito: la NC conserva su motivo/sustento legal.
   */
  observacionComprobante?: string | null;
  leyendas?: { codigo: string; valor: string }[];
  documentoReferencia?: {
    tipoComprobante: TipoComprobante;
    serie: string;
    numero: number;
    tipoNotaCredito?: TipoNotaCredito;
    tipoNotaDebito?: TipoNotaDebito;
    motivo: string;
  };
}

/** Resultado de la emisión a SUNAT */
export interface ResultadoEmision {
  exito: boolean;
  codigoRespuesta?: string;
  descripcion?: string;
  hashCpe?: string;
  cdrBase64?: string;
  xmlFirmadoBase64?: string;
  ticket?: string;
  observaciones?: string[];
  estado: EstadoSunat;
  /** Serie-Número del comprobante emitido (ej. F001-00000001). Lo agrega el
   * caller que orquesta el flujo (`emitirComprobante` en index.ts). El
   * soap-client puro no lo conoce. */
  serieNumero?: string;
  /** Importe TOTAL emitido (== cbc:PayableAmount del XML). Lo agrega
   * `emitirComprobante`. El caller lo usa como monto de la cobranza para que la
   * deuda coincida EXACTO con el comprobante legal (no con el bruto crudo). */
  total?: number;
  error?: string;
  mensaje?: string;
  /** true si el fallo fue porque SUNAT está caído/no disponible (NO un rechazo de
   * datos). El front muestra un aviso amigable + sugerencia de emisión manual. */
  sunatCaido?: boolean;
}

/** Datos para resumen diario de boletas (RC-) */
export interface DatosResumenDiario {
  fechaEmision: string;
  fechaReferencia: string;
  correlativo: number;
  items: ResumenDiarioItem[];
}

export interface ResumenDiarioItem {
  tipoComprobante: TipoComprobante;
  serie: string;
  numeroInicio: number;
  numeroFin: number;
  tipoDocumentoCliente: TipoDocumentoIdentidad;
  numDocumentoCliente: string;
  estadoItem: "1" | "2" | "3";
  totalGravadas: number;
  totalExoneradas: number;
  totalInafectas: number;
  totalIGV: number;
  totalISC: number;
  totalOtrosCargos: number;
  importeTotal: number;
  moneda: string;
}

/** Datos para comunicación de baja (RA-) */
export interface DatosComunicacionBaja {
  fechaEmision: string;
  fechaReferencia: string;
  correlativo: number;
  items: {
    tipoComprobante: TipoComprobante;
    serie: string;
    numero: number;
    motivo: string;
  }[];
}

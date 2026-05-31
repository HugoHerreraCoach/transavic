// src/lib/sunat/config-transavic.ts
// Configuración multi-empresa SUNAT para Transavic + Avícola de Tony.
// Portado de conexipema-eventos/src/lib/sunat/sunat-config.ts y adaptado a:
//   - EmpresaId = "transavic" | "avicola"
//   - Prefijos env vars SUNAT_TRA_* y SUNAT_AVI_*

import type { EmpresaId } from "./types";
export type { EmpresaId } from "./types"; // re-export para que pdf-comprobante.ts lo importe desde acá

/** SUNAT Environment */
export type SunatEnvironment = "beta" | "production";

/** SUNAT SOAP Endpoints (oficiales) */
const SUNAT_ENDPOINTS = {
  beta: {
    factura: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService?wsdl",
    guia: "https://e-beta.sunat.gob.pe/ol-ti-itemision-guia-gem-beta/billService?wsdl",
    consultaCdr: "https://e-beta.sunat.gob.pe/ol-it-wsconscpegem-beta/billConsultService?wsdl",
  },
  production: {
    factura: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService?wsdl",
    guia: "https://e-factura.sunat.gob.pe/ol-ti-itemision-guia-gem/billService?wsdl",
    consultaCdr: "https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService?wsdl",
  },
} as const;

/** Datos fijos de cada empresa emisora */
interface DatosEmisor {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  codigoPais: string;
}

/** Mapa de datos por defecto (override con env vars). */
export const DATOS_EMISOR_MAP: Record<EmpresaId, DatosEmisor> = {
  transavic: {
    // Valores placeholder — se sobrescriben con env vars SUNAT_TRA_*
    ruc: "20XXXXXXXXX",
    razonSocial: "TRANSAVIC SAC",
    nombreComercial: "Transavic",
    direccion: "Av. Ejemplo 123 La Victoria",
    ubigeo: "150115",
    departamento: "LIMA",
    provincia: "LIMA",
    distrito: "LA VICTORIA",
    codigoPais: "PE",
  },
  avicola: {
    ruc: "20YYYYYYYYY",
    razonSocial: "AVICOLA DE TONY SAC",
    nombreComercial: "Avícola de Tony",
    direccion: "",
    ubigeo: "150115",
    departamento: "LIMA",
    provincia: "LIMA",
    distrito: "LA VICTORIA",
    codigoPais: "PE",
  },
} as const;

/** Empresa por defecto */
export const EMPRESA_DEFAULT: EmpresaId = "transavic";

/** Prefijos de variables de entorno por empresa */
const ENV_PREFIX_MAP: Record<EmpresaId, string> = {
  transavic: "SUNAT_TRA",
  avicola: "SUNAT_AVI",
};

/** Catálogos SUNAT fijos (idénticos al módulo de conexipema) */
export const CATALOGO = {
  MONEDA: {
    SOLES: "PEN",
    DOLARES: "USD",
  },
  UNIDAD_MEDIDA: {
    UNIDAD: "NIU",
    SERVICIO: "ZZ",
    KILOGRAMO: "KGM",
    LITRO: "LTR",
  },
  IGV_PORCENTAJE: 18,
  /** Código UNSPSC para alimentos perecederos (Catálogo N° 25) */
  CODIGO_PRODUCTO_DEFAULT: "10101501", // "Aves vivas" — Antonio puede override por item
  IGV: {
    id: "1000",
    nombre: "IGV",
    codigoInternacional: "VAT",
  },
  UBL_VERSION: "2.1",
  CUSTOMIZATION_ID: "2.0",
} as const;

/** Configuración completa de SUNAT (consumida por xml-builder, xml-signer, soap-client) */
export interface SunatConfig {
  environment: SunatEnvironment;
  empresa: EmpresaId;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  urbanizacion: string;
  codigoPais: string;
  solUser: string;
  solPassword: string;
  certificatePath: string;
  certificatePassword: string;
  certificateBase64: string;
  endpoints: { factura: string; guia: string; consultaCdr: string };
}

/** Forma "vieja" de config (retrocompatible con stub anterior) */
export interface ConfigEmpresa {
  empresa: EmpresaId;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccionFiscal: string;
  ubigeo: string;
  solUser: string;
  solPassword: string;
  certificatePassword: string;
  certificateBase64: string;
}

/**
 * Obtiene la configuración completa de SUNAT para una empresa.
 * Lee env vars con prefijo SUNAT_TRA_* o SUNAT_AVI_* según corresponda.
 */
export function getSunatConfig(empresa: EmpresaId = EMPRESA_DEFAULT): SunatConfig {
  const environment = (process.env.SUNAT_ENVIRONMENT || "beta") as SunatEnvironment;
  const isBeta = environment === "beta";
  const emisor = DATOS_EMISOR_MAP[empresa];
  const prefix = ENV_PREFIX_MAP[empresa];

  const ruc = process.env[`${prefix}_RUC`] || emisor.ruc;
  const razonSocial = process.env[`${prefix}_RAZON_SOCIAL`] || emisor.razonSocial;
  const direccion = process.env[`${prefix}_DIRECCION`] || emisor.direccion;
  const ubigeo = process.env[`${prefix}_UBIGEO`] || emisor.ubigeo;
  // Datos descriptivos del domicilio fiscal — también configurables por env
  // (el default del MAP es un placeholder "LA VICTORIA"; en producción se
  // sobrescriben con la dirección real de cada empresa).
  const nombreComercial =
    process.env[`${prefix}_NOMBRE_COMERCIAL`] || emisor.nombreComercial;
  const departamento = process.env[`${prefix}_DEPARTAMENTO`] || emisor.departamento;
  const provincia = process.env[`${prefix}_PROVINCIA`] || emisor.provincia;
  const distrito = process.env[`${prefix}_DISTRITO`] || emisor.distrito;
  // Urbanización del domicilio fiscal (CitySubdivisionName). Vacía por defecto:
  // si no hay urbanización, el XML OMITE el campo (un CitySubdivisionName VACÍO
  // dispara la observación SUNAT 4095). Configurable por SUNAT_*_URBANIZACION.
  const urbanizacion = process.env[`${prefix}_URBANIZACION`] || "";

  const solUser = process.env[`${prefix}_SOL_USER`] || (isBeta ? "MODDATOS" : "");
  const solPassword = process.env[`${prefix}_SOL_PASSWORD`] || (isBeta ? "moddatos" : "");

  if (!isBeta && (!solUser || !solPassword)) {
    throw new Error(
      `${prefix}_SOL_USER y ${prefix}_SOL_PASSWORD son obligatorios en producción para ${razonSocial}`
    );
  }

  return {
    environment,
    empresa,
    ruc,
    razonSocial,
    nombreComercial,
    direccion,
    ubigeo,
    departamento,
    provincia,
    distrito,
    urbanizacion,
    codigoPais: emisor.codigoPais,
    solUser,
    solPassword,
    certificatePath: "",
    certificatePassword: process.env[`${prefix}_CERT_PASS`] || "",
    certificateBase64: process.env[`${prefix}_CERT_B64`] || "",
    endpoints: SUNAT_ENDPOINTS[environment],
  };
}

/** Versión legacy del config (retrocompatible con stub anterior) */
export function getEmpresaConfig(empresa: EmpresaId): ConfigEmpresa {
  const c = getSunatConfig(empresa);
  return {
    empresa: c.empresa,
    ruc: c.ruc,
    razonSocial: c.razonSocial,
    nombreComercial: c.nombreComercial,
    direccionFiscal: c.direccion,
    ubigeo: c.ubigeo,
    solUser: c.solUser,
    solPassword: c.solPassword,
    certificatePassword: c.certificatePassword,
    certificateBase64: c.certificateBase64,
  };
}

/**
 * Mapea el nombre de empresa que viene en pedidos (texto libre)
 * al ID interno del módulo SUNAT.
 *
 * ⚠️ BUG HISTÓRICO RESUELTO: la versión anterior usaba `includes("av")`,
 * pero "Transavic" CONTIENE "av" (tr-AV-ic) → siempre devolvía "avicola".
 * Eso significaba que TODA factura de Transavic se emitía contra el RUC
 * de Avícola de Tony. Usamos comparación exacta.
 */
export function empresaFromPedidoString(empresaPedido: string): EmpresaId {
  const norm = empresaPedido.trim().toLowerCase();
  // Match SOLO si empieza con "av" (cubre "Avícola de Tony", "AVICOLA", "Avícola...").
  // NO usar `.includes("av")` porque "trAVic" también contiene "av".
  // NO usar `.includes("avic")` porque "trANSAVIC" también lo contiene.
  if (norm.startsWith("av")) return "avicola";
  return "transavic";
}

/**
 * Inverso de empresaFromPedidoString: convierte el ID interno al nombre
 * amigable para mostrar al usuario.
 *
 *   "transavic" → "Transavic"
 *   "avicola"   → "Avícola de Tony"
 */
export function empresaLabel(empresa: EmpresaId | string): string {
  if (empresa === "avicola") return "Avícola de Tony";
  if (empresa === "transavic") return "Transavic";
  return empresa; // fallback al string crudo
}

// ════════════════════════════════════════════════════════════════════════
// Helpers de formato (idénticos al módulo de conexipema)
// ════════════════════════════════════════════════════════════════════════

/**
 * Formatea el número de comprobante con ceros a la izquierda
 * Ej: 1 → "00000001"
 */
export function formatNumero(numero: number): string {
  return numero.toString().padStart(8, "0");
}

/**
 * Genera el nombre del archivo XML según convención SUNAT
 * Formato: {RUC}-{TipoDoc}-{Serie}-{Numero}
 * Ej: 20XXXXXXXXX-01-F001-00000001
 */
export function generarNombreArchivo(
  ruc: string,
  tipoDoc: string,
  serie: string,
  numero: number
): string {
  return `${ruc}-${tipoDoc}-${serie}-${formatNumero(numero)}`;
}

/** Nombre archivo resumen diario (boletas): {RUC}-RC-{YYYYMMDD}-{Correlativo} */
export function generarNombreResumen(
  ruc: string,
  fecha: string,
  correlativo: number
): string {
  const fechaSinGuiones = fecha.replace(/-/g, "");
  return `${ruc}-RC-${fechaSinGuiones}-${correlativo.toString().padStart(5, "0")}`;
}

/** Nombre archivo comunicación de baja: {RUC}-RA-{YYYYMMDD}-{Correlativo} */
export function generarNombreBaja(
  ruc: string,
  fecha: string,
  correlativo: number
): string {
  const fechaSinGuiones = fecha.replace(/-/g, "");
  return `${ruc}-RA-${fechaSinGuiones}-${correlativo.toString().padStart(5, "0")}`;
}

/**
 * Convierte un monto numérico a texto en español para la leyenda
 * Ej: 118.00 → "CIENTO DIECIOCHO CON 00/100 SOLES"
 */
export function montoATexto(monto: number, moneda: string = "PEN"): string {
  const nombreMoneda = moneda === "PEN" ? "SOLES" : "DÓLARES AMERICANOS";
  const entero = Math.floor(monto);
  const centavos = Math.round((monto - entero) * 100);
  const centavosStr = centavos.toString().padStart(2, "0");

  return `${numeroATexto(entero)} CON ${centavosStr}/100 ${nombreMoneda}`;
}

/** Convierte un número entero a texto en español */
function numeroATexto(num: number): string {
  if (num === 0) return "CERO";

  const unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const decenas = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const especiales = ["ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE"];
  const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

  const partes: string[] = [];

  if (num >= 1000000) {
    const millones = Math.floor(num / 1000000);
    if (millones === 1) {
      partes.push("UN MILLÓN");
    } else {
      partes.push(numeroATexto(millones) + " MILLONES");
    }
    num %= 1000000;
  }

  if (num >= 1000) {
    const miles = Math.floor(num / 1000);
    if (miles === 1) {
      partes.push("MIL");
    } else {
      partes.push(numeroATexto(miles) + " MIL");
    }
    num %= 1000;
  }

  if (num >= 100) {
    if (num === 100) {
      partes.push("CIEN");
      num = 0;
    } else {
      partes.push(centenas[Math.floor(num / 100)]);
      num %= 100;
    }
  }

  if (num >= 11 && num <= 15) {
    partes.push(especiales[num - 11]);
    num = 0;
  } else if (num >= 10) {
    if (num === 10) {
      partes.push("DIEZ");
    } else if (num >= 21 && num <= 29) {
      partes.push("VEINTI" + unidades[num - 20]);
    } else {
      const d = Math.floor(num / 10);
      const u = num % 10;
      if (u === 0) {
        partes.push(decenas[d]);
      } else {
        partes.push(decenas[d] + " Y " + unidades[u]);
      }
    }
    num = 0;
  }

  if (num > 0 && num < 10) {
    partes.push(unidades[num]);
  }

  return partes.join(" ");
}

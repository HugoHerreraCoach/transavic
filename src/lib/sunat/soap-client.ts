// ============================================================
// SUNAT SOAP Client - Direct HTTP Communication
// ============================================================
// Uses direct HTTP POST instead of WSDL-based soap library
// to avoid authentication issues with SUNAT's WSDL endpoints.
// ============================================================

import { unzipSync, strFromU8 } from "fflate";
import { SunatConfig, generarNombreArchivo } from "./config-transavic";
import { ResultadoEmision, EstadoSunat } from "./types";
import { decodeEntidadesXml } from "./mensajes-amigables";
// archiver@7 es CJS. Para evitar bugs de bundling con webpack, lo cargamos
// con createRequire (ESM-safe require) y `serverExternalPackages` en next.config.ts.
import { createRequire } from "module";
const requireCjs = createRequire(import.meta.url);
type ArchiverFactory = (
  format: string,
  opts?: { zlib?: { level: number } }
) => import("archiver").Archiver;
const archiver: ArchiverFactory = requireCjs("archiver");

/**
 * Comprime el XML en un archivo ZIP (requerido por SUNAT).
 *
 * NOTA: usamos archiver@7 (no @8). La v8 cambió a ESM-only y la API ya no es
 * `archiver("zip", opts)` sino `new ZipArchive(opts)`. Mantener pin en v7.
 * Listado en `next.config.ts:serverExternalPackages` para que webpack no lo
 * mal-bundlee.
 */
async function comprimirXML(xml: string, nombreArchivo: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    archive.append(xml, { name: `${nombreArchivo}.xml` });
    archive.finalize();
  });
}

/**
 * Descomprime el ZIP del CDR (constancia) de SUNAT y devuelve su XML.
 *
 * SUNAT entrega un ZIP con "data descriptor" (compressedSize=0 en el header
 * local). El parser PKZip manual anterior NO lo leía → devolvía crudo/vacío →
 * `parsearRespuestaCDR` no hallaba el ResponseCode → la clasificación caía a
 * "aceptado" por defecto. Ese fue el bug que marcó como ACEPTADAS 5 notas de
 * crédito que SUNAT RECHAZÓ (3286), jun 2026. `fflate.unzipSync` lee el central
 * directory (igual que python/zipfile) y maneja el data descriptor sin problema.
 *
 * Devuelve `{ xml, ok }`. **`ok=false` significa que NO se pudo leer la
 * constancia** — el caller NUNCA debe asumir ACEPTADA en ese caso (debe quedar
 * ERROR para revisión). Jamás se devuelve el base64 crudo disfrazado de XML.
 */
export function descomprimirCDR(zipBase64: string): { xml: string; ok: boolean } {
  try {
    const files = unzipSync(new Uint8Array(Buffer.from(zipBase64, "base64")));
    // SUNAT mete una carpeta vacía "dummy/" + el CDR real "R-<ruc>-<tipo>-<serie>.xml".
    const nombre =
      Object.keys(files).find((n) => /(^|\/)R-.*\.xml$/i.test(n)) ??
      Object.keys(files).find((n) => n.toLowerCase().endsWith(".xml"));
    if (nombre && files[nombre]?.length) {
      const xml = strFromU8(files[nombre]);
      if (xml.includes("ApplicationResponse") || xml.includes("ResponseCode")) {
        return { xml, ok: true };
      }
    }
    console.error("[CDR] ZIP sin XML de constancia reconocible.");
    return { xml: "", ok: false };
  } catch (e) {
    console.error("[CDR] descompresión falló:", (e as Error).message);
    return { xml: "", ok: false };
  }
}

/**
 * Parsea la respuesta CDR de SUNAT para extraer código y descripción
 */
export function parsearRespuestaCDR(cdrXml: string): {
  codigo: string;
  descripcion: string;
  observaciones: string[];
} {
  const codigoMatch = cdrXml.match(/<cbc:ResponseCode[^>]*>(\d+)<\/cbc:ResponseCode>/);
  const descripcionMatch = cdrXml.match(/<cbc:Description[^>]*>([^<]+)<\/cbc:Description>/);

  const observaciones: string[] = [];
  const notasRegex = /<cbc:Note[^>]*>([^<]+)<\/cbc:Note>/g;
  let match;
  while ((match = notasRegex.exec(cdrXml)) !== null) {
    observaciones.push(match[1]);
  }

  return {
    codigo: codigoMatch?.[1] || "",
    descripcion: descripcionMatch?.[1] || "",
    observaciones,
  };
}

/**
 * Genera el bloque WS-Security UsernameToken para el SOAP Header.
 * Método estándar de autenticación de SUNAT (usado también por Greenter).
 *
 * ⚠️ SEGURIDAD CRÍTICA: el envelope resultante contiene `solPassword` en
 * texto plano dentro de `<wsse:Password>`. NUNCA loguear el envelope
 * completo. Si necesitas debug del envelope, usar `redactarEnvelopeParaLog()`
 * que reemplaza el password antes del log.
 */
function buildWsSecurityHeader(config: SunatConfig): string {
  return `<soapenv:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${config.ruc}${config.solUser}</wsse:Username>
        <wsse:Password>${config.solPassword}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>`;
}

/**
 * Redacta el password en un envelope SOAP antes de loguearlo.
 * Reemplaza `<wsse:Password>...</wsse:Password>` con `<wsse:Password>***REDACTED***</wsse:Password>`.
 *
 * Usar SIEMPRE que se quiera loguear un envelope para debug.
 */
export function redactarEnvelopeParaLog(envelope: string): string {
  return envelope.replace(
    /<wsse:Password[^>]*>[^<]*<\/wsse:Password>/g,
    "<wsse:Password>***REDACTED***</wsse:Password>"
  );
}

/**
 * Construye el sobre SOAP para sendBill (con WS-Security)
 */
function buildSendBillEnvelope(fileName: string, contentFile: string, config: SunatConfig): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  ${buildWsSecurityHeader(config)}
  <soapenv:Body>
    <ser:sendBill>
      <fileName>${fileName}</fileName>
      <contentFile>${contentFile}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Construye el sobre SOAP para sendSummary (con WS-Security)
 */
function buildSendSummaryEnvelope(fileName: string, contentFile: string, config: SunatConfig): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  ${buildWsSecurityHeader(config)}
  <soapenv:Body>
    <ser:sendSummary>
      <fileName>${fileName}</fileName>
      <contentFile>${contentFile}</contentFile>
    </ser:sendSummary>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Construye el sobre SOAP para getStatus (con WS-Security)
 */
function buildGetStatusEnvelope(ticket: string, config: SunatConfig): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  ${buildWsSecurityHeader(config)}
  <soapenv:Body>
    <ser:getStatus>
      <ticket>${ticket}</ticket>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Clasifica un SOAP Fault de SUNAT para dar mensajes claros al usuario.
 * Retorna un prefijo de tipo de error + mensaje amigable.
 */
function clasificarErrorSunat(faultCode: string | null, faultString: string): {
  tipo: "SUNAT_SERVIDOR" | "SUNAT_PERMISOS" | "SUNAT_VALIDACION" | "SUNAT_ERROR";
  mensajeUsuario: string;
  mensajeTecnico: string;
} {
  const code = faultCode?.toLowerCase() || "";
  const msg = faultString.toLowerCase();

  // Error 0111 con "Rejected by policy" = Gateway de SUNAT caído
  if (code.includes("0111") && msg.includes("rejected by policy")) {
    return {
      tipo: "SUNAT_SERVIDOR",
      mensajeUsuario: "SUNAT no está disponible en este momento. Sus servidores están presentando intermitencias. Por favor intenta de nuevo en unos minutos.",
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // "El sistema no puede responder su solicitud" / "El servicio de autenticación
  // no está disponible" = SUNAT caído (transitorio). NO es un rechazo de datos:
  // debe quedar como ERROR reintentable, no como RECHAZADA (caso F001-78, 10 jun 2026).
  // Guard: si el faultcode trae un código de validación real (2xxx-4xxx), ese
  // diagnóstico manda — no lo enmascaramos con el patrón amplio de "no disponible".
  const codigoValidacion = parseInt(code.replace(/\D/g, ""));
  const esCodigoValidacion = codigoValidacion >= 2000 && codigoValidacion <= 4999;
  if (
    !esCodigoValidacion &&
    (msg.includes("no puede responder su solicitud") ||
      msg.includes("servicio de autenticaci") ||
      msg.includes("service unavailable") ||
      msg.includes("no está disponible") ||
      msg.includes("no esta disponible"))
  ) {
    return {
      tipo: "SUNAT_SERVIDOR",
      mensajeUsuario: "SUNAT no está disponible en este momento (es una caída de sus servidores, no del sistema). El comprobante NO se emitió. Intenta de nuevo en unos minutos.",
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // Error 0111 genérico (permisos del usuario SOL)
  if (code.includes("0111")) {
    return {
      tipo: "SUNAT_PERMISOS",
      mensajeUsuario: "SUNAT rechazó las credenciales. Puede ser una caída temporal del servidor o un problema de permisos del usuario SOL. Intenta de nuevo en unos minutos y si persiste, verifica los permisos de APIFACTU en el portal de SUNAT.",
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // Error 0112 - Usuario debe ser secundario
  if (code.includes("0112")) {
    return {
      tipo: "SUNAT_PERMISOS",
      mensajeUsuario: "El usuario SOL debe ser un usuario secundario. Verifica la configuración en el portal de SUNAT.",
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // Error 0113 - No afiliado
  if (code.includes("0113")) {
    return {
      tipo: "SUNAT_PERMISOS",
      mensajeUsuario: "El usuario no está afiliado al servicio de Factura Electrónica. Activa la opción 'SEE - Del Contribuyente' en el portal de SUNAT.",
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // Errores de validación (2xxx, 3xxx, 4xxx en faultcode)
  const codeNum = parseInt(code.replace(/\D/g, ""));
  if (codeNum >= 2000 && codeNum <= 4999) {
    return {
      tipo: "SUNAT_VALIDACION",
      mensajeUsuario: `SUNAT rechazó el comprobante: ${faultString}`,
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // Timeout / conexión
  if (msg.includes("timeout") || msg.includes("time-out") || msg.includes("connection")) {
    return {
      tipo: "SUNAT_SERVIDOR",
      mensajeUsuario: "No se pudo conectar con SUNAT (timeout). Sus servidores pueden estar saturados. Intenta de nuevo en unos minutos.",
      mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
    };
  }

  // Error genérico
  return {
    tipo: "SUNAT_ERROR",
    mensajeUsuario: `Error de SUNAT: ${faultString}`,
    mensajeTecnico: `SOAP Fault ${faultCode}: ${faultString}`,
  };
}

/**
 * Envía una petición SOAP directa a SUNAT via HTTP POST
 * Autenticación: WS-Security UsernameToken en SOAP Header (NO Basic Auth HTTP)
 */
async function soapRequest(
  url: string,
  soapAction: string,
  envelope: string,
  config: SunatConfig
): Promise<string> {
  // Remove ?wsdl from URL to get the service endpoint
  const serviceUrl = url.replace("?wsdl", "");

  console.log(`[SUNAT] ${soapAction} → ${serviceUrl} (${config.environment})`);

  // NO Authorization header - authentication is via WS-Security in SOAP envelope
  const response = await fetch(serviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
      "SOAPAction": `"${soapAction}"`,
    },
    body: envelope,
  });

  const responseBody = await response.text();

  // SUNAT returns SOAP Faults with HTTP 500 - that's normal SOAP behavior
  // Only throw for non-SOAP error responses (e.g., 401, 403, HTML errors)
  if (!response.ok && !responseBody.includes("soap-env:Envelope") && !responseBody.includes("soap:Envelope")) {
    throw new Error(
      `SUNAT HTTP ${response.status}: ${responseBody.substring(0, 300)}`
    );
  }

  console.log(`[SUNAT] Response: ${response.status}`);

  return responseBody;
}

/**
 * Extrae el valor de un tag XML de la respuesta SOAP
 */
function extractSoapValue(xml: string, tagName: string): string | null {
  // Handle namespaced and non-namespaced tags
  const patterns = [
    new RegExp(`<${tagName}>([^<]*)</${tagName}>`),
    new RegExp(`<[^:]+:${tagName}>([^<]*)</[^:]+:${tagName}>`),
    new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s"),
  ];

  for (const pattern of patterns) {
    const match = xml.match(pattern);
    // SUNAT escapa los acentos como entidades XML (&#243;) en los faultstring.
    // Decodificar aquí cubre todos los caminos (sendBill/sendSummary/getStatus);
    // es inofensivo para el base64 del CDR, que no contiene '&'.
    if (match?.[1]) return decodeEntidadesXml(match[1]);
  }
  return null;
}

/**
 * Envía un comprobante (Factura o Boleta individual) a SUNAT
 * Usa el método SOAP: sendBill via HTTP POST directo
 */
export async function enviarComprobante(
  xmlFirmado: string,
  tipoDoc: string,
  serie: string,
  numero: number,
  config: SunatConfig
): Promise<ResultadoEmision> {
  try {
    const nombreArchivo = generarNombreArchivo(config.ruc, tipoDoc, serie, numero);
    const zipBuffer = await comprimirXML(xmlFirmado, nombreArchivo);
    const zipBase64 = zipBuffer.toString("base64");

    const envelope = buildSendBillEnvelope(`${nombreArchivo}.zip`, zipBase64, config);

    const endpointUrl = tipoDoc === "09" ? config.endpoints.guia : config.endpoints.factura;
    const responseXml = await soapRequest(
      endpointUrl,
      "urn:sendBill",
      envelope,
      config
    );

    // Check for SOAP Fault first
    const faultString = extractSoapValue(responseXml, "faultstring");
    const faultCode = extractSoapValue(responseXml, "faultcode");
    if (faultString) {
      const errorInfo = clasificarErrorSunat(faultCode, faultString);
      console.error(`[SUNAT] ${errorInfo.tipo}:`, errorInfo.mensajeTecnico);

      // Extract numeric code from faultcode (e.g., "soap:Client.1032" → "1032")
      const numericCode = faultCode?.replace(/\D/g, "") || "";
      const esCaido = errorInfo.tipo === "SUNAT_SERVIDOR";

      return {
        exito: false,
        // SUNAT caído ≠ rechazo de datos: lo marcamos ERROR (reintentable), no RECHAZADA.
        estado: esCaido ? EstadoSunat.ERROR : EstadoSunat.RECHAZADA,
        sunatCaido: esCaido || undefined,
        codigoRespuesta: numericCode || undefined,
        descripcion: faultString,
        error: `[${errorInfo.tipo}] ${errorInfo.mensajeUsuario}`,
        xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
      };
    }

    // Extraer applicationResponse del SOAP response
    const appResponse = extractSoapValue(responseXml, "applicationResponse");

    if (appResponse) {
      const { xml: cdrXml, ok } = descomprimirCDR(appResponse);

      // FAIL-SAFE: si no se pudo leer la constancia (CDR), NO clasificamos por
      // código → queda ERROR (revisar/reintentar), NUNCA ACEPTADA. Bug jun 2026:
      // el CDR ilegible se colaba como "aceptado" (5 NC rechazadas mostradas OK).
      if (!ok) {
        return {
          exito: false,
          estado: EstadoSunat.ERROR,
          codigoRespuesta: "",
          descripcion: "No se pudo leer la constancia (CDR) de SUNAT. Requiere revisión manual.",
          error: "CDR_ILEGIBLE: la respuesta de SUNAT no se pudo descomprimir/parsear.",
          cdrBase64: appResponse,
          xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
        };
      }

      const { codigo, descripcion, observaciones } = parsearRespuestaCDR(cdrXml);

      // El código DEBE ser un entero válido antes de aplicar rangos. Si no lo es,
      // NO se asume aceptado: queda ERROR. (`parseInt("")`=NaN caía al `else`→
      // ACEPTADA — el corazón del bug.)
      const codigoNum = Number(codigo);
      const codigoValido =
        codigo !== "" && Number.isInteger(codigoNum) && codigoNum >= 0;

      let estado: EstadoSunat;
      if (!codigoValido) {
        estado = EstadoSunat.ERROR;
      } else if (codigoNum === 0) {
        estado =
          observaciones.length > 0
            ? EstadoSunat.ACEPTADA_CON_OBSERVACIONES
            : EstadoSunat.ACEPTADA;
      } else if (codigoNum >= 100 && codigoNum <= 3999) {
        estado = EstadoSunat.RECHAZADA; // 100-3999 = rechazo (incluye 3286)
      } else if (codigoNum >= 4000) {
        estado = EstadoSunat.ACEPTADA_CON_OBSERVACIONES;
      } else {
        estado = EstadoSunat.ERROR; // 1-99: rango no estándar → indeterminado
      }

      // Persistir SIEMPRE código+descripción (también en aceptados) → un aceptado
      // real tendrá "0: …ha sido aceptada" en mensaje_sunat (señal de salud).
      const mensajeSunat = codigoValido ? `${codigo}: ${descripcion}`.trim() : descripcion || "";

      return {
        exito: estado === EstadoSunat.ACEPTADA || estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES,
        codigoRespuesta: codigo,
        descripcion: mensajeSunat,
        hashCpe: "",
        cdrBase64: appResponse,
        xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
        estado,
        observaciones,
      };
    }

    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      error: "No se recibió respuesta de SUNAT",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Error desconocido";
    // Errores de red/timeout/HTTP 5xx = SUNAT no responde (caído), NO un rechazo
    // de datos. Lo marcamos para avisar amigable y sugerir emisión manual.
    const esCaido =
      /timeout|time-?out|fetch failed|econnrefused|enotfound|socket|getaddrinfo|network|terminated|und_err|http 5\d\d/i.test(
        errorMsg
      );
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      sunatCaido: esCaido || undefined,
      error: esCaido
        ? "SUNAT no está respondiendo (es un problema de sus servidores, no del sistema). El comprobante NO se emitió."
        : `Error al enviar comprobante: ${errorMsg}`,
    };
  }
}

/**
 * Envía un resumen diario o comunicación de baja a SUNAT
 * Usa el método SOAP: sendSummary
 */
export async function enviarResumen(
  xmlFirmado: string,
  nombreArchivo: string,
  config: SunatConfig
): Promise<ResultadoEmision> {
  try {
    const zipBuffer = await comprimirXML(xmlFirmado, nombreArchivo);
    const zipBase64 = zipBuffer.toString("base64");

    const envelope = buildSendSummaryEnvelope(`${nombreArchivo}.zip`, zipBase64, config);

    const responseXml = await soapRequest(
      config.endpoints.factura,
      "urn:sendSummary",
      envelope,
      config
    );

    const ticket = extractSoapValue(responseXml, "ticket");

    if (ticket) {
      return {
        exito: true,
        ticket,
        estado: EstadoSunat.PENDIENTE,
        xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
      };
    }

    const faultString = extractSoapValue(responseXml, "faultstring");
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      error: faultString || "No se recibió ticket de SUNAT",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Error desconocido";
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      error: `Error al enviar resumen: ${errorMsg}`,
    };
  }
}

/**
 * Consulta el estado de un ticket (para resúmenes y comunicaciones de baja)
 * Usa el método SOAP: getStatus
 */
export async function consultarTicket(
  ticket: string,
  config: SunatConfig
): Promise<ResultadoEmision> {
  try {
    const envelope = buildGetStatusEnvelope(ticket, config);

    const responseXml = await soapRequest(
      config.endpoints.factura,
      "urn:getStatus",
      envelope,
      config
    );

    const statusCode = extractSoapValue(responseXml, "statusCode");
    const content = extractSoapValue(responseXml, "content");

    if (statusCode === "0" && content) {
      const { xml: cdrXml, ok } = descomprimirCDR(content);
      // FAIL-SAFE: statusCode 0 NO garantiza aceptación — hay que leer el
      // ResponseCode del CDR. Si no se puede leer, ERROR (no asumir ACEPTADA).
      if (!ok) {
        return {
          exito: false,
          estado: EstadoSunat.ERROR,
          descripcion: "No se pudo leer la constancia (CDR) de SUNAT. Requiere revisión manual.",
          cdrBase64: content,
          ticket,
        };
      }
      const { codigo, descripcion, observaciones } = parsearRespuestaCDR(cdrXml);
      const codigoNum = Number(codigo);
      const codigoValido = codigo !== "" && Number.isInteger(codigoNum) && codigoNum >= 0;
      let estado: EstadoSunat;
      if (!codigoValido) estado = EstadoSunat.ERROR;
      else if (codigoNum === 0)
        estado = observaciones.length > 0 ? EstadoSunat.ACEPTADA_CON_OBSERVACIONES : EstadoSunat.ACEPTADA;
      else if (codigoNum >= 100 && codigoNum <= 3999) estado = EstadoSunat.RECHAZADA;
      else if (codigoNum >= 4000) estado = EstadoSunat.ACEPTADA_CON_OBSERVACIONES;
      else estado = EstadoSunat.ERROR;

      return {
        exito: estado === EstadoSunat.ACEPTADA || estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES,
        codigoRespuesta: codigo,
        descripcion: codigoValido ? `${codigo}: ${descripcion}`.trim() : descripcion,
        cdrBase64: content,
        estado,
        observaciones,
        ticket,
      };
    } else if (statusCode === "98") {
      return {
        exito: false,
        estado: EstadoSunat.PENDIENTE,
        descripcion: "En proceso. Reintentar en unos minutos.",
        ticket,
      };
    } else if (statusCode === "99") {
      const statusMessage = extractSoapValue(responseXml, "statusMessage");
      const content99 = extractSoapValue(responseXml, "content");
      
      let errorDetail = statusMessage || "Error en el procesamiento del resumen";
      
      // Try to parse CDR for detailed error
      if (content99) {
        try {
          const { xml: cdrXml } = descomprimirCDR(content99);
          const { codigo, descripcion, observaciones } = parsearRespuestaCDR(cdrXml);
          console.error("[SUNAT BAJA] CDR Code:", codigo, "Description:", descripcion);
          if (observaciones?.length) console.error("[SUNAT BAJA] Observaciones:", observaciones);
          errorDetail = `${codigo}: ${descripcion}${observaciones?.length ? ` | ${observaciones.join("; ")}` : ""}`;
        } catch (cdrErr) {
          console.error("[SUNAT BAJA] Error parsing CDR:", cdrErr);
        }
      }
      
      console.error("[SUNAT BAJA] Ticket RECHAZADO. statusCode=99, error:", errorDetail);
      return {
        exito: false,
        estado: EstadoSunat.RECHAZADA,
        error: errorDetail,
        ticket,
      };
    }

    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      error: "Respuesta inesperada de SUNAT",
      ticket,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Error desconocido";
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      error: `Error al consultar ticket: ${errorMsg}`,
      ticket,
    };
  }
}

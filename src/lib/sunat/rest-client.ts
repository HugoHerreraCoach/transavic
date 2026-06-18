// src/lib/sunat/rest-client.ts
// ============================================================
// SUNAT REST Client - Modern GRE (Guía de Remisión Electrónica) Communication
// ============================================================
// Since July 2023, SUNAT requires all Guías de Remisión Electrónica (CPE "09")
// to be emitted using their REST API instead of SOAP.
// ============================================================

import * as crypto from "crypto";
import { SunatConfig, generarNombreArchivo } from "./config-transavic";
import { ResultadoEmision, EstadoSunat } from "./types";
import { descomprimirCDR, parsearRespuestaCDR } from "./soap-client";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);
const archiver = requireCjs("archiver");

/**
 * Comprime el XML en un archivo ZIP.
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
 * Solicita el token de acceso OAuth 2.0 (grant_type=password) para la API REST de la SUNAT.
 */
export async function solicitarTokenRest(config: SunatConfig): Promise<string> {
  const { clientId, clientSecret, ruc, solUser, solPassword } = config;

  if (!clientId || !clientSecret) {
    throw new Error(
      `Faltan credenciales API REST (Client ID / Client Secret) para la empresa. Por favor configúralas.`
    );
  }

  const username = `${ruc}${solUser}`;
  const password = solPassword;

  console.log(`[SUNAT REST] Solicitando token OAuth2 para RUC ${ruc} (${config.environment})`);

  const params = new URLSearchParams();
  params.append("grant_type", "password");
  params.append("scope", "https://api-cpe.sunat.gob.pe");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("username", username);
  params.append("password", password);

  const tokenUrl = `https://api-seguridad.sunat.gob.pe/v1/clientessol/${clientId}/oauth2/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error al solicitar token SUNAT REST (HTTP ${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Respuesta de token SUNAT REST no contiene access_token: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

/**
 * Envía una Guía de Remisión Electrónica (GRE) a la SUNAT a través del API REST.
 * Genera el ZIP, calcula el hash SHA-256 del ZIP, realiza el POST y consulta el ticket (polling).
 */
export async function enviarGuiaRest(
  xmlFirmado: string,
  serie: string,
  numero: number,
  config: SunatConfig
): Promise<ResultadoEmision> {
  try {
    const token = await solicitarTokenRest(config);

    const nombreArchivo = generarNombreArchivo(config.ruc, "09", serie, numero);
    const zipBuffer = await comprimirXML(xmlFirmado, nombreArchivo);
    const zipBase64 = zipBuffer.toString("base64");
    const hashZip = crypto.createHash("sha256").update(zipBuffer).digest("hex");

    const isBeta = config.environment === "beta";
    if (isBeta) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    const baseUrl = isBeta
      ? "https://api-cpe-test.sunat.gob.pe/v1/contribuyente/gem/comprobantes"
      : "https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes";

    const fileNameZip = `${nombreArchivo}.zip`;
    const sendUrl = `${baseUrl}/${nombreArchivo}`;

    console.log(`[SUNAT REST] Enviando GRE → ${sendUrl} (${config.environment})`);

    const response = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        archivo: {
          nomArchivo: fileNameZip,
          arcGreZip: zipBase64,
          hashZip: hashZip,
        },
      }),
    });

    const responseBody = await response.text();
    if (!response.ok) {
      console.error(`[SUNAT REST] Error de envío (${response.status}):`, responseBody);
      try {
        const errorJson = JSON.parse(responseBody);
        const errorCode = errorJson.codRespuesta || errorJson.error?.numError || "";
        const errorMsg = errorJson.error?.desError || errorJson.message || "Error desconocido en SUNAT REST";
        return {
          exito: false,
          estado: EstadoSunat.ERROR,
          codigoRespuesta: errorCode,
          descripcion: errorMsg,
          error: `[SUNAT REST ${response.status}] ${errorCode}: ${errorMsg}`,
          xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
        };
      } catch {
        return {
          exito: false,
          estado: EstadoSunat.ERROR,
          error: `SUNAT REST HTTP ${response.status}: ${responseBody.substring(0, 300)}`,
          xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
        };
      }
    }

    const data = JSON.parse(responseBody);
    const ticket = data.numTicket;

    if (!ticket) {
      console.error(`[SUNAT REST] No se recibió ticket. Respuesta:`, data);
      return {
        exito: false,
        estado: EstadoSunat.ERROR,
        error: `No se recibió número de ticket de SUNAT REST: ${responseBody}`,
        xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
      };
    }

    console.log(`[SUNAT REST] Envío exitoso. Ticket obtenido: ${ticket}`);

    // Consultar estado del ticket (Polling)
    return await consultarTicketRest(ticket, token, baseUrl, xmlFirmado);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Error desconocido";
    const esCaido = /timeout|time-?out|fetch failed|econnrefused|enotfound|socket|getaddrinfo|network|terminated|und_err|http 5\d\d/i.test(errorMsg);
    return {
      exito: false,
      estado: EstadoSunat.ERROR,
      sunatCaido: esCaido || undefined,
      error: esCaido
        ? "No se pudo conectar con los servidores REST de SUNAT. Intenta nuevamente en unos minutos."
        : `Error al emitir guía vía REST: ${errorMsg}`,
      xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
    };
  }
}

/**
 * Realiza el bucle de consulta (polling) para obtener el resultado de procesamiento del ticket.
 */
async function consultarTicketRest(
  ticket: string,
  token: string,
  baseUrl: string,
  xmlFirmado: string
): Promise<ResultadoEmision> {
  const pollUrl = `${baseUrl}/envios/${ticket}`;
  const maxRetries = 6;
  const delayMs = 2000;

  for (let i = 0; i < maxRetries; i++) {
    // Esperar antes de consultar
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    console.log(`[SUNAT REST] Polling ticket ${ticket} (intento ${i + 1}/${maxRetries})`);

    try {
      const response = await fetch(pollUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SUNAT REST] Error al consultar ticket (${response.status}):`, errorText);
        continue; // Reintentar en caso de fallo HTTP temporal
      }

      const data = await response.json();
      const codRespuesta = String(data.codRespuesta);

      if (codRespuesta === "0" && data.arcCdr) {
        // codRespuesta 0 = el ticket se procesó, pero hay que LEER el ResponseCode
        // del CDR para saber si aceptó o rechazó. Si no se puede leer → ERROR
        // (nunca asumir ACEPTADA — mismo fail-safe que soap-client).
        const { xml: cdrXml, ok } = descomprimirCDR(data.arcCdr);
        if (!ok) {
          return {
            exito: false,
            estado: EstadoSunat.ERROR,
            codigoRespuesta: "",
            descripcion: "No se pudo leer la constancia (CDR) de SUNAT. Requiere revisión manual.",
            error: "CDR_ILEGIBLE",
            cdrBase64: data.arcCdr,
            xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
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
          descripcion: (codigoValido ? `${codigo}: ${descripcion}` : descripcion) || data.message || "Guía procesada por SUNAT.",
          hashCpe: "",
          cdrBase64: data.arcCdr,
          xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
          estado,
          observaciones,
        };
      } else if (codRespuesta === "98") {
        // En proceso, continuar polling
        console.log(`[SUNAT REST] Ticket ${ticket} aún en proceso...`);
        continue;
      } else if (codRespuesta === "99") {
        // Procesamiento con error / rechazo
        const errorMsg = data.error?.desError || data.message || "Error en el procesamiento del ticket";
        const errorCode = data.error?.numError || codRespuesta;

        let observaciones: string[] = [];
        if (data.arcCdr) {
          try {
            const { xml: cdrXml } = descomprimirCDR(data.arcCdr);
            const parsed = parsearRespuestaCDR(cdrXml);
            observaciones = parsed.observaciones;
          } catch (cdrErr) {
            console.error("[SUNAT REST] Error al descomprimir CDR de rechazo:", cdrErr);
          }
        }

        return {
          exito: false,
          estado: EstadoSunat.RECHAZADA,
          codigoRespuesta: errorCode,
          descripcion: errorMsg,
          cdrBase64: data.arcCdr || undefined,
          observaciones: observaciones.length > 0 ? observaciones : undefined,
          xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
          error: `[SUNAT RECHAZADA] ${errorCode}: ${errorMsg}`,
        };
      }
    } catch (e) {
      console.error(`[SUNAT REST] Excepción en polling intento ${i + 1}:`, e);
    }
  }

  // Timeout reached sin respuesta definitiva
  return {
    exito: false,
    estado: EstadoSunat.PENDIENTE,
    ticket,
    error: "El servidor de la SUNAT está demorando en responder. El comprobante quedó registrado como PENDIENTE.",
    xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
  };
}

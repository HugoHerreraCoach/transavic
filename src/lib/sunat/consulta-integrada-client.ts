// Consulta Integrada de validez de CPE (API REST oficial de SUNAT).
//
// Se usa para boletas 03 porque billConsultService solo admite documentos con
// serie F (01/07/08). Este cliente NO comparte ni rota las credenciales OAuth
// de GRE: requiere una aplicacion de Consulta de Validez por cada RUC.

import type { SunatConfig } from "./config-transavic";
import { EstadoSunat, type ResultadoEmision } from "./types";

const SCOPE_CONSULTA =
  "https://api.sunat.gob.pe/v1/contribuyente/contribuyentes";
const TOKEN_TIMEOUT_MS = 8_000;
const CONSULTA_TIMEOUT_MS = 8_000;
const CODIGO_CONFIG_FALTANTE = "CFG_API03";

interface ConsultaIntegradaParams {
  ruc: string;
  tipo: string;
  serie: string;
  numero: number;
  fechaEmision?: string | Date;
  monto?: number;
}

interface TokenCache {
  token: string;
  expiraAt: number;
}

const tokens = new Map<string, TokenCache>();

function fechaDdMmYyyy(value: string | Date | undefined): string | null {
  if (!value) return null;
  const iso =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

function proximaConsultaIso(minutos = 15): string {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}

async function solicitarTokenConsulta(
  config: SunatConfig,
  forzar = false
): Promise<string> {
  const clientId = config.consultaClientId;
  const clientSecret = config.consultaClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(CODIGO_CONFIG_FALTANTE);
  }

  const cacheKey = `${config.empresa}:${clientId}`;
  const guardado = tokens.get(cacheKey);
  if (!forzar && guardado && guardado.expiraAt > Date.now() + 30_000) {
    return guardado.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: SCOPE_CONSULTA,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch(
    `https://api-seguridad.sunat.gob.pe/v1/clientesextranet/${encodeURIComponent(clientId)}/oauth2/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    }
  );
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // La respuesta HTTP se maneja abajo sin registrar secretos ni el body.
  }

  const token = typeof data.access_token === "string" ? data.access_token : "";
  if (!response.ok || !token) {
    const error =
      typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(`TOKEN_CONSULTA:${error}`);
  }

  const expiresIn = Number(data.expires_in);
  tokens.set(cacheKey, {
    token,
    expiraAt:
      Date.now() +
      (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300) * 1_000,
  });
  return token;
}

async function consultarConToken(
  config: SunatConfig,
  token: string,
  params: {
    ruc: string;
    tipo: string;
    serie: string;
    numero: number;
    fechaEmision: string;
    monto: number;
  }
): Promise<Response> {
  return fetch(
    `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/${encodeURIComponent(config.ruc)}/validarcomprobante`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        numRuc: params.ruc,
        codComp: params.tipo,
        numeroSerie: params.serie,
        numero: params.numero,
        fechaEmision: params.fechaEmision,
        monto: params.monto,
      }),
      signal: AbortSignal.timeout(CONSULTA_TIMEOUT_MS),
    }
  );
}

/**
 * Consulta una boleta 03 sin reenviar su XML ni consumir correlativos.
 * La API confirma existencia/aceptacion/baja, pero no entrega CDR ni un estado
 * de rechazo; un rechazo definitivo sigue proviniendo solo del CDR de sendBill.
 */
export async function consultarBoletaIntegrada(
  config: SunatConfig,
  cpe: ConsultaIntegradaParams
): Promise<ResultadoEmision> {
  const fechaEmision = fechaDdMmYyyy(cpe.fechaEmision);
  const monto = Number(cpe.monto);
  if (
    config.environment !== "production" ||
    cpe.tipo !== "03" ||
    !/^\d{11}$/.test(cpe.ruc) ||
    !/^B[A-Z0-9]{3}$/.test(cpe.serie) ||
    !Number.isInteger(cpe.numero) ||
    cpe.numero <= 0 ||
    !fechaEmision ||
    !Number.isFinite(monto) ||
    monto <= 0
  ) {
    return {
      exito: false,
      estado: EstadoSunat.POR_CONFIRMAR,
      error:
        "No se puede consultar la boleta porque faltan su fecha o monto legal. Requiere revision; no emitas otro comprobante.",
      codigoRespuesta: "DATOS_API",
      proximaConsultaAt: proximaConsultaIso(360),
      tieneCdr: false,
      requiereRevision: true,
    };
  }

  if (!config.consultaClientId || !config.consultaClientSecret) {
    return {
      exito: false,
      estado: EstadoSunat.POR_CONFIRMAR,
      codigoRespuesta: CODIGO_CONFIG_FALTANTE,
      error:
        "La consulta automatica de boletas aun no tiene credenciales SUNAT para esta empresa. El numero queda bloqueado y requiere configuracion del administrador.",
      proximaConsultaAt: proximaConsultaIso(360),
      tieneCdr: false,
      requiereRevision: true,
    };
  }

  try {
    let token = await solicitarTokenConsulta(config);
    let response = await consultarConToken(config, token, {
      ruc: cpe.ruc,
      tipo: cpe.tipo,
      serie: cpe.serie,
      numero: cpe.numero,
      fechaEmision,
      monto: Number(monto.toFixed(2)),
    });

    // Un token pudo vencer entre cold starts. Se renueva una sola vez.
    if (response.status === 401) {
      token = await solicitarTokenConsulta(config, true);
      response = await consultarConToken(config, token, {
        ruc: cpe.ruc,
        tipo: cpe.tipo,
        serie: cpe.serie,
        numero: cpe.numero,
        fechaEmision,
        monto: Number(monto.toFixed(2)),
      });
    }

    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Nunca se incluye el body crudo: podria contener detalles internos.
    }

    if (!response.ok) {
      const requiereRevision =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429;
      return {
        exito: false,
        estado: EstadoSunat.POR_CONFIRMAR,
        codigoRespuesta: requiereRevision
          ? "REV_API03"
          : `HTTP${response.status}`.slice(0, 10),
        error: requiereRevision
          ? "SUNAT no autorizo o no pudo validar los datos de consulta de la boleta. Requiere revision del administrador; no emitas otro comprobante."
          : "SUNAT no pudo completar la consulta de la boleta. El sistema volvera a verificar; no emitas otro comprobante.",
        sunatCaido: response.status >= 500 || undefined,
        proximaConsultaAt: proximaConsultaIso(requiereRevision ? 360 : 15),
        tieneCdr: false,
        requiereRevision,
      };
    }

    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const estadoCp = data?.estadoCp == null ? "" : String(data.estadoCp);
    const mensaje =
      typeof payload.message === "string"
        ? payload.message
        : "Consulta Integrada de SUNAT completada.";
    const verificadoAt = new Date().toISOString();

    if (estadoCp === "1") {
      return {
        exito: true,
        estado: EstadoSunat.ACEPTADA,
        codigoRespuesta: "1",
        descripcion: "SUNAT confirmo que la boleta esta aceptada.",
        verificadoAt,
        tieneCdr: false,
      };
    }
    if (estadoCp === "2") {
      return {
        exito: false,
        estado: EstadoSunat.ANULADA,
        codigoRespuesta: "2",
        descripcion: "SUNAT confirmo que la boleta fue dada de baja.",
        verificadoAt,
        tieneCdr: false,
      };
    }
    if (estadoCp === "0") {
      return {
        exito: false,
        estado: EstadoSunat.POR_CONFIRMAR,
        // Reutiliza la regla conservadora: dos evidencias separadas tras espera.
        codigoRespuesta: "0011",
        descripcion:
          "SUNAT aun no encuentra la boleta. Se verificara otra vez antes de permitir reenviar el mismo numero.",
        verificadoAt,
        proximaConsultaAt: proximaConsultaIso(),
        tieneCdr: false,
      };
    }

    return {
      exito: false,
      estado: EstadoSunat.POR_CONFIRMAR,
      codigoRespuesta: estadoCp ? `CP${estadoCp}` : "RESP_API",
      descripcion: mensaje,
      error:
        "SUNAT devolvio un estado que no corresponde a una boleta electronica. Requiere revision; no emitas otro comprobante.",
      proximaConsultaAt: proximaConsultaIso(360),
      tieneCdr: false,
      requiereRevision: true,
    };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    const configuracion =
      mensaje === CODIGO_CONFIG_FALTANTE ||
      mensaje.startsWith("TOKEN_CONSULTA:");
    return {
      exito: false,
      estado: EstadoSunat.POR_CONFIRMAR,
      codigoRespuesta: configuracion ? CODIGO_CONFIG_FALTANTE : undefined,
      error: configuracion
        ? "SUNAT no autorizo las credenciales de consulta de boletas para esta empresa. Requiere configuracion del administrador; no emitas otro comprobante."
        : "No se pudo consultar SUNAT en este momento. El sistema volvera a verificar; no emitas otro comprobante.",
      proximaConsultaAt: proximaConsultaIso(configuracion ? 360 : 15),
      tieneCdr: false,
      requiereRevision: configuracion,
      sunatCaido: configuracion ? undefined : true,
    };
  }
}

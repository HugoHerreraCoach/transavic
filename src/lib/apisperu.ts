// src/lib/apisperu.ts
// ════════════════════════════════════════════════════════════════════════════
// Consulta de RUC y DNI vía Decolecta (https://api.decolecta.com) o
// Apisperu (https://dniruc.apisperu.com) con sistema de fallback automático.
//
// - Los tokens viven SOLO en el servidor (DECOLECTA_TOKEN / APISPERU_TOKEN).
// - La UI llama a /api/consulta-documento.
// - Nunca lanza excepción: devuelve { ok:false, code, mensaje } para que la UI
//   siempre permita escribir los datos a mano si las APIs fallan.
// ════════════════════════════════════════════════════════════════════════════

const APISPERU_BASE = "https://dniruc.apisperu.com/api/v1";
const DECOLECTA_BASE = "https://api.decolecta.com/v1";

export interface ConsultaRucResult {
  ruc: string;
  razonSocial: string;
  direccion: string | null;
  estado: string | null; // ACTIVO / BAJA PROVISIONAL / BAJA DEFINITIVA / ...
  condicion: string | null; // HABIDO / NO HABIDO
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  ubigeo: string | null;
}

export interface ConsultaDniResult {
  dni: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
}

export type ConsultaErrorCode =
  | "FORMATO"
  | "NO_ENCONTRADO"
  | "TOKEN"
  | "CUOTA"
  | "RED"
  | "DESCONOCIDO";

export interface ConsultaError {
  ok: false;
  code: ConsultaErrorCode;
  mensaje: string;
}

export type ConsultaRucResponse = ({ ok: true } & ConsultaRucResult) | ConsultaError;
export type ConsultaDniResponse = ({ ok: true } & ConsultaDniResult) | ConsultaError;

function getApisperuToken(): string | null {
  return process.env.APISPERU_TOKEN || null;
}

function getDecolectaToken(): string | null {
  return process.env.DECOLECTA_TOKEN || null;
}

/** Consulta RUC usando Decolecta API */
async function consultarRucDecolecta(limpio: string, token: string): Promise<ConsultaRucResponse> {
  try {
    const res = await fetch(`${DECOLECTA_BASE}/sunat/ruc?numero=${limpio}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, code: "NO_ENCONTRADO", mensaje: "RUC no encontrado." };
    if (res.status === 401 || res.status === 403) return { ok: false, code: "TOKEN", mensaje: "Token Decolecta inválido o sin saldo." };
    if (res.status === 429) return { ok: false, code: "CUOTA", mensaje: "Cuota Decolecta agotada." };
    if (res.status >= 400) return { ok: false, code: "DESCONOCIDO", mensaje: `Error de Decolecta (${res.status}).` };

    const data = await res.json().catch(() => null);
    if (!data || (!data.razon_social && !data.numero_documento)) {
      return { ok: false, code: "NO_ENCONTRADO", mensaje: data?.message || "RUC no encontrado en Decolecta." };
    }

    return {
      ok: true,
      ruc: data.numero_documento ?? limpio,
      razonSocial: data.razon_social ?? "",
      direccion: data.direccion ?? null,
      estado: data.estado ?? null,
      condicion: data.condicion ?? null,
      departamento: data.departamento ?? null,
      provincia: data.provincia ?? null,
      distrito: data.distrito ?? null,
      ubigeo: data.ubigeo ?? null,
    };
  } catch {
    return { ok: false, code: "RED", mensaje: "No se pudo conectar con Decolecta." };
  }
}

/** Consulta DNI usando Decolecta API */
async function consultarDniDecolecta(limpio: string, token: string): Promise<ConsultaDniResponse> {
  try {
    const res = await fetch(`${DECOLECTA_BASE}/reniec/dni?numero=${limpio}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, code: "NO_ENCONTRADO", mensaje: "DNI no encontrado." };
    if (res.status === 401 || res.status === 403) return { ok: false, code: "TOKEN", mensaje: "Token Decolecta inválido o sin saldo." };
    if (res.status === 429) return { ok: false, code: "CUOTA", mensaje: "Cuota Decolecta agotada." };
    if (res.status >= 400) return { ok: false, code: "DESCONOCIDO", mensaje: `Error de Decolecta (${res.status}).` };

    const data = await res.json().catch(() => null);
    if (!data || (!data.first_name && !data.full_name)) {
      return { ok: false, code: "NO_ENCONTRADO", mensaje: data?.message || "DNI no encontrado en Decolecta." };
    }

    const nombres: string = data.first_name ?? "";
    const apellidoPaterno: string = data.first_last_name ?? "";
    const apellidoMaterno: string = data.second_last_name ?? "";
    const nombreCompleto: string =
      data.full_name ?? `${apellidoPaterno} ${apellidoMaterno} ${nombres}`.replace(/\s+/g, " ").trim();

    return {
      ok: true,
      dni: data.document_number ?? limpio,
      nombres,
      apellidoPaterno,
      apellidoMaterno,
      nombreCompleto,
    };
  } catch {
    return { ok: false, code: "RED", mensaje: "No se pudo conectar con Decolecta." };
  }
}

/** Consulta RUC con Apisperu */
async function consultarRucApisperu(limpio: string, token: string): Promise<ConsultaRucResponse> {
  try {
    const res = await fetch(`${APISPERU_BASE}/ruc/${limpio}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, code: "NO_ENCONTRADO", mensaje: "RUC no encontrado." };
    if (res.status === 401 || res.status === 403) return { ok: false, code: "TOKEN", mensaje: "Token Apisperu inválido." };
    if (res.status === 429) return { ok: false, code: "CUOTA", mensaje: "Cuota Apisperu agotada." };
    if (res.status >= 400) return { ok: false, code: "DESCONOCIDO", mensaje: `Error de Apisperu (${res.status}).` };

    const data = await res.json().catch(() => null);
    if (!data || data.success === false || (!data.ruc && !data.razonSocial)) {
      return { ok: false, code: "NO_ENCONTRADO", mensaje: data?.message || "RUC no encontrado." };
    }
    return {
      ok: true,
      ruc: data.ruc ?? limpio,
      razonSocial: data.razonSocial ?? "",
      direccion: data.direccion ?? null,
      estado: data.estado ?? null,
      condicion: data.condicion ?? null,
      departamento: data.departamento ?? null,
      provincia: data.provincia ?? null,
      distrito: data.distrito ?? null,
      ubigeo: data.ubigeo ?? null,
    };
  } catch {
    return { ok: false, code: "RED", mensaje: "No se pudo conectar con Apisperu." };
  }
}

/** Consulta DNI con Apisperu */
async function consultarDniApisperu(limpio: string, token: string): Promise<ConsultaDniResponse> {
  try {
    const res = await fetch(`${APISPERU_BASE}/dni/${limpio}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, code: "NO_ENCONTRADO", mensaje: "DNI no encontrado." };
    if (res.status === 401 || res.status === 403) return { ok: false, code: "TOKEN", mensaje: "Token Apisperu inválido." };
    if (res.status === 429) return { ok: false, code: "CUOTA", mensaje: "Cuota Apisperu agotada." };
    if (res.status >= 400) return { ok: false, code: "DESCONOCIDO", mensaje: `Error de Apisperu (${res.status}).` };

    const data = await res.json().catch(() => null);
    if (!data || data.success === false) {
      return { ok: false, code: "NO_ENCONTRADO", mensaje: data?.message || "DNI no encontrado." };
    }
    const nombres: string = data.nombres ?? "";
    const apellidoPaterno: string = data.apellidoPaterno ?? "";
    const apellidoMaterno: string = data.apellidoMaterno ?? "";
    if (!nombres && !apellidoPaterno) {
      return { ok: false, code: "NO_ENCONTRADO", mensaje: "DNI no encontrado." };
    }
    const nombreCompleto: string =
      data.nombreCompleto ?? `${apellidoPaterno} ${apellidoMaterno} ${nombres}`.replace(/\s+/g, " ").trim();

    return {
      ok: true,
      dni: data.dni ?? limpio,
      nombres,
      apellidoPaterno,
      apellidoMaterno,
      nombreCompleto,
    };
  } catch {
    return { ok: false, code: "RED", mensaje: "No se pudo conectar con Apisperu." };
  }
}

/**
 * Consulta RUC con cadena de Fallback:
 * 1. Decolecta (si DECOLECTA_TOKEN está activo)
 * 2. Apisperu (si Decolecta falla o APISPERU_TOKEN está activo)
 */
export async function consultarRuc(ruc: string): Promise<ConsultaRucResponse> {
  const limpio = (ruc || "").trim();
  if (!/^\d{11}$/.test(limpio)) {
    return { ok: false, code: "FORMATO", mensaje: "El RUC debe tener 11 dígitos." };
  }

  const decolectaToken = getDecolectaToken();
  const apisperuToken = getApisperuToken();

  if (!decolectaToken && !apisperuToken) {
    return { ok: false, code: "TOKEN", mensaje: "No hay token de consulta configurado (DECOLECTA_TOKEN o APISPERU_TOKEN)." };
  }

  // Intenta Decolecta primero si tiene token
  if (decolectaToken) {
    const resDecolecta = await consultarRucDecolecta(limpio, decolectaToken);
    if (resDecolecta.ok) return resDecolecta;

    // Si falla por token/cuota/red y tenemos apisperu, probamos apisperu como respaldo
    if (apisperuToken) {
      const resApisperu = await consultarRucApisperu(limpio, apisperuToken);
      if (resApisperu.ok) return resApisperu;
    }
    return resDecolecta;
  }

  // Si no hay Decolecta, usa Apisperu
  return consultarRucApisperu(limpio, apisperuToken!);
}

/**
 * Consulta DNI con cadena de Fallback:
 * 1. Decolecta (si DECOLECTA_TOKEN está activo)
 * 2. Apisperu (si Decolecta falla o APISPERU_TOKEN está activo)
 */
export async function consultarDni(dni: string): Promise<ConsultaDniResponse> {
  const limpio = (dni || "").trim();
  if (!/^\d{8}$/.test(limpio)) {
    return { ok: false, code: "FORMATO", mensaje: "El DNI debe tener 8 dígitos." };
  }

  const decolectaToken = getDecolectaToken();
  const apisperuToken = getApisperuToken();

  if (!decolectaToken && !apisperuToken) {
    return { ok: false, code: "TOKEN", mensaje: "No hay token de consulta configurado (DECOLECTA_TOKEN o APISPERU_TOKEN)." };
  }

  // Intenta Decolecta primero si tiene token
  if (decolectaToken) {
    const resDecolecta = await consultarDniDecolecta(limpio, decolectaToken);
    if (resDecolecta.ok) return resDecolecta;

    // Si falla y tenemos apisperu, probamos apisperu como respaldo
    if (apisperuToken) {
      const resApisperu = await consultarDniApisperu(limpio, apisperuToken);
      if (resApisperu.ok) return resApisperu;
    }
    return resDecolecta;
  }

  // Si no hay Decolecta, usa Apisperu
  return consultarDniApisperu(limpio, apisperuToken!);
}

// src/lib/apisperu.ts
// ════════════════════════════════════════════════════════════════════════════
// Consulta de RUC y DNI vía apisperu.com (https://dniruc.apisperu.com).
//
// - El token vive SOLO en el server (env APISPERU_TOKEN). Nunca se expone al
//   navegador: la UI llama a /api/consulta-documento, que usa este helper.
// - Cuenta: transavicdev@gmail.com.
// - Nunca tira excepción hacia arriba: devuelve { ok:false, code, mensaje } para
//   que la UI siempre permita escribir los datos a mano si el servicio falla.
// ════════════════════════════════════════════════════════════════════════════

const BASE = "https://dniruc.apisperu.com/api/v1";

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

function getToken(): string | null {
  return process.env.APISPERU_TOKEN || null;
}

/** Mapea el status HTTP de apisperu a nuestro código de error. */
function errorPorStatus(status: number): ConsultaError | null {
  if (status === 404) return { ok: false, code: "NO_ENCONTRADO", mensaje: "Documento no encontrado." };
  if (status === 401 || status === 403)
    return { ok: false, code: "TOKEN", mensaje: "Token inválido o sin permisos." };
  if (status === 422) return { ok: false, code: "FORMATO", mensaje: "Número de documento inválido." };
  if (status === 429)
    return { ok: false, code: "CUOTA", mensaje: "Cuota de consultas agotada. Intenta más tarde." };
  if (status >= 400) return { ok: false, code: "DESCONOCIDO", mensaje: `Error del servicio (${status}).` };
  return null;
}

export async function consultarRuc(ruc: string): Promise<ConsultaRucResponse> {
  const limpio = (ruc || "").trim();
  if (!/^\d{11}$/.test(limpio)) {
    return { ok: false, code: "FORMATO", mensaje: "El RUC debe tener 11 dígitos." };
  }
  const token = getToken();
  if (!token) return { ok: false, code: "TOKEN", mensaje: "APISPERU_TOKEN no configurado." };

  try {
    const res = await fetch(`${BASE}/ruc/${limpio}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const err = errorPorStatus(res.status);
    if (err) return err;

    const data = await res.json().catch(() => null);
    // apisperu a veces responde {success:false, message} con HTTP 200.
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
    return { ok: false, code: "RED", mensaje: "No se pudo conectar con el servicio de consulta." };
  }
}

export async function consultarDni(dni: string): Promise<ConsultaDniResponse> {
  const limpio = (dni || "").trim();
  if (!/^\d{8}$/.test(limpio)) {
    return { ok: false, code: "FORMATO", mensaje: "El DNI debe tener 8 dígitos." };
  }
  const token = getToken();
  if (!token) return { ok: false, code: "TOKEN", mensaje: "APISPERU_TOKEN no configurado." };

  try {
    const res = await fetch(`${BASE}/dni/${limpio}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const err = errorPorStatus(res.status);
    if (err) return err;

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
      data.nombreCompleto ??
      `${apellidoPaterno} ${apellidoMaterno} ${nombres}`.replace(/\s+/g, " ").trim();
    return {
      ok: true,
      dni: data.dni ?? limpio,
      nombres,
      apellidoPaterno,
      apellidoMaterno,
      nombreCompleto,
    };
  } catch {
    return { ok: false, code: "RED", mensaje: "No se pudo conectar con el servicio de consulta." };
  }
}

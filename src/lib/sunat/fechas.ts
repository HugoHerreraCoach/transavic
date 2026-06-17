// src/lib/sunat/fechas.ts
// Fecha y hora actuales en zona LIMA para los documentos SUNAT.
//
// 🔴 NUNCA usar `new Date().toISOString()` para la fecha de emisión: Vercel corre
// en UTC, así que desde las ~19:00 hora Lima la fecha UTC ya es "mañana" y SUNAT
// (que vive en hora Perú) responde RECHAZADA 2329 "La fecha de emisión se
// encuentra fuera del límite permitido". Pasó con el reintento de la guía
// T002-00000010 (10 jun 2026, 22:40 Lima). Las facturas/boletas ya usaban
// su propio helper Lima en lib/sunat/index.ts; este es el equivalente para
// las guías (y cualquier flujo nuevo).

/** Hoy en Lima, formato YYYY-MM-DD. */
export function fechaHoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Hora actual en Lima, formato HH:mm:ss (24h). */
export function horaActualLima(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación de la FECHA DE EMISIÓN seleccionable (boletas/facturas).
//
// La SUNAT permite emitir con fecha RETROACTIVA dentro del plazo de envío, pero
// RECHAZA cualquier fecha FUTURA (la fecha de emisión no puede ser mayor a la
// fecha en que recibe el XML — rechazo tipo 2329 / ERR-1079). Límites:
//   - Factura (01): hasta 3 días calendario atrás (RS 003-2023).
//   - Boleta  (03): hasta 7 días calendario atrás (vía resumen diario, RS 193-2020).
// Un solo lugar define los límites para que UI y servidor compartan el número.
// ─────────────────────────────────────────────────────────────────────────────

/** Días calendario hacia atrás permitidos por tipo de comprobante. */
export const LIMITE_DIAS_ATRAS = { "01": 3, "03": 7 } as const;

export type TipoFechaEmision = keyof typeof LIMITE_DIAS_ATRAS;

export interface RangoFechaEmision {
  /** Fecha mínima permitida (YYYY-MM-DD) = hoy - límite del tipo. */
  min: string;
  /** Fecha máxima permitida (YYYY-MM-DD) = hoy (no se permiten fechas futuras). */
  max: string;
}

/** Resta `dias` a una fecha YYYY-MM-DD con aritmética UTC (sin zona horaria). */
function restarDiasISO(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - dias);
  return base.toISOString().slice(0, 10);
}

/** Rango válido [hoy - límite, hoy] en zona Lima para un tipo de comprobante. */
export function rangoFechaEmision(
  tipo: TipoFechaEmision,
  hoy: string = fechaHoyLima()
): RangoFechaEmision {
  const dias = LIMITE_DIAS_ATRAS[tipo] ?? 3;
  return { min: restarDiasISO(hoy, dias), max: hoy };
}

export type ResultadoValidacionFecha =
  | { ok: true; min: string; max: string }
  | { ok: false; min: string; max: string; motivo: string };

/**
 * Valida una fecha de emisión (YYYY-MM-DD) para un tipo de comprobante.
 * Se compara como string (orden lexicográfico = cronológico) para evitar bugs de TZ.
 * `min`/`max` se devuelven SIEMPRE para que la UI pinte el rango desde la misma fuente.
 */
export function validarFechaEmision(
  fecha: string,
  tipo: TipoFechaEmision
): ResultadoValidacionFecha {
  const { min, max } = rangoFechaEmision(tipo);
  const f = (fecha ?? "").trim();

  // 1) Formato estricto YYYY-MM-DD (rechaza "2026-6-9", ISO con hora, vacío).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
    return { ok: false, min, max, motivo: "Formato de fecha inválido. Usa el selector (AAAA-MM-DD)." };
  }

  // 2) Fecha calendario real (round-trip UTC → rechaza 2026-02-31, 2026-13-01).
  const [y, m, d] = f.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, min, max, motivo: "La fecha indicada no existe en el calendario." };
  }

  // 3) Futura → prohibida (SUNAT rechaza con 2329).
  if (f > max) {
    return {
      ok: false,
      min,
      max,
      motivo: "No se permiten fechas futuras: la fecha de emisión no puede ser posterior a hoy.",
    };
  }

  // 4) Demasiado atrás según el tipo (fuera del plazo de envío SUNAT).
  if (f < min) {
    const limite = LIMITE_DIAS_ATRAS[tipo] ?? 3;
    const etiqueta = tipo === "01" ? "Una factura" : "Una boleta";
    return {
      ok: false,
      min,
      max,
      motivo: `${etiqueta} solo puede emitirse hasta ${limite} días atrás (desde ${min}).`,
    };
  }

  return { ok: true, min, max };
}

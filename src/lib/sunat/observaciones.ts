// Utilidades para la observación libre que el usuario agrega al comprobante.
// No confundir con `comprobantes.observaciones`: esa columna guarda observaciones
// del CDR/respuesta SUNAT y logs internos de NC/anulación.

export const MAX_OBSERVACION_CPE = 200;
export const MAX_OBSERVACION_GRE = 250;

export class ObservacionSunatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservacionSunatError";
  }
}

/**
 * Normaliza el texto para que sea válido en los campos SUNAT an..N:
 * - trim
 * - colapsa saltos, tabs y espacios múltiples en un solo espacio
 * - vacío => null
 * - si excede maxLength, lanza error explícito (no trunca texto legal).
 */
export function normalizarObservacionSunat(
  value: unknown,
  maxLength: number
): string | null {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new ObservacionSunatError(
      `La observación no puede superar ${maxLength} caracteres.`
    );
  }
  return normalized;
}

export function validarObservacionSunat(
  value: unknown,
  maxLength: number
): { ok: true; value: string | null } | { ok: false; error: string } {
  try {
    return { ok: true, value: normalizarObservacionSunat(value, maxLength) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : `La observación no puede superar ${maxLength} caracteres.`,
    };
  }
}

// src/lib/dev-bypass.ts
// ============================================================================
// Bypass de autenticación SOLO para tests E2E LOCALES
// (scratch/test_integration_flow.js corre contra http://localhost:3001 con
//  SUNAT_ENVIRONMENT="beta"). Fabrica una sesión admin si el header
// `x-bypass-auth` coincide con AUTH_SECRET.
//
// ⚠️ SEGURIDAD: el bypass está GATEADO a entornos NO productivos. En producción
// (Vercel `VERCEL_ENV === "production"`) o cuando se emite contra SUNAT real
// (`SUNAT_ENVIRONMENT === "production"`) el header se IGNORA — así nadie que
// conozca AUTH_SECRET puede emitir comprobantes reales ni consumir correlativos
// de producción fuera de la UI. Cada intento (permitido o bloqueado) se loguea.
//
// Antes esta lógica estaba DUPLICADA inline en 3 endpoints
// (comprobantes/emitir-manual, guias/emitir, guias/[id]/anular) SIN gate de
// entorno — cualquiera con el secreto podía emitir en producción.
// ============================================================================

/** Shape mínimo de sesión que consumen los endpoints de emisión. */
type BypassSession = {
  user: { name: string; role: string; id: string };
};

/**
 * Devuelve una sesión admin fabricada si el request trae un `x-bypass-auth`
 * válido Y el entorno NO es productivo. En cualquier otro caso devuelve `null`
 * (el caller usa entonces la sesión real de NextAuth).
 */
export function resolveDevBypassSession(
  request: Request,
): BypassSession | null {
  const header = request.headers.get("x-bypass-auth");
  if (!header) return null;

  // Solo en entornos no productivos: ni producción de Vercel, ni emisión
  // contra SUNAT real. Local (`next dev`) no setea VERCEL_ENV y corre beta.
  const esProduccion =
    process.env.VERCEL_ENV === "production" ||
    process.env.SUNAT_ENVIRONMENT === "production";

  if (esProduccion) {
    console.warn(
      "[dev-bypass] x-bypass-auth recibido en entorno PRODUCTIVO — IGNORADO (usar sesión real).",
    );
    return null;
  }

  if (!process.env.AUTH_SECRET || header !== process.env.AUTH_SECRET) {
    console.warn("[dev-bypass] x-bypass-auth no coincide con AUTH_SECRET — IGNORADO.");
    return null;
  }

  console.warn(
    "[dev-bypass] sesión admin fabricada vía x-bypass-auth (entorno no productivo — solo tests E2E).",
  );
  return { user: { name: "Antonio (bypass)", role: "admin", id: "admin-bypass" } };
}

// src/lib/gastos/registro.ts
//
// Reglas de servidor compartidas por el alta, la edición y el borrado de un gasto
// (`/api/gastos` y `/api/gastos/[id]`). Tocan DB, así que viven aparte de las
// funciones puras de `fecha-gasto.ts`.
//
// Las dos reglas que importan:
//
//  1. **El dinero de otro día no toca la caja de hoy.** La transacción del gasto
//     se escribe con `fecha` = la del gasto y un `created_at` SINTÉTICO en ese
//     mismo día (mismo patrón que la venta del POS, `api/pos/route.ts:228-236`).
//     El arqueo suma `transacciones` con `created_at >= caja.abierta_at`: con el
//     created_at en su día real, un gasto atrasado queda FUERA del turno de hoy
//     y deja de generar un faltante fantasma. No hace falta tocar el arqueo.
//
//  2. **No se contradice un arqueo ya firmado.** Si el gasto sale en efectivo de
//     una caja cuyo día YA fue cerrado, se rechaza con 409 (mismo criterio que
//     `api/pos/ventas/[id]` al editar o anular una venta).
import type { NeonQueryFunction } from "@neondatabase/serverless";

/** Hoy en Lima, resuelto por la BASE. Nunca `new Date()` (gotcha de timezone). */
export async function hoyLimaSql(sql: NeonQueryFunction<false, false>): Promise<string> {
  const filas = await sql`SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy`;
  return filas[0].hoy as string;
}

/**
 * ¿La caja de ESA fecha y ESA cuenta ya fue arqueada?
 *
 * Solo aplica a cuentas de efectivo con caja: un gasto pagado por transferencia
 * no pasa por ningún arqueo. Devuelve `false` ante cualquier error para no
 * bloquear el registro por un problema de lectura.
 */
export async function cajaDelDiaCerrada(
  sql: NeonQueryFunction<false, false>,
  fecha: string,
  cuentaId: string
): Promise<boolean> {
  try {
    const filas = await sql`
      SELECT 1
      FROM public.caja_diaria
      WHERE estado = 'Cerrada'
        AND fecha = ${fecha}::date
        AND cuenta_id = ${cuentaId}::uuid
      LIMIT 1
    `;
    return filas.length > 0;
  } catch (err) {
    console.error("⚠️ [gastos] No se pudo comprobar si la caja del día está cerrada:", err);
    return false;
  }
}

/** El concepto que se ve en el ledger y en los movimientos de la caja. */
export function conceptoDeGasto(categoria: string, descripcion?: string | null): string {
  const detalle = (descripcion ?? "").trim();
  return `Gasto: ${categoria}${detalle ? ` - ${detalle}` : ""}`;
}

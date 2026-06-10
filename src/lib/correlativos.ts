// src/lib/correlativos.ts
// Helper para obtener el siguiente número correlativo de un tipo dado (guías, etc.)
// Usa UPDATE ... RETURNING para garantizar atomicidad (no race conditions).
import { neon } from "@neondatabase/serverless";

// `guia_remision` — DEPRECATED como número compartido. Quedó congelado el
// 2026-06-10: la GRE legal pasó a un contador POR SERIE en
// `comprobantes_contador` (T001/T002) y la orden de pedido interna usa
// `orden_pedido`. Ya nada consume `guia_remision`; se conserva el tipo por si
// hay datos históricos. Ver scripts/migrate-guias-numeracion-2026-06-10.sql.
export type TipoCorrelativo = "guia_remision" | "orden_pedido";

/**
 * Reserva atómicamente el siguiente número correlativo del tipo dado.
 *
 * Usa un UPSERT (INSERT ... ON CONFLICT): si el tipo todavía no existe en la
 * tabla lo crea arrancando en 1; si ya existe lo incrementa. Así nunca falla
 * aunque la tabla `correlativos` no haya sido sembrada — evita el crash
 * "Tipo de correlativo no inicializado" en una base recién migrada donde la
 * tabla nace vacía (fue exactamente lo que tumbó la "orden de pedido" en
 * producción: la tabla existía pero sin la fila 'guia_remision').
 */
export async function siguienteCorrelativo(
  tipo: TipoCorrelativo
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    INSERT INTO correlativos (tipo, ultimo_numero, updated_at)
    VALUES (${tipo}, 1, NOW())
    ON CONFLICT (tipo)
    DO UPDATE SET ultimo_numero = correlativos.ultimo_numero + 1, updated_at = NOW()
    RETURNING ultimo_numero
  `;
  return result[0].ultimo_numero as number;
}

/**
 * Formato visual del número de guía: "00001234".
 */
export function formatNumeroGuia(numero: number): string {
  return String(numero).padStart(8, "0");
}

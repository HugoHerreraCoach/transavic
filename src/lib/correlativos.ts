// src/lib/correlativos.ts
// Helper para obtener el siguiente número correlativo de un tipo dado (guías, etc.)
// Usa UPDATE ... RETURNING para garantizar atomicidad (no race conditions).
import { neon } from "@neondatabase/serverless";

export type TipoCorrelativo = "guia_remision";

/**
 * Reserva atómicamente el siguiente número correlativo del tipo dado.
 * Lanza error si el tipo no está inicializado en la tabla.
 */
export async function siguienteCorrelativo(
  tipo: TipoCorrelativo
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    UPDATE correlativos
    SET ultimo_numero = ultimo_numero + 1, updated_at = NOW()
    WHERE tipo = ${tipo}
    RETURNING ultimo_numero
  `;
  if (result.length === 0) {
    throw new Error(
      `Tipo de correlativo no inicializado: ${tipo}. Ejecutar migrate-correlativos-guias.mjs`
    );
  }
  return result[0].ultimo_numero as number;
}

/**
 * Formato visual del número de guía: "00001234".
 */
export function formatNumeroGuia(numero: number): string {
  return String(numero).padStart(8, "0");
}

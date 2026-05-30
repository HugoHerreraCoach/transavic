// src/lib/sunat/contador.ts
// Correlativo atómico de comprobantes por RUC + serie.
// Usa UPDATE...RETURNING para evitar race conditions.
import { neon } from "@neondatabase/serverless";

export async function siguienteNumeroComprobante(
  ruc: string,
  serie: string
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);

  // Inicializar si no existe (idempotente)
  await sql`
    INSERT INTO comprobantes_contador (ruc, serie) VALUES (${ruc}, ${serie})
    ON CONFLICT (ruc, serie) DO NOTHING
  `;

  // Incremento atómico
  const result = (await sql`
    UPDATE comprobantes_contador
    SET ultimo_numero = ultimo_numero + 1, updated_at = NOW()
    WHERE ruc = ${ruc} AND serie = ${serie}
    RETURNING ultimo_numero
  `) as Array<{ ultimo_numero: number }>;

  return result[0].ultimo_numero;
}

/**
 * Formatea serie + número como "F001-00001234"
 */
export function formatSerieNumero(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(8, "0")}`;
}

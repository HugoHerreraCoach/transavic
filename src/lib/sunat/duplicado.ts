// src/lib/sunat/duplicado.ts
// ─────────────────────────────────────────────────────────────────────────────
// Detección de comprobante DUPLICADO para advertir antes de emitir uno igual.
// Caso real: emitir dos veces la misma factura (doble clic, o no ver que ya se
// emitió). Un CPE aceptado solo advierte (puede ser otra venta legítima), pero
// un CPE indeterminado BLOQUEA: primero se consulta/reintenta ese mismo número.
//
// Solo aplica a clientes IDENTIFICADOS (DNI 8 / RUC 11). Para "CLIENTES VARIOS"
// (doc genérico) repetir un mismo monto es normal (mostrador), así que no avisa.
// ─────────────────────────────────────────────────────────────────────────────

import { neon } from "@neondatabase/serverless";

export interface ComprobanteDuplicado {
  id: string;
  serieNumero: string;
  fecha: string; // ISO
  estado: string;
  bloqueante: boolean;
}

/**
 * Busca un comprobante "igual" reciente: misma empresa + tipo + cliente
 * identificado + mismo monto total (±0.10 por redondeo) + estado válido, emitido
 * en las últimas ~48 h. Devuelve null si no hay, o si el cliente no está
 * identificado (no se chequea a CLIENTES VARIOS).
 */
export async function buscarComprobanteDuplicado(opts: {
  empresa: string;
  tipo: string;
  clienteDocNum: string;
  montoTotal: number;
}): Promise<ComprobanteDuplicado | null> {
  const doc = (opts.clienteDocNum || "").trim();
  if (!/^(\d{8}|\d{11})$/.test(doc)) return null; // solo clientes identificados

  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, serie_numero, created_at, estado
    FROM comprobantes
    WHERE empresa = ${opts.empresa}
      AND tipo = ${opts.tipo}
      AND cliente_doc_num = ${doc}
      AND ABS(monto_total - ${opts.montoTotal}) < 0.10
      AND estado IN (
        'aceptado', 'observado', 'pendiente', 'emitiendo',
        'por_confirmar', 'error', 'no_registrado'
      )
      AND created_at >= (NOW() - INTERVAL '2 days')
    ORDER BY
      CASE
        WHEN estado IN ('pendiente', 'emitiendo', 'por_confirmar', 'error', 'no_registrado')
          THEN 0
        ELSE 1
      END,
      created_at DESC
    LIMIT 1
  `) as Array<{
    id: string;
    serie_numero: string;
    created_at: string | Date;
    estado: string;
  }>;

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    serieNumero: r.serie_numero,
    estado: r.estado,
    bloqueante: [
      "pendiente",
      "emitiendo",
      "por_confirmar",
      "error",
      "no_registrado",
    ].includes(r.estado),
    fecha:
      typeof r.created_at === "string"
        ? r.created_at
        : r.created_at.toISOString(),
  };
}

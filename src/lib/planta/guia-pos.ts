// src/lib/planta/guia-pos.ts
// Arma el payload de la guía de una venta del POS de planta (documento interno
// informal, NO es la GRE legal de SUNAT). Espejo de src/lib/avicola/guia.ts.
//
// Diferencias con campo, a propósito:
//  - La venta de planta vive en `pedidos` (origen='pos_planta') + `pedido_items`,
//    no en tablas propias.
//  - Las líneas llevan `unidad` variable (kg | uni), no kilos fijos.
//  - El estado de cuenta es OPCIONAL: solo existe si la venta fue a crédito
//    (y por lo tanto generó una fila en `cobranzas_planta`).
// ⚠️ Neon devuelve NUMERIC como string → montos ::float8 y fechas ::text en SQL.
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export interface ItemGuiaPlanta {
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
}

/** Saldo del cliente alrededor de esta venta (solo ventas a crédito). */
export interface EstadoCuentaGuiaPlanta {
  saldo_previo: number;
  total_venta: number;
  abonos_aplicados: number;
  saldo_actualizado: number;
}

export interface GuiaPlantaData {
  venta_id: string;
  numero_guia: number | null;
  fecha: string;
  hora: string;
  cliente: {
    nombre: string;
    razon_social: string | null;
    ruc_dni: string | null;
    telefono: string | null;
    direccion: string | null;
    empresa: string;
  };
  items: ItemGuiaPlanta[];
  total: number;
  tipo_pago: "Contado" | "Credito";
  /** Solo en ventas a crédito; en contado no hay cuenta corriente que mostrar. */
  estado_cuenta: EstadoCuentaGuiaPlanta | null;
  anulada: boolean;
  observaciones: string | null;
}

/**
 * Devuelve todo lo que el ticket de la guía de planta necesita para renderizarse,
 * o null si la venta no existe o no es del POS de planta.
 */
export async function guiaDeVentaPlanta(
  sql: Sql,
  ventaId: string
): Promise<GuiaPlantaData | null> {
  const filas = (await sql`
    SELECT
      p.id                AS venta_id,
      p.numero_guia,
      p.cliente,
      p.razon_social,
      p.ruc_dni,
      p.empresa,
      p.notas,
      COALESCE(p.anulada, FALSE) AS anulada,
      TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
      TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'HH24:MI')    AS hora,
      cp.id        AS cliente_planta_id,
      cp.telefono  AS cliente_telefono,
      cp.direccion AS cliente_direccion,
      co.id        AS cobranza_id
    FROM pedidos p
    LEFT JOIN cobranzas_planta co
      ON co.pedido_id = p.id AND NOT co.anulada
    LEFT JOIN clientes_planta cp
      ON cp.id = co.cliente_planta_id
    WHERE p.id = ${ventaId} AND p.origen = 'pos_planta'
    LIMIT 1
  `) as Array<{
    venta_id: string;
    numero_guia: number | null;
    cliente: string | null;
    razon_social: string | null;
    ruc_dni: string | null;
    empresa: string;
    notas: string | null;
    anulada: boolean;
    fecha: string;
    hora: string;
    cliente_planta_id: string | null;
    cliente_telefono: string | null;
    cliente_direccion: string | null;
    cobranza_id: string | null;
  }>;

  const venta = filas[0];
  if (!venta) return null;

  const items = (await sql`
    SELECT
      producto_nombre,
      COALESCE(cantidad_real, cantidad)::float8                       AS cantidad,
      unidad,
      COALESCE(precio_unitario, 0)::float8                            AS precio_unitario,
      COALESCE(subtotal_real, subtotal, 0)::float8                    AS subtotal
    FROM pedido_items
    WHERE pedido_id = ${ventaId}
    ORDER BY created_at ASC, producto_nombre ASC
  `) as ItemGuiaPlanta[];

  const total = items.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

  // Estado de cuenta solo si la venta fue a crédito (hay cobranza viva).
  let estadoCuenta: EstadoCuentaGuiaPlanta | null = null;
  if (venta.cobranza_id && venta.cliente_planta_id) {
    estadoCuenta = await estadoCuentaParaGuiaPlanta(
      sql,
      venta.cliente_planta_id,
      venta.cobranza_id,
      total
    );
  }

  return {
    venta_id: venta.venta_id,
    numero_guia: venta.numero_guia,
    fecha: venta.fecha,
    hora: venta.hora,
    cliente: {
      nombre: venta.cliente || "Venta al paso",
      razon_social: venta.razon_social,
      ruc_dni: venta.ruc_dni,
      telefono: venta.cliente_telefono,
      direccion: venta.cliente_direccion,
      empresa: venta.empresa,
    },
    items,
    total,
    tipo_pago: venta.cobranza_id ? "Credito" : "Contado",
    estado_cuenta: estadoCuenta,
    anulada: venta.anulada,
    observaciones: venta.notas,
  };
}

/**
 * Saldo del cliente ANCLADO a esta cobranza, para que reimprimir una guía vieja
 * siga mostrando lo mismo que el día que se emitió.
 *
 * Se corta por `created_at` (no por `fecha`): un abono hecho un día posterior a la
 * venta no es "saldo previo" pero sí se aplicó a esta venta si llegó antes de la
 * siguiente — misma regla que campo (ver gotcha #46, caso Vicki).
 *
 * OJO planta: los abonos cuelgan de la COBRANZA (`abonos_planta.cobranza_id`), no
 * del cliente, así que todo pasa por el JOIN a `cobranzas_planta` filtrando las
 * anuladas de ambos lados.
 */
async function estadoCuentaParaGuiaPlanta(
  sql: Sql,
  clientePlantaId: string,
  cobranzaId: string,
  totalVenta: number
): Promise<EstadoCuentaGuiaPlanta> {
  const filas = (await sql`
    WITH esta AS (
      SELECT created_at
      FROM cobranzas_planta
      WHERE id = ${cobranzaId}
    ),
    siguiente AS (
      SELECT MIN(co.created_at) AS created_at
      FROM cobranzas_planta co
      CROSS JOIN esta
      WHERE co.cliente_planta_id = ${clientePlantaId}
        AND NOT co.anulada
        AND co.created_at > esta.created_at
    ),
    -- Todos los abonos del cliente (van contra la COBRANZA, no contra el cliente).
    abonos AS (
      SELECT a.monto, a.created_at
      FROM abonos_planta a
      JOIN cobranzas_planta c2 ON c2.id = a.cobranza_id
      WHERE c2.cliente_planta_id = ${clientePlantaId}
        AND NOT c2.anulada
        AND NOT a.anulado
    )
    SELECT
      COALESCE((
        SELECT SUM(co.monto)
        FROM cobranzas_planta co
        CROSS JOIN esta
        WHERE co.cliente_planta_id = ${clientePlantaId}
          AND NOT co.anulada
          AND co.created_at < esta.created_at
      ), 0)::float8 AS deuda_previa,
      COALESCE((
        SELECT SUM(ab.monto)
        FROM abonos ab
        CROSS JOIN esta
        WHERE ab.created_at < esta.created_at
      ), 0)::float8 AS abonos_previos,
      COALESCE((
        SELECT SUM(ab.monto)
        FROM abonos ab
        CROSS JOIN esta
        CROSS JOIN siguiente
        WHERE ab.created_at >= esta.created_at
          AND ab.created_at < COALESCE(siguiente.created_at, 'infinity'::timestamptz)
      ), 0)::float8 AS abonos_aplicados
  `) as Array<{
    deuda_previa: number;
    abonos_previos: number;
    abonos_aplicados: number;
  }>;

  const f = filas[0] ?? { deuda_previa: 0, abonos_previos: 0, abonos_aplicados: 0 };
  const saldoPrevio = Number(f.deuda_previa) - Number(f.abonos_previos);
  const abonosAplicados = Number(f.abonos_aplicados);

  return {
    saldo_previo: saldoPrevio,
    total_venta: totalVenta,
    abonos_aplicados: abonosAplicados,
    saldo_actualizado: saldoPrevio + totalVenta - abonosAplicados,
  };
}

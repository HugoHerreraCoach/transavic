// src/lib/avicola/guia.ts
// Arma el payload completo de la guía de una venta del módulo Clientes Avícola
// (documento interno informal, NO es la GRE legal de SUNAT).
// Une: venta + cliente (denormalizado al momento de leer), líneas de la venta y
// el estado de cuenta ANCLADO al created_at de la venta (reimpresión estable) —
// la aritmética vive en src/lib/avicola/saldos.ts (única fuente, no duplicar).
// ⚠️ Neon devuelve NUMERIC como string → montos ::float8 y fechas ::text en SQL.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { EmpresaAvicola, GuiaAvicolaData } from "@/lib/avicola/types";
import { estadoCuentaParaGuia } from "@/lib/avicola/saldos";

type Sql = NeonQueryFunction<false, false>;

/**
 * Devuelve todo lo que necesita el ticket de la guía para renderizarse,
 * o null si la venta no existe.
 */
export async function guiaDeVenta(
  sql: Sql,
  ventaId: string
): Promise<GuiaAvicolaData | null> {
  const ventas = (await sql`
    SELECT
      v.id AS venta_id,
      v.numero_guia,
      v.fecha::text AS fecha,
      v.total::float8 AS total,
      v.observaciones,
      v.anulada,
      c.nombre,
      c.mercado,
      c.numero_puesto,
      c.telefono,
      c.empresa
    FROM ventas_avicola v
    JOIN clientes_avicola c ON c.id = v.cliente_id
    WHERE v.id = ${ventaId}
  `) as Array<{
    venta_id: string;
    numero_guia: number;
    fecha: string;
    total: number;
    observaciones: string | null;
    anulada: boolean;
    nombre: string;
    mercado: string;
    numero_puesto: string | null;
    telefono: string | null;
    empresa: EmpresaAvicola;
  }>;
  const venta = ventas[0];
  if (!venta) return null;

  const items = (await sql`
    SELECT
      producto_nombre,
      peso_kg::float8 AS peso_kg,
      precio_kg::float8 AS precio_kg,
      subtotal::float8 AS subtotal
    FROM venta_avicola_items
    WHERE venta_id = ${ventaId}
    ORDER BY created_at ASC, producto_nombre ASC
  `) as GuiaAvicolaData["items"];

  const estadoCuenta = await estadoCuentaParaGuia(sql, ventaId);
  if (!estadoCuenta) return null;

  return {
    venta_id: venta.venta_id,
    numero_guia: venta.numero_guia,
    fecha: venta.fecha,
    cliente: {
      nombre: venta.nombre,
      mercado: venta.mercado,
      numero_puesto: venta.numero_puesto,
      telefono: venta.telefono,
      empresa: venta.empresa,
    },
    items,
    total: venta.total,
    estado_cuenta: estadoCuenta,
    anulada: venta.anulada,
    observaciones: venta.observaciones,
  };
}

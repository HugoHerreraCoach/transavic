// src/lib/parse-detalle-pedido.ts
// Reconstruye los ítems estructurados de un pedido a partir del TEXTO de
// `pedidos.detalle` (formato que genera el propio sistema: una línea por ítem,
// "N uni|kg - Nombre del producto y notas…").
//
// ¿Por qué existe? Un pedido puede nacer SIN filas en `pedido_items` (el bug
// clásico: "Duplicar pedido" copiaba solo el texto; también pasa si la asesora
// escribe el detalle a mano sin tocar el selector). Sin ítems, Producción no
// puede registrar pesos (modal vacío, S/ 0.00 — caso Manuel lince / Nikuya,
// 11 jun 2026) y el pedido no cuenta en Resumen del día. Este parser es la
// red de seguridad: deriva los ítems del texto, matcheando contra el catálogo
// cuando se puede (para recuperar producto_id y precio).

export interface ItemParseado {
  cantidad: number;
  unidad: string; // 'kg' | 'uni' (normalizada)
  producto_nombre: string;
}

export interface ProductoCatalogo {
  id: string;
  nombre: string;
  precio_venta: number | string | null;
}

function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Parsea el texto del detalle a ítems {cantidad, unidad, producto_nombre}.
 * Tolera: decimales con coma, unidades raras ("paquete x 6" → 'uni'), saltos de
 * línea entre la cantidad y la unidad ("5\nkg - …"), y texto libre tras el
 * nombre (se conserva dentro de producto_nombre — Producción pesa igual).
 * Las líneas que no siguen el patrón "N … - texto" se ignoran.
 */
export function parseDetallePedido(detalle: string | null | undefined): ItemParseado[] {
  if (!detalle || !detalle.trim()) return [];
  // Reparar "5\nkg - …" (cantidad y unidad separadas por salto de línea)
  const texto = detalle.replace(/(\d)[ \t]*\r?\n[ \t]*(kg|kilos?|uni|unidades?)\b/gi, "$1 $2");

  const items: ItemParseado[] = [];
  for (const lineaRaw of texto.split(/\r?\n/)) {
    const linea = lineaRaw.trim();
    if (!linea) continue;
    const m = linea.match(/^(\d+(?:[.,]\d+)?)\s*([a-záéíóúñ]+(?:\s*x\s*\d+)?)?\s*-\s*(.+)$/i);
    if (!m) continue;
    const cantidad = Number(m[1].replace(",", "."));
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    const unidadCruda = (m[2] || "uni").trim().toLowerCase();
    const unidad = /^k/.test(unidadCruda) ? "kg" : "uni";
    const nombre = m[3].trim();
    if (!nombre) continue;
    items.push({ cantidad, unidad, producto_nombre: nombre });
  }
  return items;
}

/**
 * Matchea el texto de un ítem contra el catálogo: gana el producto cuyo nombre
 * (normalizado) sea PREFIJO más largo del texto. "Filete de Pechuga CORTE
 * CORAZÓN…" → producto "Filete de Pechuga". Sin match → null (el ítem se
 * inserta igual con producto_id NULL; Producción puede pesarlo y ponerle precio).
 */
/** Cliente SQL mínimo (tagged template de @neondatabase/serverless). */
type SqlClient = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

/** Ítem ya guardado en pedido_items — forma mínima que la reconciliación necesita. */
export interface ItemActual {
  cantidad_real: number | string | null;
}

/**
 * Inserta en `pedido_items` una fila por cada ítem parseado, matcheando contra el
 * catálogo para producto_id + snapshot de precio (sin match → producto_id/precio
 * NULL). Helper interno compartido por derivar/reconciliar. Devuelve cuántos insertó.
 */
async function insertarItemsParseados(
  sql: SqlClient,
  pedidoId: string,
  parseados: ItemParseado[]
): Promise<number> {
  if (parseados.length === 0) return 0;
  const catalogo = (await sql`
    SELECT id, nombre, precio_venta FROM productos
  `) as unknown as ProductoCatalogo[];
  let insertados = 0;
  for (const it of parseados) {
    const prod = matchProductoCatalogo(it.producto_nombre, catalogo);
    const precio = prod?.precio_venta != null ? Number(prod.precio_venta) : null;
    const subtotal = precio !== null ? Number((precio * it.cantidad).toFixed(2)) : null;
    await sql`
      INSERT INTO pedido_items (pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido, precio_unitario, subtotal)
      VALUES (${pedidoId}, ${prod?.id ?? null}, ${it.producto_nombre}, ${it.cantidad}, ${it.unidad}, ${it.unidad}, ${precio}, ${subtotal})
    `;
    insertados++;
  }
  return insertados;
}

/**
 * Deriva los ítems del texto `detalle` y los INSERTa en `pedido_items` para un
 * pedido que no tiene ninguno (red de seguridad server-side). Devuelve cuántos insertó.
 * El llamador es responsable de invocarla SOLO cuando el pedido tiene 0 ítems.
 */
export async function derivarEInsertarItemsDesdeDetalle(
  sql: SqlClient,
  pedidoId: string,
  detalle: string | null | undefined
): Promise<number> {
  return insertarItemsParseados(sql, pedidoId, parseDetallePedido(detalle));
}

/**
 * Reconcilia `pedido_items` con el DESGLOSE del texto `detalle`.
 *
 * ¿Por qué? El mismo producto en dos líneas del pedido (ej. "2 kg + 3 kg, bolsas
 * separadas", o "60 uni Filete de Pechuga 120gr + 50 uni Filete 150gr") se FUSIONA
 * en UNA sola fila al crear el pedido (ProductSelector suma por producto_id).
 * Producción pesa por fila → ve una sola línea combinada (5 kg / 110 uni) y no puede
 * pesar cada parte. El desglose real solo sobrevive en el texto `detalle`. Esta
 * función lo reconstruye para que Producción muestre y pese cada línea.
 *
 * Actúa SOLO si el detalle aporta MÁS granularidad que lo guardado
 * (`parseados.length > itemsActuales.length`) y NINGÚN ítem tiene `cantidad_real`
 * (no se empezó a pesar — jamás perder pesos ya registrados). En ese caso borra los
 * ítems del pedido y reinserta una fila por línea del detalle. Idempotente: una vez
 * separado, parseados == filas → no vuelve a actuar. Devuelve cuántas filas reinsertó
 * (0 = no hizo nada).
 */
export async function reconciliarItemsDesdeDetalle(
  sql: SqlClient,
  pedidoId: string,
  detalle: string | null | undefined,
  itemsActuales: ItemActual[]
): Promise<number> {
  const parseados = parseDetallePedido(detalle);
  if (parseados.length === 0) return 0;
  // Solo re-derivar si el detalle tiene más líneas que las filas guardadas (hay
  // fusión/desfase); si están alineados, no tocar nada.
  if (parseados.length <= itemsActuales.length) return 0;
  // Guarda de seguridad: no tocar pedidos que ya tienen algún peso registrado.
  if (itemsActuales.some((it) => it.cantidad_real != null)) return 0;

  await sql`DELETE FROM pedido_items WHERE pedido_id = ${pedidoId}`;
  return insertarItemsParseados(sql, pedidoId, parseados);
}

export function matchProductoCatalogo(
  nombreItem: string,
  productos: ProductoCatalogo[]
): ProductoCatalogo | null {
  const objetivo = normalizarTexto(nombreItem);
  let mejor: ProductoCatalogo | null = null;
  let mejorLen = 0;
  for (const p of productos) {
    const nombreProd = normalizarTexto(p.nombre);
    if (!nombreProd || nombreProd.length <= mejorLen) continue;
    if (
      objetivo === nombreProd ||
      objetivo.startsWith(nombreProd + " ") ||
      objetivo.startsWith(nombreProd + ",") ||
      objetivo.startsWith(nombreProd + ".") ||
      objetivo.startsWith(nombreProd + "(")
    ) {
      mejor = p;
      mejorLen = nombreProd.length;
    }
  }
  return mejor;
}

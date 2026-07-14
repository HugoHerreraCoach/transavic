export type TipoPagoPos = "Contado" | "Credito";

export interface ItemDetalleVentaPos {
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal_venta: number;
  costo_unitario: number | null;
  subtotal_costo: number | null;
}

type FilaDetalleCruda = Record<string, unknown>;

function numero(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numeroNullable(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function redondearMonedaPos(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function subtotalVentaPos(cantidad: number, precioUnitario: number): number {
  return redondearMonedaPos(cantidad * precioUnitario);
}

export function totalVentaPos(
  items: Array<{ cantidad: number; precioUnitario: number }>
): number {
  return redondearMonedaPos(
    items.reduce(
      (total, item) => total + subtotalVentaPos(item.cantidad, item.precioUnitario),
      0
    )
  );
}

/**
 * Convierte el JSONB devuelto por Neon a un contrato numérico estable para la UI.
 * El costo se toma únicamente del snapshot del ítem; nunca del catálogo actual.
 */
export function normalizarItemsDetalleVentaPos(value: unknown): ItemDetalleVentaPos[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is FilaDetalleCruda => Boolean(item) && typeof item === "object")
    .map((item) => {
      const cantidad = numero(item.cantidad);
      const costoUnitario = numeroNullable(item.costo_unitario);
      const subtotalCosto =
        costoUnitario === null
          ? null
          : redondearMonedaPos(
              numeroNullable(item.subtotal_costo) ?? cantidad * costoUnitario
            );

      return {
        producto_nombre:
          typeof item.producto_nombre === "string" && item.producto_nombre.trim()
            ? item.producto_nombre
            : "Producto sin nombre",
        cantidad,
        unidad: typeof item.unidad === "string" && item.unidad.trim() ? item.unidad : "uni",
        precio_unitario: numero(item.precio_unitario),
        subtotal_venta: redondearMonedaPos(
          numero(item.subtotal_venta ?? item.subtotal)
        ),
        costo_unitario: costoUnitario,
        subtotal_costo: subtotalCosto,
      };
    });
}

export function resumirCostosVentaPos(items: ItemDetalleVentaPos[]): {
  costo_total: number | null;
  costo_completo: boolean;
} {
  const costoCompleto =
    items.length > 0 &&
    items.every(
      (item) => item.costo_unitario !== null && item.subtotal_costo !== null
    );

  return {
    costo_completo: costoCompleto,
    costo_total: costoCompleto
      ? redondearMonedaPos(
          items.reduce((total, item) => total + (item.subtotal_costo ?? 0), 0)
        )
      : null,
  };
}

/** Normaliza una venta sin imponer el resto de campos de cada endpoint. */
export function normalizarVentaConDetallePos<
  T extends { total: unknown; items: unknown }
>(venta: T): Omit<T, "total" | "items"> & {
  total: number;
  items: ItemDetalleVentaPos[];
  costo_total: number | null;
  costo_completo: boolean;
} {
  const items = normalizarItemsDetalleVentaPos(venta.items);
  return {
    ...venta,
    total: redondearMonedaPos(numero(venta.total)),
    items,
    ...resumirCostosVentaPos(items),
  };
}

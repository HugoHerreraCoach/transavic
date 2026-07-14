export type ItemPedidoCanonico = {
  productoId: string | null;
  nombre: string;
  cantidad: number | string;
  unidad: string;
  notas: string | null;
};

export function redondearDecimalPedido(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}

export function decimalCanonicoNullable(
  valor: number | string | null | undefined,
  decimales: number
): string | null {
  return valor === null || valor === undefined
    ? null
    : redondearDecimalPedido(Number(valor), decimales).toFixed(decimales);
}

export function claveItemPedido(
  item: ItemPedidoCanonico,
  compararProducto: boolean
): string {
  return JSON.stringify([
    compararProducto ? item.productoId : null,
    item.nombre,
    decimalCanonicoNullable(item.cantidad, 2),
    item.unidad,
    item.notas ?? null,
  ]);
}

import type { ItemDetalleVentaPos } from "@/lib/planta/ventas-pos";

const soles = (value: number) =>
  `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const cantidad = (value: number) =>
  value.toLocaleString("es-PE", { maximumFractionDigits: 2 });

export default function DetalleVentaPos({
  items,
  total,
  costoTotal,
  costoCompleto,
}: {
  items: ItemDetalleVentaPos[];
  total: number;
  costoTotal: number | null;
  costoCompleto: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
        Esta venta no tiene ítems registrados.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 sm:hidden">
        {items.map((item, index) => (
          <article
            key={`${item.producto_nombre}-${index}`}
            className="rounded-xl border border-gray-200 bg-gray-50/70 p-3"
          >
            <h4 className="text-sm font-bold leading-snug text-gray-900">
              {item.producto_nombre}
            </h4>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="font-medium text-gray-500">Peso / cantidad</dt>
                <dd className="font-semibold text-gray-900">
                  {cantidad(item.cantidad)} {item.unidad}
                </dd>
              </div>
              <div className="text-right">
                <dt className="font-medium text-gray-500">Precio de venta</dt>
                <dd className="font-semibold text-gray-900">
                  {soles(item.precio_unitario)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Costo unitario</dt>
                <dd className={item.costo_unitario === null ? "font-semibold text-amber-700" : "font-semibold text-gray-900"}>
                  {item.costo_unitario === null
                    ? "Sin costo registrado"
                    : soles(item.costo_unitario)}
                </dd>
              </div>
              <div className="text-right">
                <dt className="font-medium text-gray-500">Subtotal vendido</dt>
                <dd className="font-bold text-violet-700">
                  {soles(item.subtotal_venta)}
                </dd>
              </div>
            </dl>
            {item.subtotal_costo !== null && (
              <p className="mt-2 border-t border-gray-200 pt-2 text-right text-xs text-gray-500">
                Subtotal de costo: <strong className="text-gray-800">{soles(item.subtotal_costo)}</strong>
              </p>
            )}
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 sm:block">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-bold">Producto</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Peso / cantidad</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Precio venta</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Subtotal vendido</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Costo unitario</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Subtotal costo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {items.map((item, index) => (
              <tr key={`${item.producto_nombre}-${index}`}>
                <th scope="row" className="max-w-[230px] px-3 py-2 font-semibold text-gray-900">
                  {item.producto_nombre}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                  {cantidad(item.cantidad)} {item.unidad}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                  {soles(item.precio_unitario)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-violet-700">
                  {soles(item.subtotal_venta)}
                </td>
                <td className={`px-3 py-2 text-right ${item.costo_unitario === null ? "font-semibold text-amber-700" : "text-gray-700"}`}>
                  {item.costo_unitario === null
                    ? "Sin costo registrado"
                    : soles(item.costo_unitario)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                  {item.subtotal_costo === null ? "—" : soles(item.subtotal_costo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="flex flex-col gap-2 rounded-xl bg-violet-50 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-end sm:gap-6">
        <div className="flex items-center justify-between gap-4">
          <dt className="font-medium text-violet-700">Total vendido</dt>
          <dd className="font-black tabular-nums text-violet-950">{soles(total)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="font-medium text-gray-600">Costo total</dt>
          <dd className={costoCompleto ? "font-bold tabular-nums text-gray-900" : "font-semibold text-amber-700"}>
            {costoCompleto && costoTotal !== null
              ? soles(costoTotal)
              : "Incompleto"}
          </dd>
        </div>
      </dl>
      {!costoCompleto && (
        <p className="text-xs font-medium text-amber-700" role="note">
          El costo total no se calcula porque uno o más productos no tenían costo de compra registrado al venderse.
        </p>
      )}
    </div>
  );
}

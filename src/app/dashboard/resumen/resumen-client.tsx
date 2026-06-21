// src/app/dashboard/resumen/resumen-client.tsx
// "Resumen del día" — herramienta de PRODUCCIÓN: cuánto hay que preparar de cada
// producto para una fecha de entrega. Los TOTALES POR PRODUCTO son el héroe;
// debajo, el detalle de pedidos. Abre en MAÑANA (lo que toca preparar esta noche).
// Reusa /api/resumen-diario (admin + produccion).
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  FiBox,
  FiCalendar,
  FiChevronLeft,
  FiChevronRight,
  FiUser,
  FiClock,
  FiPhone,
  FiMapPin,
  FiPackage,
  FiClipboard,
  FiX,
} from "react-icons/fi";
import { toLocalDateString, getLocalDateString } from "@/lib/utils";

type PedidoResumen = {
  id: string;
  cliente: string;
  whatsapp: string | null;
  empresa: string;
  direccion: string | null;
  distrito: string | null;
  hora_entrega: string | null;
  detalle: string;
  entregado: boolean;
  fecha_pedido: string;
  asesor_name: string | null;
  items: { producto_nombre: string; cantidad: string; unidad: string }[];
};
type ResumenData = {
  fecha: string;
  kpis: { total: number; entregados: number; pendientes: number };
  pedidos: PedidoResumen[];
  totalesPorProducto: { nombre: string; unidad: string; total: string }[];
};

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const f = date.toLocaleDateString("es-PE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return f.charAt(0).toUpperCase() + f.slice(1);
}
// Cantidad legible: sin decimales si es entero, con 1 decimal si no.
function fmtCant(total: string | number): string {
  const n = Number(total);
  if (!isFinite(n)) return "0";
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

export default function ResumenClient() {
  const [data, setData] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(true);
  // Por defecto MAÑANA: es lo que se prepara esta noche / mañana temprano.
  const [fecha, setFecha] = useState(() => getLocalDateString(1));
  const [productoSeleccionado, setProductoSeleccionado] = useState<{
    nombre: string;
    unidad: string;
  } | null>(null);

  // ── Desglose de pedidos para el producto seleccionado ──
  const pedidosDelProducto = useMemo(() => {
    if (!productoSeleccionado || !data) return [];
    return data.pedidos
      .map((p) => {
        const item = p.items.find(
          (it) =>
            it.producto_nombre === productoSeleccionado.nombre &&
            it.unidad === productoSeleccionado.unidad
        );
        if (!item) return null;
        return {
          ...p,
          cantidad_pedida: item.cantidad,
        };
      })
      .filter((p): p is PedidoConCantidad => p !== null);
  }, [productoSeleccionado, data]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/resumen-diario?fecha=${fecha}`);
      setData(res.ok ? await res.json() : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const shiftDay = (delta: number) => {
    const d = new Date(fecha + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setFecha(toLocalDateString(d));
  };

  const hoy = getLocalDateString(0);
  const manana = getLocalDateString(1);
  const totales = data?.totalesPorProducto ?? [];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 pb-24 max-w-5xl mx-auto anim-fade">
      {/* ── Encabezado + navegación de fecha ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiBox className="text-red-600" /> Resumen del día
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Lo que hay que preparar — total por producto de la fecha de entrega.
          </p>
          <p className="text-base font-semibold text-gray-800 mt-2">
            {formatDisplayDate(fecha)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => shiftDay(-1)}
            className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 active:scale-[0.95] transition-transform"
            aria-label="Día anterior"
          >
            <FiChevronLeft />
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg">
            <FiCalendar className="text-gray-400" size={15} />
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="text-sm bg-white text-gray-900 outline-none"
            />
          </div>
          <button
            onClick={() => shiftDay(1)}
            className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 active:scale-[0.95] transition-transform"
            aria-label="Día siguiente"
          >
            <FiChevronRight />
          </button>
          <div className="flex gap-1.5 ml-1">
            <button
              onClick={() => setFecha(hoy)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors active:scale-[0.97] ${
                fecha === hoy
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              Hoy
            </button>
            <button
              onClick={() => setFecha(manana)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors active:scale-[0.97] ${
                fecha === manana
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              Mañana
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
            ))}
          </div>
          <div className="h-48 bg-gray-100 rounded-2xl" />
        </div>
      ) : !data || data.kpis.total === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
          <FiPackage className="mx-auto mb-3 text-gray-300" size={44} />
          <p className="text-gray-500">No hay pedidos para esta fecha todavía.</p>
          <p className="text-gray-400 text-sm mt-1">
            Prueba con otro día, o vuelve cuando se registren pedidos.
          </p>
        </div>
      ) : (
        <>
          {/* ── HÉROE: total por producto ── */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2">
                <FiPackage className="text-red-600" /> Para preparar — total por producto
              </h2>
              <span className="text-xs text-gray-400">
                {data.kpis.total} pedido{data.kpis.total !== 1 ? "s" : ""}
              </span>
            </div>
            {totales.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {totales.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setProductoSeleccionado({ nombre: t.nombre, unidad: t.unidad })}
                    className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:border-red-300 hover:shadow-md transition-all active:scale-[0.98] text-left focus:outline-none focus:ring-2 focus:ring-red-500/20 cursor-pointer group flex flex-col justify-between h-full min-h-[6.5rem]"
                  >
                    <div className="text-xs text-gray-500 leading-snug line-clamp-2 group-hover:text-gray-800 transition-colors">
                      {t.nombre}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between w-full">
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-extrabold text-gray-900 tabular-nums">
                          {fmtCant(t.total)}
                        </span>
                        <span className="text-sm font-medium text-gray-400">{t.unidad}</span>
                      </div>
                      <span className="text-[10px] text-red-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        Ver detalle →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Hay {data.kpis.total} pedido(s), pero sus productos no están enlazados al
                catálogo, así que no se pueden sumar por producto. Los ves igual en el
                detalle de abajo.
              </div>
            )}
          </section>

          {/* ── Detalle de pedidos (secundario) ── */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2 mb-3">
              <FiClipboard className="text-gray-400" /> Pedidos de la fecha ({data.kpis.total})
            </h2>
            <div className="space-y-2.5">
              {data.pedidos.map((p) => (
                <div
                  key={p.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FiUser className="text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-gray-800 truncate">{p.cliente}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{p.empresa}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    {p.distrito && (
                      <span className="flex items-center gap-1">
                        <FiMapPin size={11} />
                        {p.distrito}
                      </span>
                    )}
                    {p.hora_entrega && (
                      <span className="flex items-center gap-1">
                        <FiClock size={11} />
                        {p.hora_entrega}
                      </span>
                    )}
                    {p.whatsapp && (
                      <a
                        href={`https://wa.me/${p.whatsapp.replace(/[^0-9]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-green-600 hover:underline"
                      >
                        <FiPhone size={11} />
                        {p.whatsapp}
                      </a>
                    )}
                  </div>
                  {p.items.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.items.map((it, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2 py-1"
                        >
                          <span className="font-semibold text-gray-800 tabular-nums">
                            {fmtCant(it.cantidad)} {it.unidad}
                          </span>
                          <span className="text-gray-500">{it.producto_nombre}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ── Modal de detalle por producto ── */}
      {productoSeleccionado && (
        <DetalleProductoModal
          producto={productoSeleccionado}
          pedidos={pedidosDelProducto}
          onClose={() => setProductoSeleccionado(null)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  Modal: desglose de pedidos por producto
// ════════════════════════════════════════════════════════════
interface PedidoConCantidad extends PedidoResumen {
  cantidad_pedida: string;
}

function DetalleProductoModal({
  producto,
  pedidos,
  onClose,
}: {
  producto: { nombre: string; unidad: string };
  pedidos: PedidoConCantidad[];
  onClose: () => void;
}) {
  const total = pedidos.reduce((acc, p) => acc + Number(p.cantidad_pedida), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col anim-slide-up">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold text-red-600 uppercase tracking-widest">
              Desglose de Pedidos
            </div>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5">{producto.nombre}</h2>
            <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
              <span>Total requerido:</span>
              <span className="font-semibold text-gray-800 tabular-nums">
                {fmtCant(total)} {producto.unidad}
              </span>
              <span>·</span>
              <span>{pedidos.length} pedido{pedidos.length !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <FiX className="text-lg" />
          </button>
        </div>

        {/* Contenido (Desglose) */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
          {pedidos.length === 0 ? (
            <p className="text-center text-gray-500 py-6 text-sm">
              No hay pedidos que contengan este producto.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {pedidos.map((p) => (
                <div key={p.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800 text-sm truncate">{p.cliente}</span>
                      <span className="text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-100 rounded-md px-1.5 py-0.5 uppercase">
                        {p.empresa}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {p.distrito && (
                        <span className="flex items-center gap-1">
                          <FiMapPin size={11} className="text-gray-400" />
                          {p.distrito}
                        </span>
                      )}
                      {p.hora_entrega && (
                        <span className="flex items-center gap-1">
                          <FiClock size={11} className="text-gray-400" />
                          {p.hora_entrega}
                        </span>
                      )}
                      {p.asesor_name && (
                        <span className="flex items-center gap-1">
                          <FiUser size={11} className="text-gray-400" />
                          Asesora: {p.asesor_name.trim()}
                        </span>
                      )}
                    </div>
                    {p.whatsapp && (
                      <div className="mt-1.5">
                        <a
                          href={`https://wa.me/${p.whatsapp.replace(/[^0-9]/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700 hover:underline"
                        >
                          <FiPhone size={11} />
                          <span>WhatsApp: {p.whatsapp}</span>
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-400 uppercase font-medium">Cantidad</div>
                    <div className="text-lg font-black text-red-600 tabular-nums">
                      {fmtCant(p.cantidad_pedida)} <span className="text-xs font-semibold text-gray-500">{producto.unidad}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t bg-gray-50 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-semibold hover:bg-gray-900 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

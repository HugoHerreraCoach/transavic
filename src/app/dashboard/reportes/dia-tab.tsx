// src/app/dashboard/reportes/dia-tab.tsx
// Vista "Día a día" — resumen OPERATIVO de un día puntual: la lista de pedidos
// (cliente, WhatsApp, dirección, items) + los totales por producto, útil para
// planear despacho/producción de la mañana. Distinto del reporte de Ventas
// (que es análisis por rango). Repulido para consistencia: sin gradientes,
// mismas tarjetas KPI que el resto.
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiTruck,
  FiUser,
  FiPhone,
  FiMapPin,
  FiChevronLeft,
  FiChevronRight,
  FiPackage,
  FiClipboard,
} from "react-icons/fi";
import { toLocalDateString, getLocalDateString } from "@/lib/utils";
import { KpiCard } from "./ui";

type PedidoResumen = {
  id: string;
  cliente: string;
  whatsapp: string | null;
  empresa: string;
  direccion: string | null;
  distrito: string | null;
  hora_entrega: string | null;
  notas: string | null;
  detalle: string;
  detalle_final: string | null;
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
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const f = date.toLocaleDateString("es-PE", opts);
  return f.charAt(0).toUpperCase() + f.slice(1);
}

export default function DiaTab() {
  const [data, setData] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fecha, setFecha] = useState(() => getLocalDateString(-1));
  const [filtro, setFiltro] = useState<"todos" | "pendientes" | "entregados">("todos");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/resumen-diario?fecha=${fecha}`);
      setData(await res.json());
    } catch (err) {
      console.error("Error:", err);
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

  const pedidosFiltrados = (data?.pedidos || []).filter((p) => {
    if (filtro === "pendientes") return !p.entregado;
    if (filtro === "entregados") return p.entregado;
    return true;
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-10 max-w-6xl mx-auto">
      {/* ── Navegación de fecha ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <p className="text-xs text-gray-500">Resumen operativo del día</p>
          <p className="text-lg font-bold text-gray-800">{formatDisplayDate(fecha)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => shiftDay(-1)}
            className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 active:scale-[0.95]"
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
            className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 active:scale-[0.95]"
          >
            <FiChevronRight />
          </button>
          <div className="flex gap-1.5 ml-1">
            <button
              onClick={() => setFecha(getLocalDateString(-1))}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 active:scale-[0.97]"
            >
              Ayer
            </button>
            <button
              onClick={() => setFecha(getLocalDateString(0))}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 active:scale-[0.97]"
            >
              Hoy
            </button>
          </div>
        </div>
      </div>

      {loading || !data ? (
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <KpiCard color="blue" icon={<FiTruck size={14} />} label="Total" value={data.kpis.total} />
            <KpiCard
              color="green"
              icon={<FiCheckCircle size={14} />}
              label="Entregados"
              value={data.kpis.entregados}
            />
            <KpiCard
              color={data.kpis.pendientes > 0 ? "amber" : "gray"}
              icon={<FiClock size={14} />}
              label="Pendientes"
              value={data.kpis.pendientes}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Pedidos ── */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center gap-2">
                {(["todos", "pendientes", "entregados"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors active:scale-[0.97] ${
                      filtro === f
                        ? "bg-gray-800 text-white border-gray-800"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {f === "todos"
                      ? `Todos (${data.kpis.total})`
                      : f === "pendientes"
                      ? `Pendientes (${data.kpis.pendientes})`
                      : `Entregados (${data.kpis.entregados})`}
                  </button>
                ))}
              </div>

              {pedidosFiltrados.length === 0 ? (
                <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-100">
                  <FiClipboard className="mx-auto mb-3" size={40} />
                  <p>No hay pedidos para mostrar este día.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pedidosFiltrados.map((p) => (
                    <div
                      key={p.id}
                      className={`bg-white rounded-xl shadow-sm border overflow-hidden ${
                        !p.entregado ? "border-amber-200" : "border-gray-200"
                      }`}
                    >
                      <div
                        className={`px-4 py-2 flex items-center justify-between ${
                          p.entregado ? "bg-green-50" : "bg-amber-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {p.entregado ? (
                            <FiCheckCircle className="text-green-600" />
                          ) : (
                            <FiClock className="text-amber-600" />
                          )}
                          <span
                            className={`text-sm font-semibold ${
                              p.entregado ? "text-green-700" : "text-amber-700"
                            }`}
                          >
                            {p.entregado ? "Entregado" : "Pendiente de entrega"}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">{p.empresa}</span>
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <FiUser className="text-gray-400 flex-shrink-0" />
                          <span className="font-semibold text-gray-800">{p.cliente}</span>
                        </div>
                        {p.whatsapp && (
                          <div className="flex items-center gap-2">
                            <FiPhone className="text-gray-400 flex-shrink-0" />
                            <a
                              href={`https://wa.me/${p.whatsapp.replace(/[^0-9]/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 text-sm hover:underline"
                            >
                              {p.whatsapp}
                            </a>
                          </div>
                        )}
                        {p.direccion && (
                          <div className="flex items-center gap-2">
                            <FiMapPin className="text-gray-400 flex-shrink-0" />
                            <span className="text-sm text-gray-600">
                              {p.direccion}
                              {p.distrito ? ` - ${p.distrito}` : ""}
                            </span>
                          </div>
                        )}
                        {p.hora_entrega && (
                          <div className="flex items-center gap-2">
                            <FiClock className="text-gray-400 flex-shrink-0" />
                            <span className="text-sm text-gray-600">{p.hora_entrega}</span>
                          </div>
                        )}
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{p.detalle}</p>
                        </div>
                        {p.items.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              Productos
                            </p>
                            {p.items.map((item, i) => (
                              <div
                                key={i}
                                className="flex justify-between text-sm bg-gray-50 px-3 py-1.5 rounded"
                              >
                                <span className="text-gray-700">{item.producto_nombre}</span>
                                <span className="font-semibold text-gray-800 tabular-nums">
                                  {item.cantidad} {item.unidad}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {p.detalle_final && (
                          <div className="mt-2 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                            <p className="text-xs font-semibold text-blue-600 mb-1">
                              Detalle final (pesado)
                            </p>
                            <p className="text-sm text-blue-800 whitespace-pre-wrap">
                              {p.detalle_final}
                            </p>
                          </div>
                        )}
                        {p.asesor_name && (
                          <p className="text-xs text-gray-400 mt-2">
                            Asesora: {p.asesor_name.trim()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Sidebar: Totales por producto ── */}
            <div>
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 sticky top-4">
                <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <FiPackage className="text-red-500" /> Total por producto
                </h2>
                {data.totalesPorProducto.length > 0 ? (
                  <div className="space-y-1.5">
                    {data.totalesPorProducto.map((p, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0"
                      >
                        <span className="text-sm text-gray-700">{p.nombre}</span>
                        <span className="text-sm font-bold text-red-700 bg-red-50 px-2.5 py-0.5 rounded-full tabular-nums whitespace-nowrap">
                          {Number(p.total).toFixed(Number(p.total) % 1 === 0 ? 0 : 1)} {p.unidad}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-6">
                    Los totales aparecen cuando los pedidos usan el catálogo.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// src/app/dashboard/gastos/gastos-client.tsx
// Listado de gastos: KPIs (hoy / mes actual), filtro por categoría (en memoria)
// y por rango de fechas (server-side, GET /api/gastos?desde&hasta).
// Los gastos se registran desde Caja Diaria — esta vista es solo consulta.
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FiAlertCircle,
  FiCalendar,
  FiCreditCard,
  FiFilter,
  FiRefreshCw,
  FiTag,
  FiTrendingDown,
  FiX,
} from "react-icons/fi";
import { fetchParametrosNegocio } from "@/lib/parametros-negocio";
import GuiaModulo from "@/components/GuiaModulo";

type Gasto = {
  id: string;
  /** Fecha ISO (YYYY-MM-DD) para cálculos. */
  fecha: string;
  /** Fecha lista para mostrar (DD/MM/YYYY). */
  fecha_formateada: string;
  categoria: string;
  descripcion: string | null;
  monto: number;
  metodo_pago: string | null;
  created_by_name: string | null;
};

/** Hoy en zona Lima como YYYY-MM-DD (en-CA formatea exactamente así). */
const hoyLima = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const formatSoles = (val: number) =>
  `S/ ${val.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Paleta de badges por categoría (clases completas para que Tailwind las compile).
const PALETA_BADGE = [
  "bg-red-50 text-red-700 border-red-100",
  "bg-amber-50 text-amber-700 border-amber-100",
  "bg-emerald-50 text-emerald-700 border-emerald-100",
  "bg-sky-50 text-sky-700 border-sky-100",
  "bg-indigo-50 text-indigo-700 border-indigo-100",
  "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100",
  "bg-teal-50 text-teal-700 border-teal-100",
  "bg-orange-50 text-orange-700 border-orange-100",
];

/** Color estable por nombre de categoría (mismo nombre → mismo color siempre). */
const colorCategoria = (categoria: string) => {
  let hash = 0;
  for (let i = 0; i < categoria.length; i++) {
    hash = (hash * 31 + categoria.charCodeAt(i)) >>> 0;
  }
  return PALETA_BADGE[hash % PALETA_BADGE.length];
};

export default function GastosClient() {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // KPIs hoy/mes: se calculan con la carga SIN rango (la vista por defecto ya
  // trae lo más reciente) y se conservan aunque el usuario filtre fechas viejas.
  const [kpisBase, setKpisBase] = useState<{ hoy: number; mes: number }>({ hoy: 0, mes: 0 });

  // Filtros
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  // Categorías configuradas por el admin (se unen con las de los gastos cargados).
  const [categoriasNegocio, setCategoriasNegocio] = useState<string[]>([]);

  const cargarGastos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      const res = await fetch(`/api/gastos${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Error cargando gastos");
      const data: Gasto[] = await res.json();
      const lista = Array.isArray(data) ? data : [];
      setGastos(lista);

      // Sin rango de fechas la respuesta incluye lo más reciente: es la base
      // correcta para los KPIs de hoy y del mes actual.
      if (!desde && !hasta) {
        const hoy = hoyLima();
        const mesActual = hoy.slice(0, 7); // YYYY-MM
        let totalHoy = 0;
        let totalMes = 0;
        for (const g of lista) {
          if (g.fecha === hoy) totalHoy += g.monto;
          if (g.fecha.startsWith(mesActual)) totalMes += g.monto;
        }
        setKpisBase({ hoy: totalHoy, mes: totalMes });
      }
    } catch (err) {
      console.error(err);
      setError("No se pudieron cargar los gastos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    cargarGastos();
  }, [cargarGastos]);

  useEffect(() => {
    let activo = true;
    fetchParametrosNegocio().then((p) => {
      if (activo) setCategoriasNegocio(p.categorias_gasto);
    });
    return () => {
      activo = false;
    };
  }, []);

  // Opciones del filtro: categorías configuradas + las presentes en los gastos.
  const categoriasDisponibles = useMemo(() => {
    const set = new Set<string>(categoriasNegocio);
    gastos.forEach((g) => {
      if (g.categoria) set.add(g.categoria);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [categoriasNegocio, gastos]);

  const gastosFiltrados = useMemo(() => {
    if (filtroCategoria === "todas") return gastos;
    return gastos.filter((g) => g.categoria === filtroCategoria);
  }, [gastos, filtroCategoria]);

  const totalListado = useMemo(
    () => gastosFiltrados.reduce((acc, g) => acc + g.monto, 0),
    [gastosFiltrados]
  );

  const hayFiltros = filtroCategoria !== "todas" || desde !== "" || hasta !== "";

  const limpiarFiltros = () => {
    setFiltroCategoria("todas");
    setDesde("");
    setHasta("");
  };

  return (
    <div className="space-y-6">
      <GuiaModulo modulo="gastos" />

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-center justify-between shadow-sm">
          <span className="text-xs font-semibold flex items-center gap-2">
            <FiAlertCircle size={16} /> {error}
          </span>
          <button
            onClick={cargarGastos}
            className="text-xs font-bold text-red-700 hover:text-red-900 flex items-center gap-1 cursor-pointer"
          >
            <FiRefreshCw size={13} /> Reintentar
          </button>
        </div>
      )}

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Gastado hoy
            </span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(kpisBase.hoy)}
            </span>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <FiTrendingDown size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Gastado este mes
            </span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(kpisBase.mes)}
            </span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <FiCalendar size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Total del listado
            </span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(totalListado)}
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              {gastosFiltrados.length} {gastosFiltrados.length === 1 ? "gasto" : "gastos"}
              {hayFiltros ? " (con filtros)" : ""}
            </span>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <FiTag size={20} />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-end gap-4">
        <div className="w-full md:w-56">
          <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiFilter size={12} /> Categoría
          </label>
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer"
          >
            <option value="todas">Todas las categorías</option>
            {categoriasDisponibles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full md:w-44">
          <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiCalendar size={12} /> Desde
          </label>
          <input
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>
        <div className="w-full md:w-44">
          <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiCalendar size={12} /> Hasta
          </label>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>
        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 whitespace-nowrap self-stretch md:self-auto flex items-center justify-center gap-1"
          >
            <FiX size={14} /> Limpiar filtros
          </button>
        )}
      </div>

      {/* Listado */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-20 text-gray-400 animate-pulse">Cargando gastos...</div>
        ) : gastosFiltrados.length === 0 ? (
          <div className="text-center py-16 space-y-3 px-4">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500">
              <FiTrendingDown size={32} />
            </div>
            {hayFiltros ? (
              <>
                <h3 className="font-bold text-gray-800 text-base">Sin resultados</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  No se encontraron gastos con los filtros seleccionados.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-bold text-gray-800 text-base">No hay gastos aún</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Los gastos se registran desde{" "}
                  <Link
                    href="/dashboard/caja-diaria"
                    className="text-red-600 font-semibold underline hover:text-red-700"
                  >
                    Caja Diaria
                  </Link>
                  . Cuando registres uno, aparecerá aquí.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Tabla (desktop) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                    <th className="py-4 px-6">Fecha</th>
                    <th className="py-4 px-4">Categoría</th>
                    <th className="py-4 px-4">Descripción</th>
                    <th className="py-4 px-4">Método de pago</th>
                    <th className="py-4 px-4 text-right">Monto</th>
                    <th className="py-4 px-6">Registrado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {gastosFiltrados.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-6 font-medium text-gray-900 whitespace-nowrap">
                        {g.fecha_formateada}
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border w-max inline-block ${colorCategoria(g.categoria)}`}
                        >
                          {g.categoria}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-gray-600 max-w-xs">
                        {g.descripcion || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-4 px-4 text-gray-600">
                        {g.metodo_pago ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                            <FiCreditCard size={12} className="text-gray-400" /> {g.metodo_pago}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right text-gray-900 font-extrabold text-sm whitespace-nowrap">
                        {formatSoles(g.monto)}
                      </td>
                      <td className="py-4 px-6 text-gray-600">
                        {g.created_by_name?.trim() || <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (móvil) */}
            <div className="md:hidden divide-y divide-gray-50">
              {gastosFiltrados.map((g) => (
                <div key={g.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border w-max inline-block ${colorCategoria(g.categoria)}`}
                      >
                        {g.categoria}
                      </span>
                      {g.descripcion && (
                        <p className="text-xs text-gray-600 mt-1.5 break-words">{g.descripcion}</p>
                      )}
                    </div>
                    <span className="text-base font-extrabold text-gray-900 whitespace-nowrap">
                      {formatSoles(g.monto)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <FiCalendar size={10} /> {g.fecha_formateada}
                    </span>
                    {g.metodo_pago && (
                      <span className="inline-flex items-center gap-1">
                        <FiCreditCard size={10} /> {g.metodo_pago}
                      </span>
                    )}
                    {g.created_by_name?.trim() && (
                      <span className="font-medium text-gray-500">
                        Registró: {g.created_by_name.trim()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// src/app/dashboard/ventas-generales/ventas-generales-client.tsx
// Las 3 operaciones de venta juntas por fecha. Ejecutivas incluye un detalle
// conciliable generado por la misma consulta que alimenta su tarjeta.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FiArrowRight,
  FiBarChart2,
  FiCalendar,
  FiCheckCircle,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiRefreshCw,
} from "react-icons/fi";
import { OPERACIONES, type OperacionVenta } from "@/lib/operaciones-venta";

function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}
function sumarDias(fecha: string, delta: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function etiquetaFecha(fecha: string, hoy: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = new Date(y, m - 1, d).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (fecha === hoy) return `Hoy, ${base}`;
  if (fecha === sumarDias(hoy, -1)) return `Ayer, ${base}`;
  const conAnio = y !== Number(hoy.slice(0, 4)) ? `${base} de ${y}` : base;
  return conAnio.charAt(0).toUpperCase() + conAnio.slice(1);
}
const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface OpData {
  total: number;
  ventas: number;
  ventasValorizadas: number;
  ventasPorValorizar: number;
}
interface DetalleEjecutiva {
  id: string;
  cliente: string;
  asesor: string;
  createdAt: string;
  fechaEntrega: string;
  estadoPedido: string;
  numeroGuia: string | null;
  monto: number | null;
  estadoValoracion: "confirmada" | "por_valorizar";
  itemsPendientes: number;
}
interface Respuesta {
  fecha: string;
  operaciones: Record<OperacionVenta, OpData>;
  detalleEjecutivas: DetalleEjecutiva[];
  total: number;
  totalVentas: number;
}

// A dónde lleva "ver detalle" de cada operación.
const DETALLE: Record<Exclude<OperacionVenta, "ejecutivas">, { href: string; cta: string }> = {
  campo: { href: "/dashboard/clientes-avicola/ventas", cta: "Ver ventas en campo" },
  planta: { href: "/dashboard/pos-planta", cta: "Ir al POS de planta" },
};
const ORDEN: OperacionVenta[] = ["ejecutivas", "campo", "planta"];

export default function VentasGeneralesClient() {
  const hoy = hoyLima();
  const [fecha, setFecha] = useState(hoy);
  const [data, setData] = useState<Respuesta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalleEjecutivasAbierto, setDetalleEjecutivasAbierto] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ventas-generales?fecha=${fecha}`);
      if (!res.ok) {
        setData(null);
        setError("No se pudieron cargar las ventas. Revisa tu conexión e intenta de nuevo.");
        return;
      }
      setData((await res.json()) as Respuesta);
    } catch {
      setData(null);
      setError("No se pudieron cargar las ventas. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const detalleEjecutivas = data?.detalleEjecutivas ?? [];
  // Sumar centavos evita diferencias visuales por punto flotante. Esta cifra es
  // solo la comprobación visible; el total oficial ya fue calculado en NUMERIC por SQL.
  const totalDetalleEjecutivas =
    detalleEjecutivas.reduce(
      (centavos, venta) =>
        centavos + (venta.monto === null ? 0 : Math.round(venta.monto * 100)),
      0
    ) / 100;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 flex items-center gap-2 tracking-tight">
          <FiBarChart2 className="text-gray-700" /> Ventas Generales
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Las 3 operaciones de venta en un solo lugar: 🛵 Ejecutivas, 🏪 Campo y 🏭 Planta.
          Elige el día para ver cuánto se vendió en cada una.
        </p>
      </div>

      {/* Navegación de fecha */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={() => setFecha((f) => sumarDias(f, -1))}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition"
          aria-label="Día anterior"
        >
          <FiChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
          <FiCalendar size={16} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-800 capitalize">
            {etiquetaFecha(fecha, hoy)}
          </span>
        </div>
        <button
          onClick={() => setFecha((f) => sumarDias(f, 1))}
          disabled={fecha >= hoy}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Día siguiente"
        >
          <FiChevronRight size={18} />
        </button>
        {fecha !== hoy && (
          <button
            onClick={() => setFecha(hoy)}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition"
          >
            Hoy
          </button>
        )}
        <input
          type="date"
          value={fecha}
          max={hoy}
          onChange={(e) => e.target.value && setFecha(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
        />
        <button
          onClick={fetchData}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition"
        >
          <FiRefreshCw size={15} /> Refrescar
        </button>
      </div>

      {error && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Total del día */}
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 mb-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">
          Total confirmado {etiquetaFecha(fecha, hoy).toLowerCase()}
        </p>
        <p className="text-3xl font-black text-gray-900">
          {loading ? "…" : fmtSoles(data?.total ?? 0)}
        </p>
        {!loading && data && (
          <p className="text-xs text-gray-500 mt-0.5">
            {data.totalVentas} operación{data.totalVentas === 1 ? "" : "es"} registrada
            {data.totalVentas === 1 ? "" : "s"}
          </p>
        )}
        {!loading && (data?.operaciones.ejecutivas.ventasPorValorizar ?? 0) > 0 && (
          <p className="mt-2 text-xs font-medium text-amber-700">
            {data?.operaciones.ejecutivas.ventasPorValorizar} venta
            {data?.operaciones.ejecutivas.ventasPorValorizar === 1 ? "" : "s"} de
            Ejecutivas por pesar; todavía no se incluyen en el importe.
          </p>
        )}
      </div>

      {/* Tarjetas por operación */}
      <div className="grid gap-3 sm:grid-cols-3">
        {ORDEN.map((op) => {
          const e = OPERACIONES[op];
          const d = data?.operaciones[op];
          return (
            <div
              key={op}
              className={`rounded-2xl border-l-4 border border-gray-200 bg-white px-4 py-4 ${e.borderClass}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${e.dotClass}`} />
                <span className={`text-sm font-bold ${e.textClass}`}>
                  {e.emoji} {e.label}
                </span>
              </div>
              {op === "ejecutivas" && (
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  Total confirmado
                </p>
              )}
              <p className="text-2xl font-black text-gray-900">
                {loading ? "…" : fmtSoles(d?.total ?? 0)}
              </p>
              {op === "ejecutivas" ? (
                <>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {loading
                      ? ""
                      : `${d?.ventas ?? 0} registradas · ${d?.ventasValorizadas ?? 0} valorizadas · ${d?.ventasPorValorizar ?? 0} por pesar`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDetalleEjecutivasAbierto((abierto) => !abierto)}
                    aria-expanded={detalleEjecutivasAbierto}
                    aria-controls="detalle-ventas-ejecutivas"
                    className="mt-3 min-h-11 inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-lg"
                  >
                    {detalleEjecutivasAbierto ? "Ocultar detalle" : "Conciliar ventas"}
                    <FiChevronDown
                      size={14}
                      className={`transition-transform ${detalleEjecutivasAbierto ? "rotate-180" : ""}`}
                    />
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {loading
                      ? ""
                      : `${d?.ventas ?? 0} venta${(d?.ventas ?? 0) === 1 ? "" : "s"}`}
                  </p>
                  <Link
                    href={DETALLE[op].href}
                    className="mt-3 min-h-11 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    {DETALLE[op].cta} <FiArrowRight size={13} />
                  </Link>
                </>
              )}
            </div>
          );
        })}
      </div>

      {detalleEjecutivasAbierto && (
        <section
          id="detalle-ventas-ejecutivas"
          className="mt-4 overflow-hidden rounded-2xl border border-blue-100 bg-white"
          aria-labelledby="titulo-detalle-ejecutivas"
        >
          <div className="border-b border-blue-100 bg-blue-50/60 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="titulo-detalle-ejecutivas" className="font-bold text-gray-900">
                  Conciliación de Ejecutivas
                </h2>
                <p className="mt-0.5 text-xs text-gray-600">
                  Cada pedido aparece una sola vez. “Por pesar” no aporta importe al total.
                </p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700 border border-blue-100">
                {detalleEjecutivas.length} registro{detalleEjecutivas.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {detalleEjecutivas.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              No hay ventas de Ejecutivas registradas en esta fecha.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {detalleEjecutivas.map((venta) => (
                <article
                  key={venta.id}
                  className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">{venta.cliente}</p>
                    <p className="mt-0.5 text-xs text-gray-500">Ejecutiva: {venta.asesor}</p>
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <p className="flex items-center gap-1.5">
                      <FiClock className="shrink-0" aria-hidden="true" /> Registrado: {venta.createdAt}
                    </p>
                    <p>
                      Entrega: {venta.fechaEntrega || "Sin fecha"} · {venta.estadoPedido}
                    </p>
                    {venta.numeroGuia && <p>Orden N.º {venta.numeroGuia}</p>}
                  </div>
                  <div className="sm:min-w-32 sm:text-right">
                    {venta.monto === null ? (
                      <>
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                          Por pesar
                        </span>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {venta.itemsPendientes > 0
                            ? `${venta.itemsPendientes} ítem${venta.itemsPendientes === 1 ? "" : "s"} pendiente${venta.itemsPendientes === 1 ? "" : "s"}`
                            : "Sin ítems para valorizar"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-base font-black text-gray-900">{fmtSoles(venta.monto)}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <FiCheckCircle aria-hidden="true" /> Confirmada
                        </p>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
            <span className="text-xs font-semibold text-gray-600">Suma de importes visibles</span>
            <span className="text-sm font-black text-gray-900">{fmtSoles(totalDetalleEjecutivas)}</span>
          </div>
        </section>
      )}

      <p className="text-xs text-gray-400 mt-5">
        La facturación de todas las operaciones vive en{" "}
        <Link href="/dashboard/comprobantes" className="font-semibold text-gray-600 hover:text-gray-800 underline">
          Comprobantes
        </Link>
        , con filtro por operación.
      </p>
    </div>
  );
}

// src/app/dashboard/ventas-generales/ventas-generales-client.tsx
// Las 3 operaciones de venta juntas por fecha, con su color (azul/ámbar/violeta) y un
// enlace al detalle de cada una. Consume GET /api/ventas-generales.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FiArrowRight,
  FiBarChart2,
  FiCalendar,
  FiChevronLeft,
  FiChevronRight,
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
}
interface Respuesta {
  fecha: string;
  operaciones: Record<OperacionVenta, OpData>;
  total: number;
  totalVentas: number;
}

// A dónde lleva "ver detalle" de cada operación.
const DETALLE: Record<OperacionVenta, { href: string; cta: string }> = {
  ejecutivas: { href: "/dashboard", cta: "Ver lista de pedidos" },
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
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Total del día */}
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 mb-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">
          Total vendido {etiquetaFecha(fecha, hoy).toLowerCase()}
        </p>
        <p className="text-3xl font-black text-gray-900">
          {loading ? "…" : fmtSoles(data?.total ?? 0)}
        </p>
        {!loading && data && (
          <p className="text-xs text-gray-500 mt-0.5">
            {data.totalVentas} venta{data.totalVentas === 1 ? "" : "s"} en total
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
              <p className="text-2xl font-black text-gray-900">
                {loading ? "…" : fmtSoles(d?.total ?? 0)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {loading ? "" : `${d?.ventas ?? 0} venta${(d?.ventas ?? 0) === 1 ? "" : "s"}`}
              </p>
              <Link
                href={DETALLE[op].href}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
              >
                {DETALLE[op].cta} <FiArrowRight size={13} />
              </Link>
            </div>
          );
        })}
      </div>

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

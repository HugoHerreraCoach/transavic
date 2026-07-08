// src/app/dashboard/clientes-avicola/panel/panel-client.tsx
// Panel gerencial (req. §14): cartera por cobrar como héroe + KPIs del mes +
// rankings (mejores compradores / mayor deuda) + clientes que dejaron de comprar.
// Consume GET /api/avicola/dashboard (shape DashboardAvicola, admin-only).
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiAward,
  FiChevronDown,
  FiChevronRight,
  FiClock,
} from "react-icons/fi";
import type { DashboardAvicola } from "@/lib/avicola/types";

const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const fmtKg = (n: number) =>
  n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

type BucketSinComprar = "d7" | "d15" | "d30";

const BUCKETS: Array<{ clave: BucketSinComprar; etiqueta: string; color: string }> = [
  { clave: "d7", etiqueta: "7 a 14 días", color: "text-yellow-700 border-yellow-200 bg-yellow-50" },
  { clave: "d15", etiqueta: "15 a 29 días", color: "text-orange-700 border-orange-200 bg-orange-50" },
  { clave: "d30", etiqueta: "30 días o más", color: "text-red-700 border-red-200 bg-red-50" },
];

export default function PanelClient() {
  const [data, setData] = useState<DashboardAvicola | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucketAbierto, setBucketAbierto] = useState<BucketSinComprar | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/avicola/dashboard");
      if (!res.ok) {
        setData(null);
        setError("No se pudo cargar el panel. Revisa tu conexión e intenta de nuevo.");
        return;
      }
      setData((await res.json()) as DashboardAvicola);
    } catch {
      setData(null);
      setError("No se pudo cargar el panel. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const topVolumen = data?.ranking_volumen.slice(0, 5) ?? [];
  const topDeuda = data?.ranking_deuda.slice(0, 5) ?? [];
  const maxVolumen = Math.max(...topVolumen.map((c) => c.total), 1);
  const maxDeuda = Math.max(...topDeuda.map((c) => c.saldo_actual), 1);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 pb-24 max-w-3xl mx-auto anim-fade">
      {/* ── Encabezado ── */}
      <div className="flex items-center gap-3 mb-5">
        <Link
          href="/dashboard/clientes-avicola"
          className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 active:scale-[0.95] transition-transform"
          aria-label="Volver a Clientes Avícola"
        >
          <FiArrowLeft />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel avícola</h1>
          <p className="text-sm text-gray-500">Cómo va el negocio de campo, de un vistazo.</p>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
            ))}
          </div>
          <div className="h-56 bg-gray-100 rounded-2xl" />
        </div>
      ) : error || !data ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-red-100">
          <p className="text-red-600 font-medium">
            {error ?? "No se pudo cargar el panel."}
          </p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* ── HÉROE: cartera por cobrar ── */}
          <section className="rounded-2xl bg-red-600 text-white p-5 sm:p-6 shadow-sm mb-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-red-100">
              Cartera por cobrar
            </div>
            <div className="text-4xl sm:text-5xl font-black tabular-nums mt-1.5">
              {fmtSoles(data.cartera_total)}
            </div>
            <div className="text-sm text-red-100 mt-1.5">
              {data.clientes_con_deuda === 1
                ? "1 cliente con deuda"
                : `${data.clientes_con_deuda} clientes con deuda`}
            </div>
          </section>

          {/* ── KPIs (grid 2 col) ── */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Clientes
              </div>
              <div className="text-2xl font-black text-gray-900 tabular-nums mt-1">
                {data.clientes_activos}
                <span className="text-sm font-semibold text-gray-400">
                  {" "}
                  de {data.total_clientes}
                </span>
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">activos</div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Ticket promedio del mes
              </div>
              <div className="text-2xl font-black text-gray-900 tabular-nums mt-1">
                {fmtSoles(data.ticket_promedio_mes)}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Kg vendidos (mes)
              </div>
              <div className="text-2xl font-black text-gray-900 tabular-nums mt-1">
                {fmtKg(data.kg_vendidos_mes)}{" "}
                <span className="text-sm font-semibold text-gray-400">kg</span>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Cobranza
              </div>
              <div className="mt-1.5 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-gray-500">Hoy</span>
                  <span className="text-sm font-bold text-green-700 tabular-nums">
                    {fmtSoles(data.cobranza.dia)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-gray-500">Mes</span>
                  <span className="text-sm font-bold text-green-700 tabular-nums">
                    {fmtSoles(data.cobranza.mes)}
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm col-span-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">
                Ventas
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-gray-500">Hoy</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">
                    {fmtSoles(data.ventas.dia)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-gray-500">Semana</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">
                    {fmtSoles(data.ventas.semana)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-gray-500">Mes</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">
                    {fmtSoles(data.ventas.mes)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Mejores compradores del mes ── */}
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2 mb-3">
              <FiAward className="text-red-600" /> Mejores compradores del mes
            </h2>
            {topVolumen.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-6 text-center text-sm text-gray-500">
                Este mes todavía no hay ventas registradas.
              </div>
            ) : (
              <div className="space-y-2">
                {topVolumen.map((c) => (
                  <Link
                    key={c.cliente_id}
                    href={`/dashboard/clientes-avicola/${c.cliente_id}`}
                    className="relative block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:border-red-200 transition-colors"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-red-100"
                      style={{ width: `${Math.max((c.total / maxVolumen) * 100, 4)}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {c.nombre}
                        </div>
                        <div className="text-[11px] text-gray-500">{c.mercado}</div>
                      </div>
                      <div className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">
                        {fmtSoles(c.total)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ── Mayor deuda ── */}
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2 mb-3">
              <FiAlertTriangle className="text-amber-600" /> Mayor deuda
            </h2>
            {topDeuda.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-6 text-center text-sm text-gray-500">
                Nadie debe nada. Cartera limpia.
              </div>
            ) : (
              <div className="space-y-2">
                {topDeuda.map((c) => (
                  <Link
                    key={c.cliente_id}
                    href={`/dashboard/clientes-avicola/${c.cliente_id}`}
                    className="relative block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:border-amber-300 transition-colors"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-amber-100"
                      style={{ width: `${Math.max((c.saldo_actual / maxDeuda) * 100, 4)}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {c.nombre}
                        </div>
                        <div className="text-[11px] text-gray-500">{c.mercado}</div>
                      </div>
                      <div className="text-sm font-bold text-red-700 tabular-nums flex-shrink-0">
                        {fmtSoles(c.saldo_actual)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ── Clientes sin comprar (acordeón por rango) ── */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2 mb-3">
              <FiClock className="text-gray-400" /> Clientes sin comprar
            </h2>
            <div className="flex gap-2 flex-wrap mb-3">
              {BUCKETS.map((b) => {
                const cantidad = data.sin_comprar[b.clave].length;
                const abierto = bucketAbierto === b.clave;
                return (
                  <button
                    key={b.clave}
                    onClick={() => setBucketAbierto(abierto ? null : b.clave)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors active:scale-[0.97] ${
                      abierto ? "ring-2 ring-gray-900/10 " + b.color : b.color
                    }`}
                  >
                    {b.etiqueta} ({cantidad})
                    <FiChevronDown
                      size={13}
                      className={`transition-transform ${abierto ? "rotate-180" : ""}`}
                    />
                  </button>
                );
              })}
            </div>
            {bucketAbierto &&
              (data.sin_comprar[bucketAbierto].length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-5 text-center text-sm text-gray-500">
                  No hay clientes en este rango.
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                  {data.sin_comprar[bucketAbierto].map((c) => (
                    <Link
                      key={c.cliente_id}
                      href={`/dashboard/clientes-avicola/${c.cliente_id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {c.nombre}
                        </div>
                        <div className="text-[11px] text-gray-500">{c.mercado}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-gray-500">
                        <span className="tabular-nums">hace {c.dias} días</span>
                        <FiChevronRight size={14} className="text-gray-300" />
                      </div>
                    </Link>
                  ))}
                </div>
              ))}
          </section>
        </>
      )}
    </div>
  );
}

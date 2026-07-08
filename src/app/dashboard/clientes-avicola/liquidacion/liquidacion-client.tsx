// src/app/dashboard/clientes-avicola/liquidacion/liquidacion-client.tsx
// Liquidación del día (req. §11): cuánto se vendió, cuánto se cobró y quién
// quedó debiendo — la rendición de cuentas del Gerente General al volver de campo.
// Consume GET /api/avicola/liquidacion (shape LiquidacionAvicola, admin-only).
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { IconType } from "react-icons";
import {
  FiArrowLeft,
  FiCalendar,
  FiChevronLeft,
  FiChevronRight,
  FiCreditCard,
  FiDollarSign,
  FiPackage,
  FiRepeat,
  FiSmartphone,
  FiUsers,
  FiZap,
} from "react-icons/fi";
import {
  ETIQUETA_MEDIO_PAGO,
  MEDIOS_PAGO_AVICOLA,
  type LiquidacionAvicola,
  type MedioPagoAvicola,
} from "@/lib/avicola/types";

// ── Helpers de fecha (zona Lima SIEMPRE — nunca toISOString) ──
/** Hoy en Lima como YYYY-MM-DD ("en-CA" formatea exactamente así). */
function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
}

/** Suma días a una fecha YYYY-MM-DD sin tocar zonas horarias. */
function sumarDias(fecha: string, delta: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** "Hoy, lunes 7 de julio" / "Ayer, domingo 6 de julio" / "Lunes 30 de junio". */
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

// ── Formatos ──
const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const fmtKg = (n: number) =>
  n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

const ICONO_MEDIO: Record<MedioPagoAvicola, IconType> = {
  efectivo: FiDollarSign,
  transferencia: FiRepeat,
  yape: FiSmartphone,
  plin: FiZap,
  otro: FiCreditCard,
};

export default function LiquidacionClient() {
  const hoy = hoyLima();
  const [fecha, setFecha] = useState(hoy);
  const [mercado, setMercado] = useState<string | null>(null);
  const [medioPago, setMedioPago] = useState<MedioPagoAvicola | null>(null);
  const [mercados, setMercados] = useState<string[]>([]);
  const [data, setData] = useState<LiquidacionAvicola | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ fecha });
      if (mercado) params.set("mercado", mercado);
      if (medioPago) params.set("medio_pago", medioPago);
      const res = await fetch(`/api/avicola/liquidacion?${params.toString()}`);
      if (!res.ok) {
        setData(null);
        setError("No se pudo cargar la liquidación. Revisa tu conexión e intenta de nuevo.");
        return;
      }
      const json = (await res.json()) as LiquidacionAvicola;
      setData(json);
      // Los chips de mercado se derivan del día SIN filtrar; con filtro activo
      // la respuesta trae un solo mercado y no debe encoger la lista.
      if (!mercado) {
        setMercados(
          [...new Set(json.ventas.por_cliente.map((c) => c.mercado).filter(Boolean))].sort(
            (a, b) => a.localeCompare(b, "es")
          )
        );
      }
    } catch {
      setData(null);
      setError("No se pudo cargar la liquidación. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [fecha, mercado, medioPago]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Cambiar de día limpia los filtros: cada fecha arranca con la foto completa. */
  const cambiarFecha = (nueva: string) => {
    if (!nueva || nueva > hoy) return; // sin futuro
    setMercado(null);
    setMedioPago(null);
    setFecha(nueva);
  };

  const esHoy = fecha === hoy;
  const hayFiltros = mercado !== null || medioPago !== null;
  const sinMovimientos = !!data && data.ventas.por_cliente.length === 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 pb-24 max-w-3xl mx-auto anim-fade">
      {/* ── Encabezado ── */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/dashboard/clientes-avicola"
          className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 active:scale-[0.95] transition-transform"
          aria-label="Volver a Clientes Avícola"
        >
          <FiArrowLeft />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidación del día</h1>
          <p className="text-sm text-gray-500">
            Lo vendido, lo cobrado y lo que quedó pendiente.
          </p>
        </div>
      </div>

      {/* ── Navegación de fecha: ‹ etiqueta › ── */}
      <div className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-2xl px-2 py-2 mb-5">
        <button
          onClick={() => cambiarFecha(sumarDias(fecha, -1))}
          className="p-2.5 rounded-xl hover:bg-gray-50 text-gray-700 active:scale-[0.95] transition-transform"
          aria-label="Día anterior"
        >
          <FiChevronLeft size={18} />
        </button>
        <label className="flex items-center gap-2 min-w-0 cursor-pointer">
          <FiCalendar className="text-red-600 flex-shrink-0" size={16} />
          <span className="font-semibold text-gray-900 text-sm sm:text-base truncate">
            {etiquetaFecha(fecha, hoy)}
          </span>
          {/* El input real queda invisible encima del texto: tocar la etiqueta abre el calendario */}
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => cambiarFecha(e.target.value)}
            className="sr-only"
            aria-label="Elegir fecha"
          />
        </label>
        <button
          onClick={() => cambiarFecha(sumarDias(fecha, 1))}
          disabled={esHoy}
          className="p-2.5 rounded-xl hover:bg-gray-50 text-gray-700 active:scale-[0.95] transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Día siguiente"
        >
          <FiChevronRight size={18} />
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
            ))}
          </div>
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-48 bg-gray-100 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-red-100">
          <p className="text-red-600 font-medium">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      ) : !data ? null : (
        <>
          {/* ── Chips de filtro (visibles aun con día vacío por filtro) ── */}
          {(mercados.length > 0 || hayFiltros) && (
            <div className="mb-5 space-y-2">
              {mercados.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mr-1">
                    Mercado
                  </span>
                  {mercados.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMercado(mercado === m ? null : m)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97] ${
                        mercado === m
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mr-1">
                  Medio de pago
                </span>
                {MEDIOS_PAGO_AVICOLA.map((mp) => (
                  <button
                    key={mp}
                    onClick={() => setMedioPago(medioPago === mp ? null : mp)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97] ${
                      medioPago === mp
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {ETIQUETA_MEDIO_PAGO[mp]}
                  </button>
                ))}
                {medioPago && (
                  <span className="text-[11px] text-gray-400">
                    (el medio de pago solo filtra lo cobrado)
                  </span>
                )}
              </div>
            </div>
          )}

          {sinMovimientos ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
              <FiPackage className="mx-auto mb-3 text-gray-300" size={44} />
              <p className="text-gray-500">
                {hayFiltros
                  ? "No hay movimientos con estos filtros."
                  : esHoy
                    ? "Hoy todavía no registras ventas."
                    : "No registraste ventas en esta fecha."}
              </p>
              {hayFiltros && (
                <button
                  onClick={() => {
                    setMercado(null);
                    setMedioPago(null);
                  }}
                  className="mt-3 text-sm text-red-600 font-medium hover:underline"
                >
                  Quitar filtros
                </button>
              )}
            </div>
          ) : (
            <>
              {/* ── 4 KPIs héroe (2×2) ── */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    Vendido
                  </div>
                  <div className="text-2xl font-black text-gray-900 tabular-nums mt-1">
                    {fmtSoles(data.ventas.total_vendido)}
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    Cobrado
                  </div>
                  <div className="text-2xl font-black text-green-700 tabular-nums mt-1">
                    {fmtSoles(data.cobranza.total_cobrado)}
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    Kg vendidos
                  </div>
                  <div className="text-2xl font-black text-gray-900 tabular-nums mt-1">
                    {fmtKg(data.ventas.total_kg)} <span className="text-sm font-semibold text-gray-400">kg</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    Clientes atendidos
                  </div>
                  <div className="text-2xl font-black text-gray-900 tabular-nums mt-1">
                    {data.ventas.clientes_atendidos}
                  </div>
                </div>
              </div>

              {/* ── Medios de pago (Otro solo si recibió algo) ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {data.cobranza.por_medio
                  .filter((m) => m.medio_pago !== "otro" || m.total > 0)
                  .map((m) => {
                    const Icono = ICONO_MEDIO[m.medio_pago];
                    return (
                      <div
                        key={m.medio_pago}
                        className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                          <Icono size={12} className="text-gray-400" />
                          {ETIQUETA_MEDIO_PAGO[m.medio_pago]}
                        </div>
                        <div className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">
                          {fmtSoles(m.total)}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* ── Contexto: pendiente del día + cartera total ── */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div
                  className={`rounded-2xl border p-4 shadow-sm ${
                    data.cobranza.pendiente_del_dia > 0
                      ? "border-amber-200 bg-amber-50"
                      : "border-gray-100 bg-white"
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Pendiente del día
                  </div>
                  <div
                    className={`text-lg font-black tabular-nums mt-1 ${
                      data.cobranza.pendiente_del_dia > 0 ? "text-amber-700" : "text-gray-900"
                    }`}
                  >
                    {fmtSoles(data.cobranza.pendiente_del_dia)}
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Cartera total
                  </div>
                  <div className="text-lg font-black text-red-700 tabular-nums mt-1">
                    {fmtSoles(data.cobranza.cartera_total)}
                  </div>
                </div>
              </div>

              {/* ── Por producto ── */}
              {data.ventas.por_producto.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2 mb-3">
                    <FiPackage className="text-red-600" /> Por producto
                  </h2>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                    {data.ventas.por_producto.map((p) => (
                      <div
                        key={p.producto_nombre}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="text-sm font-medium text-gray-800 min-w-0 truncate">
                          {p.producto_nombre}
                        </span>
                        <span className="flex items-baseline gap-3 flex-shrink-0 tabular-nums">
                          <span className="text-sm font-bold text-gray-900">
                            {fmtKg(p.total_kg)} <span className="font-medium text-gray-400">kg</span>
                          </span>
                          <span className="text-sm font-semibold text-gray-600">
                            {fmtSoles(p.total_monto)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Por cliente ── */}
              <section className="mb-6">
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-2 mb-3">
                  <FiUsers className="text-red-600" /> Por cliente
                </h2>
                <div className="space-y-2.5">
                  {data.ventas.por_cliente.map((c) => {
                    const noPago = c.vendido > 0 && c.abonado === 0;
                    return (
                      <Link
                        key={c.cliente_id}
                        href={`/dashboard/clientes-avicola/${c.cliente_id}`}
                        className={`block bg-white rounded-xl border shadow-sm p-3.5 transition-colors hover:border-gray-300 ${
                          noPago ? "border-amber-300" : "border-gray-100"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate">{c.nombre}</div>
                            <div className="text-xs text-gray-500">{c.mercado}</div>
                          </div>
                          {noPago && (
                            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5">
                              {esHoy ? "No pagó hoy" : "No pagó"}
                            </span>
                          )}
                        </div>
                        <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-[10px] font-medium uppercase text-gray-400">
                              Vendido
                            </div>
                            <div className="text-sm font-bold text-gray-900 tabular-nums">
                              {fmtSoles(c.vendido)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase text-gray-400">
                              Abonado
                            </div>
                            <div className="text-sm font-bold text-green-700 tabular-nums">
                              {fmtSoles(c.abonado)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase text-gray-400">
                              Saldo
                            </div>
                            <div
                              className={`text-sm font-bold tabular-nums ${
                                c.saldo_actual > 0 ? "text-red-700" : "text-gray-900"
                              }`}
                            >
                              {fmtSoles(c.saldo_actual)}
                            </div>
                          </div>
                        </div>
                        {c.medios.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {c.medios.map((mp) => {
                              const Icono = ICONO_MEDIO[mp];
                              return (
                                <span
                                  key={mp}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-md px-1.5 py-0.5"
                                >
                                  <Icono size={10} className="text-gray-400" />
                                  {ETIQUETA_MEDIO_PAGO[mp]}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>

              {/* ── Resumen de clientes ── */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-center text-sm text-gray-600">
                <span className="font-semibold text-gray-900">Visitados {data.clientes.visitados}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>
                  Pagaron <span className="font-semibold text-green-700">{data.clientes.con_pago}</span>
                </span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>
                  No pagaron <span className="font-semibold text-amber-700">{data.clientes.sin_pago}</span>
                </span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>
                  Con deuda <span className="font-semibold text-red-700">{data.clientes.con_deuda}</span>
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

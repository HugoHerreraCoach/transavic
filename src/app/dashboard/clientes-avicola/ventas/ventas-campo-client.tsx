// src/app/dashboard/clientes-avicola/ventas/ventas-campo-client.tsx
// Lista de ventas de campo por fecha (Hoy / Ayer / fecha elegida) con acción FACTURAR.
// La facturación reutiliza el MISMO formulario de las ejecutivas (emitir-client) en un
// modal, precargado con la venta (ventaAvicolaIdProp) → emite por /emitir-manual con
// venta_avicola_id (comprobante enlazado, SIN cobranza de ejecutivas). Ver gotcha #47.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  FiArrowLeft,
  FiAlertCircle,
  FiCalendar,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiFileText,
  FiRefreshCw,
  FiShoppingBag,
  FiX,
  FiPrinter,
} from "react-icons/fi";
import { OPERACIONES } from "@/lib/operaciones-venta";

// El formulario de emisión es un client component grande: se carga sólo cuando se abre
// el modal de facturar (ssr:false, igual que otros modales pesados del proyecto).
const EmitirComprobanteClient = dynamic(
  () => import("@/app/dashboard/comprobantes/nuevo/emitir-client"),
  { ssr: false }
);

// ── Helpers de fecha (zona Lima SIEMPRE — nunca toISOString) ──
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

interface VentaCampo {
  id: string;
  cliente_id: string;
  numero_guia: number;
  fecha: string;
  total: number;
  observaciones: string | null;
  anulada: boolean;
  anulacion_motivo: string | null;
  created_at: string;
  nombre: string;
  mercado: string;
  empresa: string;
  comprobante_id: string | null;
  comprobante_serie_numero: string | null;
  comprobante_tipo: string | null;
  comprobante_estado: string | null;
  comprobante_mensaje_sunat: string | null;
  comprobante_tiene_nc: boolean;
}

const ESTADO_CPE: Record<
  string,
  { etiqueta: string; clase: string }
> = {
  aceptado: {
    etiqueta: "Aceptado por SUNAT",
    clase: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  observado: {
    etiqueta: "Aceptado con observaciones",
    clase: "border-amber-200 bg-amber-50 text-amber-800",
  },
  pendiente: {
    etiqueta: "Pendiente de SUNAT",
    clase: "border-blue-200 bg-blue-50 text-blue-700",
  },
  emitiendo: {
    etiqueta: "Enviando a SUNAT",
    clase: "border-blue-200 bg-blue-50 text-blue-700",
  },
  error: {
    etiqueta: "Error de envío",
    clase: "border-red-200 bg-red-50 text-red-700",
  },
  rechazado: {
    etiqueta: "Rechazado por SUNAT",
    clase: "border-red-200 bg-red-50 text-red-700",
  },
  anulado: {
    etiqueta: "Anulado",
    clase: "border-gray-200 bg-gray-100 text-gray-600",
  },
};

function etiquetaTipoCpe(tipo: string | null): string {
  if (tipo === "01") return "Factura";
  if (tipo === "03") return "Boleta";
  if (tipo === "07") return "Nota de crédito";
  return "Comprobante";
}

export default function VentasCampoClient() {
  const hoy = hoyLima();
  const [fecha, setFecha] = useState(hoy);
  const [ventas, setVentas] = useState<VentaCampo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  // Cola de facturación: id abierto ahora + los que siguen (lote). Al cerrar el modal,
  // se refresca la lista y se abre el siguiente de la cola.
  const [facturarId, setFacturarId] = useState<string | null>(null);
  const [reemplazaComprobanteId, setReemplazaComprobanteId] = useState<string | null>(null);
  const [cola, setCola] = useState<string[]>([]);
  const [reintentandoId, setReintentandoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "ok" | "error";
    mensaje: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde: fecha, hasta: fecha });
      const res = await fetch(`/api/avicola/ventas?${params.toString()}`);
      if (!res.ok) {
        setVentas([]);
        setError("No se pudieron cargar las ventas. Revisa tu conexión e intenta de nuevo.");
        return;
      }
      const json = await res.json();
      setVentas(Array.isArray(json.ventas) ? json.ventas : []);
    } catch {
      setVentas([]);
      setError("No se pudieron cargar las ventas. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Al cambiar de fecha, limpiar la selección (los ids ya no aplican).
  useEffect(() => {
    setSeleccion(new Set());
  }, [fecha]);

  // Una venta sin CPE inicia una emisión normal. Un rechazo no entra en la
  // selección por lote: se corrige de forma explícita para enviar al backend el
  // id exacto que se reemplaza y consumir un nuevo correlativo con trazabilidad.
  const facturable = (v: VentaCampo) => !v.anulada && !v.comprobante_id;

  const resumen = useMemo(() => {
    const activas = ventas.filter((v) => !v.anulada);
    const totalVendido = activas.reduce((s, v) => s + v.total, 0);
    const aceptadas = activas.filter((v) =>
      ["aceptado", "observado"].includes(v.comprobante_estado ?? "")
    ).length;
    const sinComprobante = activas.filter((v) => !v.comprobante_id).length;
    const porResolver = activas.filter(
      (v) => v.comprobante_id && !["aceptado", "observado"].includes(v.comprobante_estado ?? "")
    ).length;
    return { totalVendido, aceptadas, sinComprobante, porResolver, count: activas.length };
  }, [ventas]);

  const idsFacturablesVisibles = useMemo(
    () => ventas.filter(facturable).map((v) => v.id),
    [ventas]
  );

  function toggleSel(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelTodas() {
    setSeleccion((prev) =>
      prev.size === idsFacturablesVisibles.length
        ? new Set()
        : new Set(idsFacturablesVisibles)
    );
  }

  function abrirFacturar(
    id: string,
    resto: string[] = [],
    reemplazaId: string | null = null
  ) {
    setCola(resto);
    setReemplazaComprobanteId(reemplazaId);
    setFacturarId(id);
  }
  function cerrarFacturar() {
    setFacturarId(null);
    setReemplazaComprobanteId(null);
    // Refrescar para actualizar el estado de facturación; luego seguir la cola (lote).
    fetchData();
    if (cola.length > 0) {
      const [siguiente, ...resto] = cola;
      setCola(resto);
      // Abrir el siguiente en el próximo tick (deja desmontar el modal actual primero).
      setTimeout(() => setFacturarId(siguiente), 60);
    }
  }
  function cancelarFacturacion() {
    setFacturarId(null);
    setReemplazaComprobanteId(null);
    setCola([]);
    void fetchData();
  }
  function facturarSeleccionadas() {
    const ids = ventas.filter((v) => seleccion.has(v.id) && facturable(v)).map((v) => v.id);
    if (ids.length === 0) return;
    const [primero, ...resto] = ids;
    setSeleccion(new Set());
    abrirFacturar(primero, resto);
  }

  async function reintentarComprobante(v: VentaCampo) {
    if (!v.comprobante_id || reintentandoId) return;
    setReintentandoId(v.comprobante_id);
    setAviso(null);
    try {
      const res = await fetch(`/api/comprobantes/${v.comprobante_id}/reintentar`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : typeof data?.detalle === "string"
              ? data.detalle
              : "No se pudo reintentar el comprobante."
        );
      }
      setAviso({
        tipo: data?.exito ? "ok" : "error",
        mensaje:
          data?.mensaje ||
          data?.descripcion ||
          (data?.exito
            ? "El comprobante se reenvió a SUNAT."
            : "SUNAT volvió a rechazar el comprobante."),
      });
      await fetchData();
    } catch (error) {
      setAviso({
        tipo: "error",
        mensaje:
          error instanceof Error
            ? error.message
            : "No se pudo reintentar el comprobante.",
      });
    } finally {
      setReintentandoId(null);
    }
  }

  const chip = OPERACIONES.campo;

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Header */}
      <div className="mb-5">
        <Link
          href="/dashboard/clientes-avicola"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3"
        >
          <FiArrowLeft size={15} /> Venta en Campo
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 flex items-center gap-2 tracking-tight">
            <FiShoppingBag className="text-amber-500" /> Ventas en Campo
          </h1>
          <span
            className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${chip.chipClass}`}
          >
            {chip.emoji} {chip.label}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Revisa las ventas del día y emite factura o boleta de las que elijas. El
          comprobante queda enlazado a la venta y no genera cobranza de ejecutivas.
        </p>
      </div>

      {/* Navegación de fecha */}
      <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button
          onClick={() => setFecha((f) => sumarDias(f, -1))}
          className="min-h-11 min-w-11 rounded-xl border border-gray-200 bg-white p-2 text-gray-600 transition hover:bg-gray-50 active:scale-95"
          aria-label="Día anterior"
        >
          <FiChevronLeft size={18} />
        </button>
        <div className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-2 sm:justify-start sm:px-3">
          <FiCalendar size={16} className="text-amber-500" />
          <span className="truncate text-center text-sm font-semibold capitalize text-gray-800 sm:text-left">
            {etiquetaFecha(fecha, hoy)}
          </span>
        </div>
        <button
          onClick={() => setFecha((f) => sumarDias(f, 1))}
          disabled={fecha >= hoy}
          className="min-h-11 min-w-11 rounded-xl border border-gray-200 bg-white p-2 text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Día siguiente"
        >
          <FiChevronRight size={18} />
        </button>
        <div className="col-span-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 sm:ml-auto sm:flex sm:items-center">
          <input
            type="date"
            value={fecha}
            max={hoy}
            aria-label="Elegir fecha de ventas"
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
          />
          {fecha !== hoy && (
            <button
              onClick={() => setFecha(hoy)}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 active:scale-95"
            >
              Hoy
            </button>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-50"
          >
            <FiRefreshCw size={15} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refrescar</span>
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Vendido</p>
          <p className="truncate text-base font-black text-gray-900 sm:text-lg">{fmtSoles(resumen.totalVendido)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Sin comprobante</p>
          <p className="text-lg font-black text-amber-600">{resumen.sinComprobante}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Aceptados</p>
          <p className="text-lg font-black text-emerald-600">{resumen.aceptadas}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Por resolver</p>
          <p className="text-lg font-black text-red-600">{resumen.porResolver}</p>
        </div>
      </div>

      {/* Barra de selección múltiple */}
      {idsFacturablesVisibles.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={seleccion.size === idsFacturablesVisibles.length && seleccion.size > 0}
              onChange={toggleSelTodas}
              className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            Seleccionar todas las facturables ({idsFacturablesVisibles.length})
          </label>
          {seleccion.size > 0 && (
            <button
              onClick={facturarSeleccionadas}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700 active:scale-95 sm:w-auto"
            >
              <FiFileText size={15} /> Facturar {seleccion.size} seleccionada{seleccion.size > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {/* Lista */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}
      {aviso && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            aviso.tipo === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
          role="status"
        >
          {aviso.mensaje}
        </div>
      )}
      {loading ? (
        <div className="py-16 text-center text-gray-400">Cargando ventas…</div>
      ) : ventas.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          No hay ventas registradas para {etiquetaFecha(fecha, hoy).toLowerCase()}.
        </div>
      ) : (
        <div className="space-y-2">
          {ventas.map((v) => {
            const puedeSel = facturable(v);
            const estado = v.comprobante_estado ?? "";
            const estadoInfo = ESTADO_CPE[estado] ?? {
              etiqueta: estado ? `Estado: ${estado}` : "Sin estado",
              clase: "border-gray-200 bg-gray-50 text-gray-600",
            };
            const conError = estado === "error";
            const rechazado = estado === "rechazado";
            const hrefComprobante = v.comprobante_serie_numero
              ? `/dashboard/clientes-avicola/comprobantes?search=${encodeURIComponent(v.comprobante_serie_numero)}`
              : "/dashboard/clientes-avicola/comprobantes";
            return (
              <article
                key={v.id}
                className={`flex items-start gap-3 rounded-2xl border bg-white p-3 sm:p-4 ${
                  v.anulada ? "border-gray-200 bg-gray-50/70" : "border-gray-200"
                }`}
              >
                {/* Checkbox (solo facturables) */}
                <input
                  type="checkbox"
                  disabled={!puedeSel}
                  checked={seleccion.has(v.id)}
                  onChange={() => toggleSel(v.id)}
                  aria-label={`Seleccionar venta de ${v.nombre}`}
                  className="mt-1 h-5 w-5 flex-shrink-0 rounded border-gray-300 text-amber-600 focus:ring-amber-500 disabled:opacity-30"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/clientes-avicola/${v.cliente_id}`}
                        className="block truncate font-bold text-gray-900 transition-colors hover:text-amber-700"
                      >
                        {v.nombre}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        Guía #{v.numero_guia} · {v.mercado}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="font-black text-gray-900">{fmtSoles(v.total)}</p>
                      {v.anulada && (
                        <span className="text-[11px] font-bold text-red-600">Venta anulada</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      {v.comprobante_id ? (
                        <>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${estadoInfo.clase}`}
                            title={v.comprobante_mensaje_sunat ?? undefined}
                          >
                            {estado === "aceptado" || estado === "observado" ? (
                              <FiCheckCircle size={13} />
                            ) : (
                              <FiAlertCircle size={13} />
                            )}
                            {estadoInfo.etiqueta}
                          </span>
                          <p className="mt-1 truncate text-xs text-gray-500">
                            {etiquetaTipoCpe(v.comprobante_tipo)} {v.comprobante_serie_numero ?? ""}
                            {v.comprobante_tiene_nc ? " · Con Nota de Crédito" : ""}
                          </p>
                        </>
                      ) : v.anulada ? (
                        <span className="text-xs font-medium text-gray-400">Sin comprobante</span>
                      ) : (
                        <span className="text-xs font-semibold text-amber-700">Sin comprobante</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 sm:flex-shrink-0 sm:justify-end">
                      {!v.anulada && (
                        <a
                          href={`/avicola/ventas/${v.id}/imprimir`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 sm:flex-none"
                        >
                          <FiPrinter size={14} /> Imprimir Orden
                        </a>
                      )}
                      {v.comprobante_id ? (
                        <>
                          <Link
                            href={hrefComprobante}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 sm:flex-none"
                          >
                            <FiFileText size={14} /> Ver comprobante
                          </Link>
                          {conError && (
                            <button
                              type="button"
                              onClick={() => void reintentarComprobante(v)}
                              disabled={reintentandoId !== null}
                              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                            >
                              <FiRefreshCw
                                size={14}
                                className={
                                  reintentandoId === v.comprobante_id ? "animate-spin" : ""
                                }
                              />
                              {reintentandoId === v.comprobante_id
                                ? "Reintentando…"
                                : "Reintentar"}
                            </button>
                          )}
                          {rechazado && !v.anulada && (
                            <button
                              type="button"
                              onClick={() =>
                                abrirFacturar(v.id, [], v.comprobante_id)
                              }
                              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700 active:scale-95 sm:flex-none"
                            >
                              <FiFileText size={14} /> Corregir y emitir nuevo
                            </button>
                          )}
                        </>
                      ) : !v.anulada ? (
                        <button
                          type="button"
                          onClick={() => abrirFacturar(v.id)}
                          className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700 active:scale-95 sm:w-auto"
                        >
                          <FiFileText size={14} /> Facturar
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal de facturación (reusa el formulario compartido) */}
      {facturarId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-2 sm:p-4 overflow-y-auto">
          <div className="relative bg-gray-50 rounded-2xl shadow-2xl w-full max-w-2xl my-4">
            <button
              onClick={cancelarFacturacion}
              className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/90 text-gray-500 hover:text-gray-800 shadow-sm"
              aria-label="Cerrar"
            >
              <FiX size={18} />
            </button>
            <div className="p-3 sm:p-5">
              {cola.length > 0 && (
                <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700">
                  Facturación en lote: quedan {cola.length} venta{cola.length > 1 ? "s" : ""} después de esta.
                </div>
              )}
              <EmitirComprobanteClient
                key={facturarId}
                ventaAvicolaIdProp={facturarId}
                reemplazaComprobanteIdProp={reemplazaComprobanteId}
                userRole="admin"
                onClose={cerrarFacturar}
                onCancel={cancelarFacturacion}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

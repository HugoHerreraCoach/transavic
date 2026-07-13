// src/app/dashboard/pos-planta/ventas/ventas-planta-client.tsx
// Lista de ventas del POS de planta por fecha, con Anular (reversa dinero + stock) y
// Editar (= anular y rehacer en el POS). Espejo de ventas-campo-client, color violeta 🏭.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FiArrowLeft,
  FiCalendar,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiEdit2,
  FiRefreshCw,
  FiShoppingCart,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import { OPERACIONES } from "@/lib/operaciones-venta";

// ── Fechas (zona Lima SIEMPRE) ──
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
/** Lunes de la semana de `fecha` (semana empieza lunes). */
function lunesDeSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const dow = dt.getDay(); // 0=dom..6=sab
  const diff = dow === 0 ? -6 : 1 - dow;
  return sumarDias(fecha, diff);
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

interface ItemVenta {
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
}
interface VentaPlanta {
  id: string;
  cliente: string | null;
  razon_social: string | null;
  ruc_dni: string | null;
  empresa: string;
  fecha: string;
  hora: string;
  created_at: string;
  anulada: boolean;
  anulacion_motivo: string | null;
  total: number;
  tipo_pago: string;
  cuenta_nombre: string | null;
  comprobante_serie_numero: string | null;
  comprobante_tipo: string | null;
  comprobante_estado: string | null;
  items: ItemVenta[];
}

type Modo = "dia" | "semana";

export default function VentasPlantaClient() {
  const router = useRouter();
  const hoy = hoyLima();
  const [modo, setModo] = useState<Modo>("dia");
  const [fecha, setFecha] = useState(hoy);
  const [ventas, setVentas] = useState<VentaPlanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<VentaPlanta | null>(null);
  const [irAlPosDespues, setIrAlPosDespues] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [toast, setToast] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const rango = useMemo(() => {
    if (modo === "semana") return { desde: lunesDeSemana(fecha), hasta: fecha === hoy ? hoy : sumarDias(lunesDeSemana(fecha), 6) };
    return { desde: fecha, hasta: fecha };
  }, [modo, fecha, hoy]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
      const res = await fetch(`/api/pos/ventas?${params.toString()}`);
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
  }, [rango.desde, rango.hasta]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const resumen = useMemo(() => {
    const activas = ventas.filter((v) => !v.anulada);
    return {
      total: activas.reduce((s, v) => s + v.total, 0),
      count: activas.length,
      anuladas: ventas.filter((v) => v.anulada).length,
    };
  }, [ventas]);

  async function confirmarAnular() {
    if (!anulando) return;
    setProcesando(true);
    try {
      const res = await fetch(`/api/pos/ventas/${anulando.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setAnulando(null);
        setMotivo("");
        if (irAlPosDespues) {
          router.push("/dashboard/pos-planta");
          return;
        }
        setToast({ tipo: "ok", texto: "Venta anulada. Se devolvió el stock y se revirtió el cobro." });
        fetchData();
      } else {
        setToast({ tipo: "error", texto: typeof j.error === "string" ? j.error : "No se pudo anular la venta." });
      }
    } catch {
      setToast({ tipo: "error", texto: "Error de conexión al anular." });
    } finally {
      setProcesando(false);
    }
  }

  const chip = OPERACIONES.planta;
  const etiquetaRango =
    modo === "semana"
      ? `Semana del ${new Date(rango.desde + "T12:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "short" })}`
      : etiquetaFecha(fecha, hoy);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-5">
        <Link
          href="/dashboard/pos-planta"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3"
        >
          <FiArrowLeft size={15} /> Venta Rápida
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 flex items-center gap-2 tracking-tight">
            <FiShoppingCart className="text-violet-500" /> Ventas de Planta
          </h1>
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${chip.chipClass}`}>
            {chip.emoji} {chip.label}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Revisa las ventas del POS y anula la que haga falta (devuelve el stock y revierte el cobro).
        </p>
      </div>

      {/* Modo día/semana + navegación */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setModo("dia")}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${modo === "dia" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}
          >
            Por día
          </button>
          <button
            onClick={() => { setModo("semana"); }}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${modo === "semana" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}
          >
            Esta semana
          </button>
        </div>
        {modo === "dia" && (
          <>
            <button
              onClick={() => setFecha((f) => sumarDias(f, -1))}
              className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition"
              aria-label="Día anterior"
            >
              <FiChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
              <FiCalendar size={16} className="text-violet-500" />
              <span className="text-sm font-semibold text-gray-800 capitalize">{etiquetaFecha(fecha, hoy)}</span>
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
              <button onClick={() => setFecha(hoy)} className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition">Hoy</button>
            )}
            <input
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
            />
          </>
        )}
        {modo === "semana" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
            <FiCalendar size={16} className="text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">{etiquetaRango}</span>
          </div>
        )}
        <button
          onClick={fetchData}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
        >
          <FiRefreshCw size={15} /> Refrescar
        </button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Vendido</p>
          <p className="text-lg font-black text-gray-900">{fmtSoles(resumen.total)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Ventas</p>
          <p className="text-lg font-black text-violet-600">{resumen.count}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Anuladas</p>
          <p className="text-lg font-black text-gray-400">{resumen.anuladas}</p>
        </div>
      </div>

      {/* Lista */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
      )}
      {loading ? (
        <div className="py-16 text-center text-gray-400">Cargando ventas…</div>
      ) : ventas.length === 0 ? (
        <div className="py-16 text-center text-gray-400">No hay ventas registradas en este período.</div>
      ) : (
        <div className="space-y-2">
          {ventas.map((v) => (
            <div
              key={v.id}
              className={`rounded-xl border bg-white px-3 py-3 sm:px-4 ${v.anulada ? "border-gray-150 opacity-60" : "border-gray-200"}`}
            >
              <div className="flex items-start gap-3">
                <div className="w-12 flex-shrink-0 text-center">
                  <p className="text-[10px] uppercase text-gray-400 font-bold">Hora</p>
                  <p className="font-mono font-bold text-gray-800 text-sm">{v.hora}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {v.razon_social || v.cliente || "Venta al paso"}
                    {v.anulada && <span className="ml-2 text-xs text-red-500 font-bold">· ANULADA</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {v.items.map((it) => `${Number(it.cantidad)} ${it.unidad} ${it.producto_nombre}`).join(" · ") || "—"}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {v.tipo_pago === "Credito" ? "Crédito" : v.cuenta_nombre || "Contado"}
                    {v.anulada && v.anulacion_motivo ? ` · ${v.anulacion_motivo}` : ""}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-gray-900">{fmtSoles(v.total)}</p>
                  {v.comprobante_serie_numero && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 mt-1">
                      <FiCheckCircle size={11} /> {v.comprobante_serie_numero}
                    </span>
                  )}
                </div>
              </div>
              {!v.anulada && (
                <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => { setAnulando(v); setMotivo(""); setIrAlPosDespues(true); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                    title="Anula esta venta y te lleva al POS para volver a hacerla"
                  >
                    <FiEdit2 size={13} /> Editar (anular y rehacer)
                  </button>
                  <button
                    onClick={() => { setAnulando(v); setMotivo(""); setIrAlPosDespues(false); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition"
                  >
                    <FiTrash2 size={13} /> Anular
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal anular */}
      {anulando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-red-100 text-red-600 flex-shrink-0">
                <FiTrash2 size={18} />
              </span>
              <h3 className="font-bold text-gray-900">Anular esta venta</h3>
              <button onClick={() => setAnulando(null)} className="ml-auto p-1.5 rounded-full text-gray-400 hover:bg-gray-100">
                <FiX size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p className="text-gray-700">
                Se <strong>devolverá el stock</strong> de los productos y se <strong>revertirá el cobro</strong>
                {anulando.tipo_pago === "Credito" ? " (se anula la deuda)" : ` de ${fmtSoles(anulando.total)} en ${anulando.cuenta_nombre || "la caja"}`}.
                Esta acción queda registrada.
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Motivo (opcional)</label>
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. error al cobrar, cliente devolvió…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  maxLength={250}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 sm:flex-row sm:justify-end">
              <button onClick={() => setAnulando(null)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800">Cancelar</button>
              <button
                onClick={confirmarAnular}
                disabled={procesando}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition"
              >
                <FiTrash2 size={15} /> {procesando ? "Anulando…" : "Sí, anular venta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold ${toast.tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.texto}
        </div>
      )}
    </div>
  );
}

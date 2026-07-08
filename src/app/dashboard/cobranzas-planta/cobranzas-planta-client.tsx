"use client";
// Cobranzas de Planta (operación 3): deudas a crédito del POS + abonos parciales
// ("saldito"). Aislado de las cobranzas de ejecutivas (lee de cobranzas_planta,
// no de facturas). Solo admin/produccion.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiDollarSign,
  FiSearch,
  FiX,
  FiSlash,
} from "react-icons/fi";
import GuiaModulo from "@/components/GuiaModulo";
import { useToast, ToastContainer } from "@/components/Toast";
import type {
  CobranzaPlanta,
  ClientePlantaConSaldo,
  EstadoCobranzaPlanta,
} from "@/lib/planta/types";
import AbonoPlantaModal from "./abono-planta-modal";

function soles(n: number): string {
  return `S/ ${Number(n).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizar(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Fecha YYYY-MM-DD → "07/07/2026" sin correr el día por zona horaria. */
function fechaLegible(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const TABS: Array<{ key: "Todas" | EstadoCobranzaPlanta; label: string }> = [
  { key: "Todas", label: "Todas" },
  { key: "Pendiente", label: "Pendiente" },
  { key: "Parcial", label: "Parcial" },
  { key: "Vencida", label: "Vencida" },
  { key: "Pagada", label: "Pagada" },
];

const BADGE: Record<EstadoCobranzaPlanta, string> = {
  Pendiente: "bg-amber-100 text-amber-700",
  Parcial: "bg-blue-100 text-blue-700",
  Vencida: "bg-red-100 text-red-700",
  Pagada: "bg-emerald-100 text-emerald-700",
  Anulada: "bg-gray-200 text-gray-500",
};

export default function CobranzasPlantaClient() {
  const [cobranzas, setCobranzas] = useState<CobranzaPlanta[]>([]);
  const [clientes, setClientes] = useState<ClientePlantaConSaldo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<"Todas" | EstadoCobranzaPlanta>("Todas");
  const [busqueda, setBusqueda] = useState("");
  const [cobranzaAbono, setCobranzaAbono] = useState<CobranzaPlanta | null>(null);
  const [cobranzaAnular, setCobranzaAnular] = useState<CobranzaPlanta | null>(null);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [anulando, setAnulando] = useState(false);
  const { mostrarToast, toasts } = useToast();

  const cargar = async () => {
    try {
      const res = await fetch("/api/cobranzas-planta");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCobranzas(Array.isArray(data.cobranzas) ? data.cobranzas : []);
      setClientes(Array.isArray(data.clientes) ? data.clientes : []);
    } catch {
      mostrarToast("No se pudieron cargar las cobranzas", "error");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deudaTotal = useMemo(
    () => clientes.reduce((s, c) => s + Math.max(c.saldo_actual, 0), 0),
    [clientes]
  );
  const clientesConDeuda = useMemo(
    () => clientes.filter((c) => c.saldo_actual > 0.01).length,
    [clientes]
  );

  const filtradas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return cobranzas.filter((c) => {
      if (tab !== "Todas" && c.estado !== tab) return false;
      if (q && !normalizar(c.cliente_nombre).includes(q)) return false;
      return true;
    });
  }, [cobranzas, tab, busqueda]);

  const anularCobranza = async () => {
    if (!cobranzaAnular || motivoAnular.trim().length < 5) return;
    setAnulando(true);
    try {
      const res = await fetch(`/api/cobranzas-planta/${cobranzaAnular.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivoAnular.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || "No se pudo anular");
      }
      mostrarToast("Deuda anulada", "exito");
      setCobranzaAnular(null);
      setMotivoAnular("");
      cargar();
    } catch (e) {
      mostrarToast(e instanceof Error ? e.message : "Error al anular", "error");
    } finally {
      setAnulando(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/dashboard/pos-planta"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600"
      >
        <FiArrowLeft className="h-4 w-4" /> Volver a Venta Rápida
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Cobranzas de Planta</h1>
        <p className="text-sm text-gray-500">Las deudas a crédito de la Venta en Planta, aparte de las de ejecutivas.</p>
      </div>

      <GuiaModulo modulo="cobranzas-planta" />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase">Deuda total planta</p>
          <p className="text-2xl font-black text-red-600">{soles(deudaTotal)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase">Clientes con deuda</p>
          <p className="text-2xl font-black text-gray-900">{clientesConDeuda}</p>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative">
        <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Busca por cliente"
          className="w-full h-12 pl-11 pr-11 rounded-2xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {busqueda && (
          <button
            type="button"
            onClick={() => setBusqueda("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-gray-100 text-gray-500"
            aria-label="Limpiar"
          >
            <FiX className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs por estado */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-3.5 h-9 rounded-full text-sm font-semibold border transition ${
              tab === t.key
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {cargando ? (
        <p className="text-center text-gray-400 py-10 animate-pulse">Cargando…</p>
      ) : filtradas.length === 0 ? (
        <p className="text-center text-gray-500 py-10 text-sm">No hay cobranzas para este filtro.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtradas.map((c) => (
            <div
              key={c.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                c.anulada ? "opacity-60 border-gray-200" : "border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-gray-900">{c.cliente_nombre}</p>
                  <p className="text-xs text-gray-500">
                    {fechaLegible(c.fecha_emision)} · vence {fechaLegible(c.fecha_vencimiento)}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${BADGE[c.estado]}`}>
                  {c.estado}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                <div>
                  <p className="text-[10px] text-gray-400 uppercase">Deuda</p>
                  <p className="font-semibold text-gray-900">{soles(c.monto)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase">Abonado</p>
                  <p className="font-semibold text-emerald-600">{soles(c.total_abonado)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase">Saldo</p>
                  <p className={`font-black ${c.saldo > 0.01 ? "text-red-600" : "text-emerald-600"}`}>
                    {soles(c.saldo)}
                  </p>
                </div>
              </div>

              {c.anulada && c.anulacion_motivo && (
                <p className="text-xs text-red-500 mt-2">Anulada · {c.anulacion_motivo}</p>
              )}

              {!c.anulada && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {c.saldo > 0.01 ? (
                    <button
                      type="button"
                      onClick={() => setCobranzaAbono(c)}
                      className="flex items-center justify-center gap-2 h-11 rounded-xl bg-emerald-600 text-white font-bold active:scale-95 transition"
                    >
                      <FiDollarSign className="h-4 w-4" /> Registrar abono
                    </button>
                  ) : (
                    <span className="flex items-center justify-center h-11 rounded-xl bg-emerald-50 text-emerald-700 font-bold">
                      Pagada
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setCobranzaAnular(c)}
                    className="flex items-center justify-center gap-2 h-11 rounded-xl border border-red-200 text-red-600 font-bold active:scale-95 transition"
                  >
                    <FiSlash className="h-4 w-4" /> Anular
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal abono */}
      {cobranzaAbono && (
        <AbonoPlantaModal
          cobranza={cobranzaAbono}
          onClose={() => setCobranzaAbono(null)}
          onGuardado={cargar}
        />
      )}

      {/* Modal anular */}
      {cobranzaAnular && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-3">
            <h2 className="text-lg font-black text-gray-900">Anular deuda</h2>
            <p className="text-sm text-gray-500">
              {cobranzaAnular.cliente_nombre} · {soles(cobranzaAnular.saldo)}
            </p>
            <textarea
              value={motivoAnular}
              onChange={(e) => setMotivoAnular(e.target.value)}
              placeholder="¿Por qué se anula? (mínimo 5 caracteres)"
              className="w-full rounded-xl border border-gray-200 p-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setCobranzaAnular(null); setMotivoAnular(""); }}
                className="flex-1 h-11 rounded-xl border border-gray-300 text-gray-700 font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={anularCobranza}
                disabled={motivoAnular.trim().length < 5 || anulando}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
              >
                {anulando ? "Anulando…" : "Sí, anular"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

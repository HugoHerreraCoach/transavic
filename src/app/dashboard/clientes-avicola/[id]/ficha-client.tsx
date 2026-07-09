"use client";

// src/app/dashboard/clientes-avicola/[id]/ficha-client.tsx
// Ficha 360 del cliente avícola (req. §5/§6): héroe con estado de cuenta,
// acciones grandes (Vender / Abonar / Estado de cuenta), contacto e HISTORIAL
// cronológico de ventas y abonos con reenvío de guía y anulación con motivo.
// Mobile-first (uso en campo): botones ≥48px, textos grandes, active:scale-95.
// El client hace el fetch de GET /api/avicola/clientes/{id} para poder
// refrescar la ficha tras cada acción sin recargar la página.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiChevronDown,
  FiDollarSign,
  FiEdit2,
  FiFileText,
  FiLoader,
  FiMapPin,
  FiMessageCircle,
  FiPaperclip,
  FiPhone,
  FiShare2,
  FiShoppingCart,
  FiX,
} from "react-icons/fi";
import type {
  FichaClienteAvicola,
  GuiaAvicolaData,
  MovimientoAvicola,
} from "@/lib/avicola/types";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/avicola/types";
import { UMBRAL_DEUDA } from "@/lib/avicola/saldos";
import { formatNumeroGuia } from "@/lib/correlativos";
import ClienteAvicolaForm from "../cliente-avicola-form";
import AbonoModal from "../abono-modal";
import EstadoCuentaModal from "../estado-cuenta-modal";
import GuiaAvicolaModal from "../guia-avicola-modal";

const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-07-07" → "07/07/2026" (sin pasar por Date: evita el corrimiento UTC). */
function fechaCorta(fecha: string | null): string {
  if (!fecha) return "—";
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/* ------------------------------------------------------------------ */
/* Mini-modal de anulación con motivo OBLIGATORIO (el server exige ≥5) */
/* ------------------------------------------------------------------ */

function AnularModal({
  titulo,
  url,
  onClose,
  onAnulado,
}: {
  titulo: string;
  url: string;
  onClose: () => void;
  onAnulado: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const motivoValido = motivo.trim().length >= 5;

  const confirmar = async () => {
    if (!motivoValido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          typeof data?.error === "string" ? data.error : "No se pudo anular. Intenta de nuevo."
        );
        return;
      }
      onAnulado();
    } catch {
      setError("Sin conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-xl">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-gray-900">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            aria-label="Cerrar"
            className="shrink-0 h-12 w-12 flex items-center justify-center rounded-2xl bg-gray-100 text-gray-600 active:scale-95 transition-transform cursor-pointer"
          >
            <FiX size={22} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 pb-8">
          <div>
            <label htmlFor="anular-motivo" className="block text-sm font-bold text-gray-700 mb-1">
              ¿Por qué se anula? <span className="text-red-500">*</span>
            </label>
            <textarea
              id="anular-motivo"
              rows={3}
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. se registró dos veces por error"
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 resize-none"
            />
            {!motivoValido && motivo.trim().length > 0 && (
              <p className="mt-1 text-sm text-red-600">
                El motivo debe tener al menos 5 caracteres.
              </p>
            )}
          </div>

          {error && (
            <p className="text-base font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmar}
              disabled={!motivoValido || enviando}
              className="flex-1 h-12 rounded-2xl bg-red-600 text-white text-base font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform cursor-pointer disabled:opacity-50 disabled:active:scale-100"
            >
              {enviando ? (
                <>
                  <span className="inline-block h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Anulando...
                </>
              ) : (
                "Sí, anular"
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={enviando}
              className="flex-1 h-12 rounded-2xl bg-white border-2 border-gray-300 text-gray-700 text-base font-bold active:scale-95 transition-transform cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ficha 360                                                           */
/* ------------------------------------------------------------------ */

export default function FichaAvicolaClient({ clienteId }: { clienteId: string }) {
  const [ficha, setFicha] = useState<FichaClienteAvicola | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modales
  const [modalEditar, setModalEditar] = useState(false);
  const [modalAbono, setModalAbono] = useState(false);
  const [modalEstado, setModalEstado] = useState(false);
  const [guiaModal, setGuiaModal] = useState<GuiaAvicolaData | null>(null);
  const [cargandoGuia, setCargandoGuia] = useState<string | null>(null);
  const [anular, setAnular] = useState<{ tipo: "venta" | "abono"; id: string } | null>(null);

  // Ventas expandidas (para ver los items con peso × precio).
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const cargarFicha = useCallback(async () => {
    try {
      const res = await fetch(`/api/avicola/clientes/${clienteId}`);
      if (res.status === 404) {
        setError("Cliente no encontrado.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : `Estado ${res.status}`);
      }
      const data: FichaClienteAvicola = await res.json();
      setFicha(data);
      setError(null);
    } catch (err) {
      console.error("Error al cargar la ficha del cliente avícola:", err);
      setError("No se pudo cargar la ficha. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }, [clienteId]);

  useEffect(() => {
    cargarFicha();
  }, [cargarFicha]);

  // Historial DESC por fecha (desempate por created_at) — mismo criterio que
  // el estado de cuenta, por si el server cambiara el orden algún día.
  const historial = useMemo(() => {
    const base = ficha?.historial ?? [];
    return [...base].sort((a, b) =>
      a.fecha === b.fecha
        ? b.created_at.localeCompare(a.created_at)
        : b.fecha.localeCompare(a.fecha)
    );
  }, [ficha]);

  // WhatsApp normalizado 51 + dígitos (mismo patrón que la ficha de clientes).
  const whatsappLink = useMemo(() => {
    const tel = ficha?.cliente.telefono;
    if (!tel) return null;
    const limpio = tel.replace(/\D/g, "");
    if (!limpio) return null;
    const numero = limpio.startsWith("51") ? limpio : `51${limpio}`;
    return `https://wa.me/${numero}`;
  }, [ficha?.cliente.telefono]);

  const telefonoLink = useMemo(() => {
    const tel = ficha?.cliente.telefono;
    if (!tel) return null;
    const limpio = tel.replace(/\D/g, "");
    if (!limpio) return null;
    return `tel:+${limpio.startsWith("51") ? limpio : `51${limpio}`}`;
  }, [ficha?.cliente.telefono]);

  const toggleExpandida = (ventaId: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(ventaId)) next.delete(ventaId);
      else next.add(ventaId);
      return next;
    });
  };

  const reenviarGuia = async (ventaId: string) => {
    if (cargandoGuia) return;
    setCargandoGuia(ventaId);
    try {
      const res = await fetch(`/api/avicola/ventas/${ventaId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.guia) {
        throw new Error(typeof data?.error === "string" ? data.error : `Estado ${res.status}`);
      }
      setGuiaModal(data.guia as GuiaAvicolaData);
    } catch (err) {
      console.error("Error al cargar la guía de la venta:", err);
      alert("No se pudo cargar la guía. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setCargandoGuia(null);
    }
  };

  /* ---------- Loading skeleton ---------- */
  if (cargando && !ficha) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-40 bg-gray-200 rounded-full" />
        <div className="h-20 bg-gray-200 rounded-3xl" />
        <div className="h-40 bg-gray-200 rounded-3xl" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-14 bg-gray-200 rounded-2xl" />
          <div className="h-14 bg-gray-200 rounded-2xl" />
          <div className="h-14 bg-gray-200 rounded-2xl" />
        </div>
        <div className="h-64 bg-gray-200 rounded-3xl" />
      </div>
    );
  }

  /* ---------- Error / no encontrado ---------- */
  if (error || !ficha) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Link
          href="/dashboard/clientes-avicola"
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline mb-4"
        >
          <FiArrowLeft /> Volver a clientes avícola
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-base font-semibold">
          {error ?? "No se pudo cargar la ficha."}
        </div>
        <button
          type="button"
          onClick={() => {
            setCargando(true);
            setError(null);
            cargarFicha();
          }}
          className="mt-4 h-12 px-6 rounded-2xl bg-gray-800 text-white text-base font-bold active:scale-95 transition-transform cursor-pointer"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const cliente = ficha.cliente;
  const saldo = cliente.saldo_actual;
  const conDeuda = saldo > UMBRAL_DEUDA;
  const aFavor = saldo < -UMBRAL_DEUDA;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 pb-10">
      {/* Volver a la lista */}
      <Link
        href="/dashboard/clientes-avicola"
        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline"
      >
        <FiArrowLeft /> Volver a clientes avícola
      </Link>

      {/* HEADER: identidad + editar */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-gray-900 break-words">
              {cliente.nombre}
            </h1>
            <p className="text-base text-gray-500 mt-0.5">
              {cliente.mercado}
              {cliente.numero_puesto ? ` · Puesto ${cliente.numero_puesto}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                {cliente.empresa}
              </span>
              {!cliente.activo && (
                <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  Inactivo
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalEditar(true)}
            aria-label="Editar cliente"
            className="shrink-0 h-12 w-12 flex items-center justify-center rounded-2xl bg-gray-100 text-gray-600 active:scale-95 transition-transform cursor-pointer"
          >
            <FiEdit2 size={20} />
          </button>
        </div>
      </div>

      {/* HÉROE: estado de cuenta 2×2 */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Saldo anterior
            </p>
            <p className="text-lg font-bold text-gray-900">{fmtSoles(cliente.saldo_anterior)}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Total vendido
            </p>
            <p className="text-lg font-bold text-gray-900">{fmtSoles(cliente.total_vendido)}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Total abonado
            </p>
            <p className="text-lg font-bold text-gray-900">{fmtSoles(cliente.total_abonado)}</p>
          </div>
          <div
            className={`rounded-2xl border p-3 ${
              conDeuda ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Saldo pendiente
            </p>
            <p
              className={`text-2xl font-black ${conDeuda ? "text-red-600" : "text-green-600"}`}
            >
              {conDeuda
                ? fmtSoles(saldo)
                : aFavor
                  ? `A favor ${fmtSoles(Math.abs(saldo))}`
                  : "Al día"}
            </p>
          </div>
        </div>

        {/* Acciones principales */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {cliente.activo ? (
            <Link
              href={`/dashboard/clientes-avicola/${clienteId}/venta`}
              className="h-14 rounded-2xl bg-red-600 text-white text-sm sm:text-base font-black flex items-center justify-center gap-2 shadow-md shadow-red-600/20 active:scale-95 transition-transform"
            >
              <FiShoppingCart size={18} className="shrink-0" />
              Vender
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="El cliente está inactivo: no se le pueden registrar ventas."
              className="h-14 rounded-2xl bg-red-600 text-white text-sm sm:text-base font-black flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
            >
              <FiShoppingCart size={18} className="shrink-0" />
              Vender
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalAbono(true)}
            className="h-14 rounded-2xl bg-green-600 text-white text-sm sm:text-base font-black flex items-center justify-center gap-2 shadow-md shadow-green-600/20 active:scale-95 transition-transform cursor-pointer"
          >
            <FiDollarSign size={18} className="shrink-0" />
            Abonar
          </button>
          <button
            type="button"
            onClick={() => setModalEstado(true)}
            className="h-14 rounded-2xl bg-gray-800 text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-transform cursor-pointer"
          >
            <FiFileText size={18} className="shrink-0" />
            <span className="leading-tight text-left">
              Estado de
              <br className="sm:hidden" /> cuenta
            </span>
          </button>
        </div>
        {!cliente.activo && (
          <p className="mt-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            Cliente inactivo: no se le pueden registrar ventas, pero sí abonos.
          </p>
        )}
      </div>

      {/* CONTACTO */}
      {(cliente.telefono || cliente.direccion || cliente.observaciones) && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">Contacto</h2>
          {cliente.telefono && (
            <div className="flex gap-2">
              {whatsappLink && (
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-12 rounded-2xl bg-green-500 text-white text-base font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
                >
                  <FiMessageCircle size={18} />
                  WhatsApp
                </a>
              )}
              {telefonoLink && (
                <a
                  href={telefonoLink}
                  className="flex-1 h-12 rounded-2xl bg-white border-2 border-gray-300 text-gray-800 text-base font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
                >
                  <FiPhone size={18} />
                  Llamar
                </a>
              )}
            </div>
          )}
          {cliente.direccion && (
            <p className="flex items-start gap-2 text-base text-gray-600">
              <FiMapPin size={18} className="shrink-0 mt-0.5 text-gray-400" />
              {cliente.direccion}
            </p>
          )}
          {cliente.observaciones && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-2xl px-4 py-3">
              {cliente.observaciones}
            </p>
          )}
        </div>
      )}

      {/* HISTORIAL de movimientos */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-black text-gray-900">Historial</h2>
        </div>

        {historial.length === 0 ? (
          <p className="p-6 text-base text-gray-500 text-center">
            Sin movimientos todavía. Registra la primera venta o abono.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {historial.map((mov) => (
              <MovimientoRow
                key={`${mov.tipo}-${mov.id}`}
                mov={mov}
                expandida={expandidas.has(mov.id)}
                onToggle={() => toggleExpandida(mov.id)}
                cargandoGuia={cargandoGuia === mov.id}
                onReenviarGuia={() => reenviarGuia(mov.id)}
                onAnular={() => setAnular({ tipo: mov.tipo, id: mov.id })}
                clienteId={clienteId}
              />
            ))}
          </ul>
        )}

        {/* Pie: últimas fechas */}
        <p className="px-5 py-3 border-t border-gray-100 text-sm text-gray-500 text-center">
          Última compra: <span className="font-semibold">{fechaCorta(cliente.ultima_compra)}</span>
          {" · "}
          Último pago: <span className="font-semibold">{fechaCorta(cliente.ultimo_pago)}</span>
        </p>
      </div>

      {/* MODALES */}
      {modalEditar && (
        <ClienteAvicolaForm
          cliente={cliente}
          mercadosSugeridos={[cliente.mercado]}
          onClose={() => setModalEditar(false)}
          onGuardado={cargarFicha}
        />
      )}
      {modalAbono && (
        <AbonoModal
          cliente={cliente}
          onClose={() => setModalAbono(false)}
          onGuardado={cargarFicha}
        />
      )}
      {modalEstado && <EstadoCuentaModal cliente={cliente} onClose={() => setModalEstado(false)} />}
      {guiaModal && <GuiaAvicolaModal data={guiaModal} onClose={() => setGuiaModal(null)} />}
      {anular && (
        <AnularModal
          titulo={anular.tipo === "venta" ? "Anular venta" : "Anular abono"}
          url={
            anular.tipo === "venta"
              ? `/api/avicola/ventas/${anular.id}/anular`
              : `/api/avicola/abonos/${anular.id}/anular`
          }
          onClose={() => setAnular(null)}
          onAnulado={() => {
            setAnular(null);
            cargarFicha();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fila del historial (venta o abono)                                  */
/* ------------------------------------------------------------------ */

function MovimientoRow({
  mov,
  expandida,
  onToggle,
  cargandoGuia,
  onReenviarGuia,
  onAnular,
  clienteId,
}: {
  mov: MovimientoAvicola;
  expandida: boolean;
  onToggle: () => void;
  cargandoGuia: boolean;
  onReenviarGuia: () => void;
  onAnular: () => void;
  clienteId: string;
}) {
  const esVenta = mov.tipo === "venta";
  const tieneItems = esVenta && (mov.items?.length ?? 0) > 0;

  const titulo = esVenta
    ? `Venta · Guía N.º ${mov.numero_guia != null ? formatNumeroGuia(mov.numero_guia) : "—"}`
    : `Abono · ${mov.medio_pago ? ETIQUETA_MEDIO_PAGO[mov.medio_pago] : "—"}`;

  return (
    <li className={mov.anulado ? "opacity-50" : ""}>
      <div className="px-4 sm:px-5 py-3">
        {/* Cabecera de la fila: si la venta tiene items, toca para expandir */}
        <div
          className={`flex items-start gap-3 ${tieneItems ? "cursor-pointer" : ""}`}
          onClick={tieneItems ? onToggle : undefined}
          role={tieneItems ? "button" : undefined}
        >
          <div
            className={`shrink-0 h-10 w-10 rounded-2xl flex items-center justify-center ${
              esVenta ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
            }`}
          >
            {esVenta ? <FiShoppingCart size={18} /> : <FiDollarSign size={18} />}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-gray-800 flex flex-wrap items-center gap-2">
              {titulo}
              {mov.anulado && (
                <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {esVenta ? "Anulada" : "Anulado"}
                </span>
              )}
            </p>
            <p className="text-xs text-gray-400">{fechaCorta(mov.fecha)}</p>
            {mov.anulado && mov.anulacion_motivo && (
              <p className="text-xs text-red-500 mt-0.5">Motivo: {mov.anulacion_motivo}</p>
            )}
            {mov.observaciones && !mov.anulado && (
              <p className="text-xs text-gray-500 mt-0.5">{mov.observaciones}</p>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-1.5">
            <p
              className={`text-base font-black whitespace-nowrap ${
                mov.anulado
                  ? "line-through text-gray-400"
                  : esVenta
                    ? "text-red-600"
                    : "text-green-600"
              }`}
            >
              {esVenta ? "" : "− "}
              {fmtSoles(mov.monto)}
            </p>
            {tieneItems && (
              <FiChevronDown
                size={18}
                className={`text-gray-400 transition-transform ${expandida ? "rotate-180" : ""}`}
              />
            )}
          </div>
        </div>

        {/* Items de la venta (peso × precio = subtotal) */}
        {tieneItems && expandida && (
          <ul className="mt-2 ml-[52px] space-y-1 bg-gray-50 rounded-2xl px-4 py-3">
            {mov.items!.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 text-sm text-gray-700"
              >
                <span className="min-w-0">
                  {item.producto_nombre}
                  <span className="text-gray-400">
                    {" "}
                    — {item.peso_kg.toLocaleString("es-PE", { maximumFractionDigits: 2 })} kg ×{" "}
                    {fmtSoles(item.precio_kg)}
                  </span>
                </span>
                <span className="font-semibold whitespace-nowrap">{fmtSoles(item.subtotal)}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Acciones */}
        {(!mov.anulado || (!esVenta && mov.tiene_comprobante)) && (
          <div className="mt-2 ml-[52px] flex flex-wrap gap-2">
            {esVenta && !mov.anulado && (
              <>
                <Link
                  href={`/dashboard/clientes-avicola/${clienteId}/venta?edit=${mov.id}`}
                  className="h-10 px-4 rounded-2xl bg-red-600 text-white text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-transform shadow-sm shadow-red-600/20"
                >
                  <FiEdit2 size={16} />
                  Editar
                </Link>
                <button
                  type="button"
                  onClick={onReenviarGuia}
                  disabled={cargandoGuia}
                  className="h-10 px-4 rounded-2xl bg-white border-2 border-gray-200 text-gray-700 text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-transform cursor-pointer disabled:opacity-50"
                >
                  {cargandoGuia ? (
                    <FiLoader size={16} className="animate-spin" />
                  ) : (
                    <FiShare2 size={16} />
                  )}
                  Reenviar guía
                </button>
              </>
            )}
            {!esVenta && mov.tiene_comprobante && (
              <a
                href={`/api/avicola/abonos/${mov.id}/comprobante`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 px-4 rounded-2xl bg-white border-2 border-gray-200 text-gray-700 text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                <FiPaperclip size={16} />
                Ver comprobante
              </a>
            )}
            {!mov.anulado && (
              <button
                type="button"
                onClick={onAnular}
                className="h-10 px-3 rounded-2xl text-gray-500 hover:bg-red-50 hover:text-red-600 text-sm font-semibold flex items-center gap-1.5 active:scale-95 transition-colors cursor-pointer"
              >
                <FiX size={16} />
                Anular
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

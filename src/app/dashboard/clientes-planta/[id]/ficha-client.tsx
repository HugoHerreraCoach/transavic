"use client";

// src/app/dashboard/clientes-planta/[id]/ficha-client.tsx
// Ficha del cliente de planta: identidad + contacto, estado de cuenta (saldo) y
// la lista de sus deudas (cobranzas) con su saldo y estado. El detalle de abonos
// y el registro de pagos viven en "Cobranzas de Planta", no aquí.
// Mobile-first: botones ≥48px, textos grandes, active:scale-95. El client hace el
// fetch de GET /api/clientes-planta/{id} para refrescar tras editar sin recargar.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiEdit2,
  FiMapPin,
  FiMessageCircle,
  FiPhone,
} from "react-icons/fi";
import type {
  ClientePlantaConSaldo,
  CobranzaPlanta,
  EstadoCobranzaPlanta,
} from "@/lib/planta/types";
import { UMBRAL_DEUDA_PLANTA } from "@/lib/planta/saldos";
import ClientePlantaForm from "../cliente-planta-form";

const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-07-07" → "07/07/2026" (sin pasar por Date: evita el corrimiento UTC). */
function fechaCorta(fecha: string | null): string {
  if (!fecha) return "—";
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Estilo del chip de estado de cada deuda. */
const ESTILO_ESTADO: Record<EstadoCobranzaPlanta, string> = {
  Pendiente: "bg-amber-100 text-amber-700",
  Parcial: "bg-blue-100 text-blue-700",
  Vencida: "bg-red-100 text-red-700",
  Pagada: "bg-emerald-100 text-emerald-700",
  Anulada: "bg-gray-100 text-gray-500",
};

interface FichaPlanta {
  cliente: ClientePlantaConSaldo;
  cobranzas: CobranzaPlanta[];
}

export default function FichaPlantaClient({ clienteId }: { clienteId: string }) {
  const [ficha, setFicha] = useState<FichaPlanta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalEditar, setModalEditar] = useState(false);

  const cargarFicha = useCallback(async () => {
    try {
      const res = await fetch(`/api/clientes-planta/${clienteId}`);
      if (res.status === 404) {
        setError("Cliente no encontrado.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : `Estado ${res.status}`);
      }
      const data: FichaPlanta = await res.json();
      setFicha(data);
      setError(null);
    } catch (err) {
      console.error("Error al cargar la ficha del cliente de planta:", err);
      setError("No se pudo cargar la ficha. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }, [clienteId]);

  useEffect(() => {
    cargarFicha();
  }, [cargarFicha]);

  // WhatsApp / teléfono normalizados a 51 + dígitos.
  const whatsappLink = useMemo(() => {
    const tel = ficha?.cliente.telefono;
    if (!tel) return null;
    const limpio = tel.replace(/\D/g, "");
    if (!limpio) return null;
    return `https://wa.me/${limpio.startsWith("51") ? limpio : `51${limpio}`}`;
  }, [ficha?.cliente.telefono]);

  const telefonoLink = useMemo(() => {
    const tel = ficha?.cliente.telefono;
    if (!tel) return null;
    const limpio = tel.replace(/\D/g, "");
    if (!limpio) return null;
    return `tel:+${limpio.startsWith("51") ? limpio : `51${limpio}`}`;
  }, [ficha?.cliente.telefono]);

  /* ---------- Loading skeleton ---------- */
  if (cargando && !ficha) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-40 bg-gray-200 rounded-full" />
        <div className="h-24 bg-gray-200 rounded-3xl" />
        <div className="h-28 bg-gray-200 rounded-3xl" />
        <div className="h-64 bg-gray-200 rounded-3xl" />
      </div>
    );
  }

  /* ---------- Error / no encontrado ---------- */
  if (error || !ficha) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Link
          href="/dashboard/clientes-planta"
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline mb-4"
        >
          <FiArrowLeft /> Volver a clientes de planta
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
  const conDeuda = saldo > UMBRAL_DEUDA_PLANTA;
  const aFavor = saldo < -UMBRAL_DEUDA_PLANTA;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 pb-10">
      {/* Volver a la lista */}
      <Link
        href="/dashboard/clientes-planta"
        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline"
      >
        <FiArrowLeft /> Volver a clientes de planta
      </Link>

      {/* HEADER: identidad + editar */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-gray-900 break-words">
              {cliente.nombre}
            </h1>
            {cliente.razon_social && (
              <p className="text-base text-gray-500 mt-0.5">{cliente.razon_social}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                {cliente.empresa}
              </span>
              {cliente.ruc_dni && (
                <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                  RUC/DNI {cliente.ruc_dni}
                </span>
              )}
              {cliente.plazo_pago_dias > 0 && (
                <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                  Plazo {cliente.plazo_pago_dias} día{cliente.plazo_pago_dias === 1 ? "" : "s"}
                </span>
              )}
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

      {/* ESTADO DE CUENTA */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Total vendido a crédito
            </p>
            <p className="text-lg font-bold text-gray-900">{fmtSoles(cliente.total_deuda)}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Total abonado
            </p>
            <p className="text-lg font-bold text-gray-900">{fmtSoles(cliente.total_abonado)}</p>
          </div>
          <div
            className={`col-span-2 rounded-2xl border p-3 ${
              conDeuda ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Saldo pendiente
            </p>
            <p className={`text-2xl font-black ${conDeuda ? "text-red-600" : "text-green-600"}`}>
              {conDeuda
                ? fmtSoles(saldo)
                : aFavor
                  ? `A favor ${fmtSoles(Math.abs(saldo))}`
                  : "Al día"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400 text-center">
          Última compra: <span className="font-semibold">{fechaCorta(cliente.ultima_compra)}</span>
          {" · "}
          Último pago: <span className="font-semibold">{fechaCorta(cliente.ultimo_pago)}</span>
        </p>
      </div>

      {/* CONTACTO */}
      {(cliente.telefono || cliente.direccion) && (
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
        </div>
      )}

      {/* DEUDAS (cobranzas) */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-black text-gray-900">Deudas</h2>
        </div>

        {ficha.cobranzas.length === 0 ? (
          <p className="p-6 text-base text-gray-500 text-center">
            Sin deudas registradas. Las ventas al crédito de este cliente aparecerán aquí.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {ficha.cobranzas.map((co) => (
              <li key={co.id} className={co.anulada ? "opacity-50" : ""}>
                <div className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-gray-800 flex flex-wrap items-center gap-2">
                      {fmtSoles(co.monto)}
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ESTILO_ESTADO[co.estado]}`}
                      >
                        {co.estado}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Emitida {fechaCorta(co.fecha_emision)} · Vence {fechaCorta(co.fecha_vencimiento)}
                    </p>
                    {co.total_abonado > UMBRAL_DEUDA_PLANTA && !co.anulada && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Abonado {fmtSoles(co.total_abonado)}
                      </p>
                    )}
                    {co.anulada && co.anulacion_motivo && (
                      <p className="text-xs text-red-500 mt-0.5">Motivo: {co.anulacion_motivo}</p>
                    )}
                  </div>
                  {!co.anulada && (
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Saldo
                      </p>
                      <p
                        className={`text-base font-black whitespace-nowrap ${
                          co.saldo > UMBRAL_DEUDA_PLANTA ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {co.saldo > UMBRAL_DEUDA_PLANTA ? fmtSoles(co.saldo) : "Pagada"}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/dashboard/cobranzas-planta"
          className="block px-5 py-3 border-t border-gray-100 text-center text-sm font-semibold text-blue-600 hover:underline"
        >
          Registrar pagos en Cobranzas de Planta
        </Link>
      </div>

      {/* MODAL editar */}
      {modalEditar && (
        <ClientePlantaForm
          cliente={cliente}
          onClose={() => setModalEditar(false)}
          onGuardado={cargarFicha}
        />
      )}
    </div>
  );
}

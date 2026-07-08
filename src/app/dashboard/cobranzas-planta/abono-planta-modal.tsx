"use client";

// src/app/dashboard/cobranzas-planta/abono-planta-modal.tsx
// Modal de ABONO (pago parcial del "saldito") a UNA cobranza de planta.
// Mobile-first extremo (uso en planta con celular): monto gigante, chips grandes,
// botones ≥48px, active:scale-95. La idempotencia contra doble-tap y reintentos la
// da el id UUID generado UNA sola vez al montar (la tabla abonos_planta usa ese id
// como PRIMARY KEY — ver migración 2026-07-08). El sobrepago está PERMITIDO por el
// servidor (queda saldo a favor), aquí solo se avisa; no se bloquea.

import { useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { FiCamera, FiChevronDown, FiRefreshCw, FiX } from "react-icons/fi";
import {
  ETIQUETA_MEDIO_PAGO_PLANTA,
  MEDIOS_PAGO_PLANTA,
  type CobranzaPlanta,
  type MedioPagoPlanta,
} from "@/lib/planta/types";

const fmtSoles = (n: number) =>
  `S/ ${
    Math.abs(n) < 0.005
      ? "0.00"
      : n.toLocaleString("es-PE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
  }`;

export default function AbonoPlantaModal({
  cobranza,
  onClose,
  onGuardado,
}: {
  cobranza: CobranzaPlanta;
  onClose: () => void;
  onGuardado: () => void;
}) {
  // Id idempotente: se genera UNA vez al montar y se reusa en todo reintento.
  const idRef = useRef(crypto.randomUUID());

  // Hoy en zona Lima (YYYY-MM-DD) — en-CA da el formato ISO directo.
  const hoyLima = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(
        new Date()
      ),
    []
  );

  const saldo = Number(cobranza.saldo);

  const [monto, setMonto] = useState("");
  const [medioPago, setMedioPago] = useState<MedioPagoPlanta>("efectivo");
  const [masOpciones, setMasOpciones] = useState(false);
  const [fecha, setFecha] = useState(hoyLima);
  const [observaciones, setObservaciones] = useState("");
  const [foto, setFoto] = useState<{
    base64: string;
    mime: string;
    preview: string;
  } | null>(null);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDeRed, setErrorDeRed] = useState(false);

  const montoNum = useMemo(() => {
    const n = Number(monto.replace(",", ".").trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }, [monto]);

  const saldoQueQueda = saldo - (montoNum ?? 0);
  const haySobrepago = montoNum !== null && saldoQueQueda < -0.005;

  // Comprime la foto del comprobante a webp (~60-90KB) — mismo patrón que avícola.
  const onSelectFoto = async (file: File | null) => {
    if (!file) return;
    setComprimiendo(true);
    setError(null);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.09,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        fileType: "image/webp",
        initialQuality: 0.7,
      });
      const dataUrl = await imageCompression.getDataUrlFromFile(compressed);
      const coma = dataUrl.indexOf(",");
      const base64 = coma >= 0 ? dataUrl.slice(coma + 1) : dataUrl;
      setFoto({ base64, mime: compressed.type || "image/webp", preview: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar la foto");
    } finally {
      setComprimiendo(false);
    }
  };

  const enviar = async () => {
    if (!montoNum || guardando) return;
    setGuardando(true);
    setError(null);
    setErrorDeRed(false);
    try {
      const body: Record<string, unknown> = {
        id: idRef.current,
        monto: montoNum,
        medio_pago: medioPago,
      };
      if (fecha && fecha !== hoyLima) body.fecha = fecha;
      if (observaciones.trim()) body.observaciones = observaciones.trim();
      if (foto) {
        body.comprobante_base64 = foto.base64;
        body.comprobante_mime = foto.mime;
      }

      const res = await fetch(
        `/api/cobranzas-planta/${cobranza.id}/abono`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "No se pudo guardar el abono"
        );
        return;
      }
      onGuardado();
      onClose();
    } catch {
      // Falla de red: el id se conserva → reintentar es seguro (idempotente).
      setErrorDeRed(true);
      setError(
        "Sin conexión. El abono no se guardó. Revisa tu internet e intenta de nuevo."
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardando) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto">
        {/* Encabezado */}
        <div className="sticky top-0 bg-white rounded-t-3xl px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-gray-900 truncate">
              Abono de {cobranza.cliente_nombre}
            </h2>
            <p className="text-base text-gray-500">
              Saldo pendiente:{" "}
              <span className="font-bold text-gray-700">{fmtSoles(saldo)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={guardando}
            aria-label="Cerrar"
            className="shrink-0 h-12 w-12 flex items-center justify-center rounded-2xl bg-gray-100 text-gray-600 active:scale-95 transition-transform cursor-pointer"
          >
            <FiX size={22} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 pb-8">
          {/* Monto gigante */}
          <div>
            <label
              htmlFor="abono-monto"
              className="block text-sm font-bold text-gray-700 mb-1"
            >
              ¿Cuánto está pagando?
            </label>
            <div className="flex items-center gap-2 border-2 border-gray-200 rounded-2xl px-4 focus-within:border-green-500">
              <span className="text-2xl font-black text-gray-400">S/</span>
              <input
                id="abono-monto"
                type="text"
                inputMode="decimal"
                autoFocus
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="w-full h-16 text-3xl text-center font-black text-gray-900 outline-none bg-transparent"
              />
            </div>
            <p
              className={`mt-2 text-base font-semibold text-center ${
                montoNum && saldoQueQueda <= 0.005
                  ? "text-green-600"
                  : "text-gray-500"
              }`}
            >
              {montoNum
                ? `El saldo quedará en ${fmtSoles(saldoQueQueda)}${
                    haySobrepago ? " (a favor del cliente)" : ""
                  }`
                : "Ingresa el monto del abono"}
            </p>
          </div>

          {/* Aviso de sobrepago (permitido, solo informativo) */}
          {haySobrepago && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">
                El monto supera el saldo pendiente. El cliente quedará con{" "}
                {fmtSoles(Math.abs(saldoQueQueda))} a favor. Puedes registrarlo
                igual.
              </p>
            </div>
          )}

          {/* Medio de pago */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Medio de pago
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {MEDIOS_PAGO_PLANTA.map((medio) => (
                <button
                  key={medio}
                  type="button"
                  onClick={() => setMedioPago(medio)}
                  className={`shrink-0 h-12 px-5 rounded-2xl border-2 text-base font-bold whitespace-nowrap active:scale-95 transition-all cursor-pointer ${
                    medioPago === medio
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  {ETIQUETA_MEDIO_PAGO_PLANTA[medio]}
                </button>
              ))}
            </div>
          </div>

          {/* Más opciones (colapsado) */}
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setMasOpciones((v) => !v)}
              className="w-full h-12 px-4 flex items-center justify-between text-base font-bold text-gray-700 active:scale-[0.98] transition-transform cursor-pointer"
            >
              Más opciones
              <FiChevronDown
                size={20}
                className={`transition-transform ${
                  masOpciones ? "rotate-180" : ""
                }`}
              />
            </button>
            {masOpciones && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
                <div>
                  <label
                    htmlFor="abono-fecha"
                    className="block text-sm font-bold text-gray-700 mb-1"
                  >
                    Fecha del abono
                  </label>
                  <input
                    id="abono-fecha"
                    type="date"
                    value={fecha}
                    max={hoyLima}
                    onChange={(e) => setFecha(e.target.value)}
                    className="w-full h-12 rounded-2xl border border-gray-300 px-4 text-base text-gray-900 outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="abono-obs"
                    className="block text-sm font-bold text-gray-700 mb-1"
                  >
                    Observaciones
                  </label>
                  <textarea
                    id="abono-obs"
                    rows={2}
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Ej. pagó la mitad en efectivo"
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none focus:border-green-500 resize-none"
                  />
                </div>
                <div>
                  <span className="block text-sm font-bold text-gray-700 mb-1">
                    Foto del comprobante
                  </span>
                  {foto ? (
                    <div className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={foto.preview}
                        alt="Comprobante del abono"
                        className="h-24 w-24 object-cover rounded-2xl border border-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => setFoto(null)}
                        aria-label="Quitar foto"
                        className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-red-600 text-white flex items-center justify-center shadow active:scale-90 transition-transform cursor-pointer"
                      >
                        <FiX size={16} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-12 rounded-2xl border-2 border-dashed border-gray-300 text-base font-bold text-gray-600 active:scale-95 transition-transform cursor-pointer">
                      <FiCamera size={20} />
                      {comprimiendo ? "Procesando foto..." : "Tomar foto"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={comprimiendo}
                        onChange={(e) => {
                          onSelectFoto(e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error (server o red) */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
              <p className="text-base font-semibold text-red-700">{error}</p>
              {errorDeRed && (
                <button
                  type="button"
                  onClick={enviar}
                  disabled={guardando}
                  className="w-full h-12 rounded-2xl bg-red-600 text-white text-base font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform cursor-pointer disabled:opacity-50"
                >
                  <FiRefreshCw size={18} />
                  Reintentar
                </button>
              )}
            </div>
          )}

          {/* Guardar */}
          <button
            type="button"
            onClick={enviar}
            disabled={!montoNum || guardando || comprimiendo}
            className="w-full h-14 rounded-2xl bg-green-600 text-white text-lg font-black flex items-center justify-center gap-2 shadow-md shadow-green-600/20 active:scale-95 transition-transform cursor-pointer disabled:opacity-50 disabled:active:scale-100"
          >
            {guardando ? (
              <>
                <span className="inline-block h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar abono"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

// src/app/dashboard/clientes-planta/cliente-planta-form.tsx
// Formulario de crear/editar cliente del módulo "Clientes de Planta" (POS).
// Mobile-first: inputs altos, textos grandes, chips de empresa.
// Crear  → POST  /api/clientes-planta  (el id lo genera el cliente: idempotencia offline).
// Editar → PATCH /api/clientes-planta/{id}.

import { useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import {
  EMPRESAS_PLANTA,
  type ClientePlantaConSaldo,
  type EmpresaPlanta,
} from "@/lib/planta/types";

const INPUT_CLS =
  "w-full h-12 rounded-2xl border border-gray-300 px-4 text-base text-gray-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100";

export default function ClientePlantaForm({
  cliente,
  onClose,
  onGuardado,
}: {
  cliente?: ClientePlantaConSaldo | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const esEdicion = !!cliente;

  // id generado UNA vez en el cliente → reintentos POST son idempotentes.
  const idRef = useRef(crypto.randomUUID());

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [razonSocial, setRazonSocial] = useState(cliente?.razon_social ?? "");
  const [rucDni, setRucDni] = useState(cliente?.ruc_dni ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [direccion, setDireccion] = useState(cliente?.direccion ?? "");
  const [plazoDias, setPlazoDias] = useState(
    cliente ? String(cliente.plazo_pago_dias) : "0"
  );
  // Default Avícola de Tony (RUC 10): la venta en planta por lo general va a RUC 10.
  const [empresa, setEmpresa] = useState<EmpresaPlanta>(
    cliente?.empresa ?? "Avícola de Tony"
  );
  const [activo, setActivo] = useState(cliente?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datosValidos = nombre.trim().length > 0;

  const guardar = async () => {
    if (!datosValidos || guardando) return;
    setError(null);

    // Días de plazo: vacío = 0; debe ser un entero ≥ 0.
    let plazoNum = 0;
    if (plazoDias.trim()) {
      const n = Number(plazoDias.trim());
      if (!Number.isInteger(n) || n < 0) {
        setError("Los días de plazo deben ser un número entero de 0 a más. Ej: 0, 7, 15");
        return;
      }
      plazoNum = n;
    }

    setGuardando(true);
    try {
      const body: Record<string, unknown> = {
        nombre: nombre.trim(),
        razon_social: razonSocial.trim() || null,
        ruc_dni: rucDni.trim() || null,
        telefono: telefono.trim() || null,
        direccion: direccion.trim() || null,
        plazo_pago_dias: plazoNum,
        empresa,
      };
      if (esEdicion) {
        body.activo = activo;
      } else {
        body.id = idRef.current;
      }

      const res = await fetch(
        esEdicion ? `/api/clientes-planta/${cliente!.id}` : "/api/clientes-planta",
        {
          method: esEdicion ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detalles =
          data?.detalles && typeof data.detalles === "object"
            ? Object.values(data.detalles as Record<string, string[]>).flat()[0]
            : null;
        setError(
          [typeof data?.error === "string" ? data.error : "No se pudo guardar el cliente", detalles]
            .filter(Boolean)
            .join(": ")
        );
        return;
      }
      onGuardado();
      onClose();
    } catch {
      setError("Sin conexión. Revisa tu internet e intenta de nuevo.");
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
        <div className="sticky top-0 bg-white rounded-t-3xl px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between gap-3 z-10">
          <h2 className="text-lg font-black text-gray-900 truncate">
            {esEdicion ? `Editar a ${cliente!.nombre}` : "Nuevo cliente"}
          </h2>
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

        <form
          className="px-5 py-4 space-y-4 pb-8"
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <div>
            <label htmlFor="cp-nombre" className="block text-sm font-bold text-gray-700 mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              id="cp-nombre"
              type="text"
              autoFocus={!esEdicion}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Sra. Carmen"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label htmlFor="cp-razon" className="block text-sm font-bold text-gray-700 mb-1">
              Razón social
            </label>
            <input
              id="cp-razon"
              type="text"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder="Opcional (para comprobante con RUC)"
              className={INPUT_CLS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cp-ruc" className="block text-sm font-bold text-gray-700 mb-1">
                RUC / DNI
              </label>
              <input
                id="cp-ruc"
                type="text"
                inputMode="numeric"
                value={rucDni}
                onChange={(e) => setRucDni(e.target.value)}
                placeholder="Opcional"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="cp-telefono" className="block text-sm font-bold text-gray-700 mb-1">
                Teléfono
              </label>
              <input
                id="cp-telefono"
                type="tel"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Ej. 987654321"
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div>
            <label htmlFor="cp-direccion" className="block text-sm font-bold text-gray-700 mb-1">
              Dirección
            </label>
            <input
              id="cp-direccion"
              type="text"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Opcional"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label htmlFor="cp-plazo" className="block text-sm font-bold text-gray-700 mb-1">
              Días de plazo de pago
            </label>
            <input
              id="cp-plazo"
              type="text"
              inputMode="numeric"
              value={plazoDias}
              onChange={(e) => setPlazoDias(e.target.value)}
              placeholder="0"
              className={INPUT_CLS}
            />
            <p className="mt-1 text-sm text-gray-500">
              Cuántos días tiene el cliente para pagar una venta al crédito. 0 = paga el mismo día.
            </p>
          </div>

          <div>
            <span className="block text-sm font-bold text-gray-700 mb-2">Empresa</span>
            <div className="flex gap-2">
              {EMPRESAS_PLANTA.map((emp) => (
                <button
                  key={emp}
                  type="button"
                  onClick={() => setEmpresa(emp)}
                  className={`flex-1 h-12 px-3 rounded-2xl border-2 text-base font-bold active:scale-95 transition-all cursor-pointer ${
                    empresa === emp
                      ? "border-red-600 bg-red-50 text-red-700"
                      : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  {emp}
                </button>
              ))}
            </div>
          </div>

          {esEdicion && (
            <div>
              <button
                type="button"
                onClick={() => setActivo((v) => !v)}
                className="w-full h-12 px-4 rounded-2xl border border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform cursor-pointer"
              >
                <span className="text-base font-bold text-gray-700">
                  Cliente {activo ? "activo" : "inactivo"}
                </span>
                <span
                  className={`relative inline-block h-7 w-12 rounded-full transition-colors ${
                    activo ? "bg-red-600" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      activo ? "left-6" : "left-1"
                    }`}
                  />
                </span>
              </button>
            </div>
          )}

          {error && (
            <p className="text-base font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!datosValidos || guardando}
            className="w-full h-14 rounded-2xl bg-red-600 text-white text-lg font-black flex items-center justify-center gap-2 shadow-md shadow-red-600/20 active:scale-95 transition-transform cursor-pointer disabled:opacity-50 disabled:active:scale-100"
          >
            {guardando ? (
              <>
                <span className="inline-block h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Guardando...
              </>
            ) : esEdicion ? (
              "Guardar cambios"
            ) : (
              "Crear cliente"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

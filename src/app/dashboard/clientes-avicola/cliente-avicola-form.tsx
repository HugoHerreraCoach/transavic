"use client";

// src/app/dashboard/clientes-avicola/cliente-avicola-form.tsx
// Formulario de crear/editar cliente del módulo "Clientes Avícola".
// Mobile-first (uso en campo): inputs altos, textos grandes, chips de empresa,
// datalist de mercados sugeridos. Crear → POST /api/avicola/clientes;
// editar → PATCH /api/avicola/clientes/{id}.

import { useState } from "react";
import { FiX } from "react-icons/fi";
import {
  EMPRESAS_AVICOLA,
  type ClienteAvicolaConSaldo,
  type EmpresaAvicola,
} from "@/lib/avicola/types";

const INPUT_CLS =
  "w-full h-12 rounded-2xl border border-gray-300 px-4 text-base text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100";

export default function ClienteAvicolaForm({
  cliente,
  mercadosSugeridos,
  onClose,
  onGuardado,
}: {
  cliente?: ClienteAvicolaConSaldo | null;
  mercadosSugeridos: string[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const esEdicion = !!cliente;

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [mercado, setMercado] = useState(cliente?.mercado ?? "");
  const [numeroPuesto, setNumeroPuesto] = useState(cliente?.numero_puesto ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [direccion, setDireccion] = useState(cliente?.direccion ?? "");
  const [observaciones, setObservaciones] = useState(cliente?.observaciones ?? "");
  // Default Avícola de Tony (RUC 10): la venta en campo por lo general va a RUC 10
  // (decisión de Antonio); el chip deja elegir Transavic para los clientes que depositan ahí.
  const [empresa, setEmpresa] = useState<EmpresaAvicola>(cliente?.empresa ?? "Avícola de Tony");
  const [saldoAnterior, setSaldoAnterior] = useState(
    cliente && cliente.saldo_anterior !== 0 ? String(cliente.saldo_anterior) : ""
  );
  const [activo, setActivo] = useState(cliente?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datosValidos = nombre.trim().length > 0 && mercado.trim().length > 0;

  const guardar = async () => {
    if (!datosValidos || guardando) return;
    setError(null);

    // Saldo anterior: vacío = 0; si escribió algo, debe ser un número.
    let saldoNum = 0;
    if (saldoAnterior.trim()) {
      const n = Number(saldoAnterior.replace(",", ".").trim());
      if (!Number.isFinite(n)) {
        setError("El saldo anterior debe ser un número. Ej: 350 o 350.50");
        return;
      }
      saldoNum = Math.round(n * 100) / 100;
    }

    setGuardando(true);
    try {
      const body: Record<string, unknown> = {
        nombre: nombre.trim(),
        mercado: mercado.trim(),
        numero_puesto: numeroPuesto.trim() || null,
        telefono: telefono.trim() || null,
        direccion: direccion.trim() || null,
        observaciones: observaciones.trim() || null,
        empresa,
        saldo_anterior: saldoNum,
      };
      if (esEdicion) body.activo = activo;

      const res = await fetch(
        esEdicion ? `/api/avicola/clientes/${cliente!.id}` : "/api/avicola/clientes",
        {
          method: esEdicion ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Muestra el error del server; si vinieron detalles de zod, agrega el primero.
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
            <label htmlFor="ca-nombre" className="block text-sm font-bold text-gray-700 mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              id="ca-nombre"
              type="text"
              autoFocus={!esEdicion}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Sra. Carmen"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label htmlFor="ca-mercado" className="block text-sm font-bold text-gray-700 mb-1">
              Mercado <span className="text-red-500">*</span>
            </label>
            <input
              id="ca-mercado"
              type="text"
              list="ca-mercados-sugeridos"
              value={mercado}
              onChange={(e) => setMercado(e.target.value)}
              placeholder="Ej. Mercado Central"
              className={INPUT_CLS}
            />
            <datalist id="ca-mercados-sugeridos">
              {mercadosSugeridos.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ca-puesto" className="block text-sm font-bold text-gray-700 mb-1">
                N.º de puesto
              </label>
              <input
                id="ca-puesto"
                type="text"
                inputMode="numeric"
                value={numeroPuesto}
                onChange={(e) => setNumeroPuesto(e.target.value)}
                placeholder="Ej. 14"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="ca-telefono" className="block text-sm font-bold text-gray-700 mb-1">
                Teléfono
              </label>
              <input
                id="ca-telefono"
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
            <label htmlFor="ca-direccion" className="block text-sm font-bold text-gray-700 mb-1">
              Dirección
            </label>
            <input
              id="ca-direccion"
              type="text"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Opcional"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label htmlFor="ca-obs" className="block text-sm font-bold text-gray-700 mb-1">
              Observaciones
            </label>
            <textarea
              id="ca-obs"
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 resize-none"
            />
          </div>

          <div>
            <span className="block text-sm font-bold text-gray-700 mb-2">Empresa</span>
            <div className="flex gap-2">
              {EMPRESAS_AVICOLA.map((emp) => (
                <button
                  key={emp}
                  type="button"
                  onClick={() => setEmpresa(emp)}
                  className={`flex-1 h-12 px-3 rounded-2xl border-2 text-base font-bold active:scale-95 transition-all cursor-pointer ${
                    empresa === emp
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  {emp}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="ca-saldo" className="block text-sm font-bold text-gray-700 mb-1">
              Saldo anterior (deuda antes del sistema)
            </label>
            <div className="flex items-center gap-2 border border-gray-300 rounded-2xl px-4 focus-within:border-green-500 focus-within:ring-2 focus-within:ring-green-100">
              <span className="text-base font-bold text-gray-400">S/</span>
              <input
                id="ca-saldo"
                type="text"
                inputMode="decimal"
                value={saldoAnterior}
                onChange={(e) => setSaldoAnterior(e.target.value)}
                placeholder="0.00"
                className="w-full h-12 text-base text-gray-900 outline-none bg-transparent"
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Solo la deuda que el cliente ya tenía en el cuaderno o Excel. Las ventas nuevas se
              suman solas.
            </p>
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
                    activo ? "bg-green-600" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      activo ? "left-6" : "left-1"
                    }`}
                  />
                </span>
              </button>
              {!activo && (
                <p className="mt-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                  No podrás registrarle ventas, pero sí abonos, y su deuda sigue contando.
                </p>
              )}
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
            className="w-full h-14 rounded-2xl bg-green-600 text-white text-lg font-black flex items-center justify-center gap-2 shadow-md shadow-green-600/20 active:scale-95 transition-transform cursor-pointer disabled:opacity-50 disabled:active:scale-100"
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

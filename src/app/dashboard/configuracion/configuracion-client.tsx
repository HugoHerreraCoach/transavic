// src/app/dashboard/configuracion/configuracion-client.tsx
// Editor de settings.parametros_negocio (admin). Dos tipos de campo:
// listas de texto (chips agregar/quitar) y números con su explicación en simple.
"use client";

import { useEffect, useState } from "react";
import { FiPlus, FiX, FiSave, FiLoader, FiSettings, FiList, FiPercent } from "react-icons/fi";
import {
  fetchParametrosNegocio,
  PARAMETROS_NEGOCIO_DEFAULT,
  type ParametrosNegocio,
} from "@/lib/parametros-negocio";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

/** Editor de una lista de textos como chips (agregar con Enter, quitar con la x). */
function ListaEditable({
  titulo,
  ayuda,
  valores,
  onChange,
  minimo = 1,
}: {
  titulo: string;
  ayuda: string;
  valores: string[];
  onChange: (v: string[]) => void;
  minimo?: number;
}) {
  const [nuevo, setNuevo] = useState("");

  const agregar = () => {
    const limpio = nuevo.trim();
    if (!limpio) return;
    if (valores.some((v) => v.toLowerCase() === limpio.toLowerCase())) {
      setNuevo("");
      return;
    }
    onChange([...valores, limpio]);
    setNuevo("");
  };

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
          <FiList size={14} className="text-indigo-500" /> {titulo}
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">{ayuda}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {valores.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 text-gray-800 text-xs font-semibold rounded-full pl-3 pr-1.5 py-1.5"
          >
            {v}
            <button
              type="button"
              onClick={() => valores.length > minimo && onChange(valores.filter((x) => x !== v))}
              disabled={valores.length <= minimo}
              aria-label={`Quitar ${v}`}
              title={valores.length <= minimo ? "Debe quedar al menos una opción" : `Quitar ${v}`}
              className="p-1 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
            >
              <FiX size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregar();
            }
          }}
          placeholder="Agregar opción…"
          className="flex-1 max-w-xs rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={agregar}
          className="px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl text-xs font-bold cursor-pointer active:scale-95 flex items-center gap-1"
        >
          <FiPlus size={13} /> Agregar
        </button>
      </div>
    </div>
  );
}

/** Editor de un número con etiqueta y ayuda. */
function NumeroEditable({
  titulo,
  ayuda,
  valor,
  onChange,
  sufijo = "%",
}: {
  titulo: string;
  ayuda: string;
  valor: number;
  onChange: (v: number) => void;
  sufijo?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
          <FiPercent size={13} className="text-indigo-500" /> {titulo}
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">{ayuda}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="number"
          min="0"
          step="1"
          value={Number.isFinite(valor) ? valor : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-bold text-right tabular-nums text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <span className="text-xs font-semibold text-gray-500">{sufijo}</span>
      </div>
    </div>
  );
}

export default function ConfiguracionClient() {
  const [params, setParams] = useState<ParametrosNegocio>({ ...PARAMETROS_NEGOCIO_DEFAULT });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const { mostrarToast, toasts } = useToast();

  useEffect(() => {
    fetchParametrosNegocio().then((p) => {
      setParams(p);
      setCargando(false);
    });
  }, []);

  const guardar = async () => {
    // Validaciones mínimas de coherencia antes de guardar.
    if (params.margen_regular_pct >= params.margen_bueno_pct) {
      mostrarToast("El margen 'regular' debe ser menor que el margen 'bueno'.", "error");
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "parametros_negocio", value: params }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo guardar.");
      }
      mostrarToast("Configuración guardada. Ya está activa en todo el sistema.", "exito");
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : "No se pudo guardar.", "error");
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) {
    return (
      <div className="text-center py-16 text-gray-400 animate-pulse font-medium">
        Cargando configuración…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} />
      <GuiaModulo modulo="configuracion" />

      {/* Listas */}
      <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-6">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <FiSettings className="text-indigo-600" /> Listas de opciones
        </h2>
        <ListaEditable
          titulo="Categorías de gasto"
          ayuda="Las opciones al registrar un gasto en Caja Diaria y en la página de Gastos. Los gastos ya registrados conservan su categoría."
          valores={params.categorias_gasto}
          onChange={(v) => setParams({ ...params, categorias_gasto: v })}
        />
        <div className="border-t border-gray-100" />
        <ListaEditable
          titulo="Tipos de documento de compra"
          ayuda="Las opciones del campo 'Tipo Documento' al registrar el ingreso de mercadería."
          valores={params.tipos_doc_compra}
          onChange={(v) => setParams({ ...params, tipos_doc_compra: v })}
        />
      </section>

      {/* Umbrales */}
      <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <FiPercent className="text-indigo-600" /> Umbrales del negocio
        </h2>
        <NumeroEditable
          titulo="Margen bueno (verde)"
          ayuda="En el catálogo, un producto con margen igual o mayor a esto se pinta verde."
          valor={params.margen_bueno_pct}
          onChange={(v) => setParams({ ...params, margen_bueno_pct: v })}
        />
        <NumeroEditable
          titulo="Margen regular (ámbar)"
          ayuda="Margen igual o mayor a esto (pero menor que el bueno) se pinta ámbar; debajo, rojo."
          valor={params.margen_regular_pct}
          onChange={(v) => setParams({ ...params, margen_regular_pct: v })}
        />
        <div className="border-t border-gray-100" />
        <NumeroEditable
          titulo="Alerta de merma alta"
          ayuda="En la calculadora de mermas, un porcentaje mayor a esto se marca como merma alta."
          valor={params.merma_alta_pct}
          onChange={(v) => setParams({ ...params, merma_alta_pct: v })}
        />
        <NumeroEditable
          titulo="Rendimiento estándar de rentabilidad"
          ayuda="Cuando no hay mermas registradas en el periodo, Rentabilidad asume este rendimiento del pollo."
          valor={params.rendimiento_fallback_pct}
          onChange={(v) => setParams({ ...params, rendimiento_fallback_pct: v })}
        />
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer active:scale-95 flex items-center gap-2"
        >
          {guardando ? <FiLoader className="animate-spin" size={16} /> : <FiSave size={16} />}
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </div>
  );
}

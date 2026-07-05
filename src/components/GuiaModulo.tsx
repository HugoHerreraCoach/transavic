"use client";
// Banner de guía paso a paso para módulos BETA (fase de prueba de la expansión ERP).
// El contenido vive en src/lib/guias-modulos.ts (un solo archivo para editar/quitar).
// Comportamiento (ajustado 5 jul 2026, feedback de Hugo): la barra es SIEMPRE
// compacta y al abrirla los pasos se muestran como panel FLOTANTE sobre el
// contenido — nunca empuja el layout de la vista (en pantallas de trabajo como
// el POS, la guía desplegada tapaba el módulo). Se cierra tocando la barra,
// la X o haciendo clic fuera.
// TEMPORAL: se elimina la entrada del módulo en guias-modulos.ts y desaparece solo.
import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiHelpCircle, FiX } from "react-icons/fi";
import { GUIAS_MODULOS } from "@/lib/guias-modulos";

export default function GuiaModulo({ modulo }: { modulo: string }) {
  const guia = GUIAS_MODULOS[modulo];
  const [abierta, setAbierta] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera del panel
  useEffect(() => {
    if (!abierta) return;
    const onClickFuera = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierta(false);
      }
    };
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, [abierta]);

  if (!guia) return null;

  return (
    <div ref={contenedorRef} className="relative mb-4 print:hidden">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className={`w-full flex items-center gap-2 px-4 py-3 text-left rounded-xl border transition-colors ${
          abierta
            ? "border-indigo-300 bg-indigo-100/80"
            : "border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/60"
        }`}
      >
        <FiHelpCircle className="text-indigo-600 shrink-0" size={18} />
        <span className="text-sm font-semibold text-indigo-900 flex-1">
          ¿Cómo funciona este módulo?
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide bg-indigo-600 text-white px-2 py-0.5 rounded-full">
          Beta
        </span>
        <FiChevronDown
          className={`text-indigo-500 shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`}
          size={18}
        />
      </button>

      {abierta && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl border border-indigo-200 bg-white shadow-xl p-4">
          <button
            type="button"
            onClick={() => setAbierta(false)}
            className="absolute top-2.5 right-2.5 p-1.5 rounded-full text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600"
            aria-label="Cerrar guía"
          >
            <FiX size={16} />
          </button>
          <ol className="space-y-2 pr-6">
            {guia.pasos.map((paso, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-800">
                  <span className="font-medium">{paso.titulo}</span>
                  {paso.detalle && (
                    <span className="text-gray-500"> — {paso.detalle}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {guia.nota && (
            <p className="mt-3 text-xs text-indigo-800 bg-indigo-50 rounded-lg px-3 py-2">
              💡 {guia.nota}
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            Guía temporal de la fase de prueba — se quitará cuando el módulo quede aprobado.
          </p>
        </div>
      )}
    </div>
  );
}

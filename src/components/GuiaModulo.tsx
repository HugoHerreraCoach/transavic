"use client";
// Banner de guía paso a paso para módulos BETA (fase de prueba de la expansión ERP).
// El contenido vive en src/lib/guias-modulos.ts (un solo archivo para editar/quitar).
// Colapsable; recuerda el estado por módulo en localStorage (abierto la primera vez).
// TEMPORAL: se elimina la entrada del módulo en guias-modulos.ts y desaparece solo.
import { useEffect, useState } from "react";
import { FiChevronDown, FiChevronUp, FiHelpCircle } from "react-icons/fi";
import { GUIAS_MODULOS } from "@/lib/guias-modulos";

export default function GuiaModulo({ modulo }: { modulo: string }) {
  const guia = GUIAS_MODULOS[modulo];
  const [colapsada, setColapsada] = useState(true); // arranca colapsada para evitar salto visual
  const [lista, setLista] = useState(false);

  useEffect(() => {
    // Abierta la primera vez; después respeta lo que el usuario dejó.
    const guardado = localStorage.getItem(`transavic_guia_colapsada_${modulo}`);
    setColapsada(guardado === "1");
    setLista(true);
  }, [modulo]);

  if (!guia || !lista) return null;

  const toggle = () => {
    const nueva = !colapsada;
    setColapsada(nueva);
    localStorage.setItem(`transavic_guia_colapsada_${modulo}`, nueva ? "1" : "0");
  };

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 print:hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <FiHelpCircle className="text-indigo-600 shrink-0" size={18} />
        <span className="text-sm font-semibold text-indigo-900 flex-1">
          ¿Cómo funciona este módulo?
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide bg-indigo-600 text-white px-2 py-0.5 rounded-full">
          Beta
        </span>
        {colapsada ? (
          <FiChevronDown className="text-indigo-500 shrink-0" size={18} />
        ) : (
          <FiChevronUp className="text-indigo-500 shrink-0" size={18} />
        )}
      </button>

      {!colapsada && (
        <div className="px-4 pb-4">
          <ol className="space-y-2">
            {guia.pasos.map((paso, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-indigo-950">
                  <span className="font-medium">{paso.titulo}</span>
                  {paso.detalle && (
                    <span className="text-indigo-700"> — {paso.detalle}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {guia.nota && (
            <p className="mt-3 text-xs text-indigo-800 bg-indigo-100/80 rounded-lg px-3 py-2">
              💡 {guia.nota}
            </p>
          )}
          <p className="mt-2 text-[11px] text-indigo-400">
            Guía temporal de la fase de prueba — se quitará cuando el módulo quede aprobado.
          </p>
        </div>
      )}
    </div>
  );
}

// src/components/InsightCard.tsx
"use client";

import { useEffect, useState } from "react";
import { FiZap, FiLoader } from "react-icons/fi";

type InsightObj = { texto?: string };

/**
 * Widget compacto que muestra un insight de la IA embebido en una sección.
 * Llama a /api/asistente-ia (scoped por rol en el server: admin ve insights del
 * negocio, asesora ve los suyos) y muestra el primer insight disponible (o el
 * `tipo` indicado). La IA vive DENTRO de las secciones + el botón flotante
 * global; no es un ítem de menú.
 */
export default function InsightCard({ tipo }: { tipo?: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    fetch("/api/asistente-ia")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<string, InsightObj> | null) => {
        if (!activo || !j) return;
        const keys = [tipo, "dia", "sugerencia", "productos", "performance", "clientes"].filter(
          Boolean
        ) as string[];
        for (const k of keys) {
          if (j[k]?.texto) {
            setTexto(j[k]!.texto!);
            return;
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [tipo]);

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <FiLoader className="animate-spin" /> Cargando insight de tu Asistente IA…
      </div>
    );
  }
  if (!texto) return null;

  return (
    <div className="bg-gradient-to-br from-red-50 to-white border border-red-100 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-1">
        <FiZap /> Insight de tu Asistente IA
      </div>
      <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{texto}</p>
    </div>
  );
}

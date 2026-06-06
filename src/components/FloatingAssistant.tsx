// src/components/FloatingAssistant.tsx
"use client";

import Link from "next/link";
import { FiZap } from "react-icons/fi";

/**
 * Botón flotante de acceso a la IA. Fase 1: link a /dashboard/asistente-ia.
 * Fase 2: se reemplaza por un panel contextual con insights + chat (scoped).
 * Solo visible para admin y asesor (los roles que usan el Asistente IA).
 */
export default function FloatingAssistant({ role }: { role: string }) {
  if (role !== "admin" && role !== "asesor") return null;
  return (
    // Compacto por defecto (círculo con ícono) para no tapar contenido; el rótulo
    // se despliega al pasar el mouse. z-40 → por debajo de los modales (z-50).
    <Link
      href="/dashboard/asistente-ia"
      title="Asistente IA"
      aria-label="Abrir Asistente IA"
      className="group fixed bottom-5 right-5 z-40 print:hidden flex items-center gap-2 p-3.5 rounded-full bg-red-600 text-white shadow-lg hover:bg-red-700 transition-colors"
    >
      <FiZap className="h-5 w-5 flex-shrink-0" />
      <span className="hidden group-hover:inline text-sm font-medium whitespace-nowrap">
        Asistente IA
      </span>
    </Link>
  );
}

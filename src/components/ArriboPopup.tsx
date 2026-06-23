// src/components/ArriboPopup.tsx
"use client";

import { useState, useCallback } from "react";
import { FiX, FiCheck, FiTruck, FiMapPin, FiClock } from "react-icons/fi";
import Link from "next/link";
import { usePollingVisible } from "@/lib/use-polling-visible";

interface Notificacion {
  id: string;
  tipo: "pedido_creado" | "pedido_asignado" | "pesos_listos" | "listo_para_despacho" | "pedido_en_camino" | "pedido_por_llegar" | "pedido_entregado" | "pedido_llegado" | "pedido_fallido" | string;
  titulo: string;
  mensaje: string;
  link: string | null;
  pedido_id: string | null;
  leida: boolean;
  created_at: string;
}

const POLL_INTERVAL_MS = 15_000; // Poll más rápido (15 segundos) para alertas en tiempo real

export default function ArriboPopup() {
  const [activo, setActivo] = useState<Notificacion | null>(null);
  const [visible, setVisible] = useState(false);
  const [marcandoLeido, setMarcandoLeido] = useState(false);
  const [cerradosTemporales, setCerradosTemporales] = useState<string[]>([]);

  const fetchNotificaciones = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones");
      if (!res.ok) return;
      const json = await res.json();
      const notifs: Notificacion[] = json.data ?? [];

      // Filtrar las notificaciones de arribo no leídas que no hayan sido cerradas temporalmente
      const alertasArribo = notifs.filter(
        (n) =>
          !n.leida &&
          (n.tipo === "pedido_por_llegar" || n.tipo === "pedido_llegado") &&
          !cerradosTemporales.includes(n.id)
      );

      // Si hay alertas activas, tomamos la más reciente
      if (alertasArribo.length > 0) {
        setActivo(alertasArribo[0]);
        setVisible(true);
      } else {
        setActivo(null);
        setVisible(false);
      }
    } catch {
      // Silencioso
    }
  }, [cerradosTemporales]);

  // Polling solo con la pestaña visible (no consume Neon en segundo plano).
  usePollingVisible(fetchNotificaciones, POLL_INTERVAL_MS);

  const handleMarcarLeido = async () => {
    if (!activo || marcandoLeido) return;
    setMarcandoLeido(true);
    try {
      const res = await fetch(`/api/notificaciones/${activo.id}/leida`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("No se pudo marcar como leída");

      // Quitar de pantalla
      setCerradosTemporales((prev) => [...prev, activo.id]);
      setActivo(null);
      setVisible(false);
    } catch (error) {
      console.error("Error al marcar como leída la notificación de arribo:", error);
    } finally {
      setMarcandoLeido(false);
    }
  };

  const handleCerrarTemporal = () => {
    if (activo) {
      setCerradosTemporales((prev) => [...prev, activo.id]);
    }
    setVisible(false);
  };

  if (!activo || !visible) return null;

  const esPorLlegar = activo.tipo === "pedido_por_llegar";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-fade-in">
      <div 
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-150 transform transition-all duration-300 scale-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botón cerrar */}
        <button
          onClick={handleCerrarTemporal}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-650 p-1.5 rounded-lg hover:bg-gray-100 transition"
        >
          <FiX size={18} />
        </button>

        {/* Cabecera / Decoración */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold shadow-sm ${
            esPorLlegar 
              ? "bg-indigo-50 text-indigo-650 border border-indigo-100" 
              : "bg-emerald-50 text-emerald-650 border border-emerald-100"
          }`}>
            {esPorLlegar ? <FiClock size={24} className="animate-pulse" /> : <FiMapPin size={24} className="animate-bounce" />}
          </div>
          <div>
            <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              esPorLlegar 
                ? "bg-indigo-100 text-indigo-800" 
                : "bg-emerald-100 text-emerald-800"
            }`}>
              {esPorLlegar ? "Arribo Inminente (5 min)" : "Motorizado en Destino"}
            </span>
            <h3 className="text-base font-bold text-gray-800 mt-1">{activo.titulo}</h3>
          </div>
        </div>

        {/* Mensaje */}
        <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-4 mb-5 text-sm text-gray-700 leading-relaxed">
          {activo.mensaje}
        </div>

        {/* Acciones */}
        <div className="flex gap-2.5">
          {activo.link ? (
            <Link
              href={activo.link}
              onClick={handleMarcarLeido}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition text-white shadow-sm hover:shadow active:scale-95 ${
                esPorLlegar ? "bg-indigo-650 hover:bg-indigo-700" : "bg-emerald-650 hover:bg-emerald-700"
              }`}
            >
              <FiTruck size={14} />
              Ver Detalles del Pedido
            </Link>
          ) : (
            <button
              onClick={handleMarcarLeido}
              disabled={marcandoLeido}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition text-white shadow-sm hover:shadow active:scale-95 ${
                esPorLlegar ? "bg-indigo-650 hover:bg-indigo-700" : "bg-emerald-650 hover:bg-emerald-700"
              }`}
            >
              <FiCheck size={14} />
              Entendido
            </button>
          )}
          
          <button
            onClick={handleMarcarLeido}
            disabled={marcandoLeido}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-xs transition active:scale-95 flex items-center justify-center gap-1"
          >
            {marcandoLeido ? (
              <span className="w-3.5 h-3.5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              "Cerrar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// src/components/ArriboPopup.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiX, FiCheck, FiTruck, FiMapPin, FiClock, FiCalendar } from "react-icons/fi";
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
// Guarda las notificaciones que ya llegaron a mostrarse durante esta sesión.
// Se persiste al abrir el popup (no recién al cerrarlo), de modo que navegar o
// recargar la app no haga aparecer dos veces el mismo aviso.
const STORAGE_CERRADAS = "transavic_notificaciones_popup_cerradas";

function cerradasEnSesion(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_CERRADAS) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function recordarAparicionEnSesion(id: string) {
  try {
    const actuales = cerradasEnSesion();
    if (!actuales.includes(id)) {
      sessionStorage.setItem(STORAGE_CERRADAS, JSON.stringify([...actuales, id]));
    }
  } catch {
    // sessionStorage es una mejora de UX; la campana sigue siendo persistente.
  }
}

export default function ArriboPopup() {
  const [activo, setActivo] = useState<Notificacion | null>(null);
  const [visible, setVisible] = useState(false);
  const [marcandoLeido, setMarcandoLeido] = useState(false);
  const [cerradosTemporales, setCerradosTemporales] = useState<string[]>(cerradasEnSesion);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);

  const cerrarDuranteSesion = useCallback((id: string) => {
    setCerradosTemporales((prev) => {
      const siguientes = Array.from(
        new Set([...cerradasEnSesion(), ...prev, id])
      );
      try {
        sessionStorage.setItem(STORAGE_CERRADAS, JSON.stringify(siguientes));
      } catch {
        // sessionStorage es una mejora de UX; la campana sigue siendo persistente.
      }
      return siguientes;
    });
  }, []);

  const fetchNotificaciones = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones");
      if (!res.ok) return;
      const json = await res.json();
      const notifs: Notificacion[] = json.data ?? [];

      // Arribos y reprogramaciones son operativamente urgentes. Cerrar el popup no
      // marca la notificación como leída: permanece en la campana y no vuelve a
      // interrumpir durante esta sesión.
      const alertasArribo = notifs.filter(
        (n) =>
          !n.leida &&
          (n.tipo === "pedido_por_llegar" ||
            n.tipo === "pedido_llegado" ||
            n.tipo === "pedido_reprogramado") &&
          !cerradosTemporales.includes(n.id)
      );

      // Si hay alertas activas, tomamos la más reciente
      if (alertasArribo.length > 0) {
        // Registrar la aparición sin agregarla todavía al estado de exclusión:
        // así el popup actual permanece visible, pero no reaparece si el layout
        // se desmonta y vuelve a montar dentro de la misma sesión.
        recordarAparicionEnSesion(alertasArribo[0].id);
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
      cerrarDuranteSesion(activo.id);
      setActivo(null);
      setVisible(false);
    } catch (error) {
      console.error("Error al marcar como leída la notificación de arribo:", error);
    } finally {
      setMarcandoLeido(false);
    }
  };

  const handleCerrarTemporal = useCallback(() => {
    if (activo) {
      cerrarDuranteSesion(activo.id);
    }
    setVisible(false);
  }, [activo, cerrarDuranteSesion]);

  // El aviso interrumpe la operación, por eso se comporta como diálogo real:
  // mueve el foco al cierre, permite Escape, contiene Tab y devuelve el foco al
  // control anterior. Cerrar solo descarta el popup durante esta sesión; no borra
  // ni marca la notificación persistente de la campana.
  useEffect(() => {
    if (!activo || !visible) return;
    const focoAnterior = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = requestAnimationFrame(() => cerrarRef.current?.focus());

    const manejarTeclado = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCerrarTemporal();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const enfocables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (enfocables.length === 0) {
        event.preventDefault();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (event.shiftKey && document.activeElement === primero) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener("keydown", manejarTeclado);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", manejarTeclado);
      if (focoAnterior?.isConnected) focoAnterior.focus();
    };
  }, [activo, handleCerrarTemporal, visible]);

  if (!activo || !visible) return null;

  const esPorLlegar = activo.tipo === "pedido_por_llegar";
  const esReprogramacion = activo.tipo === "pedido_reprogramado";
  const tema = esReprogramacion
    ? {
        icono: "bg-orange-50 text-orange-700 border-orange-200",
        chip: "bg-orange-100 text-orange-900",
        boton: "bg-orange-600 hover:bg-orange-700",
        etiqueta: "Pedido reprogramado",
      }
    : esPorLlegar
      ? {
          icono: "bg-indigo-50 text-indigo-650 border-indigo-100",
          chip: "bg-indigo-100 text-indigo-800",
          boton: "bg-indigo-650 hover:bg-indigo-700",
          etiqueta: "Arribo inminente (5 min)",
        }
      : {
          icono: "bg-emerald-50 text-emerald-650 border-emerald-100",
          chip: "bg-emerald-100 text-emerald-800",
          boton: "bg-emerald-650 hover:bg-emerald-700",
          etiqueta: "Motorizado en destino",
        };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-fade-in motion-reduce:animate-none">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-notificacion-emergente"
        aria-describedby="mensaje-notificacion-emergente"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-150 transform transition-all duration-300 scale-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          Nuevo aviso: {activo.titulo}. {activo.mensaje}
        </p>
        {/* Botón cerrar */}
        <button
          ref={cerrarRef}
          onClick={handleCerrarTemporal}
          aria-label="Cerrar aviso por esta sesión"
          className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 transition"
        >
          <FiX size={18} />
        </button>

        {/* Cabecera / Decoración */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold shadow-sm border ${tema.icono}`}>
            {esReprogramacion ? (
              <FiCalendar size={24} />
            ) : esPorLlegar ? (
              <FiClock size={24} className="motion-safe:animate-pulse" />
            ) : (
              <FiMapPin size={24} className="motion-safe:animate-bounce" />
            )}
          </div>
          <div>
            <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${tema.chip}`}>
              {tema.etiqueta}
            </span>
            <h3 id="titulo-notificacion-emergente" className="text-base font-bold text-gray-800 mt-1">
              {activo.titulo}
            </h3>
          </div>
        </div>

        {/* Mensaje */}
        <div
          id="mensaje-notificacion-emergente"
          className="bg-gray-50/70 border border-gray-100 rounded-xl p-4 mb-5 text-sm text-gray-700 leading-relaxed"
        >
          {activo.mensaje}
        </div>

        {/* Acciones */}
        <div className="flex gap-2.5">
          {activo.link ? (
            <Link
              href={activo.link}
              onClick={handleMarcarLeido}
              className={`flex-1 min-h-11 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition text-white shadow-sm hover:shadow active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${tema.boton}`}
            >
              {esReprogramacion ? <FiCalendar size={14} /> : <FiTruck size={14} />}
              {esReprogramacion ? "Ver pedido" : "Ver detalles del pedido"}
            </Link>
          ) : (
            <button
              onClick={handleMarcarLeido}
              disabled={marcandoLeido}
              className={`flex-1 min-h-11 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition text-white shadow-sm hover:shadow active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${tema.boton}`}
            >
              <FiCheck size={14} />
              Entendido
            </button>
          )}
          
          <button
            onClick={esReprogramacion ? handleCerrarTemporal : handleMarcarLeido}
            disabled={marcandoLeido}
            className="min-h-11 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-xs transition active:scale-95 flex items-center justify-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
          >
            {marcandoLeido && !esReprogramacion ? (
              <>
                <span
                  aria-hidden="true"
                  className="w-3.5 h-3.5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none"
                />
                <span className="sr-only">Marcando como leída</span>
              </>
            ) : (
              esReprogramacion ? "Ver más tarde" : "Cerrar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

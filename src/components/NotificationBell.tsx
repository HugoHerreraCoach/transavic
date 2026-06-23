// src/components/NotificationBell.tsx
// Campanita 🔔 con contador de no leídas. Polling cada 30s.
// Click → dropdown con últimas 30. Click en notificación → marca leída y navega al link.
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePollingVisible } from "@/lib/use-polling-visible";
import {
  FiBell,
  FiCheckCircle,
  FiPackage,
  FiTruck,
  FiAlertCircle,
  FiDollarSign,
  FiXCircle,
  FiAlertTriangle,
  FiTrendingDown,
  FiClock,
  FiX,
} from "react-icons/fi";
// Fuente única del tipo: lo importamos del backend para que el frontend nunca
// quede desfasado cuando se agregan tipos nuevos (import type → se borra en build,
// no arrastra el código server de lib/notificaciones al bundle del cliente).
import type { TipoNotificacion } from "@/lib/notificaciones";

interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link: string | null;
  pedido_id: string | null;
  leida: boolean;
  created_at: string;
}

const POLL_INTERVAL_MS = 30_000;

function iconoParaTipo(tipo: TipoNotificacion) {
  switch (tipo) {
    case "pedido_creado":
    case "pedido_asignado":
    case "pesos_listos":
    case "listo_para_despacho":
      return <FiPackage className="text-purple-600" />;
    case "pedido_en_camino":
    case "pedido_por_llegar":
      return <FiTruck className="text-indigo-600" />;
    case "pedido_entregado":
    case "pedido_llegado":
    case "guia_firmada":
      return <FiCheckCircle className="text-green-600" />;
    case "pedido_fallido":
      return <FiAlertCircle className="text-red-600" />;
    case "factura_vencida":
    case "factura_por_vencer":
      return <FiDollarSign className="text-amber-600" />;
    case "meta_diaria_alcanzada":
      return <span>🎯</span>;
    case "meta_atrasada":
      return <FiTrendingDown className="text-amber-600" />;
    case "comprobante_rechazado":
      return <FiXCircle className="text-red-600" />;
    case "comprobante_error":
      return <FiAlertTriangle className="text-amber-600" />;
    case "repartidor_oscuro":
      return <FiAlertTriangle className="text-red-600" />;
    case "cliente_inactivo":
      return <FiClock className="text-gray-500" />;
    default:
      return <FiBell className="text-gray-500" />;
  }
}

// Tipos IMPORTANTES: se destacan con borde de color para que no pasen
// desapercibidos (decisión 12 jun 2026: la asesora no vio su autorización
// aprobada). Igual se pueden cerrar con la "x" — el dato vive en su módulo.
function acentoParaTipo(tipo: TipoNotificacion): string | null {
  switch (tipo) {
    case "comprobante_rechazado":
    case "comprobante_error":
    case "pedido_fallido":
    case "repartidor_oscuro":
      return "border-l-[3px] border-l-red-500";
    case "factura_vencida":
      return "border-l-[3px] border-l-amber-500";
    case "autorizacion_resuelta":
    case "autorizacion_solicitada":
      return "border-l-[3px] border-l-indigo-500";
    default:
      return null;
  }
}

function formatHora(iso: string): string {
  const d = new Date(iso);
  const ahora = new Date();
  const diffMin = Math.round((ahora.getTime() - d.getTime()) / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffMin < 60 * 24) {
    const h = Math.floor(diffMin / 60);
    return `hace ${h} h`;
  }
  const days = Math.floor(diffMin / (60 * 24));
  return `hace ${days} d`;
}

// El layout monta DOS campanitas (header mobile + flotante desktop) que con CSS
// display:none NO se desmontan → ambas pollearían a la vez. Con `variant` cada
// instancia solo pollea cuando SU viewport está activo, evitando el doble fetch.
type VariantBell = "mobile" | "desktop";

export default function NotificationBell({ variant }: { variant?: VariantBell }) {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notificacion[]>([]);
  const [unread, setUnread] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ¿El viewport de ESTA instancia está activo? (de-dup del doble montaje)
  const [viewportActivo, setViewportActivo] = useState<boolean>(() => {
    if (typeof window === "undefined" || !variant) return !variant; // sin variant: siempre activa
    const q = variant === "desktop" ? "(min-width: 1024px)" : "(max-width: 1023px)";
    return window.matchMedia(q).matches;
  });
  useEffect(() => {
    if (!variant || typeof window === "undefined") return;
    const q = variant === "desktop" ? "(min-width: 1024px)" : "(max-width: 1023px)";
    const mql = window.matchMedia(q);
    setViewportActivo(mql.matches);
    const handler = (e: MediaQueryListEvent) => setViewportActivo(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [variant]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones");
      if (!res.ok) return;
      const json = await res.json();
      setNotifs(json.data ?? []);
      setUnread(json.unreadCount ?? 0);
    } catch {
      /* silencio: no-crítico */
    }
  }, []);

  // Polling solo con la pestaña visible y solo en la instancia cuyo viewport está activo.
  usePollingVisible(fetchData, POLL_INTERVAL_MS, { enabled: viewportActivo });

  // Click fuera del dropdown → cerrar
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const marcarLeida = async (id: string) => {
    await fetch(`/api/notificaciones/${id}/leida`, { method: "PATCH" });
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    setUnread((prev) => Math.max(0, prev - 1));
  };

  const marcarTodasLeidas = async () => {
    await fetch("/api/notificaciones/leer-todas", { method: "POST" });
    setNotifs((prev) => prev.map((n) => ({ ...n, leida: true })));
    setUnread(0);
  };

  // Descartar UNA notificación (la "x"). Optimista: sale de la lista al toque.
  const eliminar = async (n: Notificacion) => {
    setNotifs((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.leida) setUnread((prev) => Math.max(0, prev - 1));
    await fetch(`/api/notificaciones/${n.id}`, { method: "DELETE" }).catch(() => {});
  };

  // Borrar todas las YA LEÍDAS de un golpe. Con confirmación: "Marcar todas
  // leídas" + "Limpiar" son 2 taps que podrían borrar avisos nunca vistos
  // (leída ≠ vista), así que el conteo en el confirm da una última mirada.
  const limpiarLeidas = async () => {
    const cuantas = notifs.filter((n) => n.leida).length;
    const ok = window.confirm(
      `¿Borrar ${cuantas === 1 ? "la notificación leída" : `las ${cuantas} notificaciones leídas`}? Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    setNotifs((prev) => prev.filter((n) => !n.leida));
    await fetch("/api/notificaciones/limpiar-leidas", { method: "POST" }).catch(() => {});
  };

  const hayLeidas = notifs.some((n) => n.leida);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600 cursor-pointer"
        aria-label="Notificaciones"
      >
        <FiBell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-800">Notificaciones</h3>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={marcarTodasLeidas}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Marcar todas leídas
                </button>
              )}
              {hayLeidas && (
                <button
                  onClick={limpiarLeidas}
                  className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                  title="Borra las notificaciones que ya leíste"
                >
                  Limpiar leídas
                </button>
              )}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifs.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">
                No tienes notificaciones todavía
              </div>
            )}
            {notifs.map((n) => {
              const acento = acentoParaTipo(n.tipo);
              const className = `group/notif flex items-start gap-3 px-4 py-3 border-b last:border-b-0 cursor-pointer transition-colors ${
                n.leida ? "bg-white hover:bg-gray-50" : "bg-blue-50/40 hover:bg-blue-50"
              } ${acento ?? ""}`;
              const handleClick = () => {
                if (!n.leida) marcarLeida(n.id);
                setOpen(false);
              };
              const contenido = (
                <>
                  <span className="flex-shrink-0 mt-0.5 text-lg">
                    {iconoParaTipo(n.tipo)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm ${
                        n.leida ? "text-gray-700" : "font-semibold text-gray-900"
                      }`}
                    >
                      {n.titulo}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {n.mensaje}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      {formatHora(n.created_at)}
                    </div>
                  </div>
                  {!n.leida && (
                    <span className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-500" />
                  )}
                  {/* Descartar: área táctil ≥40px (las asesoras usan celular; un
                      fallo de dedo aquí navegaría al link de la fila). Los
                      márgenes negativos compensan el padding para que el layout
                      no se infle. */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      eliminar(n);
                    }}
                    title="Descartar notificación"
                    aria-label="Descartar notificación"
                    className="flex-shrink-0 -mr-2 -my-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 group-hover/notif:text-gray-400 transition-colors"
                  >
                    <FiX className="w-4 h-4" />
                  </button>
                </>
              );
              if (n.link) {
                return (
                  <Link
                    key={n.id}
                    href={n.link}
                    className={className}
                    onClick={handleClick}
                  >
                    {contenido}
                  </Link>
                );
              }
              return (
                <div key={n.id} className={className} onClick={handleClick}>
                  {contenido}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

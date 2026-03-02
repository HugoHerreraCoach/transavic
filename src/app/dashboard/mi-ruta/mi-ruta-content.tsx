// src/app/dashboard/mi-ruta/mi-ruta-content.tsx
"use client";

import { useState, useEffect, useCallback, useSyncExternalStore, useRef } from "react";
import { Session } from "next-auth";
import { PedidoRuta, EstadoPedido } from "@/lib/types";
import {
  isOnline,
  enqueueAction,
  getQueueCount,
  getQueue,
  syncQueue,
} from "@/lib/offline-queue";
import {
  FiNavigation,
  FiCheckCircle,
  FiXCircle,
  FiPhone,
  FiMapPin,
  FiClock,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiRefreshCw,
  FiFileText,
  FiInfo,
  FiMap,
  FiCornerUpLeft,
  FiExternalLink,
} from "react-icons/fi";

interface MiRutaContentProps {
  session: Session;
}

interface RouteStats {
  total: number;
  entregados: number;
  fallidos: number;
  completados: number;
  pendientes: number;
}

// ── Helpers ──

function getEstadoConfig(estado: EstadoPedido) {
  const configs = {
    Pendiente: { label: "Pendiente", color: "text-gray-600", bg: "bg-gray-100", border: "border-gray-200", dot: "bg-gray-400" },
    Asignado: { label: "Asignado", color: "text-blue-700", bg: "bg-blue-100", border: "border-blue-200", dot: "bg-blue-500" },
    En_Camino: { label: "En Camino", color: "text-indigo-700", bg: "bg-indigo-100", border: "border-indigo-300", dot: "bg-indigo-500" },
    Entregado: { label: "Entregado", color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-200", dot: "bg-emerald-500" },
    Fallido: { label: "Fallido", color: "text-red-700", bg: "bg-red-100", border: "border-red-200", dot: "bg-red-500" },
  };
  return configs[estado] || configs.Pendiente;
}

function formatETA(isoString: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("es-PE", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function getMinutesRemaining(isoString: string | null): number | null {
  if (!isoString) return null;
  return Math.round((new Date(isoString).getTime() - Date.now()) / 60000);
}

// ── Hook: Online Status ──

function useOnlineStatus() {
  const getSnapshot = () => navigator.onLine;
  const subscribe = (callback: () => void) => {
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
      window.removeEventListener("online", callback);
      window.removeEventListener("offline", callback);
    };
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

// ── Hook: Geolocation (Lazy — solo se activa cuando se necesita) ──

function useGeolocation(enabled: boolean) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // Silencioso — si no hay permiso, el ETA usa otros métodos
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return position;
}

// ── Componentes ──

function ProgressBar({ stats }: { stats: RouteStats }) {
  const percentage = stats.total > 0 ? Math.round((stats.completados / stats.total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-semibold text-gray-700">Progreso del día</span>
        <span className="text-sm font-bold text-gray-900">{percentage}%</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-1000 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{stats.total}</p>
          <p className="text-[10px] text-gray-400">Total</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-indigo-600">{stats.pendientes}</p>
          <p className="text-[10px] text-gray-400">Pendientes</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-600">{stats.entregados}</p>
          <p className="text-[10px] text-gray-400">Entregados</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-red-500">{stats.fallidos}</p>
          <p className="text-[10px] text-gray-400">Fallidos</p>
        </div>
      </div>
    </div>
  );
}

// ── Nav Buttons (Maps + Waze) ──

function NavButtons({ pedido }: { pedido: PedidoRuta }) {
  if (!pedido.latitude || !pedido.longitude) return null;

  const lat = pedido.latitude;
  const lng = pedido.longitude;
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-200 hover:shadow-xl transition-all active:scale-[0.98]"
      >
        <FiExternalLink size={16} />
        🗺️ Google Maps
      </a>
      <a
        href={wazeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-200 hover:shadow-xl transition-all active:scale-[0.98]"
      >
        <FiNavigation size={16} />
        🔵 Waze
      </a>
    </div>
  );
}

// ── Mini Mapa Ruta ──

function MiniMapaRuta({
  pedidos,
  driverPosition,
}: {
  pedidos: PedidoRuta[];
  driverPosition: { lat: number; lng: number } | null;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current || typeof google === "undefined") return;

    // Center: driver position or first pedido or Lima
    const center = driverPosition
      ? { lat: driverPosition.lat, lng: driverPosition.lng }
      : pedidos.find((p) => p.latitude && p.longitude)
      ? { lat: pedidos.find((p) => p.latitude)!.latitude!, lng: pedidos.find((p) => p.longitude)!.longitude! }
      : { lat: -12.0553, lng: -77.0451 };

    if (!mapInstance.current) {
      mapInstance.current = new google.maps.Map(mapRef.current, {
        center,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });
    }

    // Clear existing markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    // Add pedido markers
    const activos = pedidos.filter((p) => p.estado !== "Entregado" && p.estado !== "Fallido");
    const completados = pedidos.filter((p) => p.estado === "Entregado" || p.estado === "Fallido");

    activos.forEach((pedido, idx) => {
      if (!pedido.latitude || !pedido.longitude) return;
      const isEnCamino = pedido.estado === "En_Camino";
      const marker = new google.maps.Marker({
        position: { lat: pedido.latitude, lng: pedido.longitude },
        map: mapInstance.current!,
        title: `${idx + 1}. ${pedido.cliente}`,
        label: {
          text: String(idx + 1),
          color: "white",
          fontWeight: "bold",
          fontSize: "12px",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isEnCamino ? 18 : 14,
          fillColor: isEnCamino ? "#4f46e5" : "#f59e0b",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 2,
        },
      });
      markersRef.current.push(marker);
    });

    completados.forEach((pedido) => {
      if (!pedido.latitude || !pedido.longitude) return;
      const marker = new google.maps.Marker({
        position: { lat: pedido.latitude, lng: pedido.longitude },
        map: mapInstance.current!,
        title: pedido.cliente,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: pedido.estado === "Entregado" ? "#10b981" : "#ef4444",
          fillOpacity: 0.6,
          strokeColor: "white",
          strokeWeight: 1,
        },
      });
      markersRef.current.push(marker);
    });
  }, [pedidos, driverPosition]);

  // Update driver marker separately
  useEffect(() => {
    if (!mapInstance.current || !driverPosition) return;

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new google.maps.Marker({
        map: mapInstance.current,
        title: "Tu ubicación",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 3,
        },
        zIndex: 999,
      });
    }

    driverMarkerRef.current.setPosition(driverPosition);
  }, [driverPosition]);

  return (
    <div ref={mapRef} className="w-full h-full rounded-2xl" />
  );
}

// ── Pedido Card (Hero mode for En_Camino, Compact for completed) ──

function PedidoCard({
  pedido,
  index,
  isExpanded,
  onToggle,
  onIniciarViaje,
  onEntregar,
  onFallido,
  onCancelarViaje,
  isProcessing,
}: {
  pedido: PedidoRuta;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onIniciarViaje: (id: string) => void;
  onEntregar: (id: string) => void;
  onFallido: (id: string) => void;
  onCancelarViaje: (id: string) => void;
  isProcessing: boolean;
}) {
  const config = getEstadoConfig(pedido.estado);
  const minutesRemaining = getMinutesRemaining(pedido.hora_llegada_estimada);
  const isOverdue = minutesRemaining !== null && minutesRemaining < -5;
  const isCompleted = pedido.estado === "Entregado" || pedido.estado === "Fallido";
  const isEnCamino = pedido.estado === "En_Camino";

  // ── Compact mode for completed ──
  if (isCompleted) {
    return (
      <div className={`px-4 py-2.5 rounded-xl border flex items-center gap-3 ${
        pedido.estado === "Entregado"
          ? "border-emerald-200/60 bg-emerald-50/40"
          : "border-red-200/60 bg-red-50/40"
      }`}>
        <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          pedido.estado === "Entregado" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
        }`}>
          {pedido.estado === "Entregado" ? "✓" : "✗"}
        </span>
        <span className="text-sm text-gray-400 line-through truncate flex-1">{pedido.cliente}</span>
        <span className="text-xs text-gray-400">{pedido.distrito}</span>
        <span className="text-[10px] flex-shrink-0">{pedido.estado === "Entregado" ? "✅" : "❌"}</span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border-2 transition-all duration-300 overflow-hidden ${
        isOverdue && isEnCamino
          ? "border-red-400 bg-red-50 shadow-lg shadow-red-100 animate-pulse"
          : isEnCamino
          ? "border-indigo-400 bg-indigo-50 shadow-lg shadow-indigo-200 ring-2 ring-indigo-300/50"
          : `${config.border} bg-white shadow-sm`
      }`}
    >
      {/* Header (siempre visible) */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer"
      >
        {/* Número de orden */}
        <span
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            isEnCamino
              ? "bg-indigo-200 text-indigo-800 animate-bounce"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {index + 1}
        </span>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate text-gray-900">
            {pedido.cliente}
          </p>
          <p className="text-xs text-gray-500 truncate">{pedido.distrito} · {pedido.direccion}</p>
        </div>

        {/* Estado + ETA badge */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}>
            {config.label}
          </span>
          {isEnCamino && pedido.hora_llegada_estimada && (
            <span className={`text-xs font-medium ${isOverdue ? "text-red-600" : "text-indigo-600"}`}>
              🕐 Llega: {formatETA(pedido.hora_llegada_estimada)}
            </span>
          )}
        </div>

        {/* Chevron */}
        {isExpanded ? (
          <FiChevronUp className="text-gray-400 flex-shrink-0" />
        ) : (
          <FiChevronDown className="text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Contenido expandido */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {/* Detalles */}
          <div className="mt-3 space-y-2">
            {pedido.direccion && (
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <FiMapPin className="mt-0.5 flex-shrink-0 text-gray-400" />
                <span>{pedido.direccion}</span>
              </div>
            )}
            {pedido.whatsapp && (
              <div className="flex items-center gap-2 text-sm">
                <FiPhone className="flex-shrink-0 text-gray-400" />
                <a
                  href={`https://wa.me/${pedido.whatsapp.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  {pedido.whatsapp}
                </a>
              </div>
            )}
            {pedido.hora_entrega && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <FiClock className="flex-shrink-0 text-gray-400" />
                <span>Hora entrega: {pedido.hora_entrega}</span>
              </div>
            )}
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <FiFileText className="mt-0.5 flex-shrink-0 text-gray-400" />
              <p className="whitespace-pre-wrap">{pedido.detalle}</p>
            </div>
            {pedido.notas && (
              <div className="flex items-start gap-2 text-sm text-gray-500">
                <FiInfo className="mt-0.5 flex-shrink-0 text-gray-400" />
                <p className="whitespace-pre-wrap italic">{pedido.notas}</p>
              </div>
            )}
          </div>

          {/* ETA Info */}
          {isEnCamino && pedido.hora_llegada_estimada && (
            <div className={`mt-3 p-3 rounded-xl text-sm ${isOverdue ? "bg-red-100 text-red-800" : "bg-indigo-100 text-indigo-800"}`}>
              <div className="flex items-center gap-2">
                {isOverdue ? <FiAlertTriangle className="flex-shrink-0" /> : <FiClock className="flex-shrink-0" />}
                <span className="font-medium">
                  {isOverdue
                    ? `⚠️ Retraso: debió llegar a las ${formatETA(pedido.hora_llegada_estimada)}`
                    : `🕐 Llegada estimada: ${formatETA(pedido.hora_llegada_estimada)} (${minutesRemaining} min restantes)`}
                </span>
              </div>
            </div>
          )}

          {/* Razón de fallo */}
          {pedido.estado === "Fallido" && pedido.razon_fallo && (
            <div className="mt-3 p-3 rounded-xl bg-red-100 text-red-800 text-sm">
              <p className="font-medium">❌ Razón: {pedido.razon_fallo}</p>
            </div>
          )}

          {/* ── BOTONES DE ACCIÓN ── */}
          <div className="mt-4 space-y-2">
            {/* Estado: Asignado o Pendiente → Botón "Ir al Cliente" */}
            {(pedido.estado === "Asignado" || pedido.estado === "Pendiente") && (
              <button
                onClick={() => onIniciarViaje(pedido.id)}
                disabled={isProcessing}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-blue-200 hover:shadow-xl hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] cursor-pointer"
              >
                <FiNavigation className="text-xl" />
                🚀 Ir al Cliente
              </button>
            )}

            {/* Estado: En Camino → Botones Navigation + Entrega + Cancel */}
            {isEnCamino && (
              <>
                {/* ── Botones de navegación persistentes ── */}
                <NavButtons pedido={pedido} />

                {/* ── Botones de estado ── */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => onEntregar(pedido.id)}
                    disabled={isProcessing}
                    className="py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 hover:shadow-xl transition-all disabled:opacity-50 active:scale-[0.98] cursor-pointer"
                  >
                    <FiCheckCircle className="text-xl" />
                    Entregado
                  </button>
                  <button
                    onClick={() => onFallido(pedido.id)}
                    disabled={isProcessing}
                    className="py-4 rounded-2xl bg-gradient-to-r from-red-500 to-rose-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-red-200 hover:shadow-xl transition-all disabled:opacity-50 active:scale-[0.98] cursor-pointer"
                  >
                    <FiXCircle className="text-xl" />
                    No Entregado
                  </button>
                </div>

                {/* ── Cancelar viaje (error operativo) ── */}
                <button
                  onClick={() => onCancelarViaje(pedido.id)}
                  disabled={isProcessing}
                  className="w-full py-2.5 rounded-xl border-2 border-gray-200 bg-white text-gray-600 font-medium text-sm flex items-center justify-center gap-2 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <FiCornerUpLeft size={14} />
                  ↩️ Cancelar — seleccioné el pedido equivocado
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal de Confirmación ──

function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-2">{message}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="py-3.5 rounded-2xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 transition-colors text-sm cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={`py-3.5 rounded-2xl text-white font-semibold transition-colors text-sm cursor-pointer ${confirmColor}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de Razón de Fallo ──

function FailureReasonModal({
  cliente,
  onSubmit,
  onCancel,
}: {
  cliente: string;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  const predefinedReasons = [
    "Cliente no se encontraba",
    "Dirección incorrecta",
    "Cliente rechazó el pedido",
    "No se pudo ubicar la zona",
    "Producto dañado",
  ];

  const handleSubmit = () => {
    const finalReason = reason === "__custom__" ? customReason.trim() : reason;
    if (finalReason) onSubmit(finalReason);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-gray-900">❌ No se entregó</h3>
        <p className="text-sm text-gray-600 mt-1">
          Pedido de <strong>{cliente}</strong>
        </p>
        <p className="text-xs text-gray-400 mt-1">Selecciona la razón:</p>

        <div className="mt-4 space-y-2">
          {predefinedReasons.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all cursor-pointer ${
                reason === r
                  ? "border-red-400 bg-red-50 text-red-800"
                  : "border-gray-200 hover:border-gray-300 text-gray-700"
              }`}
            >
              {r}
            </button>
          ))}
          <button
            onClick={() => setReason("__custom__")}
            className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all cursor-pointer ${
              reason === "__custom__"
                ? "border-red-400 bg-red-50 text-red-800"
                : "border-gray-200 hover:border-gray-300 text-gray-700"
            }`}
          >
            Otra razón...
          </button>
          {reason === "__custom__" && (
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Describe la razón..."
              className="w-full mt-2 p-3 rounded-xl border-2 border-gray-200 text-sm resize-none h-20 focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none"
              autoFocus
            />
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="py-3.5 rounded-2xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 transition-colors text-sm cursor-pointer"
          >
            Volver
          </button>
          <button
            onClick={handleSubmit}
            disabled={!reason || (reason === "__custom__" && !customReason.trim())}
            className="py-3.5 rounded-2xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors text-sm disabled:opacity-50 cursor-pointer"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente Principal ──

export default function MiRutaContent({ session }: MiRutaContentProps) {
  const [pedidos, setPedidos] = useState<PedidoRuta[]>([]);
  const [stats, setStats] = useState<RouteStats>({ total: 0, entregados: 0, fallidos: 0, completados: 0, pendientes: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ pedidoId: string; cliente: string } | null>(null);
  const [failureModal, setFailureModal] = useState<{ pedidoId: string; cliente: string } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedPedidoIds, setQueuedPedidoIds] = useState<Set<string>>(new Set());
  const [syncMessage, setSyncMessage] = useState<{ type: string; text: string } | null>(null);

  const online = useOnlineStatus();

  // GPS: solo se activa cuando el mapa está abierto o hay un pedido En_Camino
  const pedidoEnCaminoExists = pedidos.some(p => p.estado === 'En_Camino');
  const driverPosition = useGeolocation(showMap || pedidoEnCaminoExists);

  const refreshQueueState = useCallback(() => {
    setQueueCount(getQueueCount());
    const ids = new Set(getQueue().map((a) => a.pedidoId));
    setQueuedPedidoIds(ids);
  }, []);

  const fetchRuta = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/repartidor/mi-ruta");
      if (!res.ok) throw new Error("Error");
      const data = await res.json();
      setPedidos(data.pedidos);
      setStats(data.stats);

      // Auto-expand the En_Camino pedido
      const enCamino = data.pedidos.find((p: PedidoRuta) => p.estado === "En_Camino");
      if (enCamino) setExpandedId(enCamino.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRuta();
    refreshQueueState();
    const interval = setInterval(() => fetchRuta(), 60000);
    return () => clearInterval(interval);
  }, [fetchRuta, refreshQueueState]);

  // Online sync
  useEffect(() => {
    if (!online) return;

    const doSync = async () => {
      const count = getQueueCount();
      if (count === 0) return;
      try {
        const result = await syncQueue();
        refreshQueueState();
        if (result.synced > 0) {
          setSyncMessage({
            type: result.failed > 0 ? "warning" : "success",
            text: `✅ ${result.synced} acción(es) sincronizada(s)${result.failed > 0 ? ` · ⚠️ ${result.failed} falló` : ""}`,
          });
          setTimeout(() => setSyncMessage(null), 4000);
          await fetchRuta();
        }
      } catch {
        console.error("Sync error");
      }
    };

    doSync();
  }, [online, fetchRuta, refreshQueueState]);

  // ── Acciones ──

  const handleIniciarViaje = async (pedidoId: string) => {
    setProcessing(true);

    if (!isOnline()) {
      enqueueAction({ type: "iniciar-viaje", pedidoId, expectedEstado: "Asignado", payload: {} });
      refreshQueueState();
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedidoId ? { ...p, estado: "En_Camino" as EstadoPedido } : p))
      );
      setExpandedId(pedidoId);
      setProcessing(false);
      return;
    }

    try {
      // Enviar ubicación GPS real para ETA preciso
      const fetchOptions: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          driverPosition
            ? { driverLat: driverPosition.lat, driverLng: driverPosition.lng }
            : {}
        ),
      };
      const res = await fetch(`/api/pedidos/${pedidoId}/iniciar-viaje`, fetchOptions);
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Error al iniciar viaje");
        return;
      }

      // Abrir Google Maps automáticamente
      if (data.navegacion?.googleMaps) {
        window.open(data.navegacion.googleMaps, "_blank");
      }

      await fetchRuta();
    } catch {
      alert("Error de conexión. Intenta de nuevo.");
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmEntrega = async (pedidoId: string) => {
    setProcessing(true);
    setConfirmModal(null);

    if (!isOnline()) {
      enqueueAction({ type: "entregar", pedidoId, expectedEstado: "En_Camino", payload: {} });
      refreshQueueState();
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedidoId ? { ...p, estado: "Entregado" as EstadoPedido } : p))
      );
      setProcessing(false);
      return;
    }

    try {
      const res = await fetch(`/api/pedidos/${pedidoId}/entregar`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al confirmar entrega");
        return;
      }
      await fetchRuta();
    } catch {
      alert("Error de conexión.");
    } finally {
      setProcessing(false);
    }
  };

  const handleFallido = async (pedidoId: string, razon: string) => {
    setProcessing(true);
    setFailureModal(null);

    if (!isOnline()) {
      enqueueAction({ type: "fallido", pedidoId, expectedEstado: "En_Camino", payload: { razon } });
      refreshQueueState();
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedidoId ? { ...p, estado: "Fallido" as EstadoPedido, razon_fallo: razon } : p))
      );
      setProcessing(false);
      return;
    }

    try {
      const res = await fetch(`/api/pedidos/${pedidoId}/entregar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallido: true, razon_fallo: razon }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error");
        return;
      }
      await fetchRuta();
    } catch {
      alert("Error de conexión.");
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelarViaje = async (pedidoId: string) => {
    setProcessing(true);

    if (!isOnline()) {
      // Offline: revert locally
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedidoId ? { ...p, estado: "Asignado" as EstadoPedido, inicio_viaje_at: null, hora_llegada_estimada: null } : p))
      );
      setProcessing(false);
      return;
    }

    try {
      const res = await fetch(`/api/pedidos/${pedidoId}/cancelar-viaje`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al cancelar viaje");
        return;
      }
      await fetchRuta();
    } catch {
      alert("Error de conexión.");
    } finally {
      setProcessing(false);
    }
  };

  // ── Render ──

  const today = new Date().toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Separate active from completed for ordering
  const activePedidos = pedidos.filter((p) => p.estado !== "Entregado" && p.estado !== "Fallido");
  const completedPedidos = pedidos.filter((p) => p.estado === "Entregado" || p.estado === "Fallido");
  const pedidoEnCamino = pedidos.find((p) => p.estado === "En_Camino");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 mt-4 text-sm">Cargando tu ruta...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-14 lg:top-0 z-30">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">🚚 Mi Ruta</h1>
            <p className="text-xs text-gray-500 capitalize">{today}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle mapa */}
            <button
              onClick={() => setShowMap(!showMap)}
              className={`p-2.5 rounded-xl transition-colors cursor-pointer ${
                showMap ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 hover:bg-gray-200 text-gray-600"
              }`}
              title={showMap ? "Ocultar mapa" : "Ver mapa"}
            >
              <FiMap className="text-lg" />
            </button>
            <button
              onClick={() => fetchRuta(true)}
              disabled={refreshing}
              className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors cursor-pointer"
              title="Actualizar"
            >
              <FiRefreshCw className={`text-lg ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-4 space-y-4">

        {/* Offline Banner */}
        {!online && (
          <div className="px-4 py-3 rounded-2xl bg-red-100 border border-red-200 flex items-center gap-2 text-sm text-red-800 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            Sin conexión{queueCount > 0 && ` · ${queueCount} acción(es) pendiente(s)`}
          </div>
        )}

        {/* Sync success message */}
        {syncMessage && (
          <div className={`px-4 py-3 rounded-2xl border flex items-center gap-2 text-sm font-medium transition-all ${
            syncMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-amber-50 border-amber-200 text-amber-800"
          }`}>
            {syncMessage.text}
          </div>
        )}

        {/* Mini Mapa */}
        {showMap && (
          <div className="h-[280px] rounded-2xl overflow-hidden border border-gray-200 shadow-lg">
            <MiniMapaRuta pedidos={pedidos} driverPosition={driverPosition} />
          </div>
        )}

        {/* Progress Bar */}
        <ProgressBar stats={stats} />

        {/* Sin pedidos */}
        {pedidos.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📭</div>
            <h2 className="text-lg font-semibold text-gray-700">Sin pedidos asignados</h2>
            <p className="text-sm text-gray-500 mt-1">
              {session.user.role === "repartidor"
                ? "El administrador aún no te ha asignado pedidos para hoy."
                : "No hay pedidos asignados a tu usuario para hoy."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Hero: pedido en camino (siempre visible arriba) */}
            {pedidoEnCamino && expandedId !== pedidoEnCamino.id && (
              <div className="p-3 rounded-2xl bg-indigo-50 border-2 border-indigo-300 shadow-md">
                <button
                  onClick={() => setExpandedId(pedidoEnCamino.id)}
                  className="w-full flex items-center gap-3 text-left cursor-pointer"
                >
                  <span className="w-8 h-8 rounded-full bg-indigo-200 text-indigo-800 font-bold text-sm flex items-center justify-center animate-bounce">
                    🚀
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-indigo-900 truncate">En camino → {pedidoEnCamino.cliente}</p>
                    <p className="text-xs text-indigo-600">{pedidoEnCamino.distrito}</p>
                  </div>
                  <span className="text-xs font-medium text-indigo-600">
                    {pedidoEnCamino.hora_llegada_estimada ? `🕐 Llega: ${formatETA(pedidoEnCamino.hora_llegada_estimada)}` : ""}
                  </span>
                  <FiChevronDown className="text-indigo-400" />
                </button>
              </div>
            )}

            {/* Pedidos activos */}
            {activePedidos.map((pedido, index) => (
              <div key={pedido.id}>
                <PedidoCard
                  pedido={pedido}
                  index={index}
                  isExpanded={expandedId === pedido.id}
                  onToggle={() => setExpandedId(expandedId === pedido.id ? null : pedido.id)}
                  onIniciarViaje={handleIniciarViaje}
                  onEntregar={(id) => {
                    const p = pedidos.find((x) => x.id === id);
                    if (p) setConfirmModal({ pedidoId: id, cliente: p.cliente });
                  }}
                  onFallido={(id) => {
                    const p = pedidos.find((x) => x.id === id);
                    if (p) setFailureModal({ pedidoId: id, cliente: p.cliente });
                  }}
                  onCancelarViaje={handleCancelarViaje}
                  isProcessing={processing}
                />
                {queuedPedidoIds.has(pedido.id) && (
                  <div className="mt-1 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700 font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    ⏳ Sin sincronizar — se enviará al reconectar
                  </div>
                )}
              </div>
            ))}

            {/* Divider si hay completados */}
            {completedPedidos.length > 0 && activePedidos.length > 0 && (
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">Completados ({completedPedidos.length})</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {/* Pedidos completados (compactos) */}
            {completedPedidos.map((pedido, index) => (
              <PedidoCard
                key={pedido.id}
                pedido={pedido}
                index={activePedidos.length + index}
                isExpanded={false}
                onToggle={() => {}}
                onIniciarViaje={() => {}}
                onEntregar={() => {}}
                onFallido={() => {}}
                onCancelarViaje={() => {}}
                isProcessing={false}
              />
            ))}
          </div>
        )}

        {/* Mensaje cuando se completó todo */}
        {stats.total > 0 && stats.completados === stats.total && (
          <div className="text-center py-8 bg-gradient-to-b from-emerald-50 to-white rounded-2xl border border-emerald-100">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-lg font-bold text-emerald-800">¡Ruta completada!</h2>
            <p className="text-sm text-emerald-600 mt-1">
              Has completado todos los pedidos del día.
            </p>
          </div>
        )}
      </div>

      {/* Modales */}
      {confirmModal && (
        <ConfirmModal
          title="✅ Confirmar Entrega"
          message={`¿Confirmas que entregaste el pedido a ${confirmModal.cliente}?`}
          confirmLabel="Sí, Entregado"
          confirmColor="bg-emerald-500 hover:bg-emerald-600"
          onConfirm={() => handleConfirmEntrega(confirmModal.pedidoId)}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {failureModal && (
        <FailureReasonModal
          cliente={failureModal.cliente}
          onSubmit={(reason) => handleFallido(failureModal.pedidoId, reason)}
          onCancel={() => setFailureModal(null)}
        />
      )}
    </div>
  );
}

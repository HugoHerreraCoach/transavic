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
  FiRotateCcw,
  FiZap,
} from "react-icons/fi";
import { useJsApiLoader } from "@react-google-maps/api";

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

interface RutaResumen {
  paradasRestantes: number;
  distanciaTotalKm: number;
  duracionTotalMin: number;
}

interface BaseLocation {
  lat: number;
  lng: number;
  address: string;
  name: string;
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

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
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

function ProgressBar({ stats, rutaResumen }: { stats: RouteStats; rutaResumen: RutaResumen }) {
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

      {/* Resumen de ruta */}
      {rutaResumen.paradasRestantes > 0 && (rutaResumen.distanciaTotalKm > 0 || rutaResumen.duracionTotalMin > 0) && (
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <span className="px-2 py-1 rounded-lg bg-violet-50 text-violet-700 text-[11px] font-semibold">
            🛑 {rutaResumen.paradasRestantes} paradas
          </span>
          {rutaResumen.distanciaTotalKm > 0 && (
            <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-semibold">
              📏 {rutaResumen.distanciaTotalKm} km
            </span>
          )}
          {rutaResumen.duracionTotalMin > 0 && (
            <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-semibold">
              ⏱️ ~{formatDuration(rutaResumen.duracionTotalMin)}
            </span>
          )}
        </div>
      )}
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

// ── Mini Mapa Ruta (Mejorado con polyline, marcador base, números) ──

function MiniMapaRuta({
  pedidos,
  driverPosition,
  baseLocation,
}: {
  pedidos: PedidoRuta[];
  driverPosition: { lat: number; lng: number } | null;
  baseLocation: BaseLocation | null;
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_MAPS_API_KEY || "",
  });

  const [tilesLoaded, setTilesLoaded] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const baseMarkerRef = useRef<google.maps.Marker | null>(null);
  const hasFitBoundsRef = useRef(false);

  const recenterMap = useCallback(() => {
    if (!mapInstance.current || typeof google === "undefined") return;
    const activos = pedidos.filter((p) => p.estado !== "Entregado" && p.estado !== "Fallido");
    
    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;
    
    if (baseLocation) {
      bounds.extend({ lat: baseLocation.lat, lng: baseLocation.lng });
      hasPoints = true;
    }
    
    activos.forEach(p => {
      if (p.latitude && p.longitude) {
        bounds.extend({ lat: p.latitude, lng: p.longitude });
        hasPoints = true;
      }
    });
    
    if (driverPosition) {
      bounds.extend(driverPosition);
      hasPoints = true;
    }

    if (hasPoints) {
      mapInstance.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    }
  }, [pedidos, driverPosition, baseLocation]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || typeof google === "undefined") return;

    // Center: driver position or first active pedido or base or Lima
    const activos = pedidos.filter((p) => p.estado !== "Entregado" && p.estado !== "Fallido");
    const firstWithCoords = activos.find((p) => p.latitude && p.longitude) || pedidos.find((p) => p.latitude && p.longitude);

    const center = driverPosition
      ? { lat: driverPosition.lat, lng: driverPosition.lng }
      : firstWithCoords
      ? { lat: firstWithCoords.latitude!, lng: firstWithCoords.longitude! }
      : baseLocation
      ? { lat: baseLocation.lat, lng: baseLocation.lng }
      : { lat: -12.0553, lng: -77.0451 };

    if (!mapInstance.current) {
      mapInstance.current = new google.maps.Map(mapRef.current, {
        center,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });

      google.maps.event.addListenerOnce(mapInstance.current, "tilesloaded", () => {
        setTilesLoaded(true);
      });
    }

    // Clear existing markers & polyline
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    if (baseMarkerRef.current) {
      baseMarkerRef.current.setMap(null);
      baseMarkerRef.current = null;
    }

    // ── Base location marker (factory) ──
    if (baseLocation && mapInstance.current) {
      baseMarkerRef.current = new google.maps.Marker({
        position: { lat: baseLocation.lat, lng: baseLocation.lng },
        map: mapInstance.current,
        title: `🏭 ${baseLocation.name}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#7c3aed",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 3,
        },
        zIndex: 100,
      });
    }

    // ── Pedido markers ──
    const completados = pedidos.filter((p) => p.estado === "Entregado" || p.estado === "Fallido");

    // Route path: base → activos (ordered) 
    const routePath: google.maps.LatLngLiteral[] = [];
    if (baseLocation) {
      routePath.push({ lat: baseLocation.lat, lng: baseLocation.lng });
    }

    activos.forEach((pedido, idx) => {
      if (!pedido.latitude || !pedido.longitude) return;
      const isEnCamino = pedido.estado === "En_Camino";

      // Add to route path
      routePath.push({ lat: pedido.latitude, lng: pedido.longitude });

      const marker = new google.maps.Marker({
        position: { lat: pedido.latitude, lng: pedido.longitude },
        map: mapInstance.current!,
        title: `${idx + 1}. ${pedido.cliente}${pedido.distancia_km ? ` (${pedido.distancia_km} km)` : ''}`,
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
        zIndex: isEnCamino ? 50 : 10,
      });

      // InfoWindow on click
      const infoContent = `
        <div style="font-family: system-ui; max-width: 200px;">
          <strong style="font-size: 14px;">${pedido.cliente}</strong>
          <p style="font-size:12px; color:#666; margin: 4px 0;">${pedido.distrito || ''} · ${pedido.direccion || ''}</p>
          ${pedido.distancia_km ? `<p style="font-size:11px; color:#4f46e5;">📏 ${pedido.distancia_km} km${pedido.duracion_estimada_min ? ` · ~${pedido.duracion_estimada_min} min` : ''}</p>` : ''}
        </div>
      `;
      const infoWindow = new google.maps.InfoWindow({ content: infoContent });
      marker.addListener("click", () => {
        infoWindow.open(mapInstance.current!, marker);
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

    // ── Draw route polyline ──
    if (routePath.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path: routePath,
        geodesic: true,
        strokeColor: "#4f46e5",
        strokeOpacity: 0.7,
        strokeWeight: 3,
        icons: [
          {
            icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, fillColor: "#4f46e5", fillOpacity: 1 },
            offset: "50%",
            repeat: "100px",
          },
        ],
        map: mapInstance.current,
      });
    }

    // Fit bounds only once on initial load to avoid annoying zoom resets
    if (routePath.length > 0 && mapInstance.current && !hasFitBoundsRef.current) {
      const bounds = new google.maps.LatLngBounds();
      routePath.forEach((p) => bounds.extend(p));
      if (driverPosition) bounds.extend(driverPosition);
      mapInstance.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
      hasFitBoundsRef.current = true;
    }

  }, [pedidos, driverPosition, baseLocation, isLoaded]);

  // Update driver marker separately
  useEffect(() => {
    if (!mapInstance.current || !driverPosition || !isLoaded || typeof google === "undefined") return;

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
  }, [driverPosition, isLoaded]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-slate-50">
      {/* Loading overlay */}
      {(!isLoaded || !tilesLoaded) && !loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm transition-opacity duration-300">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3"></div>
          <p className="text-sm font-medium text-indigo-700 animate-pulse">Cargando mapa interactivo...</p>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-4 bg-slate-50">
          <FiAlertTriangle className="text-4xl text-amber-500 mb-3" />
          <p className="text-sm font-bold text-slate-700 text-center mb-1">El mapa no pudo cargar</p>
          <p className="text-xs text-slate-500 text-center mb-4">Revisa tu conexión a internet</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <FiRefreshCw />
            Reintentar
          </button>
        </div>
      )}

      {/* Recenter Button */}
      {isLoaded && tilesLoaded && !loadError && (
        <button
          onClick={recenterMap}
          className="absolute bottom-6 right-4 z-10 w-12 h-12 bg-white rounded-full shadow-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:text-indigo-600 hover:bg-slate-50 transition-colors focus:outline-none"
          title="Centrar mapa en la ruta"
        >
          <FiMapPin className="text-xl" />
        </button>
      )}

      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />
    </div>
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
  onRevertir,
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
  onRevertir: (id: string) => void;
  isProcessing: boolean;
}) {
  const config = getEstadoConfig(pedido.estado);
  const minutesRemaining = getMinutesRemaining(pedido.hora_llegada_estimada);
  const isOverdue = minutesRemaining !== null && minutesRemaining < -5;
  const isCompleted = pedido.estado === "Entregado" || pedido.estado === "Fallido";
  const isEnCamino = pedido.estado === "En_Camino";

  // ── Compact mode for completed (with revert option) ──
  if (isCompleted) {
    return (
      <div className={`rounded-xl border overflow-hidden ${
        pedido.estado === "Entregado"
          ? "border-emerald-200/60 bg-emerald-50/40"
          : "border-red-200/60 bg-red-50/40"
      }`}>
        <div className="px-4 py-2.5 flex items-center gap-3">
          <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            pedido.estado === "Entregado" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}>
            {pedido.estado === "Entregado" ? "✓" : "✗"}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-sm text-gray-400 line-through truncate block">{pedido.cliente}</span>
            {pedido.distancia_km && (
              <span className="text-[10px] text-gray-400">📏 {pedido.distancia_km} km</span>
            )}
          </div>
          <span className="text-xs text-gray-400">{pedido.distrito}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onRevertir(pedido.id); }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors flex-shrink-0 cursor-pointer"
            title="Revertir entrega"
          >
            <FiRotateCcw size={14} />
          </button>
        </div>
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
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-gray-500 truncate">{pedido.distrito} · {pedido.direccion}</span>
          </div>
          {/* Distancia y tiempo inline */}
          {(pedido.distancia_km || pedido.duracion_estimada_min) && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {pedido.distancia_km && (
                <span className="text-[10px] text-indigo-600 font-semibold">📏 {pedido.distancia_km} km</span>
              )}
              {pedido.duracion_estimada_min && (
                <span className="text-[10px] text-indigo-600 font-semibold">· ~{pedido.duracion_estimada_min} min</span>
              )}
            </div>
          )}
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
            {/* Estado: Asignado o Pendiente → Botones "Ir al Cliente" + "Entregar directo" */}
            {(pedido.estado === "Asignado" || pedido.estado === "Pendiente") && (
              <>
                {/* Botón principal: navegar al cliente */}
                <button
                  onClick={() => onIniciarViaje(pedido.id)}
                  disabled={isProcessing}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-blue-200 hover:shadow-xl hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] cursor-pointer"
                >
                  <FiNavigation className="text-xl" />
                  🚀 Ir al Cliente
                </button>

                {/* Botones de entrega directa (sin necesidad de "Ir al Cliente") */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onEntregar(pedido.id)}
                    disabled={isProcessing}
                    className="py-3 rounded-xl bg-emerald-50 text-emerald-700 font-semibold text-sm flex items-center justify-center gap-1.5 border-2 border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50 active:scale-[0.98] cursor-pointer"
                  >
                    <FiCheckCircle size={16} />
                    ✅ Entregado
                  </button>
                  <button
                    onClick={() => onFallido(pedido.id)}
                    disabled={isProcessing}
                    className="py-3 rounded-xl bg-red-50 text-red-700 font-semibold text-sm flex items-center justify-center gap-1.5 border-2 border-red-200 hover:bg-red-100 transition-all disabled:opacity-50 active:scale-[0.98] cursor-pointer"
                  >
                    <FiXCircle size={16} />
                    ❌ No Entregado
                  </button>
                </div>
              </>
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
  const [rutaResumen, setRutaResumen] = useState<RutaResumen>({ paradasRestantes: 0, distanciaTotalKm: 0, duracionTotalMin: 0 });
  const [baseLocation, setBaseLocation] = useState<BaseLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ pedidoId: string; cliente: string } | null>(null);
  const [failureModal, setFailureModal] = useState<{ pedidoId: string; cliente: string } | null>(null);
  const [revertModal, setRevertModal] = useState<{ pedidoId: string; cliente: string } | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedPedidoIds, setQueuedPedidoIds] = useState<Set<string>>(new Set());
  const [syncMessage, setSyncMessage] = useState<{ type: string; text: string } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<{ message: string; km: number; min: number } | null>(null);

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
      if (data.rutaResumen) setRutaResumen(data.rutaResumen);
      if (data.baseLocation) setBaseLocation(data.baseLocation);

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
      const pedido = pedidos.find(p => p.id === pedidoId);
      enqueueAction({ type: "entregar", pedidoId, expectedEstado: pedido?.estado || "En_Camino", payload: {} });
      refreshQueueState();
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedidoId ? { ...p, estado: "Entregado" as EstadoPedido } : p))
      );
      setProcessing(false);
      return;
    }

    try {
      const res = await fetch(`/api/pedidos/${pedidoId}/entregar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultado: "Entregado" }),
      });
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
      enqueueAction({ type: "fallido", pedidoId, expectedEstado: "En_Camino", payload: { razon_fallo: razon } });
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
        body: JSON.stringify({ resultado: "Fallido", razon_fallo: razon }),
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

  const handleRevertirEntrega = async (pedidoId: string) => {
    setProcessing(true);
    setRevertModal(null);

    try {
      const res = await fetch(`/api/pedidos/${pedidoId}/entregar`, { method: "PATCH" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al revertir");
        return;
      }
      await fetchRuta();
    } catch {
      alert("Error de conexión.");
    } finally {
      setProcessing(false);
    }
  };

  const handleOptimizarRuta = async () => {
    if (!online) {
      alert("Necesitas conexión a internet para optimizar tu ruta.");
      return;
    }
    
    setIsOptimizing(true);
    setOptimizeResult(null);
    try {
      // session.user.id is the repartidor_id
      const res = await fetch("/api/despacho/optimizar-ruta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repartidor_id: session.user.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setOptimizeResult({
          message: data.message,
          km: data.distancia_total_km,
          min: data.duracion_total_min,
        });
        setTimeout(() => setOptimizeResult(null), 5000);
        await fetchRuta();
      } else {
        alert(data.error || "Error al optimizar ruta");
      }
    } catch {
      alert("Error de conexión.");
    } finally {
      setIsOptimizing(false);
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

        {/* Mapa de Ruta — visible por defecto para que el repartidor vea el orden */}
        <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-lg bg-white">
          <button
            onClick={() => setShowMap(!showMap)}
            className="w-full px-4 py-2.5 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-gray-100 cursor-pointer"
          >
            <span className="text-sm font-semibold text-indigo-700 flex items-center gap-2">
              <FiMap size={15} />
              🗺️ Mapa de mi ruta
            </span>
            <span className="text-xs text-indigo-500 font-medium">
              {showMap ? "▲ Ocultar" : "▼ Ver mapa"}
            </span>
          </button>
          {showMap && (
            <div className="h-[300px]">
              <MiniMapaRuta pedidos={pedidos} driverPosition={driverPosition} baseLocation={baseLocation} />
            </div>
          )}
        </div>

        {/* Progress Bar con resumen de ruta */}
        <ProgressBar stats={stats} rutaResumen={rutaResumen} />

        {/* Optimize result message */}
        {optimizeResult && (
          <div className="px-4 py-3 rounded-2xl bg-violet-50 border border-violet-200 text-violet-800 text-sm font-medium animate-pulse">
            ✅ {optimizeResult.message}
          </div>
        )}

        {/* Optimizar Ruta Botón */}
        {activePedidos.length >= 2 && online && (
          <button
            onClick={handleOptimizarRuta}
            disabled={isOptimizing || processing}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 hover:from-violet-600 hover:to-indigo-600 transition-all disabled:opacity-50 shadow-md cursor-pointer"
          >
            <FiZap className="text-lg" />
            {isOptimizing ? "Optimizando con IA..." : "🧭 Optimizar mi ruta actual"}
          </button>
        )}

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
                  onRevertir={() => {}}
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

            {/* Pedidos completados (compactos, con botón revertir) */}
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
                onRevertir={(id) => {
                  const p = pedidos.find((x) => x.id === id);
                  if (p) setRevertModal({ pedidoId: id, cliente: p.cliente });
                }}
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

      {revertModal && (
        <ConfirmModal
          title="↩️ Revertir Entrega"
          message={`¿Estás seguro de revertir la entrega de ${revertModal.cliente}? El pedido volverá a estado "Asignado".`}
          confirmLabel="Sí, Revertir"
          confirmColor="bg-amber-500 hover:bg-amber-600"
          onConfirm={() => handleRevertirEntrega(revertModal.pedidoId)}
          onCancel={() => setRevertModal(null)}
        />
      )}
    </div>
  );
}

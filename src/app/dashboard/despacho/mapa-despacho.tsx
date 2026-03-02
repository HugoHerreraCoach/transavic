// src/app/dashboard/despacho/mapa-despacho.tsx
"use client";

import { useState, useMemo, useCallback } from "react";
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, PolylineF } from "@react-google-maps/api";
import { EstadoPedido } from "@/lib/types";
import {
  FiMapPin,
  FiPhone,
  FiClock,
  FiNavigation,
  FiPackage,
  FiAlertTriangle,
  FiEye,
  FiEyeOff,
} from "react-icons/fi";

// ── Types ──

interface PedidoDespacho {
  id: string;
  cliente: string;
  direccion: string | null;
  distrito: string | null;
  whatsapp: string | null;
  latitude: number | null;
  longitude: number | null;
  estado: EstadoPedido;
  orden_ruta: number | null;
  hora_entrega: string | null;
  hora_llegada_estimada: string | null;
  inicio_viaje_at: string | null;
  razon_fallo: string | null;
  detalle: string;
  notas: string | null;
  empresa: string;
}

interface Repartidor {
  id: string;
  name: string;
  pedidos: PedidoDespacho[];
}

interface MapaDespachoProps {
  pendientes: PedidoDespacho[];
  repartidores: Repartidor[];
}

// ── Constantes ──

const LIMA_CENTER = { lat: -12.0464, lng: -77.0428 };

const ESTADO_COLORS: Record<EstadoPedido, string> = {
  Pendiente: "#f59e0b",
  Asignado: "#3b82f6",
  En_Camino: "#6366f1",
  Entregado: "#10b981",
  Fallido: "#ef4444",
};

const ESTADO_LABELS: Record<EstadoPedido, string> = {
  Pendiente: "Pendiente",
  Asignado: "Asignado",
  En_Camino: "En Camino",
  Entregado: "Entregado",
  Fallido: "No Entregado",
};

const REPARTIDOR_COLORS = ["#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#14b8a6"];

const mapContainerStyle = { width: "100%", height: "100%" };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
  styles: [
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  ],
};

// ── Helper: Generar SVG Marker ──

function createMarkerIcon(color: string, label: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="16" cy="14" r="8" fill="white" opacity="0.9"/>
      <text x="16" y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${label}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ── Componente Principal ──

export default function MapaDespacho({ pendientes, repartidores }: MapaDespachoProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_MAPS_API_KEY || "",
  });

  const [selectedPedido, setSelectedPedido] = useState<PedidoDespacho | null>(null);
  const [filtroEstados, setFiltroEstados] = useState<Set<EstadoPedido>>(
    new Set(["Pendiente", "Asignado", "En_Camino", "Entregado", "Fallido"])
  );
  const [filtroRepartidores, setFiltroRepartidores] = useState<Set<string>>(
    new Set(repartidores.map((r) => r.id))
  );
  const [showPendientes, setShowPendientes] = useState(true);

  // Todos los pedidos con coordenadas
  const allPedidos = useMemo(() => {
    const items: { pedido: PedidoDespacho; repartidorName?: string; repartidorId?: string; colorIndex?: number }[] = [];

    // Pendientes sin asignar
    if (showPendientes) {
      pendientes
        .filter((p) => p.latitude && p.longitude && filtroEstados.has(p.estado))
        .forEach((p) => items.push({ pedido: p }));
    }

    // Pedidos asignados
    repartidores.forEach((r, ri) => {
      if (!filtroRepartidores.has(r.id)) return;
      r.pedidos
        .filter((p) => p.latitude && p.longitude && filtroEstados.has(p.estado))
        .forEach((p) => items.push({ pedido: p, repartidorName: r.name, repartidorId: r.id, colorIndex: ri }));
    });

    return items;
  }, [pendientes, repartidores, filtroEstados, filtroRepartidores, showPendientes]);

  // Líneas conectoras por repartidor
  const polylines = useMemo(() => {
    return repartidores
      .filter((r) => filtroRepartidores.has(r.id))
      .map((r, ri) => {
        const coords = r.pedidos
          .filter((p) => p.latitude && p.longitude && !["Entregado", "Fallido"].includes(p.estado))
          .sort((a, b) => (a.orden_ruta || 99) - (b.orden_ruta || 99))
          .map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
        return { repartidorId: r.id, path: coords, color: REPARTIDOR_COLORS[ri % REPARTIDOR_COLORS.length] };
      })
      .filter((pl) => pl.path.length > 1);
  }, [repartidores, filtroRepartidores]);

  // Auto-fit bounds
  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      if (allPedidos.length === 0) return;
      const bounds = new google.maps.LatLngBounds();
      allPedidos.forEach(({ pedido }) => {
        if (pedido.latitude && pedido.longitude) {
          bounds.extend({ lat: pedido.latitude, lng: pedido.longitude });
        }
      });
      map.fitBounds(bounds, 60);
    },
    [allPedidos]
  );

  // Toggle filtros
  const toggleEstado = (estado: EstadoPedido) => {
    setFiltroEstados((prev) => {
      const next = new Set(prev);
      if (next.has(estado)) next.delete(estado);
      else next.add(estado);
      return next;
    });
  };

  const toggleRepartidor = (id: string) => {
    setFiltroRepartidores((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm">
        <FiAlertTriangle className="mr-2" /> Error al cargar Google Maps
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* ── Mapa ── */}
      <div className="flex-1 rounded-2xl overflow-hidden border border-gray-200 shadow-sm min-h-[400px]">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={LIMA_CENTER}
          zoom={12}
          options={mapOptions}
          onLoad={onMapLoad}
        >
          {/* Marcadores */}
          {allPedidos.map(({ pedido, repartidorName }) => {
            const color = ESTADO_COLORS[pedido.estado];
            const label = pedido.orden_ruta ? String(pedido.orden_ruta) : "•";
            return (
              <MarkerF
                key={pedido.id}
                position={{ lat: pedido.latitude!, lng: pedido.longitude! }}
                icon={{
                  url: createMarkerIcon(color, label),
                  scaledSize: new google.maps.Size(32, 40),
                  anchor: new google.maps.Point(16, 40),
                }}
                title={`${pedido.cliente} (${ESTADO_LABELS[pedido.estado]})${repartidorName ? ` - ${repartidorName}` : ""}`}
                onClick={() => setSelectedPedido(pedido)}
                zIndex={pedido.estado === "En_Camino" ? 100 : pedido.estado === "Pendiente" ? 50 : 10}
              />
            );
          })}

          {/* Líneas conectoras */}
          {polylines.map((pl) => (
            <PolylineF
              key={pl.repartidorId}
              path={pl.path}
              options={{
                strokeColor: pl.color,
                strokeOpacity: 0.7,
                strokeWeight: 3,
                geodesic: true,
                icons: [
                  {
                    icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 },
                    offset: "50%",
                  },
                ],
              }}
            />
          ))}

          {/* InfoWindow */}
          {selectedPedido && selectedPedido.latitude && selectedPedido.longitude && (
            <InfoWindowF
              position={{ lat: selectedPedido.latitude, lng: selectedPedido.longitude }}
              onCloseClick={() => setSelectedPedido(null)}
            >
              <div className="p-1 max-w-[250px]">
                <h3 className="font-bold text-sm text-gray-900">{selectedPedido.cliente}</h3>
                <div className="mt-1 space-y-1 text-xs text-gray-600">
                  <p className="flex items-center gap-1">
                    <FiMapPin size={10} /> {selectedPedido.direccion || "Sin dirección"} {selectedPedido.distrito && `(${selectedPedido.distrito})`}
                  </p>
                  {selectedPedido.whatsapp && (
                    <p className="flex items-center gap-1">
                      <FiPhone size={10} />
                      <a href={`https://wa.me/${selectedPedido.whatsapp.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {selectedPedido.whatsapp}
                      </a>
                    </p>
                  )}
                  {selectedPedido.hora_entrega && (
                    <p className="flex items-center gap-1"><FiClock size={10} /> {selectedPedido.hora_entrega}</p>
                  )}
                  <p className="flex items-start gap-1 mt-1">
                    <FiPackage size={10} className="mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2">{selectedPedido.detalle}</span>
                  </p>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: ESTADO_COLORS[selectedPedido.estado] }}
                  />
                  <span className="text-xs font-semibold" style={{ color: ESTADO_COLORS[selectedPedido.estado] }}>
                    {ESTADO_LABELS[selectedPedido.estado]}
                  </span>
                  {selectedPedido.estado === "En_Camino" && selectedPedido.hora_llegada_estimada && (
                    <span className="text-xs text-indigo-600 ml-auto">
                      🕐 Llega: {formatTime(selectedPedido.hora_llegada_estimada)}
                    </span>
                  )}
                </div>
                {selectedPedido.estado === "Fallido" && selectedPedido.razon_fallo && (
                  <p className="text-xs text-red-600 mt-1">❌ {selectedPedido.razon_fallo}</p>
                )}
              </div>
            </InfoWindowF>
          )}
        </GoogleMap>
      </div>

      {/* ── Panel de Filtros ── */}
      <div className="w-full lg:w-[260px] flex-shrink-0 space-y-4">
        {/* Filtro por estado */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Estados</h3>
          <div className="space-y-1.5">
            {(Object.keys(ESTADO_COLORS) as EstadoPedido[]).map((estado) => {
              const active = filtroEstados.has(estado);
              const count = allPedidos.filter((p) => p.pedido.estado === estado).length;
              return (
                <button
                  key={estado}
                  onClick={() => toggleEstado(estado)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    active ? "bg-gray-50 text-gray-800" : "text-gray-400 opacity-50"
                  }`}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ESTADO_COLORS[estado] }} />
                  <span className="flex-1 text-left">{ESTADO_LABELS[estado]}</span>
                  <span className="text-[10px] font-bold">{count}</span>
                  {active ? <FiEye size={12} /> : <FiEyeOff size={12} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filtro por repartidor */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Repartidores</h3>
          <button
            onClick={() => setShowPendientes(!showPendientes)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all mb-1.5 ${
              showPendientes ? "bg-amber-50 text-amber-800" : "text-gray-400 opacity-50"
            }`}
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0 bg-amber-400" />
            <span className="flex-1 text-left">Sin Asignar</span>
            <span className="text-[10px] font-bold">{pendientes.filter((p) => p.latitude && p.longitude).length}</span>
            {showPendientes ? <FiEye size={12} /> : <FiEyeOff size={12} />}
          </button>
          {repartidores.map((r, ri) => {
            const active = filtroRepartidores.has(r.id);
            const color = REPARTIDOR_COLORS[ri % REPARTIDOR_COLORS.length];
            const count = r.pedidos.filter((p) => p.latitude && p.longitude).length;
            const enCamino = r.pedidos.find((p) => p.estado === "En_Camino");
            return (
              <button
                key={r.id}
                onClick={() => toggleRepartidor(r.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  active ? "bg-gray-50 text-gray-800" : "text-gray-400 opacity-50"
                }`}
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <div className="flex-1 text-left">
                  <span>{r.name}</span>
                  {enCamino && active && (
                    <span className="block text-[10px] text-indigo-600">
                      <FiNavigation size={8} className="inline mr-0.5" />→ {enCamino.cliente}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold">{count}</span>
                {active ? <FiEye size={12} /> : <FiEyeOff size={12} />}
              </button>
            );
          })}
        </div>

        {/* Leyenda de líneas */}
        {polylines.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Rutas</h3>
            <div className="space-y-1">
              {repartidores
                .filter((r) => filtroRepartidores.has(r.id))
                .map((r, ri) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600">
                    <div className="w-6 h-0.5 rounded" style={{ backgroundColor: REPARTIDOR_COLORS[ri % REPARTIDOR_COLORS.length] }} />
                    <span>{r.name}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// src/app/dashboard/despacho/mapa-despacho.tsx
"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
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
  FiCheck,
  FiUsers,
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

interface BaseLocation {
  lat: number;
  lng: number;
  address: string;
  name: string;
}

interface MapaDespachoProps {
  pendientes: PedidoDespacho[];
  repartidores: Repartidor[];
  baseLocation?: BaseLocation;
}

// ── Constantes ──

const LIMA_CENTER = { lat: -12.0464, lng: -77.0428 };

const ESTADO_COLORS: Record<EstadoPedido, string> = {
  Pendiente: "#f59e0b",
  En_Produccion: "#a855f7",
  Listo_Para_Despacho: "#14b8a6",
  Asignado: "#3b82f6",
  En_Camino: "#6366f1",
  Entregado: "#10b981",
  Fallido: "#ef4444",
};

const ESTADO_LABELS: Record<EstadoPedido, string> = {
  Pendiente: "Pendiente",
  En_Produccion: "En Producción",
  Listo_Para_Despacho: "Listo p/ Despacho",
  Asignado: "Asignado",
  En_Camino: "En Camino",
  Entregado: "Entregado",
  Fallido: "No Entregado",
};

const REPARTIDOR_COLORS = ["#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#14b8a6"];

// Presets rápidos del filtro de estados. "Por entregar" = lo que todavía necesita
// acción (saca del mapa los ya entregados/fallidos, que suelen ser la mayoría).
const ESTADOS_TODOS: EstadoPedido[] = [
  "Pendiente",
  "En_Produccion",
  "Listo_Para_Despacho",
  "Asignado",
  "En_Camino",
  "Entregado",
  "Fallido",
];
const ESTADOS_POR_ENTREGAR: EstadoPedido[] = [
  "Pendiente",
  "En_Produccion",
  "Listo_Para_Despacho",
  "Asignado",
  "En_Camino",
];

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

function createBaseMarkerIcon(): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
      <path d="M20 0C9 0 0 9 0 20c0 15 20 28 20 28s20-13 20-28C40 9 31 0 20 0z" fill="#7c3aed" stroke="#fff" stroke-width="2"/>
      <circle cx="20" cy="18" r="10" fill="white" opacity="0.9"/>
      <text x="20" y="22" text-anchor="middle" font-size="14">🏭</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function MapaDespacho({ pendientes, repartidores, baseLocation }: MapaDespachoProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_MAPS_API_KEY || "",
  });

  const [selectedPedido, setSelectedPedido] = useState<PedidoDespacho | null>(null);
  // Abre enfocado en lo que falta repartir (saca del mapa los ya entregados, que
  // suelen ser mayoría). El preset "Todos" del panel muestra todo en 1 clic.
  const [filtroEstados, setFiltroEstados] = useState<Set<EstadoPedido>>(
    new Set(ESTADOS_POR_ENTREGAR)
  );
  // Selección ÚNICA de motorizado: null = ver todas las rutas; un id = ver SOLO esa.
  // (Antes era multi-toggle y aislar a uno obligaba a apagar los demás uno por uno.)
  const [repartidorFoco, setRepartidorFoco] = useState<string | null>(null);
  const [showPendientes, setShowPendientes] = useState(true);
  const [mapRef, setMapRef] = useState<google.maps.Map | null>(null);

  // Color estable por repartidor (según su posición original) — así el marcador y
  // su línea de ruta siempre coinciden, incluso al enfocar uno solo.
  const colorPorRepartidor = useMemo(() => {
    const m = new Map<string, string>();
    repartidores.forEach((r, i) =>
      m.set(r.id, REPARTIDOR_COLORS[i % REPARTIDOR_COLORS.length])
    );
    return m;
  }, [repartidores]);

  const esVisible = useCallback(
    (id: string) => repartidorFoco === null || repartidorFoco === id,
    [repartidorFoco]
  );

  // Todos los pedidos con coordenadas
  const allPedidos = useMemo(() => {
    const items: { pedido: PedidoDespacho; repartidorName?: string; repartidorId?: string }[] = [];

    // Pendientes sin asignar (capa independiente; se ocultan al enfocar un
    // motorizado para que "ver solo su ruta" sea de verdad solo la suya).
    if (showPendientes && repartidorFoco === null) {
      pendientes
        .filter((p) => p.latitude && p.longitude && filtroEstados.has(p.estado))
        .forEach((p) => items.push({ pedido: p }));
    }

    // Pedidos asignados (solo el motorizado en foco, o todos si no hay foco)
    repartidores.forEach((r) => {
      if (!esVisible(r.id)) return;
      r.pedidos
        .filter((p) => p.latitude && p.longitude && filtroEstados.has(p.estado))
        .forEach((p) => items.push({ pedido: p, repartidorName: r.name, repartidorId: r.id }));
    });

    return items;
  }, [pendientes, repartidores, filtroEstados, repartidorFoco, showPendientes, esVisible]);

  // Líneas conectoras por repartidor (solo los visibles)
  const polylines = useMemo(() => {
    return repartidores
      .filter((r) => esVisible(r.id))
      .map((r) => {
        const coords = r.pedidos
          .filter((p) => p.latitude && p.longitude && !["Entregado", "Fallido"].includes(p.estado))
          .sort((a, b) => (a.orden_ruta || 99) - (b.orden_ruta || 99))
          .map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
        return {
          repartidorId: r.id,
          path: coords,
          color: colorPorRepartidor.get(r.id) || REPARTIDOR_COLORS[0],
        };
      })
      .filter((pl) => pl.path.length > 1);
  }, [repartidores, esVisible, colorPorRepartidor]);

  // Encaja el mapa en lo que está visible. Se vuelve a llamar cuando cambia el
  // foco → al elegir un motorizado, el mapa hace zoom a SU ruta.
  const ajustarEncuadre = useCallback(
    (map: google.maps.Map) => {
      if (allPedidos.length === 0) return;
      const bounds = new google.maps.LatLngBounds();
      allPedidos.forEach(({ pedido }) => {
        if (pedido.latitude && pedido.longitude) {
          bounds.extend({ lat: pedido.latitude, lng: pedido.longitude });
        }
      });
      if (baseLocation && repartidorFoco === null) {
        bounds.extend({ lat: baseLocation.lat, lng: baseLocation.lng });
      }
      map.fitBounds(bounds, 60);
    },
    [allPedidos, baseLocation, repartidorFoco]
  );

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      setMapRef(map);
      ajustarEncuadre(map);
    },
    [ajustarEncuadre]
  );

  // Reencuadrar al cambiar el foco/filtro (sin esperar a recargar el mapa).
  useEffect(() => {
    if (mapRef) ajustarEncuadre(mapRef);
  }, [mapRef, ajustarEncuadre]);

  // Toggle filtros
  const toggleEstado = (estado: EstadoPedido) => {
    setFiltroEstados((prev) => {
      const next = new Set(prev);
      if (next.has(estado)) next.delete(estado);
      else next.add(estado);
      return next;
    });
  };

  // Presets rápidos de estados (1 clic en vez de togglear 7 a mano).
  const aplicarPreset = (estados: EstadoPedido[]) => setFiltroEstados(new Set(estados));
  const mismoSet = (arr: EstadoPedido[]) =>
    arr.length === filtroEstados.size && arr.every((e) => filtroEstados.has(e));
  const presetActivo: "porEntregar" | "todos" | "custom" = mismoSet(ESTADOS_TODOS)
    ? "todos"
    : mismoSet(ESTADOS_POR_ENTREGAR)
    ? "porEntregar"
    : "custom";

  // Conteo REAL de pedidos por estado (con coords) en el foco actual de motorizado,
  // independiente del filtro de estados → el número no miente aunque el estado esté oculto.
  const totalPorEstado = (estado: EstadoPedido): number => {
    let n = 0;
    if (repartidorFoco === null) {
      n += pendientes.filter((p) => p.latitude && p.longitude && p.estado === estado).length;
    }
    repartidores.forEach((r) => {
      if (!esVisible(r.id)) return;
      n += r.pedidos.filter((p) => p.latitude && p.longitude && p.estado === estado).length;
    });
    return n;
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

          {/* Base location marker */}
          {baseLocation && (
            <MarkerF
              position={{ lat: baseLocation.lat, lng: baseLocation.lng }}
              icon={{
                url: createBaseMarkerIcon(),
                scaledSize: new google.maps.Size(40, 48),
                anchor: new google.maps.Point(20, 48),
              }}
              title={`🏭 ${baseLocation.name} - ${baseLocation.address}`}
              zIndex={200}
            />
          )}

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
        {/* Ver ruta de — selección ÚNICA de motorizado (1 clic aísla su ruta) */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Ver ruta de
          </h3>
          <p className="text-[11px] text-gray-400 mb-3">
            Elige un motorizado para ver solo su ruta en el mapa.
          </p>

          {/* Todos */}
          <button
            onClick={() => setRepartidorFoco(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.98] ${
              repartidorFoco === null
                ? "bg-gray-900 text-white"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100"
            }`}
          >
            <FiUsers size={13} className="flex-shrink-0" />
            <span className="flex-1 text-left">Todos los motorizados</span>
            {repartidorFoco === null && <FiCheck size={13} />}
          </button>

          {/* Un motorizado por fila — clic = ver solo el suyo */}
          <div className="mt-2 space-y-1">
            {repartidores.map((r) => {
              const seleccionado = repartidorFoco === r.id;
              const color = colorPorRepartidor.get(r.id) || REPARTIDOR_COLORS[0];
              const count = r.pedidos.filter((p) => p.latitude && p.longitude).length;
              const enCamino = r.pedidos.find((p) => p.estado === "En_Camino");
              return (
                <button
                  key={r.id}
                  onClick={() => setRepartidorFoco(seleccionado ? null : r.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.98] ${
                    seleccionado ? "bg-gray-50 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                  }`}
                  style={seleccionado ? { boxShadow: `inset 0 0 0 2px ${color}` } : undefined}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex-1 text-left min-w-0">
                    <span className="block truncate">{r.name}</span>
                    {enCamino && (
                      <span className="block text-[10px] text-indigo-600 truncate">
                        <FiNavigation size={8} className="inline mr-0.5" />→ {enCamino.cliente}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-gray-400">{count}</span>
                  {seleccionado && <FiCheck size={13} style={{ color }} />}
                </button>
              );
            })}
            {repartidores.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-2">Nadie con pedidos asignados.</p>
            )}
          </div>

          {/* Capa "Sin asignar" — solo tiene sentido viendo a todos */}
          {repartidorFoco === null && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setShowPendientes(!showPendientes)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.98] ${
                  showPendientes ? "text-amber-800" : "text-gray-400"
                }`}
              >
                <span
                  className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    showPendientes ? "bg-amber-400" : "bg-gray-300"
                  }`}
                />
                <span className="flex-1 text-left">Sin asignar</span>
                <span className="text-[10px] font-bold">
                  {pendientes.filter((p) => p.latitude && p.longitude).length}
                </span>
                {showPendientes ? <FiEye size={12} /> : <FiEyeOff size={12} />}
              </button>
            </div>
          )}

          {repartidorFoco !== null && (
            <p className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-100">
              Mostrando solo la ruta de{" "}
              <span className="font-semibold text-gray-600">
                {repartidores.find((r) => r.id === repartidorFoco)?.name}
              </span>
              . Toca <span className="font-semibold">Todos los motorizados</span> para ver el resto.
            </p>
          )}
        </div>

        {/* Estados — presets rápidos (1 clic) + toggles finos */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Estados</h3>

          {/* Lo más común: enfocar lo que falta repartir, sin apagar estados a mano */}
          <div className="flex gap-1.5 mb-3">
            <button
              onClick={() => aplicarPreset(ESTADOS_POR_ENTREGAR)}
              className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] ${
                presetActivo === "porEntregar"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              Por entregar
            </button>
            <button
              onClick={() => aplicarPreset(ESTADOS_TODOS)}
              className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] ${
                presetActivo === "todos"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              Todos
            </button>
          </div>

          {/* Toggles finos por estado, con el conteo real (no miente aunque esté oculto) */}
          <div className="space-y-1">
            {ESTADOS_TODOS.map((estado) => {
              const active = filtroEstados.has(estado);
              const count = totalPorEstado(estado);
              return (
                <button
                  key={estado}
                  onClick={() => toggleEstado(estado)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all active:scale-[0.98] ${
                    active ? "bg-gray-50 text-gray-800" : "text-gray-400"
                  }`}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ESTADO_COLORS[estado] }} />
                  <span className="flex-1 text-left">{ESTADO_LABELS[estado]}</span>
                  <span className="text-[10px] font-bold tabular-nums">{count}</span>
                  {active ? <FiEye size={12} /> : <FiEyeOff size={12} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Leyenda de líneas (rutas dibujadas) */}
        {polylines.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {repartidorFoco === null ? "Rutas dibujadas" : "Ruta"}
            </h3>
            <div className="space-y-1">
              {repartidores
                .filter((r) => esVisible(r.id))
                .filter((r) => polylines.some((pl) => pl.repartidorId === r.id))
                .map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600">
                    <div
                      className="w-6 h-0.5 rounded"
                      style={{ backgroundColor: colorPorRepartidor.get(r.id) }}
                    />
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

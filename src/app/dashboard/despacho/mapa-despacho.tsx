// src/app/dashboard/despacho/mapa-despacho.tsx
"use client";

import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
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
  // Fecha de ENTREGA (DATE). Se usa para dibujar SOLO la ruta de hoy en el mapa
  // (el endpoint trae toda la semana; sin este recorte saldría una maraña).
  fecha_pedido?: string | null;
}

interface Repartidor {
  id: string;
  name: string;
  pedidos: PedidoDespacho[];
  // Última ubicación reportada por el motorizado (tabla rider_locations).
  // null si todavía no reportó nada (app sin abrir / sin permiso de GPS).
  ubicacion?: {
    lat: number;
    lng: number;
    heading: number | null;
    capturedAt: string;
    updatedAt?: string;
    gpsStatus?: string | null;
    simulated?: boolean;
  } | null;
  // ¿Tiene pedidos activos hoy (Asignado/En_Camino)? Solo a ellos se les exige GPS.
  tienePedidosActivos?: boolean;
  // Clasificación de "oscuro" calculada en el server:
  //   'deliberado' → revocó el permiso o GPS simulado (rojo)
  //   'sin_senal'  → con pedidos activos pero sin transmitir hace rato (ámbar)
  alerta?: "deliberado" | "sin_senal" | null;
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

// Fecha de HOY en zona Lima como "YYYY-MM-DD" (en-CA da formato ISO).
function fechaHoyLima(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

// ¿La fecha_pedido (entrega) es hoy? Tolera "YYYY-MM-DD" o ISO con hora.
function esFechaHoy(f: string | null | undefined, hoy: string): boolean {
  return !!f && String(f).slice(0, 10) === hoy;
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

// ── Helper: marcador de moto en vivo + "hace cuánto" ──

const EN_VIVO_SEG = 300; // ≤5 min ⇒ consideramos la ubicación "en vivo"

// Marcador de moto en vivo, distinto al pin de pedido: badge circular grande con
// sombra (para "levantar" del mapa), una silueta de motocicleta blanca al centro
// (siempre vertical, legible) y un chevron en el borde que orbita según el rumbo
// (heading). EN VIVO = color saturado del repartidor + halo de doble anillo (sensación
// de "pulso") + chevron. SIN SEÑAL = gris-slate, sin halo y sin chevron (así se
// distingue del live de un vistazo), pero igual de grande y nítido (no apagado).
type ModoRider = "vivo" | "gris" | "rojo" | "ambar";

function createRiderMarkerIcon(color: string, heading: number | null, modo: ModoRider): string {
  const enVivo = modo === "vivo";
  const alerta = modo === "rojo" || modo === "ambar";
  // EN VIVO = color del repartidor; ALERTA = rojo (deliberado) / ámbar (sin señal);
  // gris = sin señal reciente sin alerta (no tiene pedidos activos, p. ej.).
  const c =
    modo === "vivo" ? color : modo === "rojo" ? "#ef4444" : modo === "ambar" ? "#f59e0b" : "#94a3b8";
  // Halo de doble anillo en vivo (pulso) y también en alerta (para que salte a la vista).
  const halo =
    enVivo || alerta
      ? `<circle cx="30" cy="30" r="27" fill="${c}" opacity="0.14"/><circle cx="30" cy="30" r="21" fill="${c}" opacity="0.22"/>`
      : "";
  // Chevron de rumbo solo cuando está en vivo (con la posición vieja el rumbo no aplica).
  const chevron =
    enVivo && heading != null
      ? `<g transform="rotate(${heading.toFixed(0)} 30 30)"><path d="M30 3 L35.5 13 L30 10.5 L24.5 13 Z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></g>`
      : "";
  // Silueta de motocicleta (estilo Material "motorcycle"), blanca, centrada en el badge.
  const moto = `<g transform="translate(19 20) scale(0.9)" fill="#fff"><path d="M19.44 9.03L15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h1.65l2.77-2.77c-.21.54-.32 1.14-.32 1.77 0 2.8 2.2 5 5 5s5-2.2 5-5c0-2.79-2.21-5-4.56-4.97zM7.82 15C7.4 16.15 6.28 17 5 17c-1.63 0-3-1.37-3-3s1.37-3 3-3c1.28 0 2.4.85 2.82 2H5v2h2.82zM19 17c-1.63 0-3-1.37-3-3s1.37-3 3-3 3 1.37 3 3-1.37 3-3 3z"/></g>`;
  // Badge "!" en la esquina superior derecha cuando hay alerta (sin transmitir).
  const alertaBadge = alerta
    ? `<g><circle cx="46" cy="14" r="9" fill="#fff"/><circle cx="46" cy="14" r="7.5" fill="${c}"/><rect x="44.9" y="9.6" width="2.2" height="6" rx="1.1" fill="#fff"/><circle cx="46" cy="18.3" r="1.3" fill="#fff"/></g>`
    : "";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
      <defs>
        <filter id="riderShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#1f2937" flood-opacity="0.4"/>
        </filter>
      </defs>
      ${halo}
      ${chevron}
      <g filter="url(#riderShadow)">
        <circle cx="30" cy="30" r="15" fill="${c}" stroke="#fff" stroke-width="3.5"/>
      </g>
      ${moto}
      ${alertaBadge}
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Decide el modo visual del marcador a partir de la alerta del server + frescura.
function modoRider(alerta: "deliberado" | "sin_senal" | null | undefined, enVivo: boolean): ModoRider {
  if (alerta === "deliberado") return "rojo";
  if (alerta === "sin_senal") return "ambar";
  return enVivo ? "vivo" : "gris";
}

// "hace 15 s" / "hace 3 min" / "hace 2 h" + los segundos (para decidir si está en vivo).
function haceCuanto(iso: string): { texto: string; segundos: number } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { texto: "", segundos: Number.POSITIVE_INFINITY };
  const seg = Math.max(0, Math.floor((Date.now() - t) / 1000));
  let texto: string;
  if (seg < 60) texto = `hace ${seg} s`;
  else if (seg < 3600) texto = `hace ${Math.floor(seg / 60)} min`;
  else texto = `hace ${Math.floor(seg / 3600)} h`;
  return { texto, segundos: seg };
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
  // Capa de motos en vivo (default ON; es la función estrella del mapa).
  const [showRiders, setShowRiders] = useState(true);
  // Id del motorizado cuyo InfoWindow está abierto (muestra su última posición).
  const [riderInfo, setRiderInfo] = useState<string | null>(null);

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

  // Líneas de ruta SOLO al enfocar un motorizado (filtro "Ver ruta de").
  // En "Todos los motorizados" NO se dibuja ninguna: serían N zigzags (uno por
  // repartidor, cada uno uniendo todas sus entregas) = maraña ilegible. El overview
  // queda limpio (pines pendientes + motos en vivo) y la ruta detallada se ve al
  // elegir a alguien. Al enfocar, su ruta va partida en DOS tramos:
  //  • recorrido = base → entregas/fallidas de HOY (en orden) → posición en vivo de
  //    la moto. Es "lo que recorrió hoy". Recortado al día para no arrastrar el
  //    histórico de toda la semana (que era el origen de la maraña).
  //  • faltante  = posición de la moto (o la última parada de hoy, o la base) →
  //    TODOS los pendientes del repartidor (incluye carry-over de días previos;
  //    son pocos y sí necesitan entregarse). Es "lo que le falta".
  // Sin moto en vivo (GPS apagado) el corte cae en la última parada de hoy o la base.
  const polylines = useMemo(() => {
    if (repartidorFoco === null) return [];

    const base = baseLocation ? { lat: baseLocation.lat, lng: baseLocation.lng } : null;
    const hoy = fechaHoyLima();
    const noNulo = (x: { lat: number; lng: number } | null): x is { lat: number; lng: number } =>
      x != null;
    return repartidores
      .filter((r) => esVisible(r.id))
      .map((r) => {
        const stops = r.pedidos
          .filter((p) => p.latitude && p.longitude)
          .sort((a, b) => (a.orden_ruta || 99) - (b.orden_ruta || 99));
        const visitados = stops
          .filter((p) => ["Entregado", "Fallido"].includes(p.estado) && esFechaHoy(p.fecha_pedido, hoy))
          .map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
        const pendientes = stops
          .filter((p) => !["Entregado", "Fallido"].includes(p.estado))
          .map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
        const moto = r.ubicacion ? { lat: r.ubicacion.lat, lng: r.ubicacion.lng } : null;

        const recorrido = [base, ...visitados, moto].filter(noNulo);
        const inicioFaltante = moto ?? visitados[visitados.length - 1] ?? base;
        const faltante = [inicioFaltante, ...pendientes].filter(noNulo);

        return {
          repartidorId: r.id,
          color: colorPorRepartidor.get(r.id) || REPARTIDOR_COLORS[0],
          recorrido,
          faltante,
        };
      })
      .filter((pl) => pl.recorrido.length > 1 || pl.faltante.length > 1);
  }, [repartidores, esVisible, colorPorRepartidor, baseLocation, repartidorFoco]);

  // Encaja el mapa en lo que está visible (pedidos + motos en vivo + base).
  const ajustarEncuadre = useCallback(
    (map: google.maps.Map) => {
      const bounds = new google.maps.LatLngBounds();
      let hayPuntos = false;
      allPedidos.forEach(({ pedido }) => {
        if (pedido.latitude && pedido.longitude) {
          bounds.extend({ lat: pedido.latitude, lng: pedido.longitude });
          hayPuntos = true;
        }
      });
      // Incluir la posición en vivo de las motos visibles → al enfocar un
      // motorizado, el encuadre abarca su moto aunque tenga pocos pedidos.
      if (showRiders) {
        repartidores.forEach((r) => {
          if (esVisible(r.id) && r.ubicacion) {
            bounds.extend({ lat: r.ubicacion.lat, lng: r.ubicacion.lng });
            hayPuntos = true;
          }
        });
      }
      if (baseLocation && repartidorFoco === null) {
        bounds.extend({ lat: baseLocation.lat, lng: baseLocation.lng });
        hayPuntos = true;
      }
      // Al enfocar un motorizado, enmarcar TODA su ruta de hoy (no solo la moto):
      // los pines de entregado pueden estar ocultos por el filtro, pero la línea de
      // recorrido sí está, así que extendemos el encuadre con sus puntos.
      if (repartidorFoco !== null) {
        polylines.forEach((pl) => {
          [...pl.recorrido, ...pl.faltante].forEach((pt) => {
            bounds.extend(pt);
            hayPuntos = true;
          });
        });
      }
      if (!hayPuntos) return;
      map.fitBounds(bounds, 60);
    },
    [allPedidos, baseLocation, repartidorFoco, showRiders, repartidores, esVisible, polylines]
  );

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      setMapRef(map);
      ajustarEncuadre(map);
    },
    [ajustarEncuadre]
  );

  // Reencuadrar SOLO cuando cambia la SELECCIÓN del usuario (foco, filtros,
  // toggles), NO en cada poll de 15s. Así el mapa no "salta" mientras el admin
  // mira: las motos se mueven solas (sus markers se actualizan en cada poll),
  // pero el viewport se queda quieto hasta que el usuario cambie de vista.
  useEffect(() => {
    if (mapRef) ajustarEncuadre(mapRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, repartidorFoco, showRiders, showPendientes, filtroEstados]);

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

          {/* Líneas de ruta: gris = ya recorrido · color del repartidor = lo que falta */}
          {polylines.map((pl) => (
            <Fragment key={pl.repartidorId}>
              {pl.recorrido.length > 1 && (
                <PolylineF
                  path={pl.recorrido}
                  options={{
                    strokeColor: "#94a3b8",
                    strokeOpacity: 0.6,
                    strokeWeight: 5,
                    geodesic: true,
                    zIndex: 1,
                  }}
                />
              )}
              {pl.faltante.length > 1 && (
                <PolylineF
                  path={pl.faltante}
                  options={{
                    strokeColor: pl.color,
                    strokeOpacity: 0.95,
                    strokeWeight: 4,
                    geodesic: true,
                    zIndex: 2,
                    icons: [
                      {
                        icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 },
                        offset: "0",
                        repeat: "120px",
                      },
                    ],
                  }}
                />
              )}
            </Fragment>
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

          {/* Motos en vivo — última ubicación reportada por cada motorizado.
              Va por ENCIMA de todo (zIndex 300) para no perderlo entre los pines. */}
          {showRiders &&
            repartidores
              .filter((r) => esVisible(r.id) && r.ubicacion)
              .map((r) => {
                const u = r.ubicacion!;
                const { segundos } = haceCuanto(u.capturedAt);
                const enVivo = segundos <= EN_VIVO_SEG;
                const color = colorPorRepartidor.get(r.id) || REPARTIDOR_COLORS[0];
                const modo = modoRider(r.alerta, enVivo);
                const titulo =
                  r.alerta === "deliberado"
                    ? `${r.name} · ⚠️ apagó su ubicación`
                    : r.alerta === "sin_senal"
                      ? `${r.name} · ⚠️ sin señal`
                      : enVivo
                        ? `${r.name} · en vivo`
                        : `${r.name} · sin señal reciente`;
                return (
                  <MarkerF
                    key={`rider-${r.id}`}
                    position={{ lat: u.lat, lng: u.lng }}
                    icon={{
                      url: createRiderMarkerIcon(color, u.heading, modo),
                      scaledSize: new google.maps.Size(56, 56),
                      anchor: new google.maps.Point(28, 28),
                    }}
                    title={titulo}
                    onClick={() => {
                      setSelectedPedido(null);
                      setRiderInfo(r.id);
                    }}
                    // Las alertas (rojo/ámbar) por encima del resto para que no se pierdan.
                    zIndex={r.alerta ? 350 : 300}
                  />
                );
              })}

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

          {/* InfoWindow de moto en vivo */}
          {(() => {
            if (!riderInfo) return null;
            const r = repartidores.find((x) => x.id === riderInfo);
            if (!r || !r.ubicacion) return null;
            const { texto, segundos } = haceCuanto(r.ubicacion.capturedAt);
            const enVivo = segundos <= EN_VIVO_SEG;
            const color = colorPorRepartidor.get(r.id) || REPARTIDOR_COLORS[0];
            const enCamino = r.pedidos.filter((p) => p.estado === "En_Camino").length;
            const porEntregar = r.pedidos.filter((p) =>
              ["Pendiente", "En_Produccion", "Listo_Para_Despacho", "Asignado", "En_Camino"].includes(p.estado)
            ).length;
            const totalParadas = r.pedidos.filter((p) => p.latitude && p.longitude).length;
            const entregados = r.pedidos.filter((p) => p.estado === "Entregado").length;
            const siguiente = r.pedidos
              .filter((p) => p.latitude && p.longitude && !["Entregado", "Fallido"].includes(p.estado))
              .sort((a, b) => (a.orden_ruta || 99) - (b.orden_ruta || 99))[0];
            return (
              <InfoWindowF
                position={{ lat: r.ubicacion.lat, lng: r.ubicacion.lng }}
                onCloseClick={() => setRiderInfo(null)}
              >
                <div className="p-1 max-w-[220px]">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <h3 className="font-bold text-sm text-gray-900 truncate">{r.name}</h3>
                  </div>
                  {(() => {
                    const motivoDeliberado =
                      r.ubicacion?.gpsStatus === "permiso_revocado"
                        ? "quitó el permiso de ubicación en su celular"
                        : r.ubicacion?.simulated || r.ubicacion?.gpsStatus === "mock"
                          ? "usó una app de ubicación falsa"
                          : "apagó su ubicación";
                    if (r.alerta === "deliberado") {
                      return (
                        <p className="mt-1 flex items-center gap-1.5 text-xs">
                          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" />
                          <span className="text-red-700 font-bold">⚠️ Apagó su ubicación</span>
                          <span className="text-gray-400">· {motivoDeliberado}</span>
                        </p>
                      );
                    }
                    if (r.alerta === "sin_senal") {
                      return (
                        <p className="mt-1 flex items-center gap-1.5 text-xs">
                          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-amber-500" />
                          <span className="text-amber-700 font-bold">⚠️ Sin señal</span>
                          {texto && <span className="text-gray-400">· {texto}</span>}
                        </p>
                      );
                    }
                    return (
                      <p className="mt-1 flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${enVivo ? "bg-emerald-500" : "bg-gray-400"}`} />
                        <span className={enVivo ? "text-emerald-700 font-semibold" : "text-gray-500"}>
                          {enVivo ? "En vivo" : "Sin señal reciente"}
                        </span>
                        {texto && <span className="text-gray-400">· {texto}</span>}
                      </p>
                    );
                  })()}
                  <p className="mt-1 text-xs text-gray-600 flex items-center gap-1">
                    <FiPackage size={10} className="flex-shrink-0" /> {porEntregar} por entregar
                    {enCamino > 0 && <span className="text-indigo-600">· {enCamino} en camino</span>}
                  </p>
                  {totalParadas > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs">
                      <FiCheck size={10} className="flex-shrink-0 text-emerald-600" />
                      <span className="text-emerald-700 font-semibold">
                        {entregados} de {totalParadas} entregados
                      </span>
                    </p>
                  )}
                  {siguiente && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-gray-600">
                      <FiNavigation size={10} className="mt-0.5 flex-shrink-0" />
                      <span className="truncate">Siguiente: <span className="font-semibold text-gray-800">{siguiente.cliente}</span></span>
                    </p>
                  )}
                </div>
              </InfoWindowF>
            );
          })()}
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
                    {r.alerta ? (
                      <span
                        className={`block text-[10px] truncate font-semibold ${
                          r.alerta === "deliberado" ? "text-red-600" : "text-amber-600"
                        }`}
                      >
                        <FiAlertTriangle size={8} className="inline mr-0.5" />
                        {r.alerta === "deliberado" ? "apagó su ubicación" : "sin señal"}
                      </span>
                    ) : enCamino ? (
                      <span className="block text-[10px] text-indigo-600 truncate">
                        <FiNavigation size={8} className="inline mr-0.5" />→ {enCamino.cliente}
                      </span>
                    ) : null}
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

          {/* Motos en vivo — muestra/oculta la capa de ubicación en tiempo real */}
          <div className="mt-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowRiders(!showRiders)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.98] ${
                showRiders ? "text-emerald-700" : "text-gray-400"
              }`}
            >
              <FiNavigation size={13} className="flex-shrink-0" />
              <span className="flex-1 text-left">Motos en vivo</span>
              <span className="text-[10px] font-bold tabular-nums">
                {repartidores.filter((r) => r.ubicacion).length}
              </span>
              {showRiders ? <FiEye size={12} /> : <FiEyeOff size={12} />}
            </button>
          </div>
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

        {/* Leyenda: cómo leer el recorrido de cada moto */}
        {polylines.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Cómo leer el mapa
            </h3>
            <div className="space-y-1.5 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <span className="w-6 h-1 rounded flex-shrink-0" style={{ backgroundColor: "#94a3b8" }} />
                <span>Lo que recorrió hoy</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-1 rounded flex-shrink-0" style={{ backgroundColor: "#8b5cf6" }} />
                <span>Lo que le falta (color de cada moto)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm leading-none flex-shrink-0">🏍️</span>
                <span>Posición en vivo de la moto</span>
              </div>
            </div>
            {/* Qué color tiene la ruta de cada moto (el tramo "lo que le falta") */}
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
              {repartidores
                .filter((r) => esVisible(r.id))
                .filter((r) => polylines.some((pl) => pl.repartidorId === r.id))
                .map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600">
                    <div
                      className="w-6 h-0.5 rounded flex-shrink-0"
                      style={{ backgroundColor: colorPorRepartidor.get(r.id) }}
                    />
                    <span className="truncate">{r.name}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// src/app/dashboard/despacho/despacho-content.tsx
"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { Session } from "next-auth";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import {
  FiAlertTriangle,
  FiRefreshCw,
  FiClock,
  FiMapPin,
  FiNavigation,
  FiCheckCircle,
  FiXCircle,
  FiPackage,
  FiCopy,
  FiTruck,
  FiList,
  FiMap,
  FiChevronDown,
  FiChevronUp,
} from "react-icons/fi";
import { EstadoPedido } from "@/lib/types";

const MapaDespacho = lazy(() => import("./mapa-despacho"));

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
  fecha_pedido?: string;
  es_delivery_externo?: boolean;
  delivery_externo_nombre?: string | null;
}

interface Repartidor {
  id: string;
  name: string;
  role: string;
  pedidos: PedidoDespacho[];
}

// ── Estado Config ──

function getEstadoConfig(estado: EstadoPedido) {
  const configs: Record<EstadoPedido, { bg: string; text: string; dot: string; label: string }> = {
    Pendiente: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400", label: "Pendiente" },
    Asignado: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400", label: "Asignado" },
    En_Camino: { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500", label: "En Camino" },
    Entregado: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400", label: "Entregado" },
    Fallido: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-400", label: "Fallido" },
  };
  return configs[estado] || configs.Pendiente;
}

function isOverdue(hora_llegada_estimada: string | null): boolean {
  if (!hora_llegada_estimada) return false;
  const eta = new Date(hora_llegada_estimada).getTime();
  return Date.now() > eta + 15 * 60 * 1000; // 15 min de gracia
}

function formatTime(isoString: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ── Mini Tarjeta de Pedido (Draggable) ──

function PedidoMiniCard({ pedido, isDragging }: { pedido: PedidoDespacho; isDragging?: boolean }) {
  const config = getEstadoConfig(pedido.estado);
  const overdue = pedido.estado === "En_Camino" && isOverdue(pedido.hora_llegada_estimada);
  const isCompleted = pedido.estado === "Entregado" || pedido.estado === "Fallido";

  // ── Modo compacto para pedidos completados ──
  if (isCompleted) {
    return (
      <div
        className={`px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-2 ${
          isDragging
            ? "shadow-lg border-indigo-300 bg-indigo-50 scale-105"
            : pedido.estado === "Entregado"
            ? "border-emerald-200/60 bg-emerald-50/40"
            : "border-red-200/60 bg-red-50/40"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
        <span className="text-xs text-gray-400 line-through truncate flex-1">{pedido.cliente}</span>
        <span className="text-[10px] flex-shrink-0">{pedido.estado === "Entregado" ? "✅" : "❌"}</span>
      </div>
    );
  }

  // ── Modo full para pedidos activos ──
  return (
    <div
      className={`px-3 py-2.5 rounded-xl border transition-all ${
        isDragging
          ? "shadow-xl border-indigo-300 bg-indigo-50 scale-105 rotate-1"
          : overdue
          ? "border-red-300 bg-red-50 shadow-md animate-pulse"
          : "border-gray-200 bg-white shadow-sm hover:shadow-md"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
        <span className="font-semibold text-sm text-gray-900 truncate flex-1">{pedido.cliente}</span>
        {pedido.hora_entrega && (
          <span className="text-[10px] text-gray-400 flex-shrink-0">{pedido.hora_entrega}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <FiMapPin className="text-gray-400 flex-shrink-0" size={11} />
        <span className="text-xs text-gray-500 truncate">
          {pedido.distrito || pedido.direccion || "Sin dirección"}
        </span>
      </div>
      {pedido.estado === "En_Camino" && pedido.hora_llegada_estimada && (
        <div className={`mt-1.5 text-[10px] font-medium flex items-center gap-1 ${overdue ? "text-red-600" : "text-indigo-600"}`}>
          {overdue ? <FiAlertTriangle size={10} /> : <FiClock size={10} />}
          🕐 Llega a las {formatTime(pedido.hora_llegada_estimada)}
          {overdue && " ⚠️ RETRASO"}
        </div>
      )}
      {pedido.estado === "Fallido" && pedido.razon_fallo && (
        <div className="mt-1 text-[10px] text-red-500 truncate">
          ❌ {pedido.razon_fallo}
        </div>
      )}
    </div>
  );
}

// ── Columna de Repartidor (Droppable) ──

function RepartidorColumn({
  repartidor,
  onDesasignar,
  isCollapsed,
  onToggleCollapse,
}: {
  repartidor: Repartidor;
  onDesasignar: (pedidoId: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const entregados = repartidor.pedidos.filter((p) => p.estado === "Entregado").length;
  const fallidos = repartidor.pedidos.filter((p) => p.estado === "Fallido").length;
  const total = repartidor.pedidos.length;
  const enCamino = repartidor.pedidos.find((p) => p.estado === "En_Camino");
  const tieneRetraso = repartidor.pedidos.some(
    (p) => p.estado === "En_Camino" && isOverdue(p.hora_llegada_estimada)
  );

  // Separar activos de completados para ordenar mejor
  const activos = repartidor.pedidos.filter(p => p.estado !== "Entregado" && p.estado !== "Fallido");
  const completados = repartidor.pedidos.filter(p => p.estado === "Entregado" || p.estado === "Fallido");
  const pedidosOrdenados = [...activos, ...completados];

  return (
    <div className={`rounded-2xl border-2 transition-all flex flex-col max-h-[calc(100vh-180px)] ${
      tieneRetraso ? "border-red-300 bg-red-50/30" : "border-gray-200 bg-gray-50/50"
    }`}>
      {/* Header del repartidor — sticky */}
      <div className="px-4 py-3 border-b border-gray-100 bg-inherit rounded-t-2xl sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-sm flex items-center justify-center">
              {repartidor.name.charAt(0)}
            </span>
            <div>
              <p className="font-semibold text-gray-900 text-sm">{repartidor.name}</p>
              <p className="text-[10px] text-gray-400">🏍️ Repartidor</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-gray-700">{entregados}/{total}</p>
            <p className="text-[10px] text-gray-400">entregados{fallidos > 0 ? ` · ${fallidos} fallido${fallidos > 1 ? 's' : ''}` : ''}</p>
          </div>
          {/* Botón colapsar/expandir */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            className="p-1 rounded-lg hover:bg-gray-200 transition-colors text-gray-400 cursor-pointer"
            title={isCollapsed ? "Expandir" : "Colapsar"}
          >
            {isCollapsed ? <FiChevronDown size={14} /> : <FiChevronUp size={14} />}
          </button>
        </div>
        {enCamino && (
          <div className={`mt-2 px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
            tieneRetraso ? "bg-red-100 text-red-700" : "bg-indigo-100 text-indigo-700"
          }`}>
            <FiNavigation size={12} />
            En camino a: {enCamino.cliente}
            {enCamino.hora_llegada_estimada && (
              <span className="ml-auto">🕐 Llega: {formatTime(enCamino.hora_llegada_estimada)}</span>
            )}
          </div>
        )}
      </div>

      {/* Drop zone — scrollable interno (solo si no colapsado) */}
      {!isCollapsed && (
      <Droppable droppableId={repartidor.id} type="PEDIDO">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-2 space-y-1.5 min-h-[80px] overflow-y-auto transition-colors rounded-b-2xl ${
              snapshot.isDraggingOver ? "bg-indigo-50/70 ring-2 ring-indigo-300 ring-inset" : ""
            }`}
          >
            {repartidor.pedidos.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex items-center justify-center h-20 text-xs text-gray-400">
                Arrastra pedidos aquí
              </div>
            )}
            {pedidosOrdenados.map((pedido, index) => (
              <Draggable key={pedido.id} draggableId={pedido.id} index={index}
                isDragDisabled={pedido.estado === "Entregado" || pedido.estado === "En_Camino"}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className="group relative"
                  >
                    <PedidoMiniCard pedido={pedido} isDragging={snapshot.isDragging} />
                    {pedido.estado === "Asignado" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDesasignar(pedido.id); }}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
                        title="Desasignar"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      )}
    </div>
  );
}

// ── Tarjeta Delivery Externo (con persistencia) ──

function DeliveryExternoCard({
  pedidos,
  onRemove,
  onStatusChange,
}: {
  pedidos: PedidoDespacho[];
  onRemove: (id: string) => void;
  onStatusChange: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const generateWhatsAppText = (pedido: PedidoDespacho) => {
    const mapsLink = pedido.latitude && pedido.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${pedido.latitude},${pedido.longitude}`
      : "";

    return `🐔 *PEDIDO TRANSAVIC*
📍 *Cliente:* ${pedido.cliente}
${pedido.whatsapp ? `📞 *WhatsApp:* ${pedido.whatsapp}` : ""}
🏠 *Dirección:* ${pedido.direccion || "N/A"} - ${pedido.distrito || ""}
📦 *Pedido:* ${pedido.detalle}
${pedido.hora_entrega ? `⏰ *Hora entrega:* ${pedido.hora_entrega}` : ""}
${pedido.notas ? `📝 *Notas:* ${pedido.notas}` : ""}
${mapsLink ? `🗺️ *Ruta:* ${mapsLink}` : ""}`.trim();
  };

  const handleCopy = async (pedido: PedidoDespacho) => {
    const text = generateWhatsAppText(pedido);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(pedido.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedId(pedido.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleStatusChange = async (pedidoId: string, estado: "Entregado" | "Fallido") => {
    setUpdatingId(pedidoId);
    try {
      await fetch("/api/despacho/asignar-externo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: pedidoId, estado }),
      });
      onStatusChange();
    } catch { /* ignore */ } finally {
      setUpdatingId(null);
    }
  };

  const handleUnassign = async (pedidoId: string) => {
    try {
      await fetch("/api/despacho/asignar-externo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: pedidoId }),
      });
      onRemove(pedidoId);
      onStatusChange();
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/30">
      <div className="px-4 py-3 border-b border-orange-200">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 text-white font-bold text-sm flex items-center justify-center">
            📦
          </span>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Delivery Externo</p>
            <p className="text-[10px] text-gray-400">{pedidos.length} pedido(s) asignado(s)</p>
          </div>
        </div>
      </div>

      <Droppable droppableId="delivery-externo" type="PEDIDO">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`p-2 space-y-2 min-h-[80px] transition-colors rounded-b-2xl ${
              snapshot.isDraggingOver ? "bg-orange-100/70 ring-2 ring-orange-300 ring-inset" : ""
            }`}
          >
            {pedidos.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex items-center justify-center h-20 text-xs text-gray-400">
                Arrastra pedidos o usa ⚡ Asignar a...
              </div>
            )}
            {pedidos.map((pedido, index) => (
              <Draggable key={pedido.id} draggableId={pedido.id} index={index}>
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                    <div className="px-3 py-2.5 rounded-xl border border-orange-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <span className="font-semibold text-sm text-gray-900 truncate block">{pedido.cliente}</span>
                          {pedido.delivery_externo_nombre && (
                            <span className="text-[10px] text-orange-600 font-medium">🚚 {pedido.delivery_externo_nombre}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleCopy(pedido)}
                            className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-all ${
                              copiedId === pedido.id
                                ? "bg-green-100 text-green-700"
                                : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                            }`}
                          >
                            <FiCopy size={12} />
                            <span>{copiedId === pedido.id ? "✓" : "WA"}</span>
                          </button>
                          <button
                            onClick={() => handleUnassign(pedido.id)}
                            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Devolver a pendientes"
                          >
                            <FiXCircle size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">{pedido.distrito} · {pedido.direccion}</p>
                      {/* Estado buttons */}
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleStatusChange(pedido.id, "Entregado")}
                          disabled={updatingId === pedido.id}
                          className="flex-1 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          ✅ Entregado
                        </button>
                        <button
                          onClick={() => handleStatusChange(pedido.id, "Fallido")}
                          disabled={updatingId === pedido.id}
                          className="flex-1 py-1.5 rounded-lg bg-red-50 text-red-700 text-[10px] font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          ❌ Fallido
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

// ── Componente Principal ──

export default function DespachoContent({ }: { session: Session }) {
  const [pendientes, setPendientes] = useState<PedidoDespacho[]>([]);
  const [pendientesAnteriores, setPendientesAnteriores] = useState<PedidoDespacho[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [externosPedidos, setExternosPedidos] = useState<PedidoDespacho[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtroDistrito, setFiltroDistrito] = useState<string>("");
  const [vistaActual, setVistaActual] = useState<"lista" | "mapa">("lista");
  const [showAnteriores, setShowAnteriores] = useState(false);
  const [expandedReps, setExpandedReps] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/despacho");
      if (!res.ok) throw new Error("Error");
      const data = await res.json();
      setPendientes(data.pendientes);
      setPendientesAnteriores(data.pendientesAnteriores || []);
      setExternosPedidos(data.pedidosExternos || []);
      setRepartidores(data.repartidores);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh cada 15s para monitoreo en vivo
  useEffect(() => {
    const interval = setInterval(() => fetchData(), 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Distritos únicos para filtro
  const distritos = [...new Set(pendientes.map((p) => p.distrito).filter(Boolean))] as string[];

  const pedidosFiltrados = filtroDistrito
    ? pendientes.filter((p) => p.distrito === filtroDistrito)
    : pendientes;

  // ── Quick Assign (sin drag) ──
  const quickAssign = async (pedidoId: string, repartidorId: string, fromList: "pendientes" | "anteriores") => {
    const sourceList = fromList === "pendientes" ? pendientes : pendientesAnteriores;
    const setSourceList = fromList === "pendientes" ? setPendientes : setPendientesAnteriores;
    const pedido = sourceList.find((p) => p.id === pedidoId);
    if (!pedido) return;

    // Si asigna a externo
    if (repartidorId === "__externo__") {
      const nombre = prompt("Nombre del delivery externo (ej: Juan, Rappi):");
      if (!nombre) return;
      setSourceList((prev) => prev.filter((p) => p.id !== pedidoId));
      try {
        await fetch("/api/despacho/asignar-externo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedido_id: pedidoId, nombre_delivery: nombre }),
        });
        await fetchData();
      } catch { await fetchData(); }
      return;
    }

    // Optimistic
    setSourceList((prev) => prev.filter((p) => p.id !== pedidoId));
    setRepartidores((prev) =>
      prev.map((r) =>
        r.id === repartidorId
          ? { ...r, pedidos: [...r.pedidos, { ...pedido, estado: "Asignado" as EstadoPedido, repartidor_id: repartidorId }] }
          : r
      )
    );

    try {
      const res = await fetch("/api/despacho/asignar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_ids: [pedidoId], repartidor_id: repartidorId }),
      });
      if (!res.ok) throw new Error();
      await fetchData();
    } catch {
      await fetchData();
    }
  };

  // ── Drag & Drop Handler ──
  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const pedidoId = draggableId;

    // CASO 1: De pendientes (hoy o anteriores) a un repartidor
    if ((source.droppableId === "pendientes" || source.droppableId === "pendientes-anteriores") && destination.droppableId !== "pendientes" && destination.droppableId !== "pendientes-anteriores") {
      const sourceList = source.droppableId === "pendientes" ? pendientes : pendientesAnteriores;
      const setSourceList = source.droppableId === "pendientes" ? setPendientes : setPendientesAnteriores;

      if (destination.droppableId === "delivery-externo") {
        const pedido = sourceList.find((p) => p.id === pedidoId);
        if (pedido) {
          const nombre = prompt("Nombre del delivery externo (ej: Juan, Rappi):");
          if (!nombre) return;
          setSourceList((prev) => prev.filter((p) => p.id !== pedidoId));
          try {
            await fetch("/api/despacho/asignar-externo", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pedido_id: pedidoId, nombre_delivery: nombre }),
            });
            await fetchData();
          } catch { await fetchData(); }
        }
        return;
      }

      // Asignar a repartidor
      const repartidorId = destination.droppableId;

      // Optimistic update
      const pedido = sourceList.find((p) => p.id === pedidoId);
      if (!pedido) return;

      setSourceList((prev) => prev.filter((p) => p.id !== pedidoId));
      setRepartidores((prev) =>
        prev.map((r) =>
          r.id === repartidorId
            ? { ...r, pedidos: [...r.pedidos.slice(0, destination.index), { ...pedido, estado: "Asignado" as EstadoPedido, repartidor_id: repartidorId }, ...r.pedidos.slice(destination.index)] }
            : r
        )
      );

      try {
        const res = await fetch("/api/despacho/asignar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedido_ids: [pedidoId], repartidor_id: repartidorId }),
        });
        if (!res.ok) throw new Error("Error al asignar");
        await fetchData();
      } catch {
        await fetchData();
      }
      return;
    }

    // CASO 2: Reordenar dentro del mismo repartidor
    if (source.droppableId === destination.droppableId && source.droppableId !== "pendientes" && source.droppableId !== "delivery-externo") {
      const repartidorId = source.droppableId;

      setRepartidores((prev) =>
        prev.map((r) => {
          if (r.id !== repartidorId) return r;
          const items = [...r.pedidos];
          const [moved] = items.splice(source.index, 1);
          items.splice(destination.index, 0, moved);
          return { ...r, pedidos: items };
        })
      );

      const repartidor = repartidores.find((r) => r.id === repartidorId);
      if (!repartidor) return;

      const items = [...repartidor.pedidos];
      const [moved] = items.splice(source.index, 1);
      items.splice(destination.index, 0, moved);

      const orden = items.map((p, i) => ({ pedido_id: p.id, orden_ruta: i + 1 }));

      try {
        await fetch("/api/despacho/reordenar", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repartidor_id: repartidorId, orden }),
        });
      } catch {
        await fetchData();
      }
      return;
    }

    // CASO 3: Mover entre repartidores
    if (source.droppableId !== destination.droppableId && source.droppableId !== "pendientes" && destination.droppableId !== "pendientes") {
      const fromId = source.droppableId;
      const toId = destination.droppableId;

      if (toId === "delivery-externo") return; // No permitir mover de repartidor a externo
      if (fromId === "delivery-externo") return;

      // Optimistic: mover pedido entre repartidores
      let movedPedido: PedidoDespacho | undefined;

      setRepartidores((prev) =>
        prev.map((r) => {
          if (r.id === fromId) {
            movedPedido = r.pedidos[source.index];
            return { ...r, pedidos: r.pedidos.filter((_, i) => i !== source.index) };
          }
          if (r.id === toId && movedPedido) {
            const items = [...r.pedidos];
            items.splice(destination.index, 0, movedPedido);
            return { ...r, pedidos: items };
          }
          return r;
        })
      );

      if (movedPedido) {
        try {
          // Desasignar del anterior y asignar al nuevo
          await fetch("/api/despacho/asignar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pedido_ids: [pedidoId], repartidor_id: toId }),
          });
          await fetchData();
        } catch {
          await fetchData();
        }
      }
    }
  };

  // ── Desasignar pedido ──
  const handleDesasignar = async (pedidoId: string) => {
    try {
      await fetch(`/api/pedidos/${pedidoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "Pendiente", repartidor_id: null, orden_ruta: null }),
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Quitar de delivery externo
  const handleRemoveExterno = (pedidoId: string) => {
    const pedido = externosPedidos.find((p) => p.id === pedidoId);
    if (pedido) {
      setExternosPedidos((prev) => prev.filter((p) => p.id !== pedidoId));
      setPendientes((prev) => [...prev, pedido]);
    }
  };

  // ── Stats ──
  const totalHoy = pendientes.length + repartidores.reduce((acc, r) => acc + r.pedidos.length, 0);
  const totalEntregados = repartidores.reduce((acc, r) => acc + r.pedidos.filter((p) => p.estado === "Entregado").length, 0);
  const totalEnCamino = repartidores.reduce((acc, r) => acc + r.pedidos.filter((p) => p.estado === "En_Camino").length, 0);

  const today = new Date().toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 mt-4 text-sm">Cargando centro de despacho...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 lg:px-6 py-4 sticky top-0 z-30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold text-gray-900">
                📋 Centro de Despacho
              </h1>
              <p className="text-xs text-gray-500 capitalize">{today}</p>
            </div>
            {/* Tab toggle */}
            <div className="flex bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setVistaActual("lista")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  vistaActual === "lista" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <FiList size={14} /> Lista
              </button>
              <button
                onClick={() => setVistaActual("mapa")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  vistaActual === "mapa" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <FiMap size={14} /> Mapa
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Stats chips */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-xs font-medium text-gray-700">
              <FiPackage size={12} /> {pendientes.length} sin asignar
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
              <FiNavigation size={12} /> {totalEnCamino} en camino
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-xs font-medium text-emerald-700">
              <FiCheckCircle size={12} /> {totalEntregados}/{totalHoy} entregados
            </div>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              title="Actualizar"
            >
              <FiRefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Vista: Mapa ── */}
      {vistaActual === "mapa" && (
        <div className="p-4 lg:p-6 h-[calc(100vh-80px)]">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            </div>
          }>
            <MapaDespacho pendientes={pendientes} repartidores={repartidores} />
          </Suspense>
        </div>
      )}

      {/* ── Vista: Lista (D&D) ── */}
      {vistaActual === "lista" && (
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex flex-col lg:flex-row gap-4 p-4 lg:p-6 h-[calc(100vh-80px)]">
          {/* ── PANEL IZQUIERDO: Pedidos sin asignar ── */}
          <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 flex flex-col">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col h-full">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    <FiTruck size={16} />
                    Pedidos del Día
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                      {pedidosFiltrados.length}
                    </span>
                  </h2>
                </div>
                {/* Filtro por distrito */}
                {distritos.length > 1 && (
                  <div className="mt-2 flex gap-1 flex-wrap">
                    <button
                      onClick={() => setFiltroDistrito("")}
                      className={`px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${
                        !filtroDistrito ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      Todos
                    </button>
                    {distritos.map((d) => (
                      <button
                        key={d}
                        onClick={() => setFiltroDistrito(d === filtroDistrito ? "" : d)}
                        className={`px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${
                          filtroDistrito === d ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Droppable droppableId="pendientes" type="PEDIDO">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 p-2 space-y-2 overflow-y-auto transition-colors ${
                      snapshot.isDraggingOver ? "bg-amber-50/50" : ""
                    }`}
                  >
                    {pedidosFiltrados.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                        <FiCheckCircle size={24} className="mb-2" />
                        <p className="text-xs">¡Todos asignados!</p>
                      </div>
                    )}
                    {pedidosFiltrados.map((pedido, index) => (
                      <Draggable key={pedido.id} draggableId={pedido.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                          >
                            <PedidoMiniCard pedido={pedido} isDragging={snapshot.isDragging} />
                            {/* Quick assign */}
                            <select
                              className="w-full mt-1 text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 hover:border-indigo-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 transition-colors"
                              value=""
                              onChange={(e) => { if (e.target.value) quickAssign(pedido.id, e.target.value, "pendientes"); }}
                            >
                              <option value="">⚡ Asignar a...</option>
                              {repartidores.filter(r => r.role === "repartidor").map((r) => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                              <option value="__externo__">📦 Delivery Externo</option>
                            </select>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              {/* Sección colapsable: Pendientes de esta semana */}
              {pendientesAnteriores.length > 0 && (
                <div className="border-t border-gray-100">
                  <button
                    onClick={() => setShowAnteriores(!showAnteriores)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-orange-700 hover:bg-orange-50/50 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      📋 Pendientes de esta semana
                      <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold">
                        {pendientesAnteriores.length}
                      </span>
                    </span>
                    {showAnteriores ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                  </button>
                  {showAnteriores && (
                    <Droppable droppableId="pendientes-anteriores" type="PEDIDO">
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`p-2 space-y-2 overflow-y-auto max-h-[300px] transition-colors ${
                            snapshot.isDraggingOver ? "bg-orange-50/50" : ""
                          }`}
                        >
                          {pendientesAnteriores.map((pedido, index) => {
                            const fechaLabel = pedido.fecha_pedido
                              ? new Date(pedido.fecha_pedido + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short", day: "numeric" })
                              : "";
                            return (
                              <Draggable key={pedido.id} draggableId={pedido.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                  >
                                    <div className="relative">
                                      <PedidoMiniCard pedido={pedido} isDragging={snapshot.isDragging} />
                                      {fechaLabel && (
                                        <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-600">
                                          {fechaLabel}
                                        </span>
                                      )}
                                    </div>
                                    {/* Quick assign */}
                                    <select
                                      className="w-full mt-1 text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 hover:border-indigo-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 transition-colors"
                                      value=""
                                      onChange={(e) => { if (e.target.value) quickAssign(pedido.id, e.target.value, "anteriores"); }}
                                    >
                                      <option value="">⚡ Asignar a...</option>
                                      {repartidores.filter(r => r.role === "repartidor").map((r) => (
                                        <option key={r.id} value={r.id}>{r.name}</option>
                                      ))}
                                      <option value="__externo__">📦 Delivery Externo</option>
                                    </select>
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── PANEL DERECHO: Repartidores ── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0 items-start">
              {(() => {
                // Smart sorting: activos primero, completados al final
                const sorted = [...repartidores].sort((a, b) => {
                  const scoreA = a.pedidos.some(p => p.estado === 'En_Camino') ? 0
                    : a.pedidos.some(p => p.estado === 'Asignado' || p.estado === 'Pendiente') ? 1
                    : a.pedidos.length === 0 ? 3
                    : 2;
                  const scoreB = b.pedidos.some(p => p.estado === 'En_Camino') ? 0
                    : b.pedidos.some(p => p.estado === 'Asignado' || p.estado === 'Pendiente') ? 1
                    : b.pedidos.length === 0 ? 3
                    : 2;
                  return scoreA - scoreB;
                });
                return sorted.map((repartidor) => {
                  const allDone = repartidor.pedidos.length > 0 &&
                    repartidor.pedidos.every(p => p.estado === 'Entregado' || p.estado === 'Fallido');
                  return (
                    <RepartidorColumn
                      key={repartidor.id}
                      repartidor={repartidor}
                      onDesasignar={handleDesasignar}
                      isCollapsed={allDone && !expandedReps.has(repartidor.id)}
                      onToggleCollapse={() => {
                        setExpandedReps(prev => {
                          const next = new Set(prev);
                          if (next.has(repartidor.id)) next.delete(repartidor.id);
                          else next.add(repartidor.id);
                          return next;
                        });
                      }}
                    />
                  );
                });
              })()}

              {/* Delivery Externo */}
              <DeliveryExternoCard
                pedidos={externosPedidos}
                onRemove={handleRemoveExterno}
                onStatusChange={() => fetchData(true)}
              />
            </div>

            {/* Leyenda */}
            <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-gray-400 px-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Pendiente</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Asignado</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> En Camino</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Entregado</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Fallido</span>
            </div>
          </div>
        </div>
      </DragDropContext>
      )}
    </div>
  );
}

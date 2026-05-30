// src/app/dashboard/produccion/produccion-client.tsx
// Pantalla de la asistente de producción. Aplica "No me hagas pensar":
//   - Lista del día con buscador rápido por cliente/distrito.
//   - Click en pedido → modal con inputs grandes de peso por producto.
//   - Total se recalcula EN VIVO mientras escribe.
//   - Botón "Listo para despacho" sólo aparece cuando todo está pesado.
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FiPackage,
  FiSearch,
  FiClock,
  FiCheckCircle,
  FiArchive,
  FiX,
  FiUser,
  FiPrinter,
  FiRotateCcw,
} from "react-icons/fi";

interface Item {
  id: string;
  pedido_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number | string;
  unidad: string;
  precio_unitario: number | string | null;
  subtotal: number | string | null;
  cantidad_real: number | string | null;
  subtotal_real: number | string | null;
  notas: string | null;
}

interface Pedido {
  id: string;
  cliente: string;
  distrito: string | null;
  hora_entrega: string | null;
  empresa: string;
  detalle: string;
  notas: string | null;
  estado: "Pendiente" | "En_Produccion" | "Listo_Para_Despacho";
  fecha_pedido: string;
  asesor_name: string | null;
  items: Item[];
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

// Unidades comunes que producción puede elegir al ajustar un ítem.
const UNIDADES_COMUNES = ["kg", "uni", "docena", "plancha", "paquete x 6", "jaba", "atado"];

function estadoBadge(estado: Pedido["estado"]) {
  switch (estado) {
    case "Pendiente":
      return { color: "bg-amber-100 text-amber-700", label: "Pendiente" };
    case "En_Produccion":
      return { color: "bg-purple-100 text-purple-700", label: "En Producción" };
    case "Listo_Para_Despacho":
      return { color: "bg-teal-100 text-teal-700", label: "Listo p/ Despacho" };
  }
}

export default function ProduccionClient() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pedidoActivo, setPedidoActivo] = useState<Pedido | null>(null);

  // ── Cargar pedidos del día ──
  const fetchPedidos = async () => {
    const res = await fetch("/api/produccion/pedidos");
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPedidos(data.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPedidos();
    const interval = setInterval(fetchPedidos, 30_000); // refresh cada 30s
    return () => clearInterval(interval);
  }, []);

  // ── Filtrado por búsqueda ──
  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pedidos;
    return pedidos.filter(
      (p) =>
        p.cliente.toLowerCase().includes(q) ||
        (p.distrito ?? "").toLowerCase().includes(q) ||
        (p.asesor_name ?? "").toLowerCase().includes(q)
    );
  }, [pedidos, query]);

  // ── Stats ──
  const stats = useMemo(() => {
    const pendientes = pedidos.filter((p) => p.estado === "Pendiente").length;
    const enProduccion = pedidos.filter((p) => p.estado === "En_Produccion").length;
    const listos = pedidos.filter((p) => p.estado === "Listo_Para_Despacho").length;
    return { pendientes, enProduccion, listos, total: pedidos.length };
  }, [pedidos]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header sticky ── */}
      <header className="sticky top-0 z-20 bg-white border-b shadow-sm">
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <FiPackage className="text-purple-600 text-2xl" />
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-800">Producción</h1>
            <p className="text-xs text-gray-500">
              Pedidos del día — registra los pesos exactos
            </p>
          </div>
          <button
            onClick={fetchPedidos}
            className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600"
          >
            Refrescar
          </button>
        </div>

        {/* Stats */}
        <div className="px-4 sm:px-6 lg:px-8 pb-3 grid grid-cols-4 gap-2 text-center">
          <Stat label="Total" value={stats.total} color="text-gray-700" />
          <Stat label="Pendientes" value={stats.pendientes} color="text-amber-600" />
          <Stat label="En producción" value={stats.enProduccion} color="text-purple-600" />
          <Stat label="Listos" value={stats.listos} color="text-teal-600" />
        </div>

        {/* Buscador */}
        <div className="px-4 sm:px-6 lg:px-8 pb-3">
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, distrito o asesora…"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
      </header>

      {/* ── Lista de pedidos ── */}
      <main className="px-4 sm:px-6 lg:px-8 py-4 max-w-3xl mx-auto">
        {loading && (
          <div className="text-center text-gray-500 py-8">Cargando pedidos…</div>
        )}
        {!loading && filtrados.length === 0 && (
          <div className="text-center text-gray-500 py-16">
            <FiPackage className="mx-auto text-4xl mb-3 text-gray-300" />
            <p>No hay pedidos {query ? "que coincidan" : "para hoy"}</p>
          </div>
        )}

        <div className="space-y-3">
          {filtrados.map((p) => {
            const badge = estadoBadge(p.estado);
            const totalReal = p.items.reduce(
              (s, it) => s + toNumber(it.subtotal_real),
              0
            );
            const totalEstimado = p.items.reduce(
              (s, it) => s + toNumber(it.subtotal),
              0
            );
            const todoPesado = p.items.length > 0 && p.items.every((it) => it.cantidad_real != null);

            return (
              <button
                key={p.id}
                onClick={() => setPedidoActivo(p)}
                className="w-full text-left bg-white rounded-xl shadow-sm border hover:border-purple-300 hover:shadow-md transition-all p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-gray-800 truncate">{p.cliente}</h3>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                      {p.distrito && (
                        <span>📍 {p.distrito}</span>
                      )}
                      {p.hora_entrega && (
                        <span className="flex items-center gap-1">
                          <FiClock /> {p.hora_entrega}
                        </span>
                      )}
                      {p.asesor_name && (
                        <span className="flex items-center gap-1">
                          <FiUser /> {p.asesor_name}
                        </span>
                      )}
                      <span>{p.empresa}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-600 line-clamp-2 whitespace-pre-wrap">
                      {p.detalle}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">
                      {todoPesado ? "Real" : "Estimado"}
                    </div>
                    <div
                      className={`text-lg font-bold ${todoPesado ? "text-purple-700" : "text-gray-700"}`}
                    >
                      S/ {(todoPesado ? totalReal : totalEstimado).toFixed(2)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </main>

      {/* ── Modal de pesos ── */}
      {pedidoActivo && (
        <PesoModal
          pedido={pedidoActivo}
          onClose={() => setPedidoActivo(null)}
          onSaved={() => {
            setPedidoActivo(null);
            fetchPedidos();
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  Stat compacto del header
// ════════════════════════════════════════════════════════════
function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg py-2">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  Modal: ingreso de pesos
//  Total se recalcula EN VIVO mientras escribe (no me hagas pensar)
// ════════════════════════════════════════════════════════════
function PesoModal({
  pedido,
  onClose,
  onSaved,
}: {
  pedido: Pedido;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Estado local de pesos por item (string para input controlado)
  const [pesos, setPesos] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of pedido.items) {
      init[it.id] = it.cantidad_real != null ? String(toNumber(it.cantidad_real)) : "";
    }
    return init;
  });
  // Unidad y precio también editables por producción (flexibilidad).
  const [unidades, setUnidades] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of pedido.items) init[it.id] = it.unidad || "kg";
    return init;
  });
  const [precios, setPrecios] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of pedido.items) {
      const p = toNumber(it.precio_unitario);
      init[it.id] = p > 0 ? String(p) : "";
    }
    return init;
  });
  const [guardando, setGuardando] = useState(false);
  const [marcandoListo, setMarcandoListo] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si ya está listo para despacho, el modal lo refleja (no vuelve a ofrecer "marcar listo").
  const yaListo = pedido.estado === "Listo_Para_Despacho";

  // Total en vivo
  const totalVivo = useMemo(() => {
    let sum = 0;
    for (const it of pedido.items) {
      const peso = parseFloat(pesos[it.id] || "0");
      const precio = parseFloat(precios[it.id] || "0");
      if (peso > 0) sum += peso * precio;
    }
    return sum;
  }, [pesos, precios, pedido.items]);

  const todoCompleto = pedido.items.every(
    (it) => parseFloat(pesos[it.id] || "0") > 0
  );

  const guardarPesos = async () => {
    setError(null);
    const items = pedido.items
      .map((it) => ({
        item_id: it.id,
        cantidad_real: parseFloat(pesos[it.id] || "0"),
        unidad: unidades[it.id] || it.unidad,
        precio_unitario: parseFloat(precios[it.id] || "0"),
      }))
      .filter((x) => x.cantidad_real > 0);

    if (items.length === 0) {
      setError("Ingresa al menos un peso");
      return;
    }

    setGuardando(true);
    try {
      const res = await fetch(`/api/produccion/pedidos/${pedido.id}/pesos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(typeof e.error === "string" ? e.error : "Error al guardar");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const marcarListo = async () => {
    if (!todoCompleto) {
      setError("Faltan pesos por registrar antes de marcar como listo");
      return;
    }
    setError(null);
    setMarcandoListo(true);

    try {
      // 1. Primero guardar los pesos actuales (idempotente)
      const itemsPayload = pedido.items.map((it) => ({
        item_id: it.id,
        cantidad_real: parseFloat(pesos[it.id] || "0"),
        unidad: unidades[it.id] || it.unidad,
        precio_unitario: parseFloat(precios[it.id] || "0"),
      }));
      const resGuardar = await fetch(
        `/api/produccion/pedidos/${pedido.id}/pesos`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: itemsPayload }),
        }
      );
      if (!resGuardar.ok) {
        const e = await resGuardar.json();
        throw new Error(typeof e.error === "string" ? e.error : "Error al guardar pesos");
      }

      // 2. Marcar como listo
      const resListo = await fetch(
        `/api/produccion/pedidos/${pedido.id}/listo`,
        { method: "POST" }
      );
      if (!resListo.ok) {
        const e = await resListo.json();
        throw new Error(typeof e.error === "string" ? e.error : "Error al marcar listo");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setMarcandoListo(false);
    }
  };

  const reabrir = async () => {
    setError(null);
    setReabriendo(true);
    try {
      const res = await fetch(`/api/produccion/pedidos/${pedido.id}/reabrir`, {
        method: "POST",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(typeof e.error === "string" ? e.error : "Error al reabrir");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al reabrir");
    } finally {
      setReabriendo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-gray-800">{pedido.cliente}</h2>
            <div className="text-xs text-gray-500 mt-0.5">
              {pedido.distrito && <>📍 {pedido.distrito} · </>}
              {pedido.hora_entrega && <>⏰ {pedido.hora_entrega} · </>}
              {pedido.empresa}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100"
          >
            <FiX className="text-gray-500" />
          </button>
        </div>

        {/* Items con pesos */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
          {pedido.notas && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 px-3 py-2 text-sm text-yellow-800">
              <strong>Nota:</strong> {pedido.notas}
            </div>
          )}

          {pedido.items.map((it) => {
            const precioOriginal = toNumber(it.precio_unitario);
            const precio = parseFloat(precios[it.id] || "0");
            const cant = parseFloat(pesos[it.id] || "0");
            const subtotal = cant > 0 ? cant * precio : 0;
            const tieneRegistrado = it.cantidad_real != null;
            const opcionesUnidad = Array.from(
              new Set([...UNIDADES_COMUNES, it.unidad].filter(Boolean))
            );

            return (
              <div
                key={it.id}
                className={`rounded-lg border p-3 ${
                  tieneRegistrado ? "border-purple-200 bg-purple-50/30" : "border-gray-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800">
                      {it.producto_nombre}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Pedido original:{" "}
                      <strong>{toNumber(it.cantidad)} {it.unidad}</strong>
                      {precioOriginal > 0 && <> · S/ {precioOriginal.toFixed(2)}</>}
                    </div>
                  </div>
                </div>

                {/* Producción ajusta cantidad real, unidad y precio si hace falta */}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">
                      Cantidad real
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={pesos[it.id] ?? ""}
                      onChange={(e) => setPesos({ ...pesos, [it.id]: e.target.value })}
                      className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-base font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">
                      Unidad
                    </label>
                    <select
                      value={unidades[it.id] ?? ""}
                      onChange={(e) =>
                        setUnidades({ ...unidades, [it.id]: e.target.value })
                      }
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      {opcionesUnidad.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">
                      Precio (S/)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={precios[it.id] ?? ""}
                      onChange={(e) =>
                        setPrecios({ ...precios, [it.id]: e.target.value })
                      }
                      className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-base font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="mt-2 flex items-baseline justify-end gap-2">
                  <div className="text-[10px] text-gray-400 uppercase">Subtotal</div>
                  <div className="text-lg font-bold text-purple-700">
                    S/ {subtotal.toFixed(2)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: total + acciones */}
        <div className="px-4 sm:px-6 py-3 border-t bg-gray-50">
          {error && (
            <div className="mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-600">Total a cobrar</div>
            <div className="text-2xl font-bold text-purple-700">
              S/ {totalVivo.toFixed(2)}
            </div>
          </div>
          {yaListo ? (
            <>
              <div className="mb-3 flex items-center justify-center gap-2 px-3 py-2 bg-teal-50 border border-teal-200 rounded-lg text-sm font-semibold text-teal-700">
                <FiCheckCircle />
                Ya está listo para despacho
              </div>
              <div className="flex gap-2">
                <button
                  onClick={guardarPesos}
                  disabled={guardando || reabriendo}
                  className="flex-1 px-4 py-3 bg-purple-500 text-white rounded-lg font-semibold hover:bg-purple-600 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <FiCheckCircle />
                  {guardando ? "Guardando…" : "Actualizar pesos"}
                </button>
                <button
                  onClick={reabrir}
                  disabled={reabriendo || guardando}
                  className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  title="Volver a producción para seguir ajustando"
                >
                  <FiRotateCcw />
                  {reabriendo ? "..." : "Volver a producción"}
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={guardarPesos}
                disabled={guardando || marcandoListo}
                className="flex-1 px-4 py-3 bg-purple-500 text-white rounded-lg font-semibold hover:bg-purple-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <FiCheckCircle />
                {guardando ? "Guardando…" : "Guardar pesos"}
              </button>
              <button
                onClick={marcarListo}
                disabled={!todoCompleto || guardando || marcandoListo}
                className="flex-1 px-4 py-3 bg-teal-500 text-white rounded-lg font-semibold hover:bg-teal-600 disabled:opacity-50 flex items-center justify-center gap-2"
                title={!todoCompleto ? "Faltan pesos por ingresar" : ""}
              >
                <FiArchive />
                {marcandoListo ? "..." : "Listo p/ Despacho"}
              </button>
            </div>
          )}

          {/* Botón imprimir guía: solo si hay pesos registrados */}
          {todoCompleto && (
            <a
              href={`/pedidos/${pedido.id}/guia`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg font-medium hover:bg-gray-800 text-center flex items-center justify-center gap-2"
            >
              <FiPrinter />
              Imprimir guía de remisión
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

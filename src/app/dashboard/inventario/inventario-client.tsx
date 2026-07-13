"use client";

import { useState } from "react";
import { useToast, ToastContainer } from "@/components/Toast";
import { usePollingVisible } from "@/lib/use-polling-visible";
import GuiaModulo from "@/components/GuiaModulo";

type InventarioItem = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  categoria: string;
  cantidad: string;
  updated_at: string;
};

type MovimientoInventario = {
  id: string;
  cantidad_cambio: number;
  tipo: string;
  motivo: string | null;
  created_at: string;
  usuario_nombre: string | null;
};

// Debe coincidir con MOTIVOS_AJUSTE del backend (POST /api/inventario).
const MOTIVOS_AJUSTE = [
  "Merma no registrada",
  "Error de conteo",
  "Robo / faltante",
  "Ajuste por cierre",
  "Otro",
] as const;

const ETIQUETAS_TIPO: Record<string, string> = {
  compra: "Compra",
  venta_pos: "Venta Rápida",
  anulacion_venta_pos: "Venta Rápida anulada",
  entrega: "Entrega pedido",
  reversion: "Entrega anulada",
  ajuste: "Ajuste",
};

const formatoFechaCorta = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default function InventarioClient() {
  const [items, setItems] = useState<InventarioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { mostrarToast, toasts } = useToast();

  // Modal para ajuste manual
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventarioItem | null>(null);
  const [ajuste, setAjuste] = useState("");
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [saving, setSaving] = useState(false);

  // Mini-kardex del producto seleccionado
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [movsLoading, setMovsLoading] = useState(false);

  const fetchInventario = async () => {
    try {
      const res = await fetch("/api/inventario");
      if (res.ok) {
        setItems(await res.json());
      }
    } catch {
      mostrarToast("Error al cargar el inventario", "error");
    } finally {
      setLoading(false);
    }
  };

  // Refresco automático cada 60 s, solo con la pestaña visible.
  usePollingVisible(fetchInventario, 60_000);

  const abrirModal = async (item: InventarioItem) => {
    setSelectedItem(item);
    setAjuste("");
    setMotivo("");
    setDetalle("");
    setShowModal(true);
    setMovimientos([]);
    setMovsLoading(true);
    try {
      const res = await fetch(`/api/inventario?movimientos=${item.producto_id}`);
      if (res.ok) {
        setMovimientos(await res.json());
      }
    } catch {
      // El kardex es informativo: si falla, el ajuste sigue disponible.
    } finally {
      setMovsLoading(false);
    }
  };

  const cerrarModal = () => {
    setShowModal(false);
    setAjuste("");
    setMotivo("");
    setDetalle("");
    setSelectedItem(null);
  };

  // Stock proyectado tras aplicar el cambio (para la advertencia de negativo).
  const cambioNumerico = Number(ajuste) || 0;
  const stockProyectado = selectedItem
    ? Number(selectedItem.cantidad) + cambioNumerico
    : 0;
  const quedaNegativo = ajuste !== "" && cambioNumerico !== 0 && stockProyectado < 0;
  const faltaDetalleOtro = motivo === "Otro" && detalle.trim().length < 3;

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !ajuste) return;
    if (!motivo) {
      mostrarToast("Selecciona el motivo del ajuste", "error");
      return;
    }
    if (faltaDetalleOtro) {
      mostrarToast("Si el motivo es 'Otro', describe el detalle (mínimo 3 caracteres)", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          producto_id: selectedItem.producto_id,
          cantidad_cambio: Number(ajuste),
          motivo,
          detalle: detalle.trim() || undefined,
        }),
      });

      if (res.ok) {
        mostrarToast("Inventario ajustado correctamente", "exito");
        cerrarModal();
        fetchInventario();
      } else {
        const j = await res.json().catch(() => ({}));
        mostrarToast(j.error || "Error al ajustar inventario", "error");
      }
    } catch {
      mostrarToast("Error de red al ajustar inventario", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <GuiaModulo modulo="inventario" />

      {loading ? (
        <p className="text-gray-500">Cargando inventario...</p>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Producto</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Categoría</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Cantidad (kg)</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.producto_nombre}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.categoria}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <span className={`font-bold ${Number(item.cantidad) < 0 ? 'text-red-600' : 'text-indigo-600'}`}>
                      {item.cantidad}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <button
                      onClick={() => abrirModal(item)}
                      className="text-indigo-600 hover:text-indigo-900 font-medium"
                    >
                      Ingresar / Ajustar
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                    Aún no hay productos con inventario registrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && selectedItem && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Ajustar: {selectedItem.producto_nombre}</h2>
              <p className="text-sm text-gray-500 mt-1">Cantidad actual: {selectedItem.cantidad} kg</p>
            </div>
            <form onSubmit={handleAdjust} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad a Ingresar / Retirar</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    value={ajuste}
                    onChange={(e) => setAjuste(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2 pr-12 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Ej. 10 para ingresar, -5 para retirar"
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">kg</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Usa valores positivos para registrar ingresos de proveedor. Valores negativos para mermas o salidas manuales.
                </p>
              </div>

              {quedaNegativo && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
                  La cantidad quedará en {stockProyectado.toFixed(2)} kg. ¿Confirmas?
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo del ajuste</label>
                <select
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                >
                  <option value="" disabled>Selecciona un motivo</option>
                  {MOTIVOS_AJUSTE.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Detalle {motivo === "Otro" ? <span className="text-red-500">(obligatorio)</span> : <span className="text-gray-400">(opcional)</span>}
                </label>
                <input
                  type="text"
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  required={motivo === "Otro"}
                  minLength={motivo === "Otro" ? 3 : undefined}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Ej. Se rompió una jaba al descargar"
                />
              </div>

              {/* Mini-kardex: últimos movimientos del producto */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Últimos movimientos</h3>
                {movsLoading ? (
                  <p className="text-xs text-gray-400 animate-pulse">Cargando movimientos...</p>
                ) : movimientos.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin movimientos registrados para este producto.</p>
                ) : (
                  <ul className="divide-y divide-gray-50 max-h-44 overflow-y-auto border border-gray-100 rounded-xl">
                    {movimientos.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <span className="text-gray-400">{formatoFechaCorta.format(new Date(m.created_at))}</span>{" "}
                          <span className="font-medium text-gray-700">{ETIQUETAS_TIPO[m.tipo] ?? m.tipo}</span>
                          {m.motivo && (
                            <span className="text-gray-400 block truncate max-w-[200px]">{m.motivo}</span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`font-bold ${m.cantidad_cambio >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {m.cantidad_cambio > 0 ? "+" : ""}{m.cantidad_cambio} kg
                          </span>
                          <span className="text-gray-400 block">{m.usuario_nombre || "—"}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={cerrarModal}
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !ajuste || !motivo || faltaDetalleOtro}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? "Aplicando..." : "Aplicar Ajuste"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

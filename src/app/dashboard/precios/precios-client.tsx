// src/app/dashboard/precios/precios-client.tsx
//
// ⚠️ @deprecated (mayo 2026)
// Este componente fue reemplazado por `src/app/dashboard/catalogo/catalogo-unificado.tsx`,
// que muestra producto + precio en UNA sola vista (antes eran 2 tabs). La ruta
// /dashboard/precios ahora redirige a /dashboard/catalogo (ver page.tsx en este
// mismo directorio).
//
// Los endpoints `/api/precios` y `/api/precios/[id]` siguen funcionando pero la
// vista nueva los reemplaza por `/api/productos` y `/api/productos/[id]` (que
// ahora aceptan precio_compra/precio_venta/codigo en GET/POST/PATCH).
//
// Este archivo queda como red de seguridad por unas semanas. Si nadie reporta
// regresiones visuales de la unificación, se puede borrar sin riesgo.
"use client";

import { useState, useEffect } from "react";
import {
  FiSave,
  FiDollarSign,
  FiX,
  FiEdit2,
  FiTrendingUp,
} from "react-icons/fi";

interface Producto {
  id: string;
  nombre: string;
  categoria: "Pollo" | "Carnes" | "Huevos";
  unidad: string;
  precio_compra: number | string | null;
  precio_venta: number | string | null;
  activo: boolean;
}

type Categoria = "Pollo" | "Carnes" | "Huevos";

const CATEGORIAS: { id: Categoria; emoji: string; color: string }[] = [
  { id: "Pollo", emoji: "🐔", color: "text-amber-700" },
  { id: "Carnes", emoji: "🥩", color: "text-red-700" },
  { id: "Huevos", emoji: "🥚", color: "text-yellow-700" },
];

function toNumber(v: number | string | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? null : n;
}

function formatMoney(v: number | string | null): string {
  const n = toNumber(v);
  return n === null ? "—" : n.toFixed(2);
}

function margenPct(compra: number | null, venta: number | null): number | null {
  if (compra === null || venta === null || compra === 0) return null;
  return ((venta - compra) / compra) * 100;
}

export default function PreciosClient() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valoresEdicion, setValoresEdicion] = useState<{
    precio_compra: string;
    precio_venta: string;
  }>({ precio_compra: "", precio_venta: "" });
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{
    tipo: "ok" | "error";
    texto: string;
  } | null>(null);

  // ── Cargar productos ──
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/precios");
      if (!res.ok) {
        setMensaje({ tipo: "error", texto: "No se pudieron cargar los precios" });
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProductos(data.data ?? []);
      setLoading(false);
    })();
  }, []);

  // ── Auto-ocultar mensaje ──
  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 3500);
    return () => clearTimeout(t);
  }, [mensaje]);

  const iniciarEdicion = (p: Producto) => {
    setEditandoId(p.id);
    setValoresEdicion({
      precio_compra:
        p.precio_compra !== null && p.precio_compra !== undefined
          ? String(toNumber(p.precio_compra) ?? "")
          : "",
      precio_venta:
        p.precio_venta !== null && p.precio_venta !== undefined
          ? String(toNumber(p.precio_venta) ?? "")
          : "",
    });
  };

  const cancelarEdicion = () => {
    setEditandoId(null);
    setValoresEdicion({ precio_compra: "", precio_venta: "" });
  };

  const guardar = async (id: string) => {
    const venta = parseFloat(valoresEdicion.precio_venta);
    const compra = valoresEdicion.precio_compra
      ? parseFloat(valoresEdicion.precio_compra)
      : null;

    if (!venta || venta <= 0) {
      setMensaje({ tipo: "error", texto: "El precio de venta es requerido y debe ser mayor a 0" });
      return;
    }
    if (compra !== null && compra > venta) {
      setMensaje({ tipo: "error", texto: "La compra no puede ser mayor que la venta" });
      return;
    }

    // Confirmación: cambiar precio afecta TODOS los pedidos nuevos.
    // Comparar con el precio anterior para mostrar el cambio claro al admin.
    const productoActual = productos.find((p) => p.id === id);
    if (productoActual) {
      const ventaAnterior = toNumber(productoActual.precio_venta);
      const cambioVenta =
        ventaAnterior !== null && ventaAnterior !== venta
          ? `S/ ${ventaAnterior.toFixed(2)} → S/ ${venta.toFixed(2)}`
          : null;
      if (cambioVenta) {
        const pct = ventaAnterior
          ? (((venta - ventaAnterior) / ventaAnterior) * 100).toFixed(1)
          : "?";
        const ok = confirm(
          `¿Confirmas el cambio de precio?\n\n` +
            `${productoActual.nombre}\n` +
            `Precio venta: ${cambioVenta} (${pct.startsWith("-") ? "" : "+"}${pct}%)\n\n` +
            `⚠️ Este precio se aplicará automáticamente a todos los pedidos nuevos.`
        );
        if (!ok) return;
      }
    }

    setGuardando(true);
    try {
      const res = await fetch(`/api/precios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precio_compra: compra, precio_venta: venta }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.error === "string" ? err.error : "Error al guardar");
      }

      // Actualizar local
      setProductos((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, precio_compra: compra, precio_venta: venta } : p
        )
      );
      setMensaje({ tipo: "ok", texto: "Precio actualizado" });
      cancelarEdicion();
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "Error al guardar",
      });
    } finally {
      setGuardando(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-gray-500">
        <div className="h-6 w-6 border-2 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
        <div className="mt-2 text-sm">Cargando precios…</div></div>
    );
  }

  // Productos sin precio de venta (null o 0): no suman a ventas/metas/reportes.
  const productosSinPrecio = productos.filter((p) => {
    const v = toNumber(p.precio_venta);
    return v == null || v === 0;
  }).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FiDollarSign className="text-red-600" />
          Precios de productos
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Actualiza los precios de compra y venta. Se aplican automáticamente a los pedidos
          nuevos. Cada cambio queda en el histórico.
          <span className="block mt-1 text-xs text-amber-700">
            💡 Los precios se ingresan <strong>con IGV incluido</strong> (lo que cobras al cliente).
          </span>
        </p>
      </header>

      {productosSinPrecio > 0 && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
          ⚠️ <strong>{productosSinPrecio}</strong> producto(s) sin precio de venta — no
          sumarán a ventas, metas ni reportes hasta que les asignes uno.
        </div>
      )}

      {/* ── Mensaje ── */}
      {mensaje && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm font-medium ${
            mensaje.tipo === "ok"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      {/* ── Tabla por categoría ── */}
      {CATEGORIAS.map((cat) => {
        const items = productos.filter((p) => p.categoria === cat.id);
        if (items.length === 0) return null;

        return (
          <section key={cat.id} className="mb-8">
            <h2 className={`text-lg font-bold mb-3 flex items-center gap-2 ${cat.color}`}>
              <span className="text-xl">{cat.emoji}</span>
              {cat.id}
              <span className="text-sm text-gray-400 font-normal">
                ({items.length} productos)
              </span>
            </h2>

            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Producto</th>
                    <th className="px-3 py-2 font-semibold w-24 text-right">Compra (S/)</th>
                    <th className="px-3 py-2 font-semibold w-24 text-right">Venta (S/)</th>
                    <th className="px-3 py-2 font-semibold w-20 text-right">Margen</th>
                    <th className="px-3 py-2 font-semibold w-28 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const enEdicion = editandoId === p.id;
                    const compra = toNumber(p.precio_compra);
                    const venta = toNumber(p.precio_venta);
                    const m = margenPct(compra, venta);

                    return (
                      <tr
                        key={p.id}
                        className={`border-t ${
                          enEdicion ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="text-gray-800">{p.nombre}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{p.unidad}</div>
                        </td>

                        {/* Compra */}
                        <td className="px-3 py-2.5 text-right">
                          {enEdicion ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              autoFocus
                              className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                              value={valoresEdicion.precio_compra}
                              onChange={(e) =>
                                setValoresEdicion({
                                  ...valoresEdicion,
                                  precio_compra: e.target.value,
                                })
                              }
                              placeholder="—"
                            />
                          ) : (
                            <span className="text-gray-600">{formatMoney(p.precio_compra)}</span>
                          )}
                        </td>

                        {/* Venta */}
                        <td className="px-3 py-2.5 text-right">
                          {enEdicion ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              className="w-24 px-2 py-1 border border-gray-300 rounded text-right font-semibold"
                              value={valoresEdicion.precio_venta}
                              onChange={(e) =>
                                setValoresEdicion({
                                  ...valoresEdicion,
                                  precio_venta: e.target.value,
                                })
                              }
                              required
                            />
                          ) : (
                            <span className="font-semibold text-gray-900">
                              {formatMoney(p.precio_venta)}
                            </span>
                          )}
                        </td>

                        {/* Margen */}
                        <td className="px-3 py-2.5 text-right">
                          {m !== null ? (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                m >= 25
                                  ? "text-green-600"
                                  : m >= 15
                                  ? "text-yellow-600"
                                  : "text-red-600"
                              }`}
                            >
                              <FiTrendingUp /> {m.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Acción */}
                        <td className="px-3 py-2.5">
                          {enEdicion ? (
                            <div className="flex justify-center gap-1">
                              <button
                                onClick={() => guardar(p.id)}
                                disabled={guardando}
                                className="px-2.5 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
                              >
                                <FiSave className="h-3.5 w-3.5" />
                                Guardar
                              </button>
                              <button
                                onClick={cancelarEdicion}
                                disabled={guardando}
                                className="px-2 py-1.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                              >
                                <FiX className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => iniciarEdicion(p)}
                              className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 flex items-center justify-center gap-1 mx-auto"
                            >
                              <FiEdit2 className="h-3.5 w-3.5" />
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

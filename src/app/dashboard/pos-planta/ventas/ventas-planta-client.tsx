// src/app/dashboard/pos-planta/ventas/ventas-planta-client.tsx
// Lista de ventas del POS de planta por fecha, con Anular (reversa dinero + stock) y
// Editar (= anular y rehacer en el POS). Espejo de ventas-campo-client, color violeta 🏭.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FiArrowLeft,
  FiCalendar,
  FiCheckCircle,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiEdit2,
  FiEye,
  FiEyeOff,
  FiRefreshCw,
  FiShoppingCart,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import DetalleVentaPos from "@/components/planta/DetalleVentaPos";
import SearchableSelect from "@/components/SearchableSelect";
import { OPERACIONES } from "@/lib/operaciones-venta";
import type { ItemDetalleVentaPos } from "@/lib/planta/ventas-pos";

// ── Fechas (zona Lima SIEMPRE) ──
function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}
function sumarDias(fecha: string, delta: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
/** Lunes de la semana de `fecha` (semana empieza lunes). */
function lunesDeSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const dow = dt.getDay(); // 0=dom..6=sab
  const diff = dow === 0 ? -6 : 1 - dow;
  return sumarDias(fecha, diff);
}
function etiquetaFecha(fecha: string, hoy: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = new Date(y, m - 1, d).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (fecha === hoy) return `Hoy, ${base}`;
  if (fecha === sumarDias(hoy, -1)) return `Ayer, ${base}`;
  const conAnio = y !== Number(hoy.slice(0, 4)) ? `${base} de ${y}` : base;
  return conAnio.charAt(0).toUpperCase() + conAnio.slice(1);
}
const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
  activa?: boolean;
}

interface Cliente {
  id: string;
  nombre: string;
  ruc_dni: string | null;
  telefono: string | null;
}

interface Producto {
  id: string;
  nombre: string;
  unidad: string;
  precio_venta: number | string;
}

interface VentaPlanta {
  id: string;
  cliente: string | null;
  razon_social: string | null;
  ruc_dni: string | null;
  empresa: string;
  fecha: string;
  hora: string;
  created_at: string;
  anulada: boolean;
  anulacion_motivo: string | null;
  total: number;
  costo_total: number | null;
  costo_completo: boolean;
  tipo_pago: string;
  cuenta_nombre: string | null;
  cuenta_id: string | null;
  cliente_planta_id: string | null;
  notas: string | null;
  comprobante_serie_numero: string | null;
  comprobante_tipo: string | null;
  comprobante_estado: string | null;
  items: ItemDetalleVentaPos[];
}

type Modo = "dia" | "semana";

export default function VentasPlantaClient() {
  const router = useRouter();
  const hoy = hoyLima();
  const [modo, setModo] = useState<Modo>("dia");
  const [fecha, setFecha] = useState(hoy);
  const [ventas, setVentas] = useState<VentaPlanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<VentaPlanta | null>(null);
  const [irAlPosDespues, setIrAlPosDespues] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [toast, setToast] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  // Las anuladas se OCULTAN por defecto (no hacen ruido visual); se pueden mostrar a demanda.
  const [mostrarAnuladas, setMostrarAnuladas] = useState(false);

  // Estados para la Edición de Venta Completa
  const [editandoVenta, setEditandoVenta] = useState<VentaPlanta | null>(null);
  const [editFecha, setEditFecha] = useState("");
  const [editClienteId, setEditClienteId] = useState("");
  const [editTipoPago, setEditTipoPago] = useState<"Contado" | "Credito">("Contado");
  const [editCuentaId, setEditCuentaId] = useState("");
  const [editNotas, setEditNotas] = useState("");
  const [editItems, setEditItems] = useState<Array<{
    productoId: string;
    productoNombre: string;
    cantidad: number;
    unidad: string;
    precioUnitario: number;
    notas?: string | null;
  }>>([]);
  const [editEmpresa, setEditEmpresa] = useState<"Transavic" | "Avícola de Tony">("Avícola de Tony");
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [catalogoProductos, setCatalogoProductos] = useState<Producto[]>([]);

  useEffect(() => {
    // Cargar cuentas bancarias
    fetch("/api/cuentas")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCuentas(data.filter(c => c.activa !== false));
        }
      })
      .catch(() => {});

    // Cargar clientes de planta
    fetch("/api/clientes-planta?activo=true")
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.clientes)) {
          setClientes(data.clientes);
        }
      })
      .catch(() => {});

    // Cargar catálogo de productos
    fetch("/api/productos")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCatalogoProductos(data);
        }
      })
      .catch(() => {});
  }, []);

  const clienteOptions = useMemo(() => {
    return [
      { id: "", nombre: "Venta Rápida (Sin Cliente Registrado)" },
      ...clientes.map(c => ({
        id: c.id,
        nombre: `${c.nombre} ${c.ruc_dni ? `(${c.ruc_dni})` : ""}`.trim()
      }))
    ];
  }, [clientes]);

  const productoOptions = useMemo(() => {
    return [
      { id: "", nombre: "Buscar producto..." },
      ...catalogoProductos.map(p => ({
        id: p.id,
        nombre: `${p.nombre} (${p.unidad}) — S/ ${Number(p.precio_venta).toFixed(2)}`
      }))
    ];
  }, [catalogoProductos]);

  const editTotal = useMemo(() => {
    return editItems.reduce((acc, it) => acc + (it.cantidad * it.precioUnitario), 0);
  }, [editItems]);

  const iniciarEdicion = (v: VentaPlanta) => {
    setEditandoVenta(v);
    setEditFecha(v.fecha);
    setEditClienteId(v.cliente_planta_id || "");
    setEditTipoPago(v.tipo_pago === "Credito" ? "Credito" : "Contado");
    setEditCuentaId(v.cuenta_id || "");
    setEditNotas(v.notas || "");
    setEditEmpresa(v.empresa as "Transavic" | "Avícola de Tony");
    setEditItems(
      v.items.map((it: ItemDetalleVentaPos) => ({
        productoId: it.producto_id || "",
        productoNombre: it.producto_nombre,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precioUnitario: it.precio_unitario,
        notas: it.notas || ""
      }))
    );
  };

  const alAgregarProducto = (prodId: string) => {
    if (!prodId) return;
    const prod = catalogoProductos.find(p => p.id === prodId);
    if (!prod) return;
    if (editItems.some(i => i.productoId === prod.id)) {
      setToast({ tipo: "error", texto: "El producto ya está en la lista" });
      return;
    }
    setEditItems([
      ...editItems,
      {
        productoId: prod.id,
        productoNombre: prod.nombre,
        cantidad: 1,
        unidad: prod.unidad || "uni",
        precioUnitario: Number(prod.precio_venta) || 0,
        notas: ""
      }
    ]);
  };

  async function guardarCambiosVenta() {
    if (!editandoVenta) return;
    if (editItems.length === 0) {
      setToast({ tipo: "error", texto: "Debe ingresar al menos un producto" });
      return;
    }
    if (editTipoPago === "Contado" && !editCuentaId) {
      setToast({ tipo: "error", texto: "Debe seleccionar una cuenta bancaria/caja para pagos al Contado" });
      return;
    }
    if (editTipoPago === "Credito" && !editClienteId) {
      setToast({ tipo: "error", texto: "Debe seleccionar un cliente de planta para ventas al Crédito" });
      return;
    }

    setGuardandoEdicion(true);
    try {
      const res = await fetch(`/api/pos/ventas/${editandoVenta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa: editEmpresa,
          items: editItems,
          tipo_pago: editTipoPago,
          cuenta_id: editTipoPago === "Contado" ? editCuentaId : null,
          cliente_planta_id: editClienteId || null,
          notas_generales: editNotas || null,
          fecha: editFecha
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEditandoVenta(null);
        setToast({ tipo: "ok", texto: "Venta editada correctamente." });
        fetchData();
      } else {
        setToast({ tipo: "error", texto: typeof data.error === "string" ? data.error : "Error al guardar la venta." });
      }
    } catch {
      setToast({ tipo: "error", texto: "Error de conexión al guardar cambios." });
    } finally {
      setGuardandoEdicion(false);
    }
  }



  const rango = useMemo(() => {
    if (modo === "semana") return { desde: lunesDeSemana(fecha), hasta: fecha === hoy ? hoy : sumarDias(lunesDeSemana(fecha), 6) };
    return { desde: fecha, hasta: fecha };
  }, [modo, fecha, hoy]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
      const res = await fetch(`/api/pos/ventas?${params.toString()}`);
      if (!res.ok) {
        setVentas([]);
        setError("No se pudieron cargar las ventas. Revisa tu conexión e intenta de nuevo.");
        return;
      }
      const json = await res.json();
      setVentas(Array.isArray(json.ventas) ? json.ventas : []);
    } catch {
      setVentas([]);
      setError("No se pudieron cargar las ventas. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [rango.desde, rango.hasta]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const resumen = useMemo(() => {
    const activas = ventas.filter((v) => !v.anulada);
    return {
      total: activas.reduce((s, v) => s + v.total, 0),
      count: activas.length,
      anuladas: ventas.filter((v) => v.anulada).length,
    };
  }, [ventas]);

  // Lista visible: sin anuladas por defecto (para que no hagan ruido).
  const ventasVisibles = useMemo(
    () => (mostrarAnuladas ? ventas : ventas.filter((v) => !v.anulada)),
    [ventas, mostrarAnuladas]
  );

  async function confirmarAnular() {
    if (!anulando) return;
    setProcesando(true);
    try {
      const res = await fetch(`/api/pos/ventas/${anulando.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setAnulando(null);
        setMotivo("");
        if (irAlPosDespues) {
          router.push("/dashboard/pos-planta");
          return;
        }
        setToast({ tipo: "ok", texto: "Venta anulada. Se devolvió el stock y se revirtió el cobro." });
        fetchData();
      } else {
        setToast({ tipo: "error", texto: typeof j.error === "string" ? j.error : "No se pudo anular la venta." });
      }
    } catch {
      setToast({ tipo: "error", texto: "Error de conexión al anular." });
    } finally {
      setProcesando(false);
    }
  }

  const chip = OPERACIONES.planta;
  const etiquetaRango =
    modo === "semana"
      ? `Semana del ${new Date(rango.desde + "T12:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "short" })}`
      : etiquetaFecha(fecha, hoy);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-5">
        <Link
          href="/dashboard/pos-planta"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3"
        >
          <FiArrowLeft size={15} /> Venta Rápida
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 flex items-center gap-2 tracking-tight">
            <FiShoppingCart className="text-violet-500" /> Ventas de Planta
          </h1>
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${chip.chipClass}`}>
            {chip.emoji} {chip.label}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Revisa las ventas del POS y anula la que haga falta (devuelve el stock y revierte el cobro).
        </p>
      </div>

      {/* Modo día/semana + navegación */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setModo("dia")}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${modo === "dia" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}
          >
            Por día
          </button>
          <button
            onClick={() => { setModo("semana"); }}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${modo === "semana" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}
          >
            Esta semana
          </button>
        </div>
        {modo === "dia" && (
          <>
            <button
              onClick={() => setFecha((f) => sumarDias(f, -1))}
              className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition"
              aria-label="Día anterior"
            >
              <FiChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
              <FiCalendar size={16} className="text-violet-500" />
              <span className="text-sm font-semibold text-gray-800 capitalize">{etiquetaFecha(fecha, hoy)}</span>
            </div>
            <button
              onClick={() => setFecha((f) => sumarDias(f, 1))}
              disabled={fecha >= hoy}
              className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Día siguiente"
            >
              <FiChevronRight size={18} />
            </button>
            {fecha !== hoy && (
              <button onClick={() => setFecha(hoy)} className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition">Hoy</button>
            )}
            <input
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
            />
          </>
        )}
        {modo === "semana" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
            <FiCalendar size={16} className="text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">{etiquetaRango}</span>
          </div>
        )}
        <button
          onClick={fetchData}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
        >
          <FiRefreshCw size={15} /> Refrescar
        </button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Vendido</p>
          <p className="text-lg font-black text-gray-900">{fmtSoles(resumen.total)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Ventas</p>
          <p className="text-lg font-black text-violet-600">{resumen.count}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">Anuladas</p>
          <p className="text-lg font-black text-gray-400">{resumen.anuladas}</p>
        </div>
      </div>

      {/* Toggle de anuladas: ocultas por defecto para no hacer ruido visual. */}
      {resumen.anuladas > 0 && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setMostrarAnuladas((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition"
          >
            {mostrarAnuladas ? (
              <><FiEyeOff size={13} /> Ocultar anuladas</>
            ) : (
              <><FiEye size={13} /> Ver {resumen.anuladas} {resumen.anuladas === 1 ? "anulada" : "anuladas"}</>
            )}
          </button>
        </div>
      )}

      {/* Lista */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
      )}
      {loading ? (
        <div className="py-16 text-center text-gray-400">Cargando ventas…</div>
      ) : ventas.length === 0 ? (
        <div className="py-16 text-center text-gray-400">No hay ventas registradas en este período.</div>
      ) : ventasVisibles.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          Todas las ventas de este período están anuladas.{" "}
          <button onClick={() => setMostrarAnuladas(true)} className="text-violet-600 font-semibold hover:underline">
            Verlas
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {ventasVisibles.map((v) => {
            const noEditable = v.comprobante_serie_numero && ["aceptado", "observado", "pendiente", "emitiendo"].includes(v.comprobante_estado || "");
            return (
              <details
                key={v.id}
                className={`group rounded-xl border bg-white ${v.anulada ? "border-gray-200 opacity-60" : "border-gray-200"}`}
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-start gap-3 rounded-xl px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:px-4 [&::-webkit-details-marker]:hidden">
                  <div className="w-12 flex-shrink-0 text-center">
                    <p className="text-[10px] uppercase text-gray-400 font-bold">Hora</p>
                    <p className="font-mono font-bold text-gray-800 text-sm">{v.hora}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {v.razon_social || v.cliente || "Venta al paso"}
                      {v.anulada && <span className="ml-2 text-xs text-red-500 font-bold">· ANULADA</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {v.items.length === 0
                        ? "Sin ítems registrados"
                        : `${v.items.length} ${v.items.length === 1 ? "producto" : "productos"} · Toca para ver peso, precio y costo`}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {v.tipo_pago === "Credito"
                        ? "Crédito"
                        : `Contado · ${v.cuenta_nombre || "Cuenta no disponible"}`}
                      {v.anulada && v.anulacion_motivo ? ` · ${v.anulacion_motivo}` : ""}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-black text-gray-900">{fmtSoles(v.total)}</p>
                    {v.comprobante_serie_numero && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 mt-1">
                        <FiCheckCircle size={11} /> {v.comprobante_serie_numero}
                      </span>
                    )}
                  </div>
                  <FiChevronDown
                    className="mt-1 flex-shrink-0 text-violet-500 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </summary>
                <div className="border-t border-gray-100 px-3 pb-3 pt-3 sm:px-4">
                  <DetalleVentaPos
                    items={v.items}
                    total={v.total}
                    costoTotal={v.costo_total}
                    costoCompleto={v.costo_completo}
                  />
                  {!v.anulada && (
                    <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-end">
                      <button
                        type="button"
                        disabled={Boolean(noEditable)}
                        onClick={() => iniciarEdicion(v)}
                        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                          noEditable
                            ? "border-gray-100 bg-gray-50 text-gray-400 opacity-50 cursor-not-allowed"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer"
                        }`}
                        title={noEditable ? `No se puede editar: esta venta tiene comprobante SUNAT activo (${v.comprobante_serie_numero})` : "Modificar los detalles de esta venta directamente"}
                      >
                        <FiEdit2 size={13} /> Editar venta
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(noEditable)}
                        onClick={() => { setAnulando(v); setMotivo(""); setIrAlPosDespues(false); }}
                        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                          noEditable
                            ? "border-gray-100 bg-gray-50 text-gray-450 opacity-50 cursor-not-allowed"
                            : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer"
                        }`}
                        title={noEditable ? `No se puede anular: esta venta tiene comprobante SUNAT activo (${v.comprobante_serie_numero}). Emite una Nota de Crédito.` : "Anular venta"}
                      >
                        <FiTrash2 size={13} /> Anular
                      </button>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* Modal anular */}
      {anulando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
              <span className={`flex items-center justify-center w-9 h-9 rounded-full ${irAlPosDespues ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"} flex-shrink-0`}>
                {irAlPosDespues ? <FiEdit2 size={18} /> : <FiTrash2 size={18} />}
              </span>
              <h3 className="font-bold text-gray-900">
                {irAlPosDespues ? "Rehacer venta (Editar)" : "Anular esta venta"}
              </h3>
              <button onClick={() => setAnulando(null)} className="ml-auto p-1.5 rounded-full text-gray-400 hover:bg-gray-100">
                <FiX size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p className="text-gray-700">
                {irAlPosDespues ? (
                  <>
                    Esta acción <strong>anulará la venta actual</strong> (devolviendo el stock y revertiendo el cobro) 
                    y te <strong>redirigirá al POS</strong> con los datos cargados para que puedas rehacerla.
                  </>
                ) : (
                  <>
                    Se <strong>devolverá el stock</strong> de los productos y se <strong>revertirá el cobro</strong>
                    {anulando.tipo_pago === "Credito" ? " (se anula la deuda)" : ` de ${fmtSoles(anulando.total)} en ${anulando.cuenta_nombre || "la caja"}`}.
                    Esta acción queda registrada.
                  </>
                )}
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Motivo (opcional)</label>
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. error al cobrar, cliente devolvió…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  maxLength={250}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 sm:flex-row sm:justify-end">
              <button onClick={() => setAnulando(null)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800">Cancelar</button>
              <button
                onClick={confirmarAnular}
                disabled={procesando}
                className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-lg ${irAlPosDespues ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"} text-white disabled:opacity-60 transition`}
              >
                {irAlPosDespues ? (
                  <>{procesando ? "Preparando..." : "Sí, anular y rehacer en POS"}</>
                ) : (
                  <>
                    <FiTrash2 size={15} /> {procesando ? "Anulando…" : "Sí, anular venta"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Modal editar venta */}
      {editandoVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex-shrink-0">
                <FiEdit2 size={18} />
              </span>
              <div>
                <h3 className="font-bold text-gray-900 leading-tight">Editar Venta de Planta</h3>
                <p className="text-[11px] text-gray-500">ID: {editandoVenta.id}</p>
              </div>
              <button onClick={() => setEditandoVenta(null)} className="ml-auto p-1.5 rounded-full text-gray-400 hover:bg-gray-100 cursor-pointer">
                <FiX size={16} />
              </button>
            </div>

            {/* Content (Scrollable) */}
            <div className="p-5 space-y-4 overflow-y-auto flex-grow text-sm">
              {/* Grid 1: Empresa & Fecha */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Empresa</label>
                  <select
                    value={editEmpresa}
                    onChange={(e) => setEditEmpresa(e.target.value as "Transavic" | "Avícola de Tony")}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  >
                    <option value="Avícola de Tony">Avícola de Tony (RUC 10)</option>
                    <option value="Transavic">Transavic (RUC 20)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Fecha de venta</label>
                  <input
                    type="date"
                    value={editFecha}
                    max={hoy}
                    onChange={(e) => setEditFecha(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
              </div>

              {/* Cliente */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Cliente de Planta</label>
                <SearchableSelect
                  value={editClienteId}
                  onChange={setEditClienteId}
                  options={clienteOptions}
                  placeholder="Seleccione Cliente..."
                  searchPlaceholder="Buscar cliente..."
                />
              </div>

              {/* Grid 2: Tipo de Pago & Caja */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Método de Pago</label>
                  <div className="grid grid-cols-2 gap-1 bg-gray-100 p-0.5 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setEditTipoPago("Contado")}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        editTipoPago === "Contado"
                          ? "bg-white text-indigo-700 shadow-sm"
                          : "text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      Contado
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTipoPago("Credito")}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        editTipoPago === "Credito"
                          ? "bg-white text-indigo-700 shadow-sm"
                          : "text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      Crédito
                    </button>
                  </div>
                </div>
                {editTipoPago === "Contado" ? (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Caja / Cuenta de destino</label>
                    <select
                      value={editCuentaId}
                      onChange={(e) => setEditCuentaId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                    >
                      <option value="" disabled>Elige la caja o cuenta</option>
                      {cuentas.map(c => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-end">
                    <div className="p-2 w-full bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 font-medium">
                      Deuda del cliente (por cobrar).
                    </div>
                  </div>
                )}
              </div>

              {/* Items Section */}
              <div className="border-t border-gray-150 pt-4">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Productos de la Venta</h4>
                  <span className="text-xs text-gray-500 font-medium">Líneas: {editItems.length}</span>
                </div>

                {/* Table of items */}
                <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-500">
                        <th className="p-2.5">Producto</th>
                        <th className="p-2.5 w-24 text-center">Cantidad</th>
                        <th className="p-2.5 w-16 text-center">Unidad</th>
                        <th className="p-2.5 w-24 text-center">P. Unit.</th>
                        <th className="p-2.5 w-24 text-right">Subtotal</th>
                        <th className="p-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-150">
                      {editItems.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50/50">
                          <td className="p-2.5 font-semibold text-gray-800">
                            {item.productoNombre}
                          </td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              step="any"
                              value={item.cantidad || ""}
                              min="0.01"
                              onChange={(e) => {
                                const newQty = parseFloat(e.target.value) || 0;
                                const updated = [...editItems];
                                updated[index].cantidad = newQty;
                                setEditItems(updated);
                              }}
                              className="w-20 px-1.5 py-1 border border-gray-300 rounded text-center font-bold"
                            />
                          </td>
                          <td className="p-2.5 text-center text-gray-500 font-medium">
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold">{item.unidad}</span>
                          </td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              step="any"
                              value={item.precioUnitario || ""}
                              min="0"
                              onChange={(e) => {
                                const newPrice = parseFloat(e.target.value) || 0;
                                const updated = [...editItems];
                                updated[index].precioUnitario = newPrice;
                                setEditItems(updated);
                              }}
                              className="w-20 px-1.5 py-1 border border-gray-300 rounded text-center font-bold"
                            />
                          </td>
                          <td className="p-2.5 text-right font-bold text-gray-800">
                            S/ {(item.cantidad * item.precioUnitario).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setEditItems(editItems.filter((_, idx) => idx !== index));
                              }}
                              className="p-1 text-red-500 hover:bg-red-50 rounded cursor-pointer animate-none"
                              title="Quitar producto"
                            >
                              <FiTrash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {editItems.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-gray-400 font-medium italic bg-gray-50/50">
                            No hay productos agregados a la venta.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add product to items */}
                <div className="flex gap-2 items-center">
                  <div className="flex-grow">
                    <SearchableSelect
                      value=""
                      onChange={alAgregarProducto}
                      options={productoOptions}
                      placeholder="Buscar producto para agregar..."
                      searchPlaceholder="Escribe el nombre del producto..."
                    />
                  </div>
                </div>
              </div>

              {/* Notas generales */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notas / Observaciones de Venta</label>
                <input
                  type="text"
                  value={editNotas}
                  onChange={(e) => setEditNotas(e.target.value)}
                  placeholder="Ej. Venta rápida mostrador, despacho planta, etc."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  maxLength={250}
                />
              </div>

              {/* Total Display */}
              <div className="flex justify-between items-center bg-violet-50 border border-violet-100 rounded-xl p-3 px-4">
                <span className="font-extrabold text-violet-800 text-xs uppercase tracking-wider">Total de la Venta:</span>
                <span className="font-black text-violet-900 text-lg">S/ {editTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col-reverse gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 sm:flex-row sm:justify-end flex-shrink-0">
              <button onClick={() => setEditandoVenta(null)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 cursor-pointer">
                Cancelar
              </button>
              <button
                onClick={guardarCambiosVenta}
                disabled={guardandoEdicion || editItems.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 transition cursor-pointer"
              >
                {guardandoEdicion ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold ${toast.tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.texto}
        </div>
      )}
    </div>
  );
}

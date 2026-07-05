"use client";

import { useState, useEffect } from "react";
import { FiPlus, FiAlertCircle, FiArrowRight, FiArrowLeft, FiList, FiCornerUpLeft } from "react-icons/fi";
import SearchableSelect from "@/components/SearchableSelect";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

type Saldo = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  jabas: number;
  peso_kg: number;
};
type Transaccion = {
  id: string;
  producto_id: string;
  tipo_movimiento: string;
  fecha: string;
  producto_nombre: string;
  jabas: number;
  peso_kg: number;
  notas?: string;
};
type Proveedor = { id: string; razon_social: string };
type Producto = { id: string; nombre: string };

// Texto de ayuda corto por tipo de operación (se muestra bajo el select).
const AYUDA_TIPO: Record<string, string> = {
  PRESTAMO_RECIBIDO: "Nos prestan mercadería: nuestra deuda con el proveedor sube.",
  PRESTAMO_OTORGADO: "Les prestamos mercadería: la deuda del proveedor con nosotros sube.",
  DEVOLUCION_RECIBIDA: "Nos devuelven mercadería: la deuda del proveedor baja.",
  DEVOLUCION_OTORGADA: "Devolvemos mercadería: nuestra deuda con el proveedor baja.",
};

const ETIQUETA_TIPO: Record<string, string> = {
  PRESTAMO_RECIBIDO: "Recibimos prestado",
  PRESTAMO_OTORGADO: "Prestamos",
  DEVOLUCION_RECIBIDA: "Nos devolvieron",
  DEVOLUCION_OTORGADA: "Devolvimos",
};

export default function PrestamosClient() {
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [kardexOpen, setKardexOpen] = useState(false);
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const { mostrarToast, toasts } = useToast();

  // Mini-kardex del par proveedor+producto dentro del modal
  const [miniKardex, setMiniKardex] = useState<Transaccion[]>([]);
  const [miniKardexLoading, setMiniKardexLoading] = useState(false);

  // Form State
  const [form, setForm] = useState({
    proveedorId: "",
    productoId: "",
    tipoMovimiento: "PRESTAMO_RECIBIDO",
    jabas: 0,
    pesoKg: 0,
    fecha: new Date().toISOString().split("T")[0],
    notas: ""
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchSaldos();
    fetchFormOptions();
  }, []);

  const fetchSaldos = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prestamos/saldos");
      const data = await res.json();
      setSaldos(data.saldos || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchFormOptions = async () => {
    try {
      const [provRes, prodRes] = await Promise.all([
        fetch("/api/proveedores").catch(() => null),
        fetch("/api/productos").catch(() => null)
      ]);
      
      if (provRes && provRes.ok) {
        const p = await provRes.json();
        if (Array.isArray(p)) {
          setProveedores(p);
          if (p.length > 0) setForm(f => ({ ...f, proveedorId: p[0].id }));
        }
      }
      if (prodRes && prodRes.ok) {
        const pr = await prodRes.json();
        if (pr && Array.isArray(pr.data)) {
          setProductos(pr.data);
          if (pr.data.length > 0) setForm(f => ({ ...f, productoId: pr.data[0].id }));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openKardex = async (proveedorId: string) => {
    setKardexOpen(true);
    try {
      const res = await fetch(`/api/prestamos/transacciones?proveedorId=${proveedorId}`);
      const data = await res.json();
      setTransacciones(data.transacciones || []);
    } catch (err) {
      console.error(err);
    }
  };

  // Abre el modal desde una fila de saldos con proveedor, producto y tipo preseleccionados.
  // El tipo sugerido depende del signo del saldo:
  // saldo positivo = el proveedor nos debe → devolución: nos devuelven; préstamo: les prestamos más.
  // saldo negativo = nosotros debemos → devolución: devolvemos; préstamo: nos prestan más.
  const abrirMovimientoRapido = (s: Saldo, accion: "devolucion" | "prestamo") => {
    const nosDeben = s.peso_kg > 0 || s.jabas > 0;
    const tipo =
      accion === "devolucion"
        ? (nosDeben ? "DEVOLUCION_RECIBIDA" : "DEVOLUCION_OTORGADA")
        : (nosDeben ? "PRESTAMO_OTORGADO" : "PRESTAMO_RECIBIDO");
    setForm((f) => ({
      ...f,
      proveedorId: s.proveedor_id,
      productoId: s.producto_id,
      tipoMovimiento: tipo,
      jabas: 0,
      pesoKg: 0,
      notas: "",
    }));
    setModalOpen(true);
  };

  // Mini-kardex: últimos 5 movimientos del par proveedor+producto elegido en el modal.
  // El endpoint GET /api/prestamos/transacciones filtra por proveedorId; el producto se filtra aquí.
  useEffect(() => {
    if (!modalOpen || !form.proveedorId || !form.productoId) {
      setMiniKardex([]);
      return;
    }
    let cancelado = false;
    const cargarMiniKardex = async () => {
      setMiniKardexLoading(true);
      try {
        const res = await fetch(`/api/prestamos/transacciones?proveedorId=${form.proveedorId}`);
        const data = await res.json();
        if (!cancelado) {
          const todas: Transaccion[] = data.transacciones || [];
          setMiniKardex(todas.filter((t) => t.producto_id === form.productoId).slice(0, 5));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelado) setMiniKardexLoading(false);
      }
    };
    cargarMiniKardex();
    return () => {
      cancelado = true;
    };
  }, [modalOpen, form.proveedorId, form.productoId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/prestamos/transacciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Error registrando movimiento");
      }

      mostrarToast("Movimiento registrado correctamente", "exito");
      setModalOpen(false);
      setForm({ ...form, jabas: 0, pesoKg: 0, notas: "" });
      fetchSaldos();
    } catch (err: unknown) {
      mostrarToast(err instanceof Error ? err.message : "Error al registrar el movimiento", "error");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            Préstamos de Mercadería
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full uppercase font-bold">Beta</span>
          </h1>
          <p className="text-gray-500 mt-1">Control exacto de jabas y kilos prestados entre proveedores.</p>
        </div>
        <button 
          onClick={() => setModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
        >
          <FiPlus className="w-5 h-5" /> Registrar Movimiento
        </button>
      </div>

      <GuiaModulo modulo="prestamos" />

      {loading ? (
        <div className="text-center py-12 text-gray-400 animate-pulse">Cargando saldos...</div>
      ) : saldos.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-indigo-500">
            <FiAlertCircle size={32} />
          </div>
          <h3 className="font-bold text-gray-800 text-base">No hay saldos de préstamos</h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">Todos los préstamos y devoluciones en especie con los proveedores se encuentran saldados actualmente.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="p-4 font-semibold text-gray-600">Proveedor</th>
                <th className="p-4 font-semibold text-gray-600">Producto</th>
                <th className="p-4 font-semibold text-gray-600">Jabas</th>
                <th className="p-4 font-semibold text-gray-600">Peso (Kg)</th>
                <th className="p-4 font-semibold text-gray-600">Estado</th>
                <th className="p-4 font-semibold text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {saldos.map((s) => {
                // Positivo = Proveedor nos debe a nosotros
                // Negativo = Nosotros debemos al proveedor
                const isPositive = s.peso_kg > 0 || s.jabas > 0;
                const isZero = s.peso_kg === 0 && s.jabas === 0;

                return (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="p-4 font-medium text-gray-900">{s.proveedor_nombre}</td>
                    <td className="p-4 text-gray-600">{s.producto_nombre}</td>
                    <td className="p-4 text-gray-900 font-medium">{Math.abs(s.jabas)}</td>
                    <td className="p-4 text-gray-900 font-medium">{Math.abs(s.peso_kg)} Kg</td>
                    <td className="p-4">
                      {isZero ? (
                        <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                          Saldado
                        </span>
                      ) : isPositive ? (
                        <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1 w-max">
                          <FiArrowRight /> Nos Deben
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 flex items-center gap-1 w-max">
                          <FiArrowLeft /> Debemos
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => abrirMovimientoRapido(s, "devolucion")}
                          title="Registrar una devolución de este producto con este proveedor"
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer active:scale-95 flex items-center gap-1"
                        >
                          <FiCornerUpLeft className="w-3.5 h-3.5" /> Devolución
                        </button>
                        <button
                          onClick={() => abrirMovimientoRapido(s, "prestamo")}
                          title="Registrar un préstamo de este producto con este proveedor"
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors cursor-pointer active:scale-95 flex items-center gap-1"
                        >
                          <FiPlus className="w-3.5 h-3.5" /> Préstamo
                        </button>
                        <button
                          onClick={() => openKardex(s.proveedor_id)}
                          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer active:scale-95"
                        >
                          <FiList /> Ver Kardex
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL NUEVO MOVIMIENTO */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="bg-gray-50 p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Registrar Movimiento Físico</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Proveedor y Producto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Proveedor</label>
                  <SearchableSelect
                    options={proveedores.map(p => ({ id: p.id, nombre: p.razon_social }))}
                    value={form.proveedorId}
                    onChange={val => setForm({ ...form, proveedorId: val })}
                    placeholder="Seleccione Proveedor"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Producto</label>
                  <SearchableSelect
                    options={productos.map(p => ({ id: p.id, nombre: p.nombre }))}
                    value={form.productoId}
                    onChange={val => setForm({ ...form, productoId: val })}
                    placeholder="Seleccione Producto"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Operación</label>
                <select 
                  value={form.tipoMovimiento} 
                  onChange={e => setForm({...form, tipoMovimiento: e.target.value})}
                  className="w-full border-gray-200 rounded-xl p-2 focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="PRESTAMO_RECIBIDO">Recibimos Prestado (nos prestan mercadería)</option>
                  <option value="PRESTAMO_OTORGADO">Prestamos a ellos (les prestamos mercadería)</option>
                  <option value="DEVOLUCION_RECIBIDA">Nos Devuelven (nos devuelven mercadería)</option>
                  <option value="DEVOLUCION_OTORGADA">Devolvemos (devolvemos mercadería)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1.5">{AYUDA_TIPO[form.tipoMovimiento]}</p>
              </div>

              {/* Mini-kardex del par proveedor+producto elegido */}
              {form.proveedorId && form.productoId && (
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Últimos movimientos de este producto con este proveedor
                  </h3>
                  {miniKardexLoading ? (
                    <p className="text-xs text-gray-400 animate-pulse">Cargando movimientos...</p>
                  ) : miniKardex.length === 0 ? (
                    <p className="text-xs text-gray-400">Sin movimientos previos para este par.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {miniKardex.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                          <div className="min-w-0">
                            <span className="text-gray-400">
                              {new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(new Date(t.fecha))}
                            </span>{" "}
                            <span className="font-medium text-gray-700">
                              {ETIQUETA_TIPO[t.tipo_movimiento] ?? t.tipo_movimiento.replace("_", " ")}
                            </span>
                          </div>
                          <span className="text-gray-600 shrink-0 font-medium">
                            {t.jabas} jabas · {t.peso_kg} kg
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Jabas</label>
                  <input type="number" min="0" required value={form.jabas} onChange={e => setForm({...form, jabas: Number(e.target.value)})} className="w-full border-gray-200 rounded-xl p-2 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Peso (Kg)</label>
                  <input type="number" step="0.01" min="0" required value={form.pesoKg} onChange={e => setForm({...form, pesoKg: Number(e.target.value)})} className="w-full border-gray-200 rounded-xl p-2 focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas / Justificación</label>
                <input type="text" value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} className="w-full border-gray-200 rounded-xl p-2 focus:ring-2 focus:ring-indigo-500" placeholder="Ej. Pollo prestado por falta de stock, recoge chofer..." />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setModalOpen(false)} className="px-5 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-medium transition-colors cursor-pointer active:scale-95">Cancelar</button>
                <button type="submit" disabled={submitting} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-md transition-colors disabled:opacity-50 cursor-pointer active:scale-95">
                  {submitting ? "Guardando..." : "Registrar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL KARDEX */}
      {kardexOpen && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-gray-50 p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Kardex Físico del Proveedor</h2>
              <button onClick={() => setKardexOpen(false)} className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer transition-colors">✕</button>
            </div>
            <div className="p-0 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 sticky top-0 border-b border-gray-100">
                  <tr>
                    <th className="p-3 font-semibold text-gray-600">Fecha</th>
                    <th className="p-3 font-semibold text-gray-600">Operación</th>
                    <th className="p-3 font-semibold text-gray-600">Producto</th>
                    <th className="p-3 font-semibold text-gray-600 text-right">Jabas</th>
                    <th className="p-3 font-semibold text-gray-600 text-right">Peso</th>
                    <th className="p-3 font-semibold text-gray-600">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transacciones.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 px-4 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-400 space-y-2">
                          <FiList size={32} className="opacity-40 text-indigo-400 animate-pulse" />
                          <span className="font-semibold text-gray-700 text-xs">Historial de Kardex vacío</span>
                          <p className="text-[10px] text-gray-400 max-w-xs mx-auto">No se han registrado movimientos de préstamos ni devoluciones para este proveedor.</p>
                        </div>
                      </td>
                    </tr>
                  ) : transacciones.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-600">
                        {new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(t.fecha))}
                      </td>
                      <td className="p-3 font-medium text-gray-900 text-xs">
                        {t.tipo_movimiento.replace('_', ' ')}
                      </td>
                      <td className="p-3 text-gray-600">{t.producto_nombre}</td>
                      <td className="p-3 text-gray-900 text-right">{t.jabas}</td>
                      <td className="p-3 text-gray-900 text-right">{t.peso_kg} Kg</td>
                      <td className="p-3 text-gray-500 text-xs truncate max-w-[150px]">{t.notas || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

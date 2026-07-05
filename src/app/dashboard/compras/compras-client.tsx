"use client";

import { useState, useEffect, useRef } from "react";
import { FiPlus, FiTrash2, FiSave, FiCalendar, FiBox, FiFileText } from "react-icons/fi";
import SearchableSelect from "@/components/SearchableSelect";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

interface Proveedor {
  id: string;
  ruc: string;
  razon_social: string;
}

interface Producto {
  id: string;
  nombre: string;
  categoria: string;
}

interface CompraItemInput {
  producto_id: string;
  jabas: number;
  peso_bruto: number;
  peso_tara: number;
  costo_unitario: number;
}

interface CompraRecord {
  id: string;
  fecha: string;
  tipo_doc: string;
  nro_doc: string;
  estado: string;
  subtotal: number;
  igv: number;
  total: number;
  proveedor_nombre: string;
  proveedor_ruc: string;
  registrado_por: string;
  items: {
    id: string;
    producto_nombre: string;
    jabas: number;
    peso_bruto: number;
    peso_tara: number;
    peso_neto: number;
    costo_unitario: number;
    subtotal: number;
  }[];
}

const CLAVE_ULTIMO_PROVEEDOR = "transavic_compras_ultimo_proveedor";

const filaVacia = (): CompraItemInput => ({
  producto_id: "",
  jabas: 0,
  peso_bruto: 0,
  peso_tara: 0,
  costo_unitario: 0,
});

export default function ComprasClient() {
  const [activeTab, setActiveTab] = useState<"nuevo" | "historial">("nuevo");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [compras, setCompras] = useState<CompraRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [proveedorId, setProveedorId] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [tipoDoc, setTipoDoc] = useState("Factura");
  const [nroDoc, setNroDoc] = useState("");
  const [items, setItems] = useState<CompraItemInput[]>([
    { producto_id: "", jabas: 0, peso_bruto: 0, peso_tara: 0, costo_unitario: 0 }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const { mostrarToast, toasts } = useToast();

  // Mapa producto_id → último costo pagado al proveedor seleccionado
  const [ultimosCostos, setUltimosCostos] = useState<Record<string, number>>({});
  // Refs a las celdas de producto para enfocar el selector al agregar fila con Enter
  const celdasProductoRefs = useRef<(HTMLTableCellElement | null)[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  // Al cambiar de proveedor, traer sus últimos costos por producto
  useEffect(() => {
    if (!proveedorId) {
      setUltimosCostos({});
      return;
    }
    let cancelado = false;
    fetch(`/api/compras?ultimos_costos=${proveedorId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { producto_id: string; costo_unitario: number }[]) => {
        if (cancelado || !Array.isArray(data)) return;
        const mapa: Record<string, number> = {};
        for (const fila of data) mapa[fila.producto_id] = Number(fila.costo_unitario);
        setUltimosCostos(mapa);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [proveedorId]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [provRes, prodRes, compRes] = await Promise.all([
        fetch("/api/proveedores"),
        fetch("/api/productos"),
        fetch("/api/compras")
      ]);

      if (provRes.ok) {
        const provData: Proveedor[] = await provRes.json();
        setProveedores(provData);
        // Recordar el último proveedor usado (agiliza la carga de la madrugada)
        const guardado = localStorage.getItem(CLAVE_ULTIMO_PROVEEDOR);
        if (guardado && provData.some((p) => p.id === guardado)) {
          setProveedorId((prev) => prev || guardado);
        }
      }
      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProductos(prodData.data || prodData);
      }
      if (compRes.ok) setCompras(await compRes.json());
    } catch (error) {
      console.error("Error cargando datos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    setItems([...items, filaVacia()]);
  };

  // Enter en el costo (último campo de la fila) → nueva fila + foco en su selector de producto
  const handleEnterEnCosto = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // no disparar el submit del form
    const nuevaFila = items.length;
    setItems([...items, filaVacia()]);
    setTimeout(() => {
      celdasProductoRefs.current[nuevaFila]?.querySelector("button")?.focus();
    }, 60);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof CompraItemInput, value: string | number) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      [field]: value
    };
    // Al elegir producto con el costo vacío, precargar el último costo del proveedor
    if (field === "producto_id" && typeof value === "string") {
      const ultimo = ultimosCostos[value];
      if (ultimo != null && !newItems[index].costo_unitario) {
        newItems[index] = { ...newItems[index], costo_unitario: ultimo };
      }
    }
    setItems(newItems);
  };

  const calculateTotal = () => {
    return items.reduce((acc, item) => {
      const neto = Math.max(0, item.peso_bruto - item.peso_tara);
      return acc + (neto * item.costo_unitario);
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // Validar items
    for (const item of items) {
      if (!item.producto_id) {
        mostrarToast("Debes seleccionar un producto para todos los renglones.", "error");
        setSubmitting(false);
        return;
      }
      if (item.peso_bruto <= item.peso_tara) {
        mostrarToast("El peso bruto debe ser mayor al peso tara.", "error");
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/compras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedorId,
          fecha,
          tipo_doc: tipoDoc,
          nro_doc: nroDoc,
          items
        })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Error al registrar la compra.");
      }

      mostrarToast("Compra registrada. Inventario actualizado y Cuenta por Pagar generada.", "exito");

      // Recordar el proveedor para la próxima carga
      if (proveedorId) localStorage.setItem(CLAVE_ULTIMO_PROVEEDOR, proveedorId);

      // Resetear formulario
      setNroDoc("");
      setItems([filaVacia()]);

      // Recargar historial
      const compRes = await fetch("/api/compras");
      if (compRes.ok) setCompras(await compRes.json());
    } catch (error: unknown) {
      console.error(error);
      mostrarToast(error instanceof Error ? error.message : "Error de red", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const totalCompra = calculateTotal();

  return (
    <div className="space-y-6">
      <GuiaModulo modulo="compras" />

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab("nuevo")}
          className={`py-3 px-6 font-semibold border-b-2 text-sm transition-all cursor-pointer ${
            activeTab === "nuevo"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Nueva Compra
        </button>
        <button
          onClick={() => setActiveTab("historial")}
          className={`py-3 px-6 font-semibold border-b-2 text-sm transition-all cursor-pointer ${
            activeTab === "historial"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Historial de Recepciones
        </button>
      </div>

      <ToastContainer toasts={toasts} />

      {loading ? (
        <div className="text-center py-12 text-gray-400 animate-pulse font-medium">Cargando datos del módulo...</div>
      ) : activeTab === "nuevo" ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Recepcion Info */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <FiBox className="text-indigo-600" /> Datos del Comprobante / Recepción
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Proveedor</label>
                <SearchableSelect
                  required
                  value={proveedorId}
                  onChange={setProveedorId}
                  options={proveedores.map(p => ({
                    id: p.id,
                    nombre: p.razon_social,
                    subtext: p.ruc
                  }))}
                  placeholder="Seleccione proveedor..."
                  searchPlaceholder="Buscar proveedor por RUC o nombre..."
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Fecha de Ingreso</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiCalendar className="text-gray-400" />
                  </div>
                  <input
                    type="date"
                    required
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="block w-full rounded-xl border-gray-300 pl-10 py-3 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Tipo Documento</label>
                <select
                  value={tipoDoc}
                  onChange={(e) => setTipoDoc(e.target.value)}
                  className="block w-full rounded-xl border-gray-300 py-3 px-4 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-sm"
                >
                  <option value="Factura">Factura</option>
                  <option value="Boleta">Boleta</option>
                  <option value="Guia">Guía de Remisión</option>
                  <option value="Sin Documento">Sin Documento</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Nro. Documento / Lote</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: F001-00123"
                  value={nroDoc}
                  onChange={(e) => setNroDoc(e.target.value)}
                  className="block w-full rounded-xl border-gray-300 px-4 py-3 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FiFileText className="text-indigo-600" /> Detalle de Carga
              </h2>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-2 rounded-lg font-bold transition-all flex items-center gap-1 cursor-pointer active:scale-95"
              >
                <FiPlus /> Agregar Fila
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 font-semibold">
                    <th className="pb-3 pr-4 w-1/3">Producto</th>
                    <th className="pb-3 pr-4 text-right">Jabas</th>
                    <th className="pb-3 pr-4 text-right">P. Bruto (Kg)</th>
                    <th className="pb-3 pr-4 text-right">P. Tara (Kg)</th>
                    <th className="pb-3 pr-4 text-right">P. Neto (Kg)</th>
                    <th className="pb-3 pr-4 text-right">Costo / Kg (S/)</th>
                    <th className="pb-3 pr-4 text-right">Total (S/)</th>
                    <th className="pb-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item, idx) => {
                    const neto = Math.max(0, item.peso_bruto - item.peso_tara);
                    const subtotal = neto * item.costo_unitario;
                    const taraInvalida = item.peso_bruto > 0 && item.peso_tara > 0 && item.peso_tara >= item.peso_bruto;
                    const ultimoCosto = item.producto_id ? ultimosCostos[item.producto_id] : undefined;

                    return (
                      <tr key={idx} className="align-middle">
                        <td
                          className="py-3 pr-4"
                          ref={(el) => {
                            celdasProductoRefs.current[idx] = el;
                          }}
                        >
                          <SearchableSelect
                            required
                            value={item.producto_id}
                            onChange={(val) => handleItemChange(idx, "producto_id", val)}
                            options={productos.map(p => ({
                              id: p.id,
                              nombre: p.nombre,
                              subtext: p.categoria
                            }))}
                            placeholder="Seleccione producto..."
                            searchPlaceholder="Buscar producto..."
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            type="number"
                            min="0"
                            value={item.jabas || ""}
                            onChange={(e) => handleItemChange(idx, "jabas", Number(e.target.value))}
                            className="block w-20 ml-auto text-right rounded-xl border-gray-300 py-2.5 px-3 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-xs"
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder="0.00"
                            value={item.peso_bruto || ""}
                            onChange={(e) => handleItemChange(idx, "peso_bruto", Number(e.target.value))}
                            className="block w-24 ml-auto text-right font-bold rounded-xl border-gray-300 py-2.5 px-3 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-xs"
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={item.peso_tara || ""}
                            onChange={(e) => handleItemChange(idx, "peso_tara", Number(e.target.value))}
                            className={`block w-24 ml-auto text-right rounded-xl py-2.5 px-3 text-gray-900 shadow-sm bg-gray-50 text-xs ${
                              taraInvalida
                                ? "border-red-500 ring-1 ring-red-400 focus:border-red-500 focus:ring-red-500"
                                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                            }`}
                          />
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <span className={`font-mono font-medium ${taraInvalida ? "text-red-600" : "text-gray-600"}`}>
                            {neto.toFixed(2)} kg
                          </span>
                          {taraInvalida && (
                            <p className="text-[10px] text-red-600 font-semibold mt-0.5">tara ≥ bruto</p>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder="0.00"
                            value={item.costo_unitario || ""}
                            onChange={(e) => handleItemChange(idx, "costo_unitario", Number(e.target.value))}
                            onKeyDown={handleEnterEnCosto}
                            className="block w-24 ml-auto text-right font-bold rounded-xl border-gray-300 py-2.5 px-3 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-xs"
                          />
                          {ultimoCosto != null && (
                            <button
                              type="button"
                              onClick={() => handleItemChange(idx, "costo_unitario", ultimoCosto)}
                              title="Aplicar el último costo pagado a este proveedor"
                              className="block ml-auto mt-1 text-[10px] text-gray-400 hover:text-indigo-600 cursor-pointer"
                            >
                              últ.: S/ {ultimoCosto.toFixed(2)}
                            </button>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right font-mono font-bold text-gray-800">
                          S/ {subtotal.toFixed(2)}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            disabled={items.length === 1}
                            onClick={() => handleRemoveItem(idx)}
                            className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-30 transition-colors cursor-pointer"
                          >
                            <FiTrash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Total summary */}
            <div className="flex justify-end pt-4 border-t border-gray-100">
              <div className="w-64 space-y-2 text-right">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal Neto:</span>
                  <span className="font-mono">S/ {(totalCompra / 1.18).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>IGV (18%):</span>
                  <span className="font-mono">S/ {(totalCompra - (totalCompra / 1.18)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-100">
                  <span>Total General:</span>
                  <span className="font-mono text-indigo-600">S/ {totalCompra.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-xl font-bold transition-all shadow-md hover:shadow-lg flex items-center gap-2 disabled:opacity-50 cursor-pointer active:scale-95"
            >
              <FiSave className="w-5 h-5" /> {submitting ? "Procesando..." : "Registrar Carga"}
            </button>
          </div>
        </form>
      ) : (
        /* Historial de Compras */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {compras.length === 0 ? (
            <div className="text-center py-12 space-y-4">
              <p className="text-gray-500 font-medium">No se han registrado compras aún.</p>
              <button
                type="button"
                onClick={() => setActiveTab("nuevo")}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm cursor-pointer active:scale-95"
              >
                + Registrar primera compra
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="p-4 font-semibold text-gray-600">Fecha</th>
                    <th className="p-4 font-semibold text-gray-600">Proveedor</th>
                    <th className="p-4 font-semibold text-gray-600">Documento</th>
                    <th className="p-4 font-semibold text-gray-600 text-right">Items</th>
                    <th className="p-4 font-semibold text-gray-600 text-right">Total (Con IGV)</th>
                    <th className="p-4 font-semibold text-gray-600">Registrado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {compras.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 text-gray-900 font-medium">
                        {new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(c.fecha + 'T00:00:00'))}
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-gray-800">{c.proveedor_nombre}</div>
                        <div className="text-xs text-gray-400">{c.proveedor_ruc}</div>
                      </td>
                      <td className="p-4">
                        <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-md text-xs font-bold mr-2 uppercase">
                          {c.tipo_doc}
                        </span>
                        <span className="font-mono text-gray-600">{c.nro_doc}</span>
                      </td>
                      <td className="p-4 text-right font-medium text-gray-700">
                        {c.items?.length || 0} prod.
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-indigo-600">
                        S/ {Number(c.total).toFixed(2)}
                      </td>
                      <td className="p-4 text-gray-500">
                        {c.registrado_por || "Sistema"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

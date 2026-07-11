"use client";

import { useState, useEffect, useRef } from "react";
import { FiPlus, FiTrash2, FiSave, FiCalendar, FiBox, FiFileText, FiX } from "react-icons/fi";
import SearchableSelect from "@/components/SearchableSelect";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";
import { fetchParametrosNegocio, PARAMETROS_NEGOCIO_DEFAULT } from "@/lib/parametros-negocio";
import { esLineaSinPeso } from "@/lib/compras-lineas";

interface Proveedor {
  id: string;
  ruc: string;
  razon_social: string;
  activo?: boolean;
}

interface Producto {
  id: string;
  nombre: string;
  categoria: string;
}

type TipoFila = "ingreso" | "devolucion";

interface CompraItemInput {
  producto_id: string;
  jabas: number;
  peso_bruto: number;
  peso_tara: number;
  costo_unitario: number;
  /** 'devolucion' = mercadería devuelta al proveedor: RESTA del total y del stock. */
  tipo: TipoFila;
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
    tipo?: TipoFila;
  }[];
}

const CLAVE_ULTIMO_PROVEEDOR = "transavic_compras_ultimo_proveedor";

const filaVacia = (): CompraItemInput => ({
  producto_id: "",
  jabas: 0,
  peso_bruto: 0,
  peso_tara: 0,
  costo_unitario: 0,
  tipo: "ingreso",
});

export default function ComprasClient({ esAdmin = false }: { esAdmin?: boolean }) {
  const [activeTab, setActiveTab] = useState<"nuevo" | "historial">("nuevo");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [compras, setCompras] = useState<CompraRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [proveedorId, setProveedorId] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [tipoDoc, setTipoDoc] = useState("Factura");
  // Tipos de documento configurables desde /dashboard/configuracion.
  const [tiposDoc, setTiposDoc] = useState<string[]>(PARAMETROS_NEGOCIO_DEFAULT.tipos_doc_compra);
  const [nroDoc, setNroDoc] = useState("");
  const [items, setItems] = useState<CompraItemInput[]>([filaVacia()]);

  const [submitting, setSubmitting] = useState(false);
  const { mostrarToast, toasts } = useToast();

  // Mapa producto_id → último costo pagado al proveedor seleccionado
  const [ultimosCostos, setUltimosCostos] = useState<Record<string, number>>({});
  // Refs a las celdas de producto para enfocar el selector al agregar fila con Enter
  const celdasProductoRefs = useRef<(HTMLTableCellElement | null)[]>([]);

  // Modal "Nuevo producto" (autoservicio, admin): crea un producto sin salir de
  // Compras. Para insumos (arcos, mandil…) que faltan en el catálogo — pedido de
  // Nelita (11 jul 2026). `filaDestino` = fila que auto-selecciona el producto nuevo.
  const [modalProdAbierto, setModalProdAbierto] = useState(false);
  const [filaDestino, setFilaDestino] = useState<number | null>(null);
  const [nuevoProd, setNuevoProd] = useState({ nombre: "", categoria: "Insumos", unidad: "uni" });
  const [customCategoria, setCustomCategoria] = useState("");
  const [creandoProd, setCreandoProd] = useState(false);

  // Categorías existentes (para el select del modal) + "Insumos" garantizada.
  const categoriasExistentes = Array.from(
    new Set(["Insumos", ...productos.map((p) => p.categoria).filter(Boolean)])
  );

  useEffect(() => {
    fetchInitialData();
    fetchParametrosNegocio().then((p) => {
      setTiposDoc(p.tipos_doc_compra);
      setTipoDoc((prev) => (p.tipos_doc_compra.includes(prev) ? prev : p.tipos_doc_compra[0]));
    });
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

  // Abre el modal "Nuevo producto"; `fila` = fila que auto-selecciona el producto.
  const abrirModalProducto = (fila: number | null) => {
    setFilaDestino(fila);
    setNuevoProd({ nombre: "", categoria: "Insumos", unidad: "uni" });
    setCustomCategoria("");
    setModalProdAbierto(true);
  };

  const handleCrearProducto = async () => {
    const nombre = nuevoProd.nombre.trim();
    const categoria =
      nuevoProd.categoria === "__custom__" ? customCategoria.trim() : nuevoProd.categoria.trim();
    const unidad = nuevoProd.unidad.trim() || "uni";
    if (!nombre) {
      mostrarToast("Escribe el nombre del producto.", "error");
      return;
    }
    if (!categoria) {
      mostrarToast("Escribe la categoría.", "error");
      return;
    }
    setCreandoProd(true);
    try {
      const res = await fetch("/api/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, categoria, unidad }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : "No se pudo crear el producto (¿ya existe uno igual?).";
        mostrarToast(msg, "error");
        return;
      }
      const creado = (data?.data ?? data) as Producto;
      setProductos((prev) => [...prev, { id: creado.id, nombre: creado.nombre, categoria: creado.categoria }]);
      // Auto-seleccionar el nuevo producto en la fila desde donde se abrió.
      if (filaDestino != null) {
        handleItemChange(filaDestino, "producto_id", creado.id);
      }
      mostrarToast(`"${creado.nombre}" creado y agregado al catálogo.`, "exito");
      setModalProdAbierto(false);
    } catch {
      mostrarToast("Sin conexión. Revisa tu internet e intenta de nuevo.", "error");
    } finally {
      setCreandoProd(false);
    }
  };

  // ¿La fila es una línea SIN peso (servicio/insumo/adicional)? → cantidad × precio.
  const esFilaServicio = (productoId: string) =>
    esLineaSinPeso(productos.find((p) => p.id === productoId)?.categoria);

  const handleItemChange = (index: number, field: keyof CompraItemInput, value: string | number) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      [field]: value
    };
    if (field === "producto_id" && typeof value === "string") {
      // Al elegir producto con el costo vacío, precargar el último costo del proveedor
      const ultimo = ultimosCostos[value];
      if (ultimo != null && !newItems[index].costo_unitario) {
        newItems[index] = { ...newItems[index], costo_unitario: ultimo };
      }
      // Un servicio no lleva jabas ni tara: se digita cantidad × precio.
      if (esFilaServicio(value)) {
        newItems[index] = { ...newItems[index], jabas: 0, peso_tara: 0 };
      }
    }
    setItems(newItems);
  };

  // Totales con signo: las filas de devolución RESTAN del total de la guía.
  const totales = items.reduce(
    (acc, item) => {
      const neto = Math.max(0, item.peso_bruto - item.peso_tara);
      const sub = neto * item.costo_unitario;
      if (item.tipo === "devolucion") acc.devoluciones += sub;
      else acc.ingresos += sub;
      return acc;
    },
    { ingresos: 0, devoluciones: 0 }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // Ignorar renglones totalmente vacíos (ej. la fila extra que deja Enter):
    // una fila sin producto ni datos no debe bloquear el registro.
    const itemsValidos = items.filter(
      (it) => it.producto_id || it.peso_bruto > 0 || it.peso_tara > 0 || it.jabas > 0 || it.costo_unitario > 0
    );
    if (itemsValidos.length === 0) {
      mostrarToast("Agrega al menos un producto a la carga.", "error");
      setSubmitting(false);
      return;
    }

    // Validar items
    for (const item of itemsValidos) {
      if (!item.producto_id) {
        mostrarToast("Debes seleccionar un producto para todos los renglones.", "error");
        setSubmitting(false);
        return;
      }
      // Los servicios no llevan tara (el campo va deshabilitado en 0).
      if (!esFilaServicio(item.producto_id) && item.peso_bruto <= item.peso_tara) {
        mostrarToast("El peso bruto debe ser mayor al peso tara.", "error");
        setSubmitting(false);
        return;
      }
    }

    // La guía no puede quedar en negativo (la deuda nunca es "a favor").
    if (totalCompra < 0) {
      mostrarToast("Las devoluciones no pueden superar el ingreso de la guía.", "error");
      setSubmitting(false);
      return;
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
          items: itemsValidos
        })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Error al registrar la compra.");
      }

      mostrarToast("Compra registrada. Inventario actualizado y deuda al proveedor anotada.", "exito");

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

  const totalCompra = totales.ingresos - totales.devoluciones;

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
                  options={proveedores
                    .filter((p) => p.activo !== false)
                    .map(p => ({
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
                  {tiposDoc.map((t) => (
                    <option key={t} value={t}>{t === "Guia" ? "Guía de Remisión" : t}</option>
                  ))}
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
              <div className="flex items-center gap-2">
                {esAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      // Auto-selecciona en la primera fila sin producto (si hay).
                      const vacia = items.findIndex((it) => !it.producto_id);
                      abrirModalProducto(vacia >= 0 ? vacia : null);
                    }}
                    title="Crear un producto que falta en el catálogo (insumos, etc.)"
                    className="text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg font-bold transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                  >
                    <FiBox /> Nuevo producto
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-2 rounded-lg font-bold transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                >
                  <FiPlus /> Agregar Fila
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 font-semibold">
                    <th className="pb-3 pr-4 w-1/3">Producto</th>
                    <th className="pb-3 pr-4">Tipo</th>
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
                    const servicio = esFilaServicio(item.producto_id);
                    const esDevolucion = item.tipo === "devolucion";
                    const neto = Math.max(0, item.peso_bruto - item.peso_tara);
                    const subtotal = neto * item.costo_unitario;
                    const taraInvalida = !servicio && item.peso_bruto > 0 && item.peso_tara > 0 && item.peso_tara >= item.peso_bruto;
                    const ultimoCosto = item.producto_id ? ultimosCostos[item.producto_id] : undefined;

                    return (
                      <tr key={idx} className={`align-middle ${esDevolucion ? "bg-red-50/60" : ""}`}>
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
                          {servicio && (
                            <p className="text-[10px] text-indigo-500 font-semibold mt-1">
                              Servicio: cantidad × precio, no entra al inventario
                            </p>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <select
                            value={item.tipo}
                            onChange={(e) => handleItemChange(idx, "tipo", e.target.value as TipoFila)}
                            title="Devolución: resta del total de la guía y del inventario"
                            className={`block w-28 rounded-xl py-2.5 px-2 shadow-sm text-xs font-bold cursor-pointer ${
                              esDevolucion
                                ? "border-red-300 bg-red-50 text-red-700 focus:border-red-500 focus:ring-red-500"
                                : "border-gray-300 bg-gray-50 text-gray-700 focus:border-indigo-500 focus:ring-indigo-500"
                            }`}
                          >
                            <option value="ingreso">Ingreso</option>
                            <option value="devolucion">Devolución</option>
                          </select>
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            type="number"
                            min="0"
                            disabled={servicio}
                            value={servicio ? "" : item.jabas || ""}
                            onChange={(e) => handleItemChange(idx, "jabas", Number(e.target.value))}
                            className="block w-20 ml-auto text-right rounded-xl border-gray-300 py-2.5 px-3 text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 bg-gray-50 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder={servicio ? "Cant." : "0.00"}
                            title={servicio ? "Cantidad del servicio (ej. pollos pelados)" : "Peso bruto en kg"}
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
                            disabled={servicio}
                            placeholder="0.00"
                            value={servicio ? "" : item.peso_tara || ""}
                            onChange={(e) => handleItemChange(idx, "peso_tara", Number(e.target.value))}
                            className={`block w-24 ml-auto text-right rounded-xl py-2.5 px-3 text-gray-900 shadow-sm bg-gray-50 text-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                              taraInvalida
                                ? "border-red-500 ring-1 ring-red-400 focus:border-red-500 focus:ring-red-500"
                                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                            }`}
                          />
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <span className={`font-mono font-medium ${taraInvalida ? "text-red-600" : "text-gray-600"}`}>
                            {neto.toFixed(2)} {servicio ? "uni" : "kg"}
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
                        <td className={`py-3 pr-4 text-right font-mono font-bold ${esDevolucion ? "text-red-600" : "text-gray-800"}`}>
                          {esDevolucion ? "− " : ""}S/ {subtotal.toFixed(2)}
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
                {totales.devoluciones > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Ingresos:</span>
                      <span className="font-mono">S/ {totales.ingresos.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-red-600">
                      <span>Devoluciones:</span>
                      <span className="font-mono">− S/ {totales.devoluciones.toFixed(2)}</span>
                    </div>
                  </>
                )}
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
                    <th className="p-4 font-semibold text-gray-600 text-right">Productos</th>
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
                        {c.items?.some((it) => it.tipo === "devolucion") && (
                          <span className="block text-[10px] font-bold text-red-600">
                            incl. devolución
                          </span>
                        )}
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

      {/* Modal "Nuevo producto" (autoservicio, admin) — crea un producto que falta
          en el catálogo sin salir de Compras (pedido de Nelita, 11 jul 2026). */}
      {modalProdAbierto && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4"
          onClick={() => !creandoProd && setModalProdAbierto(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gray-50 p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FiBox className="text-emerald-600" /> Nuevo producto
              </h2>
              <button
                onClick={() => setModalProdAbierto(false)}
                disabled={creandoProd}
                className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer rounded-lg hover:bg-gray-100 transition-all"
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500 bg-emerald-50/60 border border-emerald-100 p-3 rounded-2xl">
                Para ítems que faltan en el catálogo (insumos como arcos, mandil…). Los de
                categoría <b>Insumos</b>, <b>Servicios</b> o <b>producto adicional</b> se cargan
                por cantidad × precio (sin pesar) y no tocan el inventario.
              </p>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Nombre</label>
                <input
                  type="text"
                  autoFocus
                  value={nuevoProd.nombre}
                  onChange={(e) => setNuevoProd({ ...nuevoProd, nombre: e.target.value })}
                  placeholder="Ej: Mandil"
                  className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Categoría</label>
                  <select
                    value={nuevoProd.categoria}
                    onChange={(e) => setNuevoProd({ ...nuevoProd, categoria: e.target.value })}
                    className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 bg-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  >
                    {categoriasExistentes.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value="__custom__">➕ Nueva categoría…</option>
                  </select>
                  {nuevoProd.categoria === "__custom__" && (
                    <input
                      type="text"
                      value={customCategoria}
                      onChange={(e) => setCustomCategoria(e.target.value)}
                      placeholder="Nombre de la categoría"
                      className="block w-full mt-2 rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Unidad</label>
                  <input
                    type="text"
                    value={nuevoProd.unidad}
                    onChange={(e) => setNuevoProd({ ...nuevoProd, unidad: e.target.value })}
                    placeholder="uni"
                    className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setModalProdAbierto(false)}
                  disabled={creandoProd}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all cursor-pointer active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCrearProducto}
                  disabled={creandoProd}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95"
                >
                  {creandoProd ? "Creando…" : "Crear producto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

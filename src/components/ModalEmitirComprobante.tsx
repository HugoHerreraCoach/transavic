// src/components/ModalEmitirComprobante.tsx
// Modal interactivo, editable e inteligente para emitir Factura o Boleta de un pedido.
//
// Principios "No me hagas pensar":
//   - Carga reactiva de los ítems del pedido en preparación/entrega.
//   - Edición en línea de cantidades y precios para ajustar pesos reales de producción.
//   - Autocategorización y adición de ítems desde catálogo con datalist para pedidos en texto libre.
//   - Toggle dinámico Contado/Crédito y ya cobrado con creación automática de cobranzas.
"use client";

import { useState, useEffect } from "react";
import {
  FiFileText,
  FiX,
  FiCheckCircle,
  FiAlertCircle,
  FiLoader,
  FiPlus,
  FiTrash2,
  FiDollarSign,
  FiCalendar,
  FiAlertTriangle,
} from "react-icons/fi";

interface PedidoBasico {
  id: string;
  cliente: string;
  razon_social?: string | null;
  ruc_dni?: string | null;
  empresa?: string;
  estado?: string;
}

interface ItemPedido {
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number; // Con IGV
  codigo?: string | null;
}

interface ProductoCatalogo {
  id: string;
  nombre: string;
  unidad: string;
  activo: boolean;
  codigo?: string | null;
  precio_venta?: number | string | null;
}

interface ApiPedidoItem {
  producto_nombre: string;
  cantidad: string | number;
  unidad: string;
  precio_unitario?: string | number | null;
  codigo?: string | null;
}

interface Props {
  pedido: PedidoBasico;
  onClose: () => void;
  onSuccess?: (resultado: { serieNumero: string; estado: string }) => void;
}

export default function ModalEmitirComprobante({
  pedido,
  onClose,
  onSuccess,
}: Props) {
  const tieneRucValido = !!pedido.ruc_dni && pedido.ruc_dni.trim().length === 11;
  const isAvicola = (pedido.empresa || "").trim().toLowerCase().startsWith("av");

  const theme = {
    text: isAvicola ? "text-amber-600" : "text-red-600",
    textHover: isAvicola ? "hover:text-amber-700" : "hover:text-red-700",
    bg: isAvicola ? "bg-amber-500" : "bg-red-600",
    bgHover: isAvicola ? "hover:bg-amber-600" : "hover:bg-red-700",
    bgLight: isAvicola ? "bg-amber-50" : "bg-red-50",
    bgLight50: isAvicola ? "bg-amber-50/50" : "bg-red-50/50",
    border: isAvicola ? "border-amber-500" : "border-red-500",
    borderLight: isAvicola ? "border-amber-100" : "border-red-100",
    border150: isAvicola ? "border-amber-150" : "border-red-150",
    textDark: isAvicola ? "text-amber-700" : "text-red-700",
    textVeryDark: isAvicola ? "text-amber-800" : "text-red-800",
    ring: isAvicola ? "focus:ring-amber-500" : "focus:ring-red-500",
    badgeBg: isAvicola ? "bg-amber-50 border border-amber-100" : "bg-red-50 border border-red-100",
    buttonDisabled: isAvicola ? "disabled:bg-amber-300" : "disabled:bg-red-300",
    borderActive: isAvicola ? "border-amber-500 bg-amber-50/50" : "border-red-500 bg-red-50/50",
    accentGlow: isAvicola ? "from-amber-50 to-white" : "from-red-50/30 to-white",
  };
  
  // Estados principales
  const [tipo, setTipo] = useState<"01" | "03">(tieneRucValido ? "01" : "03");
  const [items, setItems] = useState<ItemPedido[]>([]);
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [emitiendo, setEmitiendo] = useState(false);
  
  // Forma de pago y cobranzas
  const [formaPago, setFormaPago] = useState<"Contado" | "Credito">("Contado");
  const [plazoDias, setPlazoDias] = useState<number>(7);
  const [yaCobrado, setYaCobrado] = useState<boolean>(false);
  
  // Agregar producto manual
  const [searchProd, setSearchProd] = useState("");
  const [manualPrecio, setManualPrecio] = useState<string>("");
  const [manualCant, setManualCant] = useState<string>("1");
  
  const [resultado, setResultado] = useState<
    | { exito: true; serieNumero: string; estado: string; mensaje?: string }
    | { exito: false; error: string }
    | null
  >(null);

  // Cargar ítems y catálogo
  useEffect(() => {
    let active = true;
    
    async function loadData() {
      try {
        setCargandoDatos(true);
        
        // 1) Cargar pedido e items
        const pedRes = await fetch(`/api/pedidos/${pedido.id}`);
        const pedData = await pedRes.json();
        
        // 2) Cargar productos activos del catálogo
        const catRes = await fetch("/api/productos");
        const catData = await catRes.json();
        
        if (!active) return;

        if (catRes.ok && catData && Array.isArray(catData.data)) {
          // Filtrar solo activos y mapear
          setCatalogo(catData.data.filter((p: ProductoCatalogo) => p.activo !== false));
        } else if (catRes.ok && Array.isArray(catData)) {
          setCatalogo(catData.filter((p: ProductoCatalogo) => p.activo !== false));
        }

        if (pedRes.ok && pedData.items) {
          const itemsMapeados = pedData.items.map((it: ApiPedidoItem) => ({
            producto_nombre: it.producto_nombre,
            cantidad: Number(it.cantidad),
            unidad: it.unidad,
            precio_unitario: Number(it.precio_unitario || 0),
            codigo: it.codigo || null
          }));
          setItems(itemsMapeados);
        }
      } catch (err) {
        console.error("Error cargando datos del modal:", err);
      } finally {
        if (active) setCargandoDatos(false);
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, [pedido.id]);

  // Tecla Escape para cerrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !emitiendo) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, emitiendo]);

  // Manejadores de ítems
  const handleUpdateItem = (
    idx: number,
    field: keyof ItemPedido,
    val: string | number | null
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item))
    );
  };

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Manejar adición de productos del catálogo
  const handleAddItemFromInput = () => {
    if (!searchProd.trim()) return;
    
    // Buscar en catálogo exacto
    const p = catalogo.find(
      (x) => x.nombre.trim().toLowerCase() === searchProd.trim().toLowerCase()
    );

    const qty = Number(manualCant) > 0 ? Number(manualCant) : 1;
    let price = 0;
    if (manualPrecio) {
      price = Number(manualPrecio);
    } else if (p?.precio_venta) {
      price = Number(p.precio_venta);
    }

    const nuevo: ItemPedido = {
      producto_nombre: p ? p.nombre : searchProd.trim(),
      cantidad: qty,
      unidad: p ? (p.unidad === "kg" ? "kg" : p.unidad) : "uni",
      precio_unitario: price,
      codigo: p?.codigo || null,
    };

    setItems((prev) => [...prev, nuevo]);
    
    // Limpiar campos
    setSearchProd("");
    setManualPrecio("");
    setManualCant("1");
  };

  // Autocompletar precio y unidad al escribir o seleccionar
  const handleSearchChange = (val: string) => {
    setSearchProd(val);
    const p = catalogo.find(
      (x) => x.nombre.trim().toLowerCase() === val.trim().toLowerCase()
    );
    if (p) {
      if (p.precio_venta) setManualPrecio(String(p.precio_venta));
    }
  };

  // Totales en vivo (con IGV)
  const totalConIgv = items.reduce(
    (sum, it) => sum + (it.precio_unitario || 0) * (it.cantidad || 0),
    0
  );
  const subtotal = totalConIgv / 1.18;
  const igv = totalConIgv - subtotal;

  const emitir = async () => {
    if (items.length === 0) {
      alert("Debes agregar al menos un producto para poder facturar.");
      return;
    }
    if (items.some((it) => !it.precio_unitario || it.precio_unitario <= 0)) {
      alert("Todos los productos deben tener un precio válido y mayor a S/ 0.");
      return;
    }

    setEmitiendo(true);
    setResultado(null);
    try {
      const payload = {
        pedido_id: pedido.id,
        tipo,
        formaPago,
        plazoDias: formaPago === "Credito" ? plazoDias : 0,
        yaCobrado: formaPago === "Contado" ? yaCobrado : false,
        items_override: items.map((it) => ({
          producto_nombre: it.producto_nombre,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_unitario: it.precio_unitario,
          codigo: it.codigo || undefined,
        })),
      };

      const res = await fetch("/api/comprobantes/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        const errorMsg =
          typeof json.error === "string"
            ? json.error
            : typeof json.error === "object"
              ? Object.values(json.error).flat().join(" · ")
              : `Error HTTP ${res.status}`;
        throw new Error(errorMsg);
      }

      setResultado({
        exito: true,
        serieNumero: json.serieNumero,
        estado: json.estado,
        mensaje: json.mensaje,
      });
      onSuccess?.({ serieNumero: json.serieNumero, estado: json.estado });
    } catch (err) {
      setResultado({
        exito: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEmitiendo(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => !emitiendo && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
          <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
            <FiFileText className={`${theme.text} text-xl animate-pulse`} />
            <span>Emitir Comprobante — Pedido</span>
          </h3>
          <button
            onClick={onClose}
            disabled={emitiendo}
            aria-label="Cerrar"
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        {/* Contenido con scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {resultado?.exito ? (
            /* Pantalla Éxito */
            <div className="text-center py-6 max-w-sm mx-auto space-y-4">
              <FiCheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <div>
                <h4 className="text-xl font-bold text-gray-800">
                  ¡Comprobante emitido con éxito!
                </h4>
                <p className={`text-3xl font-mono font-black ${theme.textDark} mt-2 ${theme.bgLight} py-1.5 px-3 rounded-lg border ${theme.borderLight} inline-block tracking-wider`}>
                  {resultado.serieNumero}
                </p>
              </div>
              <p className="text-sm text-gray-600">
                Estado SUNAT: <strong className="text-green-700 font-semibold uppercase">{resultado.estado}</strong>
              </p>
              {resultado.mensaje && (
                <div className="text-xs text-blue-700 px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg text-left leading-relaxed">
                  {resultado.mensaje}
                </div>
              )}
              <button
                onClick={onClose}
                className={`mt-6 w-full px-5 py-3.5 ${theme.bg} text-white rounded-xl ${theme.bgHover} font-bold transition-all shadow-md hover:shadow-lg active:scale-98`}
              >
                Listo
              </button>
            </div>
          ) : resultado && !resultado.exito ? (
            /* Pantalla Error */
            <div className="text-center py-6 max-w-md mx-auto space-y-4">
              <FiAlertCircle className="h-16 w-16 text-red-500 mx-auto" />
              <div>
                <h4 className="text-lg font-bold text-gray-800">
                  Error de facturación electrónica
                </h4>
                <div className="text-sm text-red-700 font-medium px-4 py-3 bg-red-50 border border-red-150 rounded-lg text-left mt-2 leading-relaxed whitespace-pre-wrap">
                  {resultado.error}
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold transition-colors"
                >
                  Cerrar
                </button>
                <button
                  onClick={() => setResultado(null)}
                  className={`flex-1 px-4 py-3 ${theme.bg} text-white rounded-xl ${theme.bgHover} font-bold transition-all shadow-md hover:shadow-lg active:scale-98`}
                >
                  Volver a intentar
                </button>
              </div>
            </div>
          ) : cargandoDatos ? (
            /* Loader de Datos */
            <div className="text-center py-16 space-y-3">
              <FiLoader className={`h-10 w-10 ${theme.text} animate-spin mx-auto`} />
              <p className="text-sm text-gray-500 font-medium">Cargando productos y catálogo...</p>
            </div>
          ) : (
            /* Formulario Completo Interactuable */
            <>
              {/* Información del Cliente */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cliente</div>
                  <div className="font-bold text-gray-800 mt-0.5">
                    {pedido.razon_social || pedido.cliente}
                  </div>
                  {pedido.ruc_dni && (
                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                      {tieneRucValido ? "RUC" : "DNI"}: {pedido.ruc_dni}
                    </div>
                  )}
                </div>
                <div className="sm:border-l sm:pl-4 border-gray-200 flex flex-col justify-center">
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Origen del Pedido</div>
                  <div className="font-medium text-gray-700 mt-0.5">
                    🏢 {pedido.empresa || "Transavic"} · Estado: <span className="font-semibold">{pedido.estado}</span>
                  </div>
                </div>
              </div>

              {/* Selector tipo de comprobante */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Tipo de Comprobante
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTipo("01")}
                    disabled={!tieneRucValido}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all ${
                      tipo === "01"
                        ? `${theme.border} ${theme.bgLight50} shadow-sm`
                        : "border-gray-200 hover:border-gray-300"
                    } ${!tieneRucValido ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">📄</span>
                      <div>
                        <div className="font-bold text-gray-800 text-sm">Factura (01)</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {tieneRucValido ? "Empresa con RUC" : "Falta RUC (11 dígs)"}
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipo("03")}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                      tipo === "03"
                        ? `${theme.border} ${theme.bgLight50} shadow-sm`
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🧾</span>
                      <div>
                        <div className="font-bold text-gray-800 text-sm">Boleta (03)</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          Persona Natural / Boleta Libre
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
                {!tieneRucValido && tipo === "01" && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-1.5 leading-relaxed">
                    <FiAlertTriangle className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <span>
                      Este cliente no tiene un RUC de 11 dígitos. Solo se puede emitir <strong>Boleta</strong>. Si requieres factura, cierra el modal, edita el cliente e ingresa su RUC.
                    </span>
                  </div>
                )}
              </div>

              {/* LISTA DE ÍTEMS EDITABLES */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Detalle de Productos a Facturar
                  </label>
                  <span className="text-xs text-gray-400 font-medium">
                    {items.length} producto{items.length !== 1 && "s"}
                  </span>
                </div>
                
                {items.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500 bg-gray-50/50 space-y-1">
                    <p className="font-semibold text-gray-600">Este pedido se creó en texto libre</p>
                    <p className="text-xs text-gray-400">
                      Usa la barra inferior para buscar y agregar los productos del catálogo.
                    </p>
                  </div>
                ) : (
                  <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm max-h-56 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-gray-50 border-b border-gray-150 text-gray-500 font-bold uppercase tracking-wider">
                        <tr>
                          <th className="px-3 py-2.5">Producto</th>
                          <th className="px-3 py-2.5 w-20">Cant.</th>
                          <th className="px-3 py-2.5 w-14">Und.</th>
                          <th className="px-3 py-2.5 w-24">Precio + IGV</th>
                          <th className="px-3 py-2.5 w-24 text-right">Subtotal</th>
                          <th className="px-3 py-2.5 w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700">
                        {items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-gray-50/55">
                            <td className="px-3 py-2 font-medium">{it.producto_nombre}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="any"
                                value={it.cantidad || ""}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    idx,
                                    "cantidad",
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="w-full p-1 border rounded bg-white text-gray-900 font-medium text-center"
                                required
                              />
                            </td>
                            <td className="px-3 py-2 text-gray-400 capitalize">{it.unidad}</td>
                            <td className="px-3 py-2">
                              <div className="relative">
                                <span className="absolute left-1.5 top-1.5 text-[9px] text-gray-400 font-bold">S/</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={it.precio_unitario || ""}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      idx,
                                      "precio_unitario",
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-full p-1 pl-5 border rounded bg-white text-gray-900 font-medium"
                                  required
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-800">
                              S/ {((it.precio_unitario || 0) * (it.cantidad || 0)).toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(idx)}
                                className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-md hover:bg-red-50"
                                title="Eliminar ítem"
                              >
                                <FiTrash2 />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* BUSCADOR Y AGREGADOR DE PRODUCTOS AL VUELO */}
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-150 space-y-2">
                <div className="text-xs font-bold text-gray-600">
                  Agregar producto del catálogo
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <input
                      list="catalogo-productos-modal"
                      placeholder="Buscar producto por nombre..."
                      value={searchProd}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="w-full p-2 text-xs border rounded bg-white text-black font-medium"
                    />
                    <datalist id="catalogo-productos-modal">
                      {catalogo.map((p) => (
                        <option key={p.id} value={p.nombre}>
                          {p.precio_venta ? `S/ ${p.precio_venta} por ${p.unidad}` : ""}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  
                  <div className="flex gap-2">
                    <div className="w-16 relative">
                      <input
                        type="number"
                        placeholder="Cant."
                        value={manualCant}
                        onChange={(e) => setManualCant(e.target.value)}
                        className="w-full p-2 text-xs border rounded bg-white text-black text-center font-semibold"
                        title="Cantidad"
                        min="0.1"
                        step="any"
                      />
                    </div>
                    
                    <div className="w-24 relative">
                      <span className="absolute left-1.5 top-2.5 text-[9px] text-gray-400 font-bold">S/</span>
                      <input
                        type="number"
                        placeholder="Precio con IGV"
                        value={manualPrecio}
                        onChange={(e) => setManualPrecio(e.target.value)}
                        className="w-full p-2 pl-4 text-xs border rounded bg-white text-black font-semibold"
                        title="Precio Unitario con IGV (opcional)"
                        step="0.01"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleAddItemFromInput}
                      className={`px-3.5 ${theme.bg} text-white rounded-lg ${theme.bgHover} font-semibold text-xs flex items-center gap-1 transition-colors`}
                    >
                      <FiPlus /> Agregar
                    </button>
                  </div>
                </div>
              </div>

              {/* SECCIÓN DE COBRANZAS Y FORMAS DE PAGO */}
              <div className={`${theme.bgLight50} border ${theme.borderLight} rounded-xl p-4 space-y-3`}>
                <div className={`text-xs font-bold ${theme.textVeryDark} uppercase tracking-wider flex items-center gap-1.5`}>
                  <FiDollarSign className={theme.text} />
                  Condiciones de Pago e Integración Financiera
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Forma de pago */}
                  <div>
                    <label className="block text-gray-600 font-semibold mb-1">Forma de Pago:</label>
                    <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setFormaPago("Contado")}
                        className={`flex-1 py-1.5 rounded-md font-bold text-center transition-colors cursor-pointer ${
                          formaPago === "Contado"
                            ? `${theme.bg} text-white shadow-sm`
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Contado
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormaPago("Credito")}
                        className={`flex-1 py-1.5 rounded-md font-bold text-center transition-colors cursor-pointer ${
                          formaPago === "Credito"
                            ? `${theme.bg} text-white shadow-sm`
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Crédito
                      </button>
                    </div>
                  </div>

                  {/* Campo de Plazo o Ya Cobrado */}
                  {formaPago === "Credito" ? (
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1 flex items-center gap-1">
                        <FiCalendar /> Plazo de Pago (Días):
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={plazoDias}
                        onChange={(e) => setPlazoDias(parseInt(e.target.value) || 7)}
                        className="w-full p-2 border border-gray-200 rounded-lg bg-white text-black font-semibold"
                        required
                      />
                    </div>
                  ) : (
                    <div className="flex items-center pt-5">
                      {tipo === "01" ? (
                        <label className="flex items-center gap-2 cursor-pointer font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            checked={yaCobrado}
                            onChange={(e) => setYaCobrado(e.target.checked)}
                            className={`rounded ${theme.text} ${theme.ring} h-4 w-4 border-gray-300`}
                          />
                          <div>
                            <span>¿Ya cobrado en efectivo/mano?</span>
                            <span className="block text-[9px] font-normal text-gray-400 leading-none mt-0.5">
                              Si se marca, NO se registrará deuda en Cobranzas.
                            </span>
                          </div>
                        </label>
                      ) : (
                        <div className="text-[10px] text-gray-400 leading-normal bg-white p-2 rounded-lg border border-gray-100">
                          ℹ️ Las Boletas al contado se consideran cobradas en el acto y no generan cobranza en el sistema.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Bloque Resumen Totales */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-150 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex gap-4 text-xs text-gray-500 font-medium">
                  <div>
                    Subtotal: <strong className="text-gray-700 font-semibold">S/ {subtotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    IGV (18%): <strong className="text-gray-700 font-semibold">S/ {igv.toFixed(2)}</strong>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total a Emitir</div>
                  <div className={`text-2xl font-black ${theme.textDark} font-mono`}>
                    S/ {totalConIgv.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  disabled={emitiendo}
                  className="flex-1 px-4 py-3.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold transition-all disabled:opacity-50 active:scale-98"
                >
                  Cancelar
                </button>
                <button
                  onClick={emitir}
                  disabled={emitiendo || items.length === 0 || (tipo === "01" && !tieneRucValido)}
                  className={`flex-1 px-4 py-3.5 ${theme.bg} text-white rounded-xl ${theme.bgHover} font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md hover:shadow-lg active:scale-98 ${theme.buttonDisabled} disabled:cursor-not-allowed`}
                >
                  {emitiendo ? (
                    <>
                      <FiLoader className="h-4 w-4 animate-spin" />
                      Emitiendo en SUNAT…
                    </>
                  ) : (
                    <>Emitir {tipo === "01" ? "Factura" : "Boleta"}</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

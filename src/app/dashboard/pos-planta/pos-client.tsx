// src/app/dashboard/pos-planta/pos-client.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { FiTrash2, FiShoppingCart, FiWifiOff, FiCheck, FiUser, FiFileText, FiSearch, FiX, FiStar, FiRefreshCw } from "react-icons/fi";
import { enqueueAction, getQueue, removeAction } from "@/lib/offline-queue";
import SearchableSelect from "@/components/SearchableSelect";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

type Producto = {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number;
  unidades: string;
};

type CartItem = {
  cartId: string;
  productoId: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number;
};

type Cuenta = {
  id: string;
  nombre: string;
  tipo?: string;
};

type Cliente = {
  id: string;
  nombre: string;
  ruc_dni?: string;
  razon_social?: string;
};

const FAVORITOS_KEY = "transavic_pos_favoritos";
const MAX_FAVORITOS = 8;

// Ventas de mostrador encoladas en la cola offline compartida (transavic_offline_queue)
function contarPendientesPos(): number {
  return getQueue().filter((a) => a.type === "pos-venta").length;
}

function TarjetaProducto({
  producto,
  esFavorito,
  onAdd,
  onToggleFavorito,
}: {
  producto: Producto;
  esFavorito: boolean;
  onAdd: (p: Producto) => void;
  onToggleFavorito: (id: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onAdd(producto)}
        className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-left hover:bg-indigo-50 hover:border-indigo-200 transition-colors active:scale-95 flex flex-col justify-between aspect-square cursor-pointer"
      >
        <div>
          <span className="text-xs font-semibold text-gray-500 mb-1 block pr-8">{producto.categoria}</span>
          <span className="font-bold text-gray-900 leading-tight">{producto.nombre}</span>
        </div>
        <div className="mt-2 text-indigo-600 font-extrabold text-lg">
          S/ {Number(producto.precio_venta).toFixed(2)} <span className="text-sm font-medium text-gray-500">/{producto.unidades}</span>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onToggleFavorito(producto.id)}
        aria-label={esFavorito ? "Quitar de favoritos" : "Agregar a favoritos"}
        title={esFavorito ? "Quitar de favoritos" : "Agregar a favoritos"}
        className="absolute top-2 right-2 p-2 rounded-full bg-white/90 border border-gray-200 shadow-sm cursor-pointer active:scale-90 transition-transform hover:border-amber-300"
      >
        <FiStar size={16} className={esFavorito ? "fill-amber-400 text-amber-500" : "text-gray-400"} />
      </button>
    </div>
  );
}

export default function PosClient({ productosInit }: { productosInit: Producto[] }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [empresa, setEmpresa] = useState<"Transavic" | "Avícola de Tony">("Transavic");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [selectedCuenta, setSelectedCuenta] = useState<string>("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selectedClienteId, setSelectedClienteId] = useState<string>("");
  const [tipoPago, setTipoPago] = useState<"Contado" | "Credito">("Contado");
  const [notasGenerales, setNotasGenerales] = useState<string>("");
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const { mostrarToast, toasts } = useToast();

  // Filtros de Catálogo
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoria, setSelectedCategoria] = useState("Todos");

  // Categorías dinámicas a partir de productosInit
  const categorias = useMemo(() => {
    const cats = new Set<string>();
    productosInit.forEach(p => {
      if (p.categoria) cats.add(p.categoria);
    });
    return ["Todos", ...Array.from(cats)];
  }, [productosInit]);

  // Filtrado reactivo de productos
  const productosFiltrados = useMemo(() => {
    return productosInit.filter(p => {
      const matchesSearch = p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.categoria.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategoria === "Todos" || p.categoria === selectedCategoria;
      return matchesSearch && matchesCategory;
    });
  }, [productosInit, searchQuery, selectedCategoria]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Cargar empresa predeterminada desde localStorage
    const savedEmpresa = localStorage.getItem("transavic_pos_default_empresa");
    if (savedEmpresa === "Transavic" || savedEmpresa === "Avícola de Tony") {
      setEmpresa(savedEmpresa);
    }

    // Cargar favoritos del POS
    try {
      const rawFavoritos = localStorage.getItem(FAVORITOS_KEY);
      if (rawFavoritos) {
        const ids = JSON.parse(rawFavoritos);
        if (Array.isArray(ids)) {
          setFavoritos(ids.filter((id): id is string => typeof id === "string").slice(0, MAX_FAVORITOS));
        }
      }
    } catch {
      // Favoritos corruptos en localStorage: se ignoran
    }

    // Ventas offline pendientes de sincronizar
    setPendientes(contarPendientesPos());

    // Cargar cuentas
    fetch("/api/cuentas")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCuentas(data);
          if (data.length > 0) {
            // Preseleccionar la caja de EFECTIVO: es el caso normal del mostrador.
            const efectivo = (data as Cuenta[]).find((c) => c.tipo === "efectivo");
            setSelectedCuenta((efectivo ?? data[0]).id);
          }
        }
      });

    // Cargar clientes recurrentes
    fetch("/api/clientes?limit=500")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setClientes(data);
        } else if (data && Array.isArray(data.data)) {
          setClientes(data.data);
        }
      });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const toggleFavorito = (productoId: string) => {
    const esFavorito = favoritos.includes(productoId);
    if (!esFavorito && favoritos.length >= MAX_FAVORITOS) {
      mostrarToast("Máximo 8 favoritos", "info");
      return;
    }
    const nuevos = esFavorito
      ? favoritos.filter((id) => id !== productoId)
      : [...favoritos, productoId];
    setFavoritos(nuevos);
    try {
      localStorage.setItem(FAVORITOS_KEY, JSON.stringify(nuevos));
    } catch {
      // Sin espacio en localStorage: el favorito queda solo en memoria
    }
  };

  // Favoritos SIEMPRE visibles arriba del grid: no los afectan búsqueda ni categoría
  const productosFavoritos = useMemo(
    () =>
      favoritos
        .map((id) => productosInit.find((p) => p.id === id))
        .filter((p): p is Producto => Boolean(p)),
    [favoritos, productosInit]
  );

  const addToCart = (prod: Producto) => {
    const newItem: CartItem = {
      cartId: Date.now().toString() + Math.random(),
      productoId: prod.id,
      nombre: prod.nombre,
      cantidad: 1,
      unidad: prod.unidades,
      precioUnitario: Number(prod.precio_venta),
    };
    setCart([newItem, ...cart]);
    // En pantallas < lg el carrito queda debajo del catálogo: confirmar el agregado con un toast
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      mostrarToast(`Agregado: ${prod.nombre}`, "exito");
    }
  };

  const removeFromCart = (cartId: string) => {
    setCart(cart.filter(i => i.cartId !== cartId));
  };

  const updateQuantity = (cartId: string, val: string) => {
    setCart(cart.map(i => i.cartId === cartId ? { ...i, cantidad: Number(val) } : i));
  };

  const updatePrice = (cartId: string, val: string) => {
    setCart(cart.map(i => i.cartId === cartId ? { ...i, precioUnitario: Number(val) } : i));
  };

  const total = cart.reduce((acc, item) => acc + (item.cantidad * item.precioUnitario), 0);

  // Tras cada venta se vuelve al caso normal: Venta al Paso + Contado (decisión
  // de Hugo, 5 jul 2026 — evita anotarle por descuido la venta al cliente anterior).
  const resetVenta = () => {
    setCart([]);
    setNotasGenerales("");
    setSelectedClienteId("");
    setTipoPago("Contado");
  };

  // Encola la venta en la cola offline compartida y limpia el carrito
  const guardarVentaPendiente = (payload: Record<string, unknown>) => {
    try {
      enqueueAction({ type: "pos-venta", payload });
      mostrarToast("Sin conexión: venta guardada para reintentar", "info");
      resetVenta();
    } catch {
      // Cuota de localStorage excedida
      mostrarToast("No hay espacio para guardar la venta offline", "error");
    }
    setPendientes(contarPendientesPos());
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return mostrarToast("El carrito está vacío", "error");
    if (tipoPago === "Contado" && !selectedCuenta) return mostrarToast("Selecciona una cuenta bancaria/caja", "error");
    if (tipoPago === "Credito" && !selectedClienteId) return mostrarToast("Selecciona un cliente registrado para ventas al crédito", "error");

    const payload = {
      empresa,
      tipo_pago: tipoPago,
      cuenta_id: tipoPago === "Contado" ? selectedCuenta : null,
      cliente_id: selectedClienteId || null,
      items: cart.map(i => ({
        productoId: i.productoId,
        nombre: i.nombre,
        cantidad: i.cantidad,
        unidad: i.unidad,
        precioUnitario: i.precioUnitario,
        notas: null
      })),
      notas_generales: notasGenerales || null
    };

    if (isOffline || !navigator.onLine) {
      guardarVentaPendiente(payload);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        mostrarToast("Venta registrada exitosamente", "exito");
        resetVenta();
      } else {
        const error = await res.json().catch(() => null);
        mostrarToast(error?.error || "Error al procesar la venta", "error");
      }
    } catch {
      // fetch lanza TypeError cuando falla la red: guardar para reintentar
      guardarVentaPendiente(payload);
    } finally {
      setLoading(false);
    }
  };

  // Reintenta en orden las ventas encoladas; elimina las que el servidor acepta (2xx)
  const reintentarPendientes = async () => {
    if (sincronizando) return;
    setSincronizando(true);

    const cola = getQueue().filter((a) => a.type === "pos-venta");
    let sincronizadas = 0;
    let rechazadas = 0;

    for (const accion of cola) {
      try {
        const res = await fetch("/api/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accion.payload),
        });
        if (res.ok) {
          removeAction(accion.id);
          sincronizadas++;
        } else if (res.status === 400 || res.status === 409) {
          // Venta inválida o duplicada: se descarta para no trabar la cola
          removeAction(accion.id);
          rechazadas++;
        }
        // Otros errores (5xx): la venta se conserva para reintentar después
      } catch {
        // Sin red: no insistir con las demás
        break;
      }
    }

    const restantes = contarPendientesPos();
    setPendientes(restantes);
    setSincronizando(false);

    if (sincronizadas > 0) {
      mostrarToast(
        restantes > 0
          ? `${sincronizadas} venta(s) sincronizada(s); quedan ${restantes} pendiente(s)`
          : `${sincronizadas} venta(s) sincronizada(s)`,
        "exito"
      );
    }
    if (rechazadas > 0) {
      mostrarToast(`${rechazadas} venta(s) rechazada(s) por el servidor y descartada(s)`, "error");
    }
    if (sincronizadas === 0 && rechazadas === 0) {
      mostrarToast("No se pudo sincronizar. Revisa la conexión.", "error");
    }
  };

  // Preparar opciones de clientes para el SearchableSelect
  const clienteOptions = [
    { id: "", nombre: "Venta al Paso (Anónimo)", subtext: "Sin deuda" },
    ...clientes.map(c => ({
      id: c.id,
      nombre: c.nombre,
      subtext: c.ruc_dni || c.razon_social || undefined
    }))
  ];

  return (
    <div className="flex flex-col h-full flex-1 min-h-0">
      <GuiaModulo modulo="pos-planta" />
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
      {/* Catálogo Left Panel */}
      <div className="flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-100 space-y-3 flex-shrink-0 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-bold text-gray-800 text-lg">Catálogo</h2>
            <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-auto self-start sm:self-auto shadow-inner">
              <button
                type="button"
                onClick={() => {
                  setEmpresa("Transavic");
                  localStorage.setItem("transavic_pos_default_empresa", "Transavic");
                }}
                className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                  empresa === "Transavic"
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Transavic
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmpresa("Avícola de Tony");
                  localStorage.setItem("transavic_pos_default_empresa", "Avícola de Tony");
                }}
                className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                  empresa === "Avícola de Tony"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Avícola de Tony
              </button>
            </div>
          </div>
          
          {/* Controles de Búsqueda y Filtro de Categoría */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar producto (ej: Pechuga, Asado)..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-9 pr-8 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-gray-900"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <FiSearch size={14} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <FiX size={14} />
                </button>
              )}
            </div>
            
            {/* Chips de Categorías */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full sm:max-w-[300px] scrollbar-thin">
              {categorias.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategoria(cat)}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                    selectedCategoria === cat
                      ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 flex-1 overflow-y-auto scrollbar-visible">
          {/* Favoritos: siempre visibles, aunque haya búsqueda o filtro activo */}
          <div className="mb-6">
            <h3 className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FiStar size={12} className="fill-amber-400 text-amber-500" /> Favoritos
            </h3>
            {productosFavoritos.length === 0 ? (
              <p className="text-[10px] text-gray-400">
                Toca la estrella de un producto para tenerlo siempre a la mano aquí.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                {productosFavoritos.map(p => (
                  <TarjetaProducto
                    key={`fav-${p.id}`}
                    producto={p}
                    esFavorito
                    onAdd={addToCart}
                    onToggleFavorito={toggleFavorito}
                  />
                ))}
              </div>
            )}
          </div>

          {productosFiltrados.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-indigo-500">
                <FiSearch size={20} />
              </div>
              <h3 className="font-bold text-gray-700 text-sm">No se encontraron productos</h3>
              <p className="text-[10px] text-gray-500 max-w-xs mx-auto">Prueba con otra búsqueda o limpia los filtros para volver a cargar el catálogo.</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategoria("Todos");
                }}
                className="mt-2 text-[10px] text-indigo-600 font-bold hover:underline cursor-pointer"
              >
                Limpiar Filtros
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {productosFiltrados.map(p => (
                <TarjetaProducto
                  key={p.id}
                  producto={p}
                  esFavorito={favoritos.includes(p.id)}
                  onAdd={addToCart}
                  onToggleFavorito={toggleFavorito}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cart Right Panel */}
      <div className="w-full lg:w-[400px] bg-white rounded-3xl shadow-sm border border-gray-100 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 text-lg flex items-center">
            <FiShoppingCart className="mr-2" /> Venta Actual
          </h2>
          {isOffline && (
            <span className="flex items-center text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
              <FiWifiOff className="mr-1" /> Offline
            </span>
          )}
        </div>
        
        <div className="flex-1 min-h-[160px] overflow-y-auto p-4 space-y-3 scrollbar-visible">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <FiShoppingCart size={48} className="mb-4 opacity-50" />
              <p>Seleccione productos</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.cartId} className="flex flex-col bg-gray-50 rounded-2xl p-3 border border-gray-100">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold text-gray-900 leading-tight flex-1 pr-2">{item.nombre}</span>
                  <button onClick={() => removeFromCart(item.cartId)} className="text-gray-400 hover:text-red-500">
                    <FiTrash2 />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2 gap-1.5 border-t border-gray-100 pt-2 text-xs">
                  {/* Cantidad */}
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={item.cantidad || ""}
                      onChange={(e) => updateQuantity(item.cartId, e.target.value)}
                      className="w-16 text-center border border-gray-300 rounded-lg py-3 px-1 font-semibold outline-none focus:ring-1 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-base animate-none"
                      placeholder="Cant"
                    />
                    <span className="text-gray-500 text-[10px]">{item.unidad}</span>
                  </div>

                  <span className="text-gray-400 text-[10px] font-bold">×</span>

                  {/* Precio Unitario */}
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-[10px]">S/</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={item.precioUnitario || ""}
                      onChange={(e) => updatePrice(item.cartId, e.target.value)}
                      className="w-20 text-center border border-gray-300 rounded-lg py-3 px-1 font-extrabold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-base"
                      placeholder="Precio"
                    />
                  </div>

                  {/* Subtotal */}
                  <div className="text-right flex-1 min-w-[70px]">
                    <span className="font-extrabold text-gray-900 text-xs">
                      S/ {(item.cantidad * item.precioUnitario).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Checkout Panel */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-3xl space-y-3 flex-shrink-0">
          
          {/* Cliente selector */}
          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <FiUser className="h-3 w-3" /> Cliente:
            </label>
            <SearchableSelect
              value={selectedClienteId}
              onChange={setSelectedClienteId}
              options={clienteOptions}
              placeholder="Seleccione Cliente..."
              searchPlaceholder="Buscar cliente..."
            />
          </div>

          {/* Grid para Método de Pago y Destino de Cobro */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Tipo de Pago */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Método de Pago:
              </label>
              <div className="grid grid-cols-2 gap-1 bg-gray-200/50 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setTipoPago("Contado")}
                  className={`py-1.5 px-2 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    tipoPago === "Contado"
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Contado
                </button>
                <button
                  type="button"
                  onClick={() => setTipoPago("Credito")}
                  className={`py-1.5 px-2 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    tipoPago === "Credito"
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Crédito
                </button>
              </div>
            </div>

            {/* Cuenta / Info Crédito */}
            <div className="space-y-1">
              {tipoPago === "Contado" ? (
                <>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cobrar en:</label>
                  <select
                    value={selectedCuenta}
                    onChange={(e) => setSelectedCuenta(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:ring-1 focus:ring-indigo-500 font-semibold bg-white shadow-sm cursor-pointer"
                  >
                    <option value="" disabled>Seleccione cuenta</option>
                    {cuentas.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </>
              ) : (
                <div className="h-full flex items-center">
                  <div className="p-1 px-2 bg-indigo-50 border border-indigo-100 rounded-lg text-[9px] text-indigo-700 font-medium leading-tight">
                    Pendiente en cartera del cliente.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Notas de Venta (Opcional/Colapsable) */}
          <div className="pt-1">
            {showNotesInput ? (
              <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex justify-between items-center">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <FiFileText className="h-3 w-3" /> Notas de Venta:
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotesInput(false);
                      setNotasGenerales("");
                    }}
                    className="text-[9px] text-red-500 font-bold hover:underline cursor-pointer"
                  >
                    Quitar
                  </button>
                </div>
                <input
                  type="text"
                  value={notasGenerales}
                  onChange={(e) => setNotasGenerales(e.target.value)}
                  placeholder="Notas internas..."
                  className="w-full border border-gray-300 bg-white rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNotesInput(true)}
                className="text-[10px] text-indigo-600 font-bold hover:underline cursor-pointer flex items-center gap-1"
              >
                <FiFileText size={10} /> + Agregar notas de venta
              </button>
            )}
          </div>
          
          <div className="flex items-end justify-between pt-2 border-t border-gray-200/60">
            <span className="text-gray-500 text-xs font-semibold">Total a Cobrar</span>
            <span className="text-xl font-black text-indigo-600 tracking-tight">S/ {total.toFixed(2)}</span>
          </div>

          <button
            onClick={handleCheckout}
            disabled={
              cart.length === 0 || 
              loading || 
              (tipoPago === "Contado" && !selectedCuenta) ||
              (tipoPago === "Credito" && !selectedClienteId)
            }
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold text-sm flex items-center justify-center transition-all cursor-pointer active:scale-95 shadow-md shadow-indigo-600/10"
          >
            {loading ? "Procesando..." : <><FiCheck className="mr-1.5" size={16} /> Confirmar Cobro</>}
          </button>

          {/* Motivo por el que el botón está deshabilitado (mismas condiciones del disabled) */}
          {!loading && tipoPago === "Contado" && !selectedCuenta && (
            <p className="text-[10px] text-amber-700 font-semibold text-center">
              Selecciona la cuenta de cobro
            </p>
          )}
          {!loading && tipoPago === "Credito" && !selectedClienteId && (
            <p className="text-[10px] text-amber-700 font-semibold text-center">
              Para crédito, selecciona un cliente registrado
            </p>
          )}
        </div>
      </div>
      </div>

      {/* Chip de ventas offline pendientes (fixed bajo DashboardLayout → print:hidden, gotcha #26) */}
      {pendientes > 0 && (
        <div className="fixed bottom-4 right-4 z-[90] print:hidden flex items-center gap-2 bg-amber-100 border border-amber-300 text-amber-800 rounded-full pl-4 pr-1.5 py-1.5 shadow-lg">
          <FiWifiOff size={14} className="shrink-0" />
          <span className="text-xs font-bold whitespace-nowrap">
            {pendientes} venta{pendientes > 1 ? "s" : ""} sin sincronizar
          </span>
          <button
            type="button"
            onClick={reintentarPendientes}
            disabled={sincronizando}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-full px-4 py-3 text-xs font-bold cursor-pointer flex items-center gap-1.5 active:scale-95 transition-all"
          >
            <FiRefreshCw size={13} className={sincronizando ? "animate-spin" : ""} />
            {sincronizando ? "Sincronizando..." : "Reintentar"}
          </button>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

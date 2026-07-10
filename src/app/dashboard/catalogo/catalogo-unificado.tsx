// src/app/dashboard/catalogo/catalogo-unificado.tsx
// Vista única del catálogo (mayo 2026): un solo lugar para nombre, código,
// categoría, unidad, precio de compra y precio de venta. Antes había 2 tabs
// (Productos / Precios) que partían el mismo objeto en dos pantallas.
//
// Patrones de edición (a propósito "no me hagas pensar"):
//   - Click sobre la celda de precio Compra/Venta → input inline + Enter guarda
//     (el caso del 90%: Antonio ajusta el precio que subió).
//   - Botón ✏️ Editar → modal completo (nombre, código, categoría, unidad,
//     compra, venta). Para cuando hay que tocar varios campos a la vez.
//   - Click en 🗑️ → desactiva (soft delete) con confirmación.
//
// Filtros: tabs por categoría + buscador por nombre/código + chip "Sin precio"
// (filtra al toque los que todavía no se pueden vender).
//
// Banner ámbar arriba si hay productos sin precio_venta (no suman a ventas/
// metas/reportes hasta que lo seteen).
//
// Modo asesora (isAdmin=false): SOLO LECTURA de la lista de precios de venta —
// sin columna Compra/Margen, sin edición inline ni modales, sin alta de
// productos (el backend ya devuelve precio_compra: null para ese rol).
// El botón/modal "Historial de precios" es SOLO admin.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiX,
  FiSearch,
  FiPackage,
  FiAlertTriangle,
  FiSave,
  FiTrendingUp,
  FiCheckCircle,
  FiClock,
} from "react-icons/fi";
import type { Producto } from "@/lib/types";
import { fetchParametrosNegocio, PARAMETROS_NEGOCIO_DEFAULT } from "@/lib/parametros-negocio";

const DEFAULT_EMOJIS: Record<string, string> = {
  Pollo: "🐔",
  Carnes: "🥩",
  Huevos: "🥚",
};
const DEFAULT_BADGES: Record<string, string> = {
  Pollo: "bg-amber-100 text-amber-700",
  Carnes: "bg-red-100 text-red-700",
  Huevos: "bg-yellow-100 text-yellow-700",
};
const COMMON_UNITS = ["uni", "kg", "plancha", "caja"];
const PRODUCTOS_POR_PAGINA = 25;

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}
function fmtMoney(v: number | string | null | undefined): string {
  const n = toNum(v);
  return n === null ? "—" : n.toFixed(2);
}
function margenPct(compra: number | null, venta: number | null): number | null {
  if (compra === null || venta === null || compra === 0) return null;
  return ((venta - compra) / compra) * 100;
}
function getEmoji(cat: string): string {
  return DEFAULT_EMOJIS[cat] ?? "📦";
}
function getBadge(cat: string): string {
  return DEFAULT_BADGES[cat] ?? "bg-gray-100 text-gray-700";
}
function fmtFechaLima(fecha: string): string {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;
  return d.toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Registro del historial de precios (GET /api/precios/historial).
interface HistorialPrecio {
  tipo: "catalogo" | "venta_bajo_catalogo";
  fecha: string;
  producto: string;
  usuario: string;
  precio_anterior: number | string | null;
  precio_nuevo: number | string;
  autorizado_por: string | null;
}

interface InlineEdit {
  productoId: string;
  campo: "precio_compra" | "precio_venta";
  valor: string;
}

interface ModalEdit {
  abierto: boolean;
  productoId: string | null;
  nombre: string;
  codigo: string;
  categoria: string;
  customCategoria: string;
  unidad: string;
  precio_compra: string;
  precio_venta: string;
}

interface ModalNuevo {
  abierto: boolean;
  nombre: string;
  categoria: string;
  customCategoria: string;
  unidades: string[];
  precio_venta: string;
  precio_compra: string;
}

export default function CatalogoUnificado({ isAdmin }: { isAdmin: boolean }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  // Umbrales del semáforo de margen, configurables desde /dashboard/configuracion.
  const [margenBueno, setMargenBueno] = useState(PARAMETROS_NEGOCIO_DEFAULT.margen_bueno_pct);
  const [margenRegular, setMargenRegular] = useState(PARAMETROS_NEGOCIO_DEFAULT.margen_regular_pct);
  useEffect(() => {
    fetchParametrosNegocio().then((par) => {
      setMargenBueno(par.margen_bueno_pct);
      setMargenRegular(par.margen_regular_pct);
    });
  }, []);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaActiva, setCategoriaActiva] = useState<string>("Todos");
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Edición inline en celda (precio compra/venta).
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [guardandoInline, setGuardandoInline] = useState(false);

  // Modal de edición completa.
  const [modalEdit, setModalEdit] = useState<ModalEdit>({
    abierto: false,
    productoId: null,
    nombre: "",
    codigo: "",
    categoria: "",
    customCategoria: "",
    unidad: "",
    precio_compra: "",
    precio_venta: "",
  });
  const [guardandoModal, setGuardandoModal] = useState(false);

  // Modal de nuevo producto (combina lo que era Productos + el campo precio).
  const [modalNuevo, setModalNuevo] = useState<ModalNuevo>({
    abierto: false,
    nombre: "",
    categoria: "",
    customCategoria: "",
    unidades: [],
    precio_venta: "",
    precio_compra: "",
  });
  const customUnitRef = useRef<HTMLInputElement>(null);

  // Modal de historial de precios (solo admin).
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [historial, setHistorial] = useState<HistorialPrecio[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);
  const [filtroHistorial, setFiltroHistorial] = useState("");

  const [verInactivos, setVerInactivos] = useState(false);

  const fetchProductos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/productos${verInactivos ? "?incluir_inactivos=1" : ""}`);
      if (!res.ok) {
        // El GET ahora exige sesión: un 401 (sesión expirada) no debe dejar la
        // lista vacía en silencio.
        throw new Error(
          res.status === 401
            ? "Tu sesión expiró — vuelve a iniciar sesión."
            : "No se pudieron cargar los productos"
        );
      }
      const json = await res.json();
      setProductos(json.data ?? []);
    } catch (e) {
      console.error("Error cargando productos", e);
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "No se pudieron cargar los productos",
      });
    } finally {
      setLoading(false);
    }
  }, [verInactivos]);

  useEffect(() => {
    fetchProductos();
  }, [fetchProductos]);

  // Mensaje se auto-oculta a los 3.5 s.
  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 3500);
    return () => clearTimeout(t);
  }, [mensaje]);

  // Resetear página al cambiar filtros.
  useEffect(() => {
    setPagina(1);
  }, [busqueda, categoriaActiva, soloSinPrecio]);

  // ── Categorías + conteos dinámicos ──
  const allCategories = useMemo(
    () => Array.from(new Set(productos.map((p) => p.categoria))).sort(),
    [productos]
  );
  const conteos = useMemo(() => {
    const c: Record<string, number> = { Todos: productos.length };
    for (const cat of allCategories) {
      c[cat] = productos.filter((p) => p.categoria === cat).length;
    }
    return c;
  }, [productos, allCategories]);

  const productosSinPrecio = useMemo(
    () => productos.filter((p) => toNum(p.precio_venta) === null || toNum(p.precio_venta) === 0).length,
    [productos]
  );

  // KPIs del catálogo (panorama de negocio de un vistazo).
  const conPrecio = productos.length - productosSinPrecio;
  const margenPromedio = useMemo(() => {
    const conAmbos = productos
      .map((p) => margenPct(toNum(p.precio_compra), toNum(p.precio_venta)))
      .filter((m): m is number => m !== null);
    if (conAmbos.length === 0) return null;
    return conAmbos.reduce((a, b) => a + b, 0) / conAmbos.length;
  }, [productos]);

  // ── Filtrado ──
  const filtrados = useMemo(() => {
    return productos.filter((p) => {
      if (categoriaActiva !== "Todos" && p.categoria !== categoriaActiva) return false;
      if (soloSinPrecio) {
        const v = toNum(p.precio_venta);
        if (v !== null && v > 0) return false;
      }
      if (busqueda) {
        const q = busqueda.toLowerCase();
        const matchNombre = p.nombre.toLowerCase().includes(q);
        const matchCodigo = (p.codigo ?? "").toLowerCase().includes(q);
        if (!matchNombre && !matchCodigo) return false;
      }
      return true;
    });
  }, [productos, busqueda, categoriaActiva, soloSinPrecio]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PRODUCTOS_POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const productosPagina = filtrados.slice(
    (paginaActual - 1) * PRODUCTOS_POR_PAGINA,
    paginaActual * PRODUCTOS_POR_PAGINA
  );

  // ════════════════════════════════════════════════════════════════════
  // Edición inline de precio
  // ════════════════════════════════════════════════════════════════════
  const iniciarInline = (productoId: string, campo: InlineEdit["campo"], valorInicial: number | string | null | undefined) => {
    if (!isAdmin) return; // asesora: lista de precios en solo lectura
    setInline({
      productoId,
      campo,
      valor: valorInicial === null || valorInicial === undefined ? "" : String(toNum(valorInicial) ?? ""),
    });
  };

  const cancelarInline = () => setInline(null);

  const guardarInline = async () => {
    if (!inline) return;
    const valor = inline.valor.trim();
    const num = valor === "" ? null : parseFloat(valor);

    if (num !== null && (Number.isNaN(num) || num < 0)) {
      setMensaje({ tipo: "error", texto: "Valor inválido" });
      return;
    }
    if (inline.campo === "precio_venta" && num !== null && num > 0) {
      // Comparar con el actual: si cambia el precio venta, confirmar (afecta pedidos nuevos).
      const actual = productos.find((p) => p.id === inline.productoId);
      const ventaAnterior = actual ? toNum(actual.precio_venta) : null;
      if (ventaAnterior !== null && ventaAnterior !== num) {
        const pct =
          ventaAnterior > 0
            ? (((num - ventaAnterior) / ventaAnterior) * 100).toFixed(1)
            : "?";
        const ok = window.confirm(
          `¿Confirmas el cambio de precio?\n\n` +
            `${actual?.nombre}\n` +
            `Precio venta: S/ ${ventaAnterior.toFixed(2)} → S/ ${num.toFixed(2)} ` +
            `(${pct.startsWith("-") ? "" : "+"}${pct}%)\n\n` +
            `⚠️ Se aplicará automáticamente a todos los pedidos nuevos.`
        );
        if (!ok) return;
      }
    }
    if (
      inline.campo === "precio_compra" &&
      num !== null &&
      num > 0
    ) {
      // Validación cruzada: compra no debe superar venta.
      const actual = productos.find((p) => p.id === inline.productoId);
      const ventaActual = actual ? toNum(actual.precio_venta) : null;
      if (ventaActual !== null && num > ventaActual) {
        setMensaje({
          tipo: "error",
          texto: "La compra no puede ser mayor que la venta",
        });
        return;
      }
    }

    setGuardandoInline(true);
    try {
      const body: Record<string, number | null> = {};
      body[inline.campo] = num;
      const res = await fetch(`/api/productos/${inline.productoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al guardar");
      }
      const { data } = await res.json();
      setProductos((prev) => prev.map((p) => (p.id === inline.productoId ? { ...p, ...data } : p)));
      setMensaje({ tipo: "ok", texto: "Precio actualizado" });
      setInline(null);
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "Error al guardar",
      });
    } finally {
      setGuardandoInline(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // Modal de edición completa
  // ════════════════════════════════════════════════════════════════════
  const abrirEdit = (p: Producto) => {
    setModalEdit({
      abierto: true,
      productoId: p.id,
      nombre: p.nombre,
      codigo: p.codigo ?? "",
      categoria: p.categoria,
      customCategoria: "",
      unidad: p.unidad,
      precio_compra: toNum(p.precio_compra) === null ? "" : String(toNum(p.precio_compra)),
      precio_venta: toNum(p.precio_venta) === null ? "" : String(toNum(p.precio_venta)),
    });
  };
  const cerrarEdit = () => setModalEdit((m) => ({ ...m, abierto: false }));

  const guardarEdit = async () => {
    if (!modalEdit.productoId) return;
    if (!modalEdit.nombre.trim()) {
      setMensaje({ tipo: "error", texto: "El nombre es requerido" });
      return;
    }
    const categoriaFinal =
      modalEdit.categoria === "__custom__"
        ? modalEdit.customCategoria.trim()
        : modalEdit.categoria.trim();
    if (!categoriaFinal || !modalEdit.unidad.trim()) {
      setMensaje({ tipo: "error", texto: "Categoría y unidad son requeridos" });
      return;
    }
    const compra = modalEdit.precio_compra.trim() === "" ? null : parseFloat(modalEdit.precio_compra);
    const venta = modalEdit.precio_venta.trim() === "" ? null : parseFloat(modalEdit.precio_venta);
    if (compra !== null && venta !== null && compra > venta) {
      setMensaje({ tipo: "error", texto: "La compra no puede ser mayor que la venta" });
      return;
    }

    setGuardandoModal(true);
    try {
      const res = await fetch(`/api/productos/${modalEdit.productoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: modalEdit.nombre.trim(),
          codigo: modalEdit.codigo.trim(),
          categoria: categoriaFinal,
          unidad: modalEdit.unidad,
          precio_compra: compra,
          precio_venta: venta,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al guardar");
      }
      const { data } = await res.json();
      setProductos((prev) => prev.map((p) => (p.id === modalEdit.productoId ? { ...p, ...data } : p)));
      setMensaje({ tipo: "ok", texto: "Producto actualizado" });
      cerrarEdit();
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "Error al guardar",
      });
    } finally {
      setGuardandoModal(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // Eliminar (soft delete)
  // ════════════════════════════════════════════════════════════════════
  // Reactivar un producto desactivado (el PATCH {activo:true} ya existía sin UI).
  const reactivar = async (p: Producto) => {
    try {
      const res = await fetch(`/api/productos/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error");
      }
      setMensaje({ tipo: "ok", texto: `"${p.nombre}" reactivado: ya aparece en el catálogo.` });
      fetchProductos();
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "Error al reactivar",
      });
    }
  };

  const eliminar = async (p: Producto) => {
    if (!window.confirm(`¿Desactivar "${p.nombre}"? No aparecerá más en el catálogo.`)) return;
    try {
      const res = await fetch(`/api/productos/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error");
      }
      setProductos((prev) => prev.filter((x) => x.id !== p.id));
      setMensaje({ tipo: "ok", texto: "Producto desactivado" });
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "Error al desactivar",
      });
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // Modal de nuevo producto
  // ════════════════════════════════════════════════════════════════════
  const abrirNuevo = () => {
    setModalNuevo({
      abierto: true,
      nombre: "",
      categoria: allCategories[0] ?? "Pollo",
      customCategoria: "",
      unidades: [],
      precio_venta: "",
      precio_compra: "",
    });
  };
  const cerrarNuevo = () => setModalNuevo((m) => ({ ...m, abierto: false }));

  const toggleUnidad = (u: string) => {
    setModalNuevo((prev) => ({
      ...prev,
      unidades: prev.unidades.includes(u)
        ? prev.unidades.filter((x) => x !== u)
        : [...prev.unidades, u],
    }));
  };
  const agregarUnidadCustom = () => {
    const val = customUnitRef.current?.value.trim().toLowerCase();
    if (val && !modalNuevo.unidades.includes(val)) {
      setModalNuevo((prev) => ({ ...prev, unidades: [...prev.unidades, val] }));
      if (customUnitRef.current) customUnitRef.current.value = "";
    }
  };

  const guardarNuevo = async () => {
    const unidadFinal = modalNuevo.unidades.join("/");
    const categoriaFinal =
      modalNuevo.categoria === "__custom__"
        ? modalNuevo.customCategoria.trim()
        : modalNuevo.categoria;
    if (!modalNuevo.nombre.trim() || !unidadFinal || !categoriaFinal) {
      setMensaje({ tipo: "error", texto: "Nombre, unidad y categoría son obligatorios" });
      return;
    }
    const venta = modalNuevo.precio_venta.trim() === "" ? null : parseFloat(modalNuevo.precio_venta);
    const compra = modalNuevo.precio_compra.trim() === "" ? null : parseFloat(modalNuevo.precio_compra);
    if (compra !== null && venta !== null && compra > venta) {
      setMensaje({ tipo: "error", texto: "La compra no puede ser mayor que la venta" });
      return;
    }

    setGuardandoModal(true);
    try {
      const res = await fetch("/api/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: modalNuevo.nombre.trim(),
          categoria: categoriaFinal,
          unidad: unidadFinal,
          precio_venta: venta,
          precio_compra: compra,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al agregar");
      }
      const { data } = await res.json();
      setProductos((prev) => [...prev, data]);
      setMensaje({ tipo: "ok", texto: "Producto agregado" });
      cerrarNuevo();
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "Error al agregar",
      });
    } finally {
      setGuardandoModal(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // Historial de precios (solo admin)
  // ════════════════════════════════════════════════════════════════════
  const abrirHistorial = async () => {
    setHistorialAbierto(true);
    setFiltroHistorial("");
    setCargandoHistorial(true);
    setErrorHistorial(null);
    try {
      const res = await fetch("/api/precios/historial");
      if (!res.ok) throw new Error("No se pudo cargar el historial");
      const json = await res.json();
      const data: HistorialPrecio[] = json.data ?? [];
      // Orden defensivo por fecha DESC (lo más reciente arriba).
      data.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      setHistorial(data);
    } catch (e) {
      console.error("Error cargando historial de precios", e);
      setErrorHistorial(
        e instanceof Error ? e.message : "No se pudo cargar el historial"
      );
    } finally {
      setCargandoHistorial(false);
    }
  };

  const historialFiltrado = useMemo(() => {
    const q = filtroHistorial.trim().toLowerCase();
    if (!q) return historial;
    return historial.filter((h) => h.producto.toLowerCase().includes(q));
  }, [historial, filtroHistorial]);

  // ════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <main className="bg-white max-w-[1200px] mx-auto p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-12 bg-gray-200 rounded" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-gray-100 rounded" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="bg-white max-w-[1200px] mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <FiPackage className="text-red-600" />
            Catálogo
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {isAdmin ? "Productos, precios y márgenes" : "Lista de precios de venta"} ·{" "}
            <span className="text-amber-700">precios <strong>con IGV incluido</strong></span>
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={abrirHistorial}
              className="flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 px-5 py-2.5 rounded-lg hover:bg-gray-50 transition active:scale-[0.98] font-semibold shadow-sm"
            >
              <FiClock />
              Historial de precios
            </button>
            <button
              onClick={abrirNuevo}
              className="flex items-center justify-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-lg hover:bg-red-700 transition active:scale-[0.98] font-semibold shadow-sm"
            >
              <FiPlus />
              Agregar Producto
            </button>
          </div>
        )}
      </div>

      {/* ── KPIs del catálogo: panorama de un vistazo ──
          Asesora: solo los neutrales (Productos / Listos para vender); los de
          margen y "sin precio" (gestión de precios) son solo admin. */}
      <div className={`grid grid-cols-2 ${isAdmin ? "lg:grid-cols-4" : ""} gap-3 mb-5`}>
        <KpiCatalogo
          color="gray"
          icon={<FiPackage />}
          label="Productos"
          value={productos.length}
          hint="en el catálogo"
        />
        <KpiCatalogo
          color="green"
          icon={<FiCheckCircle />}
          label="Listos para vender"
          value={conPrecio}
          hint="con precio asignado"
        />
        {isAdmin && (
          <KpiCatalogo
            color="amber"
            icon={<FiAlertTriangle />}
            label="Sin precio"
            value={productosSinPrecio}
            hint={productosSinPrecio > 0 ? (soloSinPrecio ? "← mostrando estos" : "clic para ver") : "todo OK"}
            highlight={productosSinPrecio > 0}
            active={soloSinPrecio}
            onClick={productosSinPrecio > 0 ? () => setSoloSinPrecio((v) => !v) : undefined}
          />
        )}
        {isAdmin && (
          <KpiCatalogo
            color="indigo"
            icon={<FiTrendingUp />}
            label="Margen promedio"
            value={margenPromedio === null ? "—" : `${margenPromedio.toFixed(0)}%`}
            hint="de los que tienen costo"
          />
        )}
      </div>

      {/* Toast flotante (no empuja el contenido como un banner; entra suave desde
          abajo). Mismo patrón que /comprobantes y /cobranzas para consistencia. */}
      {mensaje && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium anim-toast ${
            mensaje.tipo === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      {/* Search + Category Tabs */}
      <div className="space-y-4 mb-6">
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-gray-900"
          />
        </div>

        {isAdmin && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verInactivos}
              onChange={(e) => setVerInactivos(e.target.checked)}
              className="h-4 w-4 accent-red-600 cursor-pointer"
            />
            Ver productos desactivados
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          {["Todos", ...allCategories].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoriaActiva(cat)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition active:scale-[0.97] ${
                categoriaActiva === cat
                  ? "bg-red-600 text-white shadow-md"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {cat !== "Todos" && <span className="mr-1">{getEmoji(cat)}</span>}
              {cat}
              <span className="ml-1.5 text-xs opacity-80">({conteos[cat] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      {filtrados.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FiPackage className="mx-auto mb-3" size={48} />
          <p className="text-lg">No se encontraron productos</p>
        </div>
      ) : (
        <>
          {/* Pista de edición inline (descubrible sin tener que adivinar) */}
          {isAdmin && (
            <p className="hidden lg:flex items-center gap-1.5 text-xs text-gray-400 mb-2">
              <FiEdit2 className="h-3 w-3" />
              Toca un precio de compra o venta para editarlo al instante.
            </p>
          )}
          {/* Desktop */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Producto
                  </th>
                  <th className="px-3 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Categoría
                  </th>
                  <th className="px-3 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Unidad
                  </th>
                  {isAdmin && (
                    <th className="px-3 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Compra S/
                    </th>
                  )}
                  <th className="px-3 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Venta S/
                  </th>
                  {isAdmin && (
                    <th className="px-3 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Margen
                    </th>
                  )}
                  {isAdmin && (
                    <th className="px-3 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {productosPagina.map((p) => {
                  const compra = toNum(p.precio_compra);
                  const venta = toNum(p.precio_venta);
                  const m = margenPct(compra, venta);
                  const sinPrecio = venta === null || venta === 0;
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        isAdmin && sinPrecio ? "bg-amber-50/30" : ""
                      }`}
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg flex-shrink-0">{getEmoji(p.categoria)}</span>
                          <div className="min-w-0">
                            <div className="text-sm text-gray-900 font-medium truncate">{p.nombre}</div>
                            {p.codigo && (
                              <div className="text-[11px] font-mono text-gray-400">{p.codigo}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${getBadge(
                            p.categoria
                          )}`}
                        >
                          {p.categoria}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-600">{p.unidad}</td>

                      {/* Precio compra (inline-editable, descubrible con lápiz) — solo admin */}
                      {isAdmin && (
                        <td
                          className="px-3 py-4 text-right text-sm group/celda cursor-pointer"
                          onClick={() =>
                            inline?.productoId !== p.id &&
                            iniciarInline(p.id, "precio_compra", p.precio_compra)
                          }
                        >
                          {inline?.productoId === p.id && inline.campo === "precio_compra" ? (
                            <CeldaInline
                              value={inline.valor}
                              onChange={(v) => setInline({ ...inline, valor: v })}
                              onSave={guardarInline}
                              onCancel={cancelarInline}
                              disabled={guardandoInline}
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1.5 justify-end rounded-lg px-2 py-1 -mr-2 text-gray-400 tabular-nums group-hover/celda:bg-blue-50 group-hover/celda:text-blue-700 transition-colors">
                              {fmtMoney(p.precio_compra)}
                              <FiEdit2 className="h-3 w-3 text-gray-300 group-hover/celda:text-blue-500 transition-colors" />
                            </span>
                          )}
                        </td>
                      )}

                      {/* Precio venta (admin: inline-editable; asesora: solo lectura) */}
                      <td
                        className={`px-3 py-4 text-right text-sm ${
                          isAdmin ? "group/celda cursor-pointer" : ""
                        }`}
                        onClick={() =>
                          isAdmin &&
                          inline?.productoId !== p.id &&
                          iniciarInline(p.id, "precio_venta", p.precio_venta)
                        }
                      >
                        {isAdmin && inline?.productoId === p.id && inline.campo === "precio_venta" ? (
                          <CeldaInline
                            value={inline.valor}
                            onChange={(v) => setInline({ ...inline, valor: v })}
                            onSave={guardarInline}
                            onCancel={cancelarInline}
                            disabled={guardandoInline}
                          />
                        ) : sinPrecio ? (
                          isAdmin ? (
                            <span className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold bg-amber-100 text-amber-800 group-hover/celda:bg-amber-200 transition-colors">
                              <FiPlus className="h-3.5 w-3.5" /> Poner precio
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )
                        ) : (
                          <span className="inline-flex items-baseline gap-1.5 justify-end rounded-lg px-2 py-1 -mr-2 text-gray-900 tabular-nums group-hover/celda:bg-blue-50 group-hover/celda:text-blue-700 transition-colors">
                            <span className="text-xs text-gray-400 font-normal">S/</span>
                            <span className="text-base font-bold">{fmtMoney(p.precio_venta)}</span>
                            {isAdmin && (
                              <FiEdit2 className="h-3 w-3 self-center text-gray-300 group-hover/celda:text-blue-500 transition-colors" />
                            )}
                          </span>
                        )}
                      </td>

                      {isAdmin && (
                        <td className="px-3 py-4 text-right">
                          {m !== null ? (
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tabular-nums ${
                                m >= margenBueno
                                  ? "bg-green-100 text-green-700"
                                  : m >= margenRegular
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                              title={
                                m >= margenBueno ? "Buen margen" : m >= margenRegular ? "Margen ajustado" : "Margen bajo"
                              }
                            >
                              {m.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      )}

                      {isAdmin && (
                        <td className="px-3 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => abrirEdit(p)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Editar completo"
                            >
                              <FiEdit2 size={16} />
                            </button>
                            {p.activo === false ? (
                              <button
                                onClick={() => reactivar(p)}
                                className="px-2.5 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"
                                title="Volver a mostrarlo en el catálogo y los selectores"
                              >
                                Reactivar
                              </button>
                            ) : (
                              <button
                                onClick={() => eliminar(p)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Desactivar"
                              >
                                <FiTrash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {productosPagina.map((p) => {
              const compra = toNum(p.precio_compra);
              const venta = toNum(p.precio_venta);
              const m = margenPct(compra, venta);
              const sinPrecio = venta === null || venta === 0;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 ${
                    isAdmin && sinPrecio
                      ? "bg-amber-50/40 border-amber-200"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">
                        {getEmoji(p.categoria)} {p.nombre}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${getBadge(p.categoria)}`}>
                          {p.categoria}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          {p.unidad}
                        </span>
                        {p.codigo && (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">
                            {p.codigo}
                          </span>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => abrirEdit(p)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          <FiEdit2 size={16} />
                        </button>
                        <button
                          onClick={() => eliminar(p)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-end justify-between mt-3 pt-3 border-t border-gray-100">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">
                        Precio de venta
                      </div>
                      {sinPrecio ? (
                        isAdmin ? (
                          <button
                            onClick={() => abrirEdit(p)}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold bg-amber-100 text-amber-800 active:scale-[0.97] transition"
                          >
                            <FiPlus className="h-3.5 w-3.5" /> Poner precio
                          </button>
                        ) : (
                          <div className="mt-0.5 text-sm text-gray-300">—</div>
                        )
                      ) : (
                        <div className="flex items-baseline gap-1 tabular-nums mt-0.5">
                          <span className="text-xs text-gray-400">S/</span>
                          <span className="text-xl font-bold text-gray-900">
                            {fmtMoney(p.precio_venta)}
                          </span>
                        </div>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="text-right flex-shrink-0">
                        {m !== null && (
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold tabular-nums ${
                              m >= margenBueno
                                ? "bg-green-100 text-green-700"
                                : m >= margenRegular
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {m.toFixed(0)}% margen
                          </span>
                        )}
                        <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">
                          Compra S/ {fmtMoney(p.precio_compra)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-2 mt-4 text-sm">
          <span className="text-gray-500">
            {filtrados.length} producto{filtrados.length === 1 ? "" : "s"} · página{" "}
            {paginaActual} de {totalPaginas}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={paginaActual <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              ‹ Anterior
            </button>
            <button
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaActual >= totalPaginas}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              Siguiente ›
            </button>
          </div>
        </div>
      )}

      {/* Modal de edición completa (solo admin) */}
      {isAdmin && modalEdit.abierto && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 anim-fade"
          onClick={cerrarEdit}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto anim-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-800">Editar producto</h2>
              <button
                onClick={cerrarEdit}
                className="text-gray-500 hover:text-gray-800"
                aria-label="Cerrar"
              >
                <FiX size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Nombre *">
                <input
                  value={modalEdit.nombre}
                  onChange={(e) => setModalEdit({ ...modalEdit, nombre: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Código">
                  <input
                    value={modalEdit.codigo}
                    onChange={(e) => setModalEdit({ ...modalEdit, codigo: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900 font-mono text-sm"
                    placeholder="POL001"
                  />
                </Field>
                <Field label="Unidad *">
                  <input
                    value={modalEdit.unidad}
                    onChange={(e) => setModalEdit({ ...modalEdit, unidad: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900"
                    placeholder="uni/kg"
                  />
                </Field>
              </div>
              <Field label="Categoría *">
                <select
                  value={modalEdit.categoria}
                  onChange={(e) => setModalEdit({ ...modalEdit, categoria: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {getEmoji(cat)} {cat}
                    </option>
                  ))}
                  <option value="__custom__">➕ Nueva categoría…</option>
                </select>
                {modalEdit.categoria === "__custom__" && (
                  <input
                    type="text"
                    value={modalEdit.customCategoria}
                    onChange={(e) =>
                      setModalEdit({ ...modalEdit, customCategoria: e.target.value })
                    }
                    className="w-full mt-2 p-2.5 border border-gray-300 rounded-lg text-gray-900"
                    placeholder="Nombre de la nueva categoría"
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Compra (S/)">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={modalEdit.precio_compra}
                    onChange={(e) =>
                      setModalEdit({ ...modalEdit, precio_compra: e.target.value })
                    }
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900 text-right"
                    placeholder="—"
                  />
                </Field>
                <Field label="Venta (S/)">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={modalEdit.precio_venta}
                    onChange={(e) =>
                      setModalEdit({ ...modalEdit, precio_venta: e.target.value })
                    }
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900 text-right font-semibold"
                    placeholder="—"
                  />
                </Field>
              </div>
            </div>
            <div className="p-5 border-t flex gap-3 justify-end sticky bottom-0 bg-white rounded-b-xl">
              <button
                onClick={cerrarEdit}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={guardarEdit}
                disabled={guardandoModal}
                className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition active:scale-[0.98] font-medium disabled:bg-gray-400 disabled:active:scale-100 flex items-center gap-1.5"
              >
                <FiSave size={14} />
                {guardandoModal ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo producto (solo admin) */}
      {isAdmin && modalNuevo.abierto && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 anim-fade"
          onClick={cerrarNuevo}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto anim-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-800">Agregar producto</h2>
              <button onClick={cerrarNuevo} className="text-gray-500 hover:text-gray-800">
                <FiX size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Nombre *">
                <input
                  type="text"
                  value={modalNuevo.nombre}
                  onChange={(e) => setModalNuevo({ ...modalNuevo, nombre: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900"
                  placeholder="Ej: Pollo entero con menudencia"
                  autoFocus
                />
              </Field>
              <Field label="Categoría *">
                <select
                  value={modalNuevo.categoria}
                  onChange={(e) => setModalNuevo({ ...modalNuevo, categoria: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {getEmoji(cat)} {cat}
                    </option>
                  ))}
                  <option value="__custom__">➕ Nueva categoría…</option>
                </select>
                {modalNuevo.categoria === "__custom__" && (
                  <input
                    type="text"
                    value={modalNuevo.customCategoria}
                    onChange={(e) =>
                      setModalNuevo({ ...modalNuevo, customCategoria: e.target.value })
                    }
                    className="w-full mt-2 p-2.5 border border-gray-300 rounded-lg text-gray-900"
                    placeholder="Nombre de la nueva categoría"
                  />
                )}
              </Field>
              <Field label="Unidades de venta *" hint="Toca para agregar/quitar. Se guardan separadas por «/».">
                <div className="flex flex-wrap gap-2">
                  {COMMON_UNITS.map((u) => {
                    const active = modalNuevo.unidades.includes(u);
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => toggleUnidad(u)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                          active
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {active && "✓ "}
                        {u}
                      </button>
                    );
                  })}
                  {modalNuevo.unidades
                    .filter((u) => !COMMON_UNITS.includes(u))
                    .map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => toggleUnidad(u)}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium border-2 bg-red-600 text-white border-red-600"
                      >
                        ✓ {u} ×
                      </button>
                    ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    ref={customUnitRef}
                    type="text"
                    placeholder="Otra unidad…"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        agregarUnidadCustom();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={agregarUnidadCustom}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 border border-gray-300"
                  >
                    + Agregar
                  </button>
                </div>
                {modalNuevo.unidades.length > 0 && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    Se guardará como: <strong>{modalNuevo.unidades.join("/")}</strong>
                  </p>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Compra (S/)" hint="opcional">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={modalNuevo.precio_compra}
                    onChange={(e) =>
                      setModalNuevo({ ...modalNuevo, precio_compra: e.target.value })
                    }
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900 text-right"
                    placeholder="—"
                  />
                </Field>
                <Field label="Venta (S/)" hint="opcional, pero si falta no vende">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={modalNuevo.precio_venta}
                    onChange={(e) =>
                      setModalNuevo({ ...modalNuevo, precio_venta: e.target.value })
                    }
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-gray-900 text-right font-semibold"
                    placeholder="—"
                  />
                </Field>
              </div>
            </div>
            <div className="p-5 border-t flex gap-3 justify-end sticky bottom-0 bg-white rounded-b-xl">
              <button
                onClick={cerrarNuevo}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={guardarNuevo}
                disabled={guardandoModal}
                className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition active:scale-[0.98] font-medium disabled:bg-gray-400 disabled:active:scale-100 flex items-center gap-1.5"
              >
                <FiPlus size={14} />
                {guardandoModal ? "Guardando…" : "Agregar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historial de precios (solo admin) */}
      {isAdmin && historialAbierto && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 anim-fade"
          onClick={() => setHistorialAbierto(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col anim-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FiClock className="text-red-600" />
                Historial de precios
              </h2>
              <button
                onClick={() => setHistorialAbierto(false)}
                className="text-gray-500 hover:text-gray-800"
                aria-label="Cerrar"
              >
                <FiX size={20} />
              </button>
            </div>

            {/* Filtro client-side por producto */}
            <div className="px-5 pt-4">
              <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrar por producto…"
                  value={filtroHistorial}
                  onChange={(e) => setFiltroHistorial(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                />
              </div>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {cargandoHistorial ? (
                <div className="py-10 text-center text-gray-400 text-sm">
                  Cargando historial…
                </div>
              ) : errorHistorial ? (
                <div className="py-10 text-center text-red-600 text-sm">{errorHistorial}</div>
              ) : historialFiltrado.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-sm">
                  {historial.length === 0
                    ? "Aún no hay cambios registrados."
                    : "Ningún producto coincide con el filtro."}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {historialFiltrado.map((h, i) => {
                    const ant = toNum(h.precio_anterior);
                    const nue = toNum(h.precio_nuevo);
                    const colorNuevo =
                      ant !== null && nue !== null
                        ? nue > ant
                          ? "text-green-600"
                          : nue < ant
                            ? "text-red-600"
                            : "text-gray-900"
                        : "text-gray-900";
                    return (
                      <li key={`${h.fecha}-${h.producto}-${i}`} className="py-3 flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              h.tipo === "catalogo"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {h.tipo === "catalogo"
                              ? "Cambio de catálogo"
                              : "Venta bajo catálogo autorizada"}
                          </span>
                          <span className="text-xs text-gray-400">{fmtFechaLima(h.fecha)}</span>
                        </div>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="text-sm font-medium text-gray-800">{h.producto}</span>
                          <span className="text-sm tabular-nums">
                            {ant === null ? (
                              <>
                                <span className="text-gray-500">Alta inicial</span>{" "}
                                <span className="text-gray-400">→</span>{" "}
                                <span className="font-bold text-gray-900">
                                  S/ {fmtMoney(h.precio_nuevo)}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-gray-500">S/ {fmtMoney(h.precio_anterior)}</span>{" "}
                                <span className="text-gray-400">→</span>{" "}
                                <span className={`font-bold ${colorNuevo}`}>
                                  S/ {fmtMoney(h.precio_nuevo)}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          por {h.usuario}
                          {h.autorizado_por ? ` · autorizó ${h.autorizado_por}` : ""}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ─────────────────────── helpers UI ─────────────────────── */

function CeldaInline({
  value,
  onChange,
  onSave,
  onCancel,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        step="0.01"
        min="0"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="w-20 px-2 py-1 border border-blue-400 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="—"
        disabled={disabled}
      />
      <button
        onClick={onSave}
        disabled={disabled}
        className="p-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 disabled:opacity-50"
        title="Guardar (Enter)"
        aria-label="Guardar"
      >
        <FiSave className="h-3 w-3" />
      </button>
      <button
        onClick={onCancel}
        disabled={disabled}
        className="p-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
        title="Cancelar (Esc)"
        aria-label="Cancelar"
      >
        <FiX className="h-3 w-3" />
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {hint && <span className="ml-2 text-xs text-gray-400 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// KpiCatalogo — métrica de cabecera. El de "Sin precio" es clickeable
// (filtra al toque), con estado activo cuando el filtro está aplicado.
// ──────────────────────────────────────────────────────────
function KpiCatalogo({
  color,
  icon,
  label,
  value,
  hint,
  highlight,
  active,
  onClick,
}: {
  color: "gray" | "green" | "amber" | "indigo";
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  highlight?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const palette: Record<typeof color, { iconBg: string }> = {
    gray: { iconBg: "bg-gray-100 text-gray-600" },
    green: { iconBg: "bg-green-100 text-green-600" },
    amber: { iconBg: "bg-amber-100 text-amber-600" },
    indigo: { iconBg: "bg-indigo-100 text-indigo-600" },
  };
  const borde = active
    ? "bg-amber-50 border-amber-300 ring-1 ring-amber-200"
    : highlight
      ? "bg-amber-50/40 border-amber-200"
      : "bg-white border-gray-200";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={hint}
      className={`flex items-center gap-3 text-left border rounded-xl px-3.5 py-2.5 shadow-sm ${borde} ${
        onClick ? "hover:shadow-md transition active:scale-[0.98] cursor-pointer" : ""
      }`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${palette[color].iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-gray-800 leading-none tabular-nums">{value}</div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mt-1 truncate">
          {label}
        </div>
      </div>
    </Tag>
  );
}

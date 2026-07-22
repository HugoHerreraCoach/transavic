"use client";

import { useState, useEffect } from "react";
import { FiPlus, FiAlertCircle, FiArrowRight, FiArrowLeft, FiList, FiCornerUpLeft, FiEdit2, FiTrash2, FiSearch, FiSettings, FiCheckCircle, FiTrendingUp, FiTrendingDown } from "react-icons/fi";
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
  proveedor_id: string;
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



const formatearFechaCorta = (fecha: string) =>
  new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(fecha));

export default function PrestamosClient() {
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [kardexOpen, setKardexOpen] = useState(false);
  const [kardexLoading, setKardexLoading] = useState(false);
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [kardexProveedorNombre, setKardexProveedorNombre] = useState("");
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

  // Estados para Edición y Eliminación directa de movimientos
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null);
  const [editForm, setEditForm] = useState({
    tipoMovimiento: "PRESTAMO_RECIBIDO",
    jabas: 0,
    pesoKg: 0,
    fecha: new Date().toISOString().split("T")[0],
    notas: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const abrirEditarMovimiento = (t: Transaccion) => {
    setEditingTx(t);
    const fechaFormateada = t.fecha ? new Date(t.fecha).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
    setEditForm({
      tipoMovimiento: t.tipo_movimiento,
      jabas: Number(t.jabas),
      pesoKg: Number(t.peso_kg),
      fecha: fechaFormateada,
      notas: t.notas || "",
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/prestamos/transacciones/${editingTx.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedorId: editingTx.proveedor_id,
          productoId: editingTx.producto_id,
          tipoMovimiento: editForm.tipoMovimiento,
          jabas: Number(editForm.jabas),
          pesoKg: Number(editForm.pesoKg),
          fecha: editForm.fecha,
          notas: editForm.notas,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Error actualizando movimiento");
      }
      mostrarToast("Movimiento actualizado exitosamente", "exito");
      setEditingTx(null);
      fetchSaldos();
      await cargarTransacciones(editingTx.proveedor_id);
    } catch (err: unknown) {
      mostrarToast(err instanceof Error ? err.message : "Error al actualizar movimiento", "error");
      console.error(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const eliminarMovimiento = async (t: Transaccion) => {
    const confirmado = window.confirm(
      `¿Seguro que deseas eliminar el movimiento de ${t.jabas} jabas / ${t.peso_kg} kg del ${formatearFechaCorta(t.fecha)}?\n\nEl saldo del proveedor se recalcularemos automáticamente.`
    );
    if (!confirmado) return;

    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/prestamos/transacciones/${t.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Error eliminando movimiento");
      }
      mostrarToast("Movimiento eliminado correctamente", "exito");
      fetchSaldos();
      await cargarTransacciones(t.proveedor_id);
    } catch (err: unknown) {
      mostrarToast(err instanceof Error ? err.message : "Error al eliminar el movimiento", "error");
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  // Buscador, Filtros y Ajuste Directo de Saldo
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"TODOS" | "NOS_DEBEN" | "DEBEMOS" | "SALDADOS">("TODOS");
  const [kardexBusqueda, setKardexBusqueda] = useState("");

  const [ajustarSaldoTarget, setAjustarSaldoTarget] = useState<Saldo | null>(null);
  const [ajusteForm, setAjusteForm] = useState({
    direccion: "NOS_DEBEN" as "NOS_DEBEN" | "DEBEMOS",
    targetJabas: 0,
    targetPesoKg: 0,
    notas: "",
  });
  const [savingAjuste, setSavingAjuste] = useState(false);

  const abrirAjustarSaldo = (s: Saldo) => {
    setAjustarSaldoTarget(s);
    const esPositivo = s.peso_kg > 0 || s.jabas > 0;
    setAjusteForm({
      direccion: esPositivo ? "NOS_DEBEN" : "DEBEMOS",
      targetJabas: Math.abs(Number(s.jabas)),
      targetPesoKg: Math.abs(Number(s.peso_kg)),
      notas: `Ajuste manual directo de saldo`,
    });
  };

  const handleSaveAjuste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ajustarSaldoTarget) return;

    const currentNetJabas = Number(ajustarSaldoTarget.jabas);
    const currentNetPeso = Number(ajustarSaldoTarget.peso_kg);

    const targetNetJabas = ajusteForm.direccion === "NOS_DEBEN" ? Math.abs(ajusteForm.targetJabas) : -Math.abs(ajusteForm.targetJabas);
    const targetNetPeso = ajusteForm.direccion === "NOS_DEBEN" ? Math.abs(ajusteForm.targetPesoKg) : -Math.abs(ajusteForm.targetPesoKg);

    const diffJabas = targetNetJabas - currentNetJabas;
    const diffPeso = targetNetPeso - currentNetPeso;

    if (diffJabas === 0 && diffPeso === 0) {
      mostrarToast("El saldo ingresado es exactamente igual al saldo actual", "info");
      setAjustarSaldoTarget(null);
      return;
    }

    let tipoMovimiento = "PRESTAMO_OTORGADO";
    if (diffPeso < 0 || (diffPeso === 0 && diffJabas < 0)) {
      tipoMovimiento = "DEVOLUCION_RECIBIDA";
    }

    setSavingAjuste(true);
    try {
      const res = await fetch("/api/prestamos/transacciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedorId: ajustarSaldoTarget.proveedor_id,
          productoId: ajustarSaldoTarget.producto_id,
          tipoMovimiento,
          jabas: Math.abs(diffJabas),
          pesoKg: Math.abs(diffPeso),
          fecha: new Date().toISOString().split("T")[0],
          notas: ajusteForm.notas || `Ajuste directo de saldo a ${ajusteForm.targetPesoKg} Kg`,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Error al aplicar ajuste de saldo");
      }

      mostrarToast("Saldo ajustado exitosamente", "exito");
      setAjustarSaldoTarget(null);
      fetchSaldos();
    } catch (err: unknown) {
      mostrarToast(err instanceof Error ? err.message : "Error al aplicar el ajuste", "error");
      console.error(err);
    } finally {
      setSavingAjuste(false);
    }
  };

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

  const cargarTransacciones = async (proveedorId: string) => {
    try {
      const res = await fetch(`/api/prestamos/transacciones?proveedorId=${proveedorId}`);
      const data = await res.json();
      setTransacciones(data.transacciones || []);
    } catch (err) {
      console.error(err);
    }
  };

  const openKardex = async (proveedorId: string, proveedorNombre: string) => {
    setTransacciones([]);
    setKardexProveedorNombre(proveedorNombre);
    setKardexLoading(true);
    setKardexOpen(true);
    await cargarTransacciones(proveedorId);
    setKardexLoading(false);
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

  // Métricas KPI
  const totalNosDebenKg = saldos.filter((s) => s.peso_kg > 0).reduce((acc, s) => acc + Number(s.peso_kg), 0);
  const totalDebemosKg = saldos.filter((s) => s.peso_kg < 0).reduce((acc, s) => acc + Math.abs(Number(s.peso_kg)), 0);
  const saldosActivosCount = saldos.filter((s) => s.peso_kg !== 0 || s.jabas !== 0).length;

  // Filtrado de Saldos en tiempo real
  const saldosFiltrados = saldos.filter((s) => {
    const q = busqueda.toLowerCase().trim();
    const coincideBusqueda =
      !q ||
      s.proveedor_nombre.toLowerCase().includes(q) ||
      s.producto_nombre.toLowerCase().includes(q);

    if (!coincideBusqueda) return false;

    if (filtroEstado === "NOS_DEBEN") return s.peso_kg > 0 || s.jabas > 0;
    if (filtroEstado === "DEBEMOS") return s.peso_kg < 0 || s.jabas < 0;
    if (filtroEstado === "SALDADOS") return s.peso_kg === 0 && s.jabas === 0;

    return true;
  });

  // Filtrado de Transacciones dentro del Kardex
  const transaccionesFiltradas = transacciones.filter((t) => {
    if (!kardexBusqueda.trim()) return true;
    const q = kardexBusqueda.toLowerCase().trim();
    return (
      t.producto_nombre.toLowerCase().includes(q) ||
      (t.notas && t.notas.toLowerCase().includes(q)) ||
      (ETIQUETA_TIPO[t.tipo_movimiento] && ETIQUETA_TIPO[t.tipo_movimiento].toLowerCase().includes(q)) ||
      t.fecha.includes(q)
    );
  });

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
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95 text-sm"
        >
          <FiPlus className="w-5 h-5" /> Registrar Movimiento
        </button>
      </div>

      <GuiaModulo modulo="prestamos" />

      {/* TARJETAS RESUMEN KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Nos Deben (Total)</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{totalNosDebenKg.toFixed(2)} <span className="text-sm font-medium">Kg</span></p>
          </div>
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <FiTrendingUp size={24} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Debemos (Total)</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{totalDebemosKg.toFixed(2)} <span className="text-sm font-medium">Kg</span></p>
          </div>
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center">
            <FiTrendingDown size={24} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saldos Activos</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">{saldosActivosCount} <span className="text-sm font-medium">registros</span></p>
          </div>
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
            <FiCheckCircle size={24} />
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Buscar proveedor o producto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 bg-gray-50/50"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {(["TODOS", "NOS_DEBEN", "DEBEMOS", "SALDADOS"] as const).map((est) => (
            <button
              key={est}
              onClick={() => setFiltroEstado(est)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                filtroEstado === est
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {est === "TODOS" && "Todos"}
              {est === "NOS_DEBEN" && "Nos Deben"}
              {est === "DEBEMOS" && "Debemos"}
              {est === "SALDADOS" && "Saldados"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 animate-pulse">Cargando saldos...</div>
      ) : saldosFiltrados.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-indigo-500">
            <FiAlertCircle size={32} />
          </div>
          <h3 className="font-bold text-gray-800 text-base">No hay saldos para mostrar</h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            {busqueda || filtroEstado !== "TODOS"
              ? "Prueba cambiando los filtros o el texto de búsqueda."
              : "Todos los préstamos y devoluciones de mercadería con los proveedores están al día."}
          </p>
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
                          onClick={() => abrirAjustarSaldo(s)}
                          title="Establecer directamente el saldo objetivo en kilos y jabas"
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer active:scale-95 flex items-center gap-1"
                        >
                          <FiSettings className="w-3.5 h-3.5" /> Ajustar
                        </button>
                        <button
                          onClick={() => openKardex(s.proveedor_id, s.proveedor_nombre)}
                          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1 transition-colors cursor-pointer active:scale-95"
                        >
                          <FiList /> Ver movimientos
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
            <div className="bg-gray-50 p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Historial de Movimientos</h2>
                <p className="text-xs text-gray-500 mt-0.5">{kardexProveedorNombre || "Proveedor"}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                  <input
                    type="text"
                    placeholder="Filtrar historial..."
                    value={kardexBusqueda}
                    onChange={(e) => setKardexBusqueda(e.target.value)}
                    className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
                <button onClick={() => { setKardexOpen(false); setKardexBusqueda(""); }} className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer transition-colors">✕</button>
              </div>
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
                    <th className="p-3 font-semibold text-gray-600 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {kardexLoading ? (
                    <tr>
                      <td colSpan={7} className="py-12 px-4 text-center">
                        <p className="text-sm text-gray-400 animate-pulse">Cargando movimientos...</p>
                      </td>
                    </tr>
                  ) : transaccionesFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 px-4 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-400 space-y-2">
                          <FiList size={32} className="opacity-40 text-indigo-400" />
                          <span className="font-semibold text-gray-700 text-xs">Sin movimientos para mostrar</span>
                          <p className="text-[10px] text-gray-400 max-w-xs mx-auto">
                            {kardexBusqueda ? "No se encontraron resultados con ese criterio de búsqueda." : "No se han registrado movimientos de préstamos ni devoluciones."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : transaccionesFiltradas.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-600">
                        {formatearFechaCorta(t.fecha)}
                      </td>
                      <td className="p-3 font-medium text-gray-900 text-xs">
                        {ETIQUETA_TIPO[t.tipo_movimiento] ?? t.tipo_movimiento.replace('_', ' ')}
                      </td>
                      <td className="p-3 text-gray-600">{t.producto_nombre}</td>
                      <td className="p-3 text-gray-900 text-right">{t.jabas}</td>
                      <td className="p-3 text-gray-900 text-right font-medium">{t.peso_kg} Kg</td>
                      <td className="p-3 text-gray-500 text-xs truncate max-w-[150px]">{t.notas || '-'}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirEditarMovimiento(t)}
                            disabled={deletingId === t.id}
                            title="Editar peso, jabas, fecha u observaciones"
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 transition-colors cursor-pointer active:scale-95 flex items-center gap-1"
                          >
                            <FiEdit2 className="w-3.5 h-3.5" /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => eliminarMovimiento(t)}
                            disabled={deletingId === t.id}
                            title="Eliminar este movimiento de la base de datos"
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50/50 hover:bg-red-100 transition-colors cursor-pointer active:scale-95 flex items-center gap-1 disabled:opacity-50"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                            {deletingId === t.id ? "..." : "Eliminar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => { setKardexOpen(false); setKardexBusqueda(""); }}
                className="px-5 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-medium transition-colors cursor-pointer active:scale-95 border border-gray-200 bg-white text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR MOVIMIENTO */}
      {editingTx && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="bg-gray-50 p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Editar Movimiento de Peso</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {kardexProveedorNombre || "Proveedor"} · {editingTx.producto_nombre}
                </p>
              </div>
              <button
                onClick={() => setEditingTx(null)}
                className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Operación</label>
                <select
                  value={editForm.tipoMovimiento}
                  onChange={(e) => setEditForm({ ...editForm, tipoMovimiento: e.target.value })}
                  className="w-full border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                >
                  <option value="PRESTAMO_RECIBIDO">Recibimos Prestado (nos prestan mercadería)</option>
                  <option value="PRESTAMO_OTORGADO">Prestamos a ellos (les prestamos mercadería)</option>
                  <option value="DEVOLUCION_RECIBIDA">Nos Devuelven (nos devuelven mercadería)</option>
                  <option value="DEVOLUCION_OTORGADA">Devolvemos (devolvemos mercadería)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1.5">{AYUDA_TIPO[editForm.tipoMovimiento]}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Jabas</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editForm.jabas}
                    onChange={(e) => setEditForm({ ...editForm, jabas: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Peso Correcto (Kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editForm.pesoKg}
                    onChange={(e) => setEditForm({ ...editForm, pesoKg: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-indigo-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha del Movimiento</label>
                <input
                  type="date"
                  required
                  value={editForm.fecha}
                  onChange={(e) => setEditForm({ ...editForm, fecha: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas / Justificación</label>
                <input
                  type="text"
                  value={editForm.notas}
                  onChange={(e) => setEditForm({ ...editForm, notas: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm"
                  placeholder="Ej. Corrección de peso digitado erróneamente"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl font-medium transition-colors cursor-pointer active:scale-95 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-md transition-colors disabled:opacity-50 cursor-pointer active:scale-95 text-sm flex items-center gap-2"
                >
                  {savingEdit ? "Guardando..." : "Guardar Cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL AJUSTAR SALDO DIRECTO */}
      {ajustarSaldoTarget && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-gray-50 p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Ajustar Saldo Directo</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {ajustarSaldoTarget.proveedor_nombre} · {ajustarSaldoTarget.producto_nombre}
                </p>
              </div>
              <button
                onClick={() => setAjustarSaldoTarget(null)}
                className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAjuste} className="p-6 space-y-4">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3.5 text-xs text-indigo-900 flex justify-between items-center">
                <div>
                  <span className="font-semibold text-indigo-700 block mb-0.5">Saldo Actual Registrado</span>
                  <span className="text-gray-600">
                    {Math.abs(ajustarSaldoTarget.jabas)} jabas · {Math.abs(ajustarSaldoTarget.peso_kg)} Kg
                  </span>
                </div>
                <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase ${
                  ajustarSaldoTarget.peso_kg > 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                }`}>
                  {ajustarSaldoTarget.peso_kg > 0 ? "Nos Deben" : "Debemos"}
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado del Nuevo Saldo</label>
                <select
                  value={ajusteForm.direccion}
                  onChange={(e) => setAjusteForm({ ...ajusteForm, direccion: e.target.value as "NOS_DEBEN" | "DEBEMOS" })}
                  className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                >
                  <option value="NOS_DEBEN">Nos Deben (El proveedor nos debe a nosotros)</option>
                  <option value="DEBEMOS">Debemos (Nosotros le debemos al proveedor)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Jabas Objetivo</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={ajusteForm.targetJabas}
                    onChange={(e) => setAjusteForm({ ...ajusteForm, targetJabas: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Peso Objetivo (Kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={ajusteForm.targetPesoKg}
                    onChange={(e) => setAjusteForm({ ...ajusteForm, targetPesoKg: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-indigo-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas / Justificación del Ajuste</label>
                <input
                  type="text"
                  value={ajusteForm.notas}
                  onChange={(e) => setAjusteForm({ ...ajusteForm, notas: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 text-sm"
                  placeholder="Ej. Conteo físico en almacén, corrección de inventario"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setAjustarSaldoTarget(null)}
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl font-medium transition-colors cursor-pointer active:scale-95 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingAjuste}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-md transition-colors disabled:opacity-50 cursor-pointer active:scale-95 text-sm flex items-center gap-2"
                >
                  {savingAjuste ? "Aplicando..." : "Aplicar Ajuste"}
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

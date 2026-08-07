// src/app/dashboard/gastos/gastos-client.tsx
// Listado de gastos: KPIs (hoy / mes actual), filtro por categoría (en memoria)
// y por rango de fechas (server-side, GET /api/gastos?desde&hasta).
// Desde el 6 ago 2026 los gastos TAMBIÉN se registran acá, con su fecha real y
// SIN necesidad de tener una caja abierta (antes había que abrir una caja para
// poder escribir un gasto, y la fecha terminaba escrita dentro de la descripción).
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FiAlertCircle,
  FiCalendar,
  FiCreditCard,
  FiEdit2,
  FiFilter,
  FiRefreshCw,
  FiTag,
  FiTrash2,
  FiTrendingDown,
  FiX,
} from "react-icons/fi";
import { fetchParametrosNegocio, PARAMETROS_NEGOCIO_DEFAULT } from "@/lib/parametros-negocio";
import GuiaModulo from "@/components/GuiaModulo";
import FormGasto, { type CuentaSimple } from "./form-gasto";
import { fechaBonita } from "@/lib/gastos/fecha-gasto";

type Gasto = {
  id: string;
  /** Fecha ISO (YYYY-MM-DD) para cálculos. */
  fecha: string;
  /** Fecha lista para mostrar (DD/MM/YYYY). */
  fecha_formateada: string;
  categoria: string;
  descripcion: string | null;
  monto: number;
  metodo_pago: string | null;
  created_by_name: string | null;
};

/** Hoy en zona Lima como YYYY-MM-DD (en-CA formatea exactamente así). */
const hoyLima = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const formatSoles = (val: number) =>
  `S/ ${val.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Paleta de badges por categoría (clases completas para que Tailwind las compile).
const PALETA_BADGE = [
  "bg-red-50 text-red-700 border-red-100",
  "bg-amber-50 text-amber-700 border-amber-100",
  "bg-emerald-50 text-emerald-700 border-emerald-100",
  "bg-sky-50 text-sky-700 border-sky-100",
  "bg-indigo-50 text-indigo-700 border-indigo-100",
  "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100",
  "bg-teal-50 text-teal-700 border-teal-100",
  "bg-orange-50 text-orange-700 border-orange-100",
];

/** Color estable por nombre de categoría (mismo nombre → mismo color siempre). */
const colorCategoria = (categoria: string) => {
  let hash = 0;
  for (let i = 0; i < categoria.length; i++) {
    hash = (hash * 31 + categoria.charCodeAt(i)) >>> 0;
  }
  return PALETA_BADGE[hash % PALETA_BADGE.length];
};

/**
 * Modal para corregir un gasto ya cargado.
 *
 * Es su propio componente para no mezclar su estado con el del formulario de
 * alta: acá los campos arrancan CON valores (los del gasto) y el botón dice qué
 * se está cambiando, no "registrar".
 */
function ModalEditarGasto({
  gasto,
  cuentas,
  categorias,
  onCerrar,
  onGuardado,
  onError,
}: {
  gasto: Gasto;
  cuentas: CuentaSimple[];
  categorias: string[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
  onError: (mensaje: string) => void;
}) {
  const hoy = hoyLima();
  const [fecha, setFecha] = useState(gasto.fecha);
  const [monto, setMonto] = useState(String(gasto.monto));
  const [categoria, setCategoria] = useState(gasto.categoria);
  const [descripcion, setDescripcion] = useState(gasto.descripcion ?? "");
  // La cuenta se identifica por NOMBRE porque es lo que guarda `metodo_pago`.
  const [cuentaId, setCuentaId] = useState(
    cuentas.find((c) => c.nombre === gasto.metodo_pago)?.id ?? ""
  );
  const [guardando, setGuardando] = useState(false);

  // La categoría del gasto puede haber sido retirada del catálogo: igual debe
  // poder verse y conservarse.
  const opciones = useMemo(
    () => Array.from(new Set([gasto.categoria, ...categorias])),
    [gasto.categoria, categorias]
  );

  const inputBase =
    "block w-full rounded-xl border-gray-300 px-3 py-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50";

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) return onError("Ingresa un monto mayor a 0.");

    setGuardando(true);
    try {
      const res = await fetch(`/api/gastos/${gasto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          categoria,
          descripcion: descripcion.trim() || null,
          monto: montoNum,
          ...(cuentaId ? { cuenta_id: cuentaId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(typeof data?.error === "string" ? data.error : "No se pudo corregir el gasto.");
        return;
      }
      onGuardado(`Gasto corregido: quedó con fecha ${fechaBonita(fecha)}.`);
    } catch {
      onError("Error de red al corregir el gasto.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4"
      onClick={() => !guardando && onCerrar()}
    >
      <form
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="bg-gray-50 p-5 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <FiEdit2 className="text-indigo-600" /> Corregir gasto
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer rounded-lg hover:bg-gray-100 transition-all"
          >
            <FiX size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700">
              Fecha del gasto (el día en que se gastó):
            </label>
            <input
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => setFecha(e.target.value || gasto.fecha)}
              className={`${inputBase} ${
                fecha !== hoy ? "border-amber-300 bg-amber-50 text-amber-900 font-bold" : ""
              }`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Monto (S/):</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className={inputBase}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Categoría:</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className={`${inputBase} bg-white`}
              >
                {opciones.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700">
              Pagar con (cuenta o caja):
            </label>
            <select
              value={cuentaId}
              onChange={(e) => setCuentaId(e.target.value)}
              className={`${inputBase} bg-white`}
            >
              {!cuentaId && <option value="">Sin cambios ({gasto.metodo_pago ?? "—"})</option>}
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700">
              Descripción <span className="font-normal text-gray-400">(opcional)</span>:
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              className={inputBase}
            />
          </div>

          <div className="flex justify-end gap-3 pt-1 border-t border-gray-100">
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all cursor-pointer active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95"
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function GastosClient({ esAdmin = false }: { esAdmin?: boolean }) {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // KPIs hoy/mes: se calculan con la carga SIN rango (la vista por defecto ya
  // trae lo más reciente) y se conservan aunque el usuario filtre fechas viejas.
  const [kpisBase, setKpisBase] = useState<{ hoy: number; mes: number }>({ hoy: 0, mes: 0 });

  // Filtros
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  // Categorías configuradas por el admin (se unen con las de los gastos cargados).
  // Arranca con las históricas, NO vacía: con la lista vacía el select del
  // formulario se quedaba sin opciones y mostraba "➕ Nueva categoría…" como si
  // fuera la categoría elegida, y el default terminaba siendo "Otros".
  const [categoriasNegocio, setCategoriasNegocio] = useState<string[]>(
    PARAMETROS_NEGOCIO_DEFAULT.categorias_gasto
  );
  const [cuentas, setCuentas] = useState<CuentaSimple[]>([]);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Corregir o borrar un gasto ya cargado. Antes del 6 ago 2026 un gasto mal
  // cargado quedaba así para siempre: los endpoints existen, faltaba la pantalla.
  const [editando, setEditando] = useState<Gasto | null>(null);
  const [borrando, setBorrando] = useState<Gasto | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  const cargarGastos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      const res = await fetch(`/api/gastos${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Error cargando gastos");
      const data: Gasto[] = await res.json();
      const lista = Array.isArray(data) ? data : [];
      setGastos(lista);

      // Sin rango de fechas la respuesta incluye lo más reciente: es la base
      // correcta para los KPIs de hoy y del mes actual.
      if (!desde && !hasta) {
        const hoy = hoyLima();
        const mesActual = hoy.slice(0, 7); // YYYY-MM
        let totalHoy = 0;
        let totalMes = 0;
        for (const g of lista) {
          if (g.fecha === hoy) totalHoy += g.monto;
          if (g.fecha.startsWith(mesActual)) totalMes += g.monto;
        }
        setKpisBase({ hoy: totalHoy, mes: totalMes });
      }
    } catch (err) {
      console.error(err);
      setError("No se pudieron cargar los gastos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    cargarGastos();
  }, [cargarGastos]);

  useEffect(() => {
    let activo = true;
    fetchParametrosNegocio().then((p) => {
      if (activo) setCategoriasNegocio(p.categorias_gasto);
    });
    // Cuentas activas para el selector "Pagar con". Si falla, el formulario
    // queda sin opciones pero la consulta de gastos sigue funcionando.
    fetch("/api/cuentas")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{ id: string; nombre: string; activa?: boolean }>) => {
        if (!activo) return;
        const lista = Array.isArray(data) ? data : [];
        setCuentas(
          lista
            .filter((c) => c.activa !== false)
            .map((c) => ({ id: c.id, nombre: c.nombre }))
        );
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, []);

  // Opciones del filtro: categorías configuradas + las presentes en los gastos.
  const categoriasDisponibles = useMemo(() => {
    const set = new Set<string>(categoriasNegocio);
    gastos.forEach((g) => {
      if (g.categoria) set.add(g.categoria);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [categoriasNegocio, gastos]);

  const gastosFiltrados = useMemo(() => {
    if (filtroCategoria === "todas") return gastos;
    return gastos.filter((g) => g.categoria === filtroCategoria);
  }, [gastos, filtroCategoria]);

  const totalListado = useMemo(
    () => gastosFiltrados.reduce((acc, g) => acc + g.monto, 0),
    [gastosFiltrados]
  );

  const hayFiltros = filtroCategoria !== "todas" || desde !== "" || hasta !== "";

  const limpiarFiltros = () => {
    setFiltroCategoria("todas");
    setDesde("");
    setHasta("");
  };

  const eliminarGasto = async () => {
    if (!borrando) return;
    setGuardandoEdicion(true);
    try {
      const res = await fetch(`/api/gastos/${borrando.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({
          tipo: "error",
          texto: typeof data?.error === "string" ? data.error : "No se pudo eliminar el gasto.",
        });
        return;
      }
      setAviso({
        tipo: "ok",
        texto: `Gasto de ${formatSoles(borrando.monto)} eliminado. El dinero volvió a ${borrando.metodo_pago ?? "la cuenta"}.`,
      });
      setBorrando(null);
      cargarGastos();
    } catch {
      setAviso({ tipo: "error", texto: "Error de red al eliminar el gasto." });
    } finally {
      setGuardandoEdicion(false);
    }
  };

  return (
    <div className="space-y-6">
      <GuiaModulo modulo="gastos" />

      {aviso && (
        <div
          className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${
            aviso.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {aviso.texto}
        </div>
      )}

      {/* Registrar un gasto SIN depender de la caja: es la pantalla donde se
          carga el mes atrasado. */}
      <FormGasto
        cuentas={cuentas}
        categorias={categoriasNegocio}
        cuentaPorDefecto={
          // La mayoría de los gastos salen del efectivo de planta: es el default
          // que ya usa la pantalla de Caja.
          cuentas.find((c) => c.nombre === "Caja Efectivo Planta")?.id ?? cuentas[0]?.id
        }
        onRegistrado={({ fecha, esRetroactivo }: { fecha: string; esRetroactivo: boolean }) => {
          setAviso({
            tipo: "ok",
            texto: esRetroactivo
              ? `Gasto del ${fechaBonita(fecha)} registrado. Como es de otro día, no afecta el arqueo de la caja de hoy.`
              : "Gasto registrado.",
          });
          cargarGastos();
        }}
        onError={(texto: string) => setAviso({ tipo: "error", texto })}
        esAdmin={esAdmin}
        onCategoriaAgregada={({ lista, valor, yaExistia }) => {
          setCategoriasNegocio(lista);
          setAviso({
            tipo: "ok",
            texto: yaExistia
              ? `"${valor}" ya estaba en tus categorías: la dejamos seleccionada.`
              : `"${valor}" agregada a tus categorías.`,
          });
        }}
      />

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-center justify-between shadow-sm">
          <span className="text-xs font-semibold flex items-center gap-2">
            <FiAlertCircle size={16} /> {error}
          </span>
          <button
            onClick={cargarGastos}
            className="text-xs font-bold text-red-700 hover:text-red-900 flex items-center gap-1 cursor-pointer"
          >
            <FiRefreshCw size={13} /> Reintentar
          </button>
        </div>
      )}

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Gastado hoy
            </span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(kpisBase.hoy)}
            </span>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <FiTrendingDown size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Gastado este mes
            </span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(kpisBase.mes)}
            </span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <FiCalendar size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Total del listado
            </span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(totalListado)}
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              {gastosFiltrados.length} {gastosFiltrados.length === 1 ? "gasto" : "gastos"}
              {hayFiltros ? " (con filtros)" : ""}
            </span>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <FiTag size={20} />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-end gap-4">
        <div className="w-full md:w-56">
          <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiFilter size={12} /> Categoría
          </label>
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer"
          >
            <option value="todas">Todas las categorías</option>
            {categoriasDisponibles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full md:w-44">
          <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiCalendar size={12} /> Desde
          </label>
          <input
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>
        <div className="w-full md:w-44">
          <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiCalendar size={12} /> Hasta
          </label>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>
        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 whitespace-nowrap self-stretch md:self-auto flex items-center justify-center gap-1"
          >
            <FiX size={14} /> Limpiar filtros
          </button>
        )}
      </div>

      {/* Listado */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-20 text-gray-400 animate-pulse">Cargando gastos...</div>
        ) : gastosFiltrados.length === 0 ? (
          <div className="text-center py-16 space-y-3 px-4">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500">
              <FiTrendingDown size={32} />
            </div>
            {hayFiltros ? (
              <>
                <h3 className="font-bold text-gray-800 text-base">Sin resultados</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  No se encontraron gastos con los filtros seleccionados.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-bold text-gray-800 text-base">No hay gastos aún</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Los gastos se registran desde{" "}
                  <Link
                    href="/dashboard/caja-diaria"
                    className="text-red-600 font-semibold underline hover:text-red-700"
                  >
                    Caja Diaria
                  </Link>
                  . Cuando registres uno, aparecerá aquí.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Tabla (desktop) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                    <th className="py-4 px-6">Fecha</th>
                    <th className="py-4 px-4">Categoría</th>
                    <th className="py-4 px-4">Descripción</th>
                    <th className="py-4 px-4">Método de pago</th>
                    <th className="py-4 px-4 text-right">Monto</th>
                    <th className="py-4 px-6">Registrado por</th>
                    <th className="py-4 px-4 text-right">Corregir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {gastosFiltrados.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-6 font-medium text-gray-900 whitespace-nowrap">
                        {g.fecha_formateada}
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border w-max inline-block ${colorCategoria(g.categoria)}`}
                        >
                          {g.categoria}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-gray-600 max-w-xs">
                        {g.descripcion || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-4 px-4 text-gray-600">
                        {g.metodo_pago ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                            <FiCreditCard size={12} className="text-gray-400" /> {g.metodo_pago}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right text-gray-900 font-extrabold text-sm whitespace-nowrap">
                        {formatSoles(g.monto)}
                      </td>
                      <td className="py-4 px-6 text-gray-600">
                        {g.created_by_name?.trim() || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditando(g)}
                            title="Corregir este gasto (fecha, monto, categoría…)"
                            className="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg p-2 transition-all cursor-pointer"
                          >
                            <FiEdit2 size={14} />
                          </button>
                          {esAdmin && (
                            <button
                              type="button"
                              onClick={() => setBorrando(g)}
                              title="Eliminar este gasto"
                              className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-2 transition-all cursor-pointer"
                            >
                              <FiTrash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (móvil) */}
            <div className="md:hidden divide-y divide-gray-50">
              {gastosFiltrados.map((g) => (
                <div key={g.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border w-max inline-block ${colorCategoria(g.categoria)}`}
                      >
                        {g.categoria}
                      </span>
                      {g.descripcion && (
                        <p className="text-xs text-gray-600 mt-1.5 break-words">{g.descripcion}</p>
                      )}
                    </div>
                    <span className="text-base font-extrabold text-gray-900 whitespace-nowrap">
                      {formatSoles(g.monto)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <FiCalendar size={10} /> {g.fecha_formateada}
                    </span>
                    {g.metodo_pago && (
                      <span className="inline-flex items-center gap-1">
                        <FiCreditCard size={10} /> {g.metodo_pago}
                      </span>
                    )}
                    {g.created_by_name?.trim() && (
                      <span className="font-medium text-gray-500">
                        Registró: {g.created_by_name.trim()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditando(g)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-2.5 py-1.5 transition-all cursor-pointer active:scale-95"
                    >
                      <FiEdit2 size={11} /> Corregir
                    </button>
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => setBorrando(g)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg px-2.5 py-1.5 transition-all cursor-pointer active:scale-95"
                      >
                        <FiTrash2 size={11} /> Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {editando && (
        <ModalEditarGasto
          gasto={editando}
          cuentas={cuentas}
          categorias={categoriasDisponibles}
          onCerrar={() => setEditando(null)}
          onGuardado={(texto) => {
            setEditando(null);
            setAviso({ tipo: "ok", texto });
            cargarGastos();
          }}
          onError={(texto) => setAviso({ tipo: "error", texto })}
        />
      )}

      {/* Confirmación de borrado: muestra QUÉ se va a borrar y a dónde vuelve la
          plata, para que no haya que adivinar. */}
      {borrando && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4"
          onClick={() => !guardandoEdicion && setBorrando(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="p-6 space-y-4">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <FiTrash2 className="text-red-500" /> ¿Eliminar este gasto?
              </h2>
              <div className="bg-gray-50 rounded-2xl p-4 space-y-1 text-xs text-gray-700">
                <p className="font-extrabold text-gray-900 text-sm">{formatSoles(borrando.monto)}</p>
                <p>
                  {borrando.categoria}
                  {borrando.descripcion ? ` · ${borrando.descripcion}` : ""}
                </p>
                <p className="text-gray-500">Del {borrando.fecha_formateada}</p>
              </div>
              <p className="text-xs text-gray-500">
                El dinero vuelve a <b>{borrando.metodo_pago ?? "la cuenta de origen"}</b>. Esto no se
                puede deshacer.
              </p>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setBorrando(null)}
                  disabled={guardandoEdicion}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all cursor-pointer active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={eliminarGasto}
                  disabled={guardandoEdicion}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95"
                >
                  {guardandoEdicion ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

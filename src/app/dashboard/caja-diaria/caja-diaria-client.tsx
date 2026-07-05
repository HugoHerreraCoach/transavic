// src/app/dashboard/caja-diaria/caja-diaria-client.tsx
"use client";

import { useState, useEffect } from "react";
import {
  FiDollarSign, FiTrendingUp, FiTrendingDown, FiLock,
  FiPlus, FiList, FiCalendar, FiAlertCircle, FiCheckCircle
} from "react-icons/fi";
import { usePollingVisible } from "@/lib/use-polling-visible";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

type Transaction = {
  id: string;
  monto: number;
  tipo: "ingreso" | "egreso";
  concepto: string;
  created_at: string;
  cuenta_nombre: string;
  cuenta_tipo: string;
};

type ActiveBox = {
  id: string;
  fecha: string;
  monto_apertura: number;
  monto_ingresos: number;
  monto_egresos: number;
  monto_estimado: number;
  estado: string;
  abierta_at: string;
  transacciones: Transaction[];
};

type ClosedBox = {
  id: string;
  fecha: string;
  monto_apertura: number;
  monto_ingresos: number;
  monto_egresos: number;
  monto_cierre_real: number;
  monto_cierre_calculado: number;
  estado: string;
  abierta_at: string;
  cerrada_at: string;
  abierta_por_name: string;
  cerrada_por_name: string;
};

type Account = {
  id: string;
  nombre: string;
};

// Denominaciones vigentes en Perú para el arqueo físico de caja
const BILLETES = [
  { valor: 200, etiqueta: "S/ 200" },
  { valor: 100, etiqueta: "S/ 100" },
  { valor: 50, etiqueta: "S/ 50" },
  { valor: 20, etiqueta: "S/ 20" },
  { valor: 10, etiqueta: "S/ 10" },
];
const MONEDAS = [
  { valor: 5, etiqueta: "S/ 5" },
  { valor: 2, etiqueta: "S/ 2" },
  { valor: 1, etiqueta: "S/ 1" },
  { valor: 0.5, etiqueta: "S/ 0.50" },
  { valor: 0.2, etiqueta: "S/ 0.20" },
  { valor: 0.1, etiqueta: "S/ 0.10" },
];

export default function CajaDiariaClient() {
  const [active, setActive] = useState<boolean>(false);
  const [caja, setCaja] = useState<ActiveBox | null>(null);
  const [historial, setHistorial] = useState<ClosedBox[]>([]);
  const [cuentas, setCuentas] = useState<Account[]>([]);
  
  // Form states
  const [montoApertura, setMontoApertura] = useState<string>("");
  const [montoCierreReal, setMontoCierreReal] = useState<string>("");
  const [gastoMonto, setGastoMonto] = useState<string>("");
  const [gastoCategoria, setGastoCategoria] = useState<string>("Almuerzo");
  const [gastoDescripcion, setGastoDescripcion] = useState<string>("");
  const [gastoCuentaId, setGastoCuentaId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [aperturaLoading, setAperturaLoading] = useState(false);
  const [gastoLoading, setGastoLoading] = useState(false);
  const [cierreLoading, setCierreLoading] = useState(false);

  // Mini-modal de confirmación del cierre de caja (acción irreversible)
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  // Arqueo por denominaciones
  const [contarDenominaciones, setContarDenominaciones] = useState(false);
  const [denomCantidades, setDenomCantidades] = useState<Record<string, string>>({});

  const { mostrarToast, toasts } = useToast();

  // Total contado en vivo a partir de las denominaciones (redondeado para evitar flotantes)
  const totalDenominaciones = Math.round(
    [...BILLETES, ...MONEDAS].reduce((acc, d) => {
      const cantidad = Number(denomCantidades[String(d.valor)]);
      return acc + (Number.isFinite(cantidad) && cantidad > 0 ? cantidad * d.valor : 0);
    }, 0) * 100
  ) / 100;
  const montoManual = Number(montoCierreReal);
  const montoContado = contarDenominaciones
    ? totalDenominaciones
    : (Number.isFinite(montoManual) ? montoManual : 0);
  const estimado = caja?.monto_estimado ?? 0;
  const diferenciaVivo = Math.round((montoContado - estimado) * 100) / 100;
  const cuadra = Math.abs(diferenciaVivo) <= 0.1;

  const fetchCajaData = async () => {
    try {
      const res = await fetch("/api/caja-diaria");
      if (res.ok) {
        const data = await res.json();
        setActive(data.active);
        setCaja(data.caja);
        setHistorial(data.historial || []);
      }
    } catch (error) {
      console.error("Error al obtener datos de caja:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCuentas = async () => {
    try {
      const res = await fetch("/api/cuentas");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setCuentas(data);
          // Seleccionar por defecto la Caja Efectivo Planta si existe
          const cashAcc = data.find(c => c.nombre === "Caja Efectivo Planta");
          if (cashAcc) {
            setGastoCuentaId(cashAcc.id);
          } else if (data.length > 0) {
            setGastoCuentaId(data[0].id);
          }
        }
      }
    } catch (error) {
      console.error("Error al cargar cuentas:", error);
    }
  };

  useEffect(() => {
    fetchCuentas();
  }, []);

  // Refresco automático de ingresos/egresos cada 30 s (pausa solo cuando la
  // pestaña está oculta; la llamada inicial también la hace este hook)
  usePollingVisible(fetchCajaData, 30_000);

  const handleApertura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!montoApertura || Number(montoApertura) < 0) return mostrarToast("Ingresa un monto de apertura válido", "error");

    setAperturaLoading(true);
    try {
      const res = await fetch("/api/caja-diaria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto_apertura: Number(montoApertura) }),
      });

      if (res.ok) {
        mostrarToast("Caja abierta exitosamente", "exito");
        setMontoApertura("");
        fetchCajaData();
      } else {
        const err = await res.json();
        mostrarToast(err.error || "Error al abrir la caja", "error");
      }
    } catch {
      mostrarToast("Error de red", "error");
    } finally {
      setAperturaLoading(false);
    }
  };

  const handleCierre = (e: React.FormEvent) => {
    e.preventDefault();
    const montoFinal = contarDenominaciones ? totalDenominaciones : Number(montoCierreReal);
    if (!Number.isFinite(montoFinal) || montoFinal < 0 || (!contarDenominaciones && montoCierreReal === "")) {
      return mostrarToast("Ingresa un monto de arqueo real válido", "error");
    }

    setConfirmarCierre(true);
  };

  const ejecutarCierre = async () => {
    const montoFinal = contarDenominaciones ? totalDenominaciones : Number(montoCierreReal);

    setCierreLoading(true);
    try {
      const res = await fetch("/api/caja-diaria", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto_cierre_real: montoFinal }),
      });

      if (res.ok) {
        const result = await res.json();
        mostrarToast(
          `Caja cerrada. Calculado S/ ${result.calculado.toFixed(2)} · Real S/ ${result.real.toFixed(2)} · Diferencia S/ ${result.diferencia.toFixed(2)}`,
          "exito"
        );
        setMontoCierreReal("");
        setDenomCantidades({});
        setContarDenominaciones(false);
        setConfirmarCierre(false);
        fetchCajaData();
      } else {
        const err = await res.json();
        mostrarToast(err.error || "Error al cerrar la caja", "error");
      }
    } catch {
      mostrarToast("Error de red", "error");
    } finally {
      setCierreLoading(false);
    }
  };

  const handleGasto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gastoMonto || Number(gastoMonto) <= 0) return mostrarToast("Ingresa un monto de gasto válido", "error");
    if (!gastoCuentaId) return mostrarToast("Selecciona la caja/cuenta de origen para el pago", "error");

    setGastoLoading(true);
    try {
      const res = await fetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: new Date().toISOString().split("T")[0],
          categoria: gastoCategoria,
          descripcion: gastoDescripcion || "",
          monto: Number(gastoMonto),
          cuenta_id: gastoCuentaId
        }),
      });

      if (res.ok) {
        mostrarToast("Gasto registrado exitosamente", "exito");
        setGastoMonto("");
        setGastoDescripcion("");
        fetchCajaData();
      } else {
        const err = await res.json();
        mostrarToast(err.error || "Error al registrar el gasto", "error");
      }
    } catch {
      mostrarToast("Error de red", "error");
    } finally {
      setGastoLoading(false);
    }
  };

  // Fila de conteo de una denominación (billete o moneda)
  const filaDenominacion = (d: { valor: number; etiqueta: string }) => {
    const key = String(d.valor);
    const cantidad = Number(denomCantidades[key]);
    const subtotal = Number.isFinite(cantidad) && cantidad > 0 ? cantidad * d.valor : 0;
    return (
      <div key={key} className="flex items-center gap-2">
        <span className="w-14 text-xs font-semibold text-gray-700 shrink-0">{d.etiqueta}</span>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={denomCantidades[key] ?? ""}
          onChange={(e) => setDenomCantidades(prev => ({ ...prev, [key]: e.target.value }))}
          placeholder="0"
          className="w-full min-w-0 text-center border border-gray-300 rounded-xl py-3 px-1 text-base font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
        />
        <span className="w-[70px] text-right text-xs font-bold text-gray-900 shrink-0">S/ {subtotal.toFixed(2)}</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Caja Diaria</h1>
          <p className="text-sm text-gray-500">
            Control de efectivo de mostrador, arqueos y egresos manuales de la planta.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-gray-600 bg-gray-100 p-2 rounded-xl border border-gray-200">
          <FiCalendar />
          <span>LIMA, PERÚ (UTC-5)</span>
        </div>
      </div>

      <GuiaModulo modulo="caja-diaria" />

      {!active ? (
        /* PANTALLA DE APERTURA */
        <div className="max-w-md mx-auto bg-white rounded-3xl p-8 border border-gray-100 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <FiLock size={28} />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Apertura de Caja Chica</h2>
            <p className="text-xs text-gray-500">
              La caja se encuentra actualmente cerrada. Inicie la jornada ingresando el efectivo físico inicial.
            </p>
          </div>

          <form onSubmit={handleApertura} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Monto Inicial en Efectivo (S/):</label>
              <div className="relative rounded-xl shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <span className="text-gray-500 sm:text-xs">S/</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  autoFocus
                  value={montoApertura}
                  onChange={(e) => setMontoApertura(e.target.value)}
                  placeholder="0.00"
                  className="block w-full rounded-xl border-gray-300 pl-8 pr-3 py-3 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={aperturaLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold text-sm shadow-md transition-colors active:scale-98"
            >
              {aperturaLoading ? "Abriendo..." : "Abrir Caja"}
            </button>
          </form>
        </div>
      ) : (
        /* PANTALLA OPERATIVA */
        <div className="space-y-8">
          {/* Tarjetas de Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Apertura</span>
                <span className="text-xl font-extrabold text-gray-900 mt-1 block">S/ {caja?.monto_apertura.toFixed(2)}</span>
              </div>
              <div className="p-3 bg-gray-50 text-gray-500 rounded-xl">
                <FiLock size={20} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Ventas Efectivo</span>
                <span className="text-xl font-extrabold text-green-600 mt-1 block">S/ {caja?.monto_ingresos.toFixed(2)}</span>
              </div>
              <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                <FiTrendingUp size={20} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Gastos Planta</span>
                <span className="text-xl font-extrabold text-red-600 mt-1 block">S/ {caja?.monto_egresos.toFixed(2)}</span>
              </div>
              <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                <FiTrendingDown size={20} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between ring-2 ring-indigo-500/20">
              <div>
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block">Efectivo Estimado</span>
                <span className="text-xl font-black text-indigo-600 mt-1 block">S/ {caja?.monto_estimado.toFixed(2)}</span>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <FiDollarSign size={20} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Formulario de Gastos */}
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FiPlus className="text-indigo-600" /> Registrar Gasto (Egreso de Caja)
              </h3>
              
              <form onSubmit={handleGasto} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-700">Monto Gasto (S/):</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={gastoMonto}
                      onChange={(e) => setGastoMonto(e.target.value)}
                      placeholder="0.00"
                      className="block w-full rounded-xl border-gray-300 px-3 py-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-700">Categoría:</label>
                    <select
                      value={gastoCategoria}
                      onChange={(e) => setGastoCategoria(e.target.value)}
                      className="block w-full rounded-xl border-gray-300 px-3 py-2.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="Almuerzo">Almuerzo</option>
                      <option value="Limpieza">Útiles de Limpieza</option>
                      <option value="Combustible">Combustible</option>
                      <option value="Útiles">Útiles de Oficina</option>
                      <option value="Mantenimiento">Mantenimiento local</option>
                      <option value="Sencillo">Cambio/Sencillo</option>
                      <option value="Otros">Otros gastos</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-700">Pagar con (Cuenta/Caja):</label>
                  <select
                    value={gastoCuentaId}
                    onChange={(e) => setGastoCuentaId(e.target.value)}
                    className="block w-full rounded-xl border-gray-300 px-3 py-2.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {cuentas.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-700">Descripción:</label>
                  <input
                    type="text"
                    required
                    value={gastoDescripcion}
                    onChange={(e) => setGastoDescripcion(e.target.value)}
                    placeholder="Ej: Pago almuerzo personal producción"
                    className="block w-full rounded-xl border-gray-300 px-3 py-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={gastoLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold text-xs shadow-md transition-all active:scale-98"
                >
                  {gastoLoading ? "Registrando..." : "Registrar Gasto"}
                </button>
              </form>
            </div>

            {/* Cierre de Caja */}
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FiLock className="text-red-500" /> Cierre Ciego de Caja (Arqueo)
              </h3>
              
              <p className="text-xs text-gray-500 leading-relaxed">
                Digite el monto total de dinero físico (efectivo) que cuenta realmente en la caja de mostrador al final del día. El sistema guardará el arqueo e informará al administrador de cualquier cuadre o descuadre de dinero.
              </p>

              <form onSubmit={handleCierre} className="space-y-4">
                {/* Toggle de arqueo por denominaciones */}
                <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={contarDenominaciones}
                    onChange={(e) => setContarDenominaciones(e.target.checked)}
                    className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                  />
                  <span className="text-xs font-semibold text-gray-700">Contar billetes y monedas</span>
                </label>

                {contarDenominaciones && (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      <div className="space-y-1.5">
                        <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Billetes</span>
                        {BILLETES.map(d => filaDenominacion(d))}
                      </div>
                      <div className="space-y-1.5">
                        <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Monedas</span>
                        {MONEDAS.map(d => filaDenominacion(d))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                      <span className="text-xs font-bold text-gray-600">Total contado:</span>
                      <span className="text-base font-black text-gray-900">S/ {totalDenominaciones.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-700">
                    Efectivo Físico Contado (S/):
                    {contarDenominaciones && (
                      <span className="ml-1 font-normal text-gray-400">(se llena solo con el conteo)</span>
                    )}
                  </label>
                  <div className="relative rounded-xl shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-gray-500 sm:text-xs">S/</span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      readOnly={contarDenominaciones}
                      value={contarDenominaciones ? totalDenominaciones.toFixed(2) : montoCierreReal}
                      onChange={(e) => { if (!contarDenominaciones) setMontoCierreReal(e.target.value); }}
                      placeholder="0.00"
                      className={`block w-full rounded-xl border-gray-300 pl-8 pr-3 py-3 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 font-bold ${
                        contarDenominaciones
                          ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                          : "bg-gray-50 text-gray-900"
                      }`}
                    />
                  </div>
                </div>

                {/* Diferencia en vivo contra el efectivo estimado */}
                {(contarDenominaciones || montoCierreReal !== "") && (
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold border ${
                    cuadra
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "bg-red-50 border-red-200 text-red-600"
                  }`}>
                    {cuadra ? <FiCheckCircle size={16} className="shrink-0" /> : <FiAlertCircle size={16} className="shrink-0" />}
                    <span>
                      Diferencia vs. estimado (S/ {estimado.toFixed(2)}): {diferenciaVivo > 0 ? "+" : ""}{diferenciaVivo.toFixed(2)}
                      {cuadra ? " · Cuadra" : diferenciaVivo < 0 ? " · Faltante" : " · Sobrante"}
                    </span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={cierreLoading}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl py-3.5 font-bold text-xs shadow-md transition-all active:scale-98"
                >
                  {cierreLoading ? "Cerrando..." : "Confirmar Cierre de Caja"}
                </button>
              </form>
            </div>
          </div>

          {/* Transacciones de la Caja Activa */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <FiList className="text-indigo-600" /> Transacciones del Turno Activo
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                    <th className="py-3 px-4">Hora</th>
                    <th className="py-3 px-4">Concepto</th>
                    <th className="py-3 px-4">Medio / Cuenta</th>
                    <th className="py-3 px-4">Tipo</th>
                    <th className="py-3 px-4 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {caja?.transacciones && caja.transacciones.length > 0 ? (
                    caja.transacciones.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 text-gray-400">
                          {new Date(t.created_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-3 px-4 font-medium text-gray-800">{t.concepto}</td>
                        <td className="py-3 px-4 text-gray-500">{t.cuenta_nombre}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            t.tipo === "ingreso"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}>
                            {t.tipo === "ingreso" ? "Ingreso" : "Egreso"}
                          </span>
                        </td>
                        <td className={`py-3 px-4 text-right font-bold ${
                          t.tipo === "ingreso" ? "text-green-600" : "text-red-600"
                        }`}>
                          S/ {Number(t.monto).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-12 px-4 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-400 space-y-2">
                          <FiList size={32} className="opacity-40 animate-pulse text-indigo-400" />
                          <span className="font-semibold text-gray-700 text-xs">No hay transacciones en este turno</span>
                          <p className="text-[10px] text-gray-400 max-w-xs mx-auto">Los cobros del POS de planta y los gastos registrados aparecerán aquí en tiempo real.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Historial de Cajas */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <FiLock className="text-gray-400" /> Historial de Arqueos y Cierres
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Apertura</th>
                <th className="py-3 px-4">Ingresos (Efectivo)</th>
                <th className="py-3 px-4">Egresos (Efectivo)</th>
                <th className="py-3 px-4 text-right">Calculado</th>
                <th className="py-3 px-4 text-right">Real (Arqueo)</th>
                <th className="py-3 px-4 text-right">Diferencia</th>
                <th className="py-3 px-4">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {historial.length > 0 ? (
                historial.map(h => {
                  const dif = h.monto_cierre_real - h.monto_cierre_calculado;
                  
                  return (
                    <tr key={h.id} className="hover:bg-gray-50/50">
                      <td className="py-3 px-4 text-gray-500 font-medium">
                        {new Date(h.fecha).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Lima" })}
                      </td>
                      <td className="py-3 px-4 text-gray-600">S/ {h.monto_apertura.toFixed(2)}</td>
                      <td className="py-3 px-4 text-green-600 font-semibold">+ S/ {h.monto_ingresos.toFixed(2)}</td>
                      <td className="py-3 px-4 text-red-500">- S/ {h.monto_egresos.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-gray-600 font-medium">S/ {h.monto_cierre_calculado.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-gray-900 font-extrabold">S/ {h.monto_cierre_real.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right">
                        {dif === 0 ? (
                          <span className="text-gray-400 font-semibold">S/ 0.00 (Cuadrado)</span>
                        ) : dif < 0 ? (
                          <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-lg">
                            S/ {dif.toFixed(2)} (Faltante)
                          </span>
                        ) : (
                          <span className="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-lg">
                            S/ +{dif.toFixed(2)} (Sobrante)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-500">
                        {h.cerrada_por_name || h.abierta_por_name}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 px-4 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-400 space-y-2">
                      <FiLock size={32} className="opacity-40 text-gray-400" />
                      <span className="font-semibold text-gray-700 text-xs">Historial de cierres vacío</span>
                      <p className="text-[10px] text-gray-400 max-w-xs mx-auto">Los arqueos y cierres ciegos de días anteriores se archivarán en esta sección.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mini-modal de confirmación del cierre de caja */}
      {confirmarCierre && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 print:hidden"
          onClick={() => !cierreLoading && setConfirmarCierre(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <FiLock className="text-red-500" /> ¿Cerrar la caja del día?
            </h3>

            <div className="rounded-xl border border-gray-200 bg-gray-50/60 divide-y divide-gray-200 text-sm">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-gray-600">Calculado</span>
                <span className="font-bold text-gray-900">S/ {estimado.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-gray-600">Contado</span>
                <span className="font-bold text-gray-900">S/ {montoContado.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-gray-600">Diferencia</span>
                <span className={`flex items-center gap-1.5 font-bold ${cuadra ? "text-green-600" : "text-red-600"}`}>
                  {cuadra ? <FiCheckCircle size={14} className="shrink-0" /> : <FiAlertCircle size={14} className="shrink-0" />}
                  S/ {diferenciaVivo > 0 ? "+" : ""}{diferenciaVivo.toFixed(2)}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-500">Esta acción no se puede deshacer.</p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirmarCierre(false)}
                disabled={cierreLoading}
                className="w-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-xl py-3 font-bold text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={ejecutarCierre}
                disabled={cierreLoading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold text-sm shadow-md transition-colors"
              >
                {cierreLoading ? "Cerrando..." : "Sí, cerrar caja"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  FiTrendingUp,
  FiBriefcase,
  FiDollarSign,
  FiArrowUpRight,
  FiArrowDownRight,
  FiPercent,
  FiList,
  FiRefreshCw,
  FiUser,
  FiActivity,
  FiAlertTriangle
} from "react-icons/fi";
import GuiaModulo from "@/components/GuiaModulo";

type Cuenta = {
  id: string;
  nombre: string;
  tipo: string;
  saldo: number;
};

type Transaccion = {
  id: string;
  cuenta_id: string;
  cuenta_nombre: string;
  tipo: "ingreso" | "egreso";
  monto: number;
  concepto: string;
  created_at: string;
  usuario_name: string;
};

type ConsolidadoData = {
  cuentas: Cuenta[];
  totalCobrar: number; // cartera de ejecutivas (facturas)
  carteraPlanta: number; // cartera de planta (POS)
  carteraCampo: number; // cartera de campo (Clientes Avícola)
  totalPagar: number;
  saldoFavorProveedores: number;
  transacciones: Transaccion[];
  ventasHoy: {
    total_ventas: number; // total de las tres operaciones (alias de total_todas)
    ventas_pos: number;
    ventas_asesor: number;
    ventas_asesor_registradas: number;
    ventas_asesor_valorizadas: number;
    ventas_asesor_pendientes: number;
    ventas_campo: number;
    total_todas: number; // ejecutivas + planta + campo
  };
};

type RentabilidadData = {
  costoCompraPorKg: number;
  mermaPorcentaje: number;
  rendimientoPorcentaje: number;
  costoRealPorKg: number;
  precioVentaPromedio: number;
  margenUtilidadPorKg: number;
  utilidadProyectada: number;
};

type ComparativoDia = { monto: number; pedidos: number; ejecutivasPorValorizar: number };
type Comparativo = { hoy: ComparativoDia; ayer: ComparativoDia };

export default function ConsolidadoClient() {
  const [data, setData] = useState<ConsolidadoData | null>(null);
  const [rentabilidad, setRentabilidad] = useState<RentabilidadData | null>(null);
  const [comparativo, setComparativo] = useState<Comparativo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);

  const fetchAllData = async () => {
    setRefreshing(true);
    setErrorCarga(false);
    try {
      const today = new Date();
      const lastMonth = new Date();
      lastMonth.setDate(today.getDate() - 30);
      const todayStr = today.toISOString().split("T")[0];
      const lastMonthStr = lastMonth.toISOString().split("T")[0];

      const [conRes, rentRes] = await Promise.all([
        fetch("/api/consolidado"),
        fetch(`/api/rentabilidad?fechaInicio=${lastMonthStr}&fechaFin=${todayStr}`)
      ]);

      if (conRes.ok) {
        const conData = await conRes.json();
        setData(conData);
      } else {
        setErrorCarga(true);
      }
      if (rentRes.ok) {
        const rentData = await rentRes.json();
        setRentabilidad(rentData.resumen);
        setComparativo(rentData.comparativo ?? null);
      } else {
        setErrorCarga(true);
      }
    } catch (err) {
      console.error("Error al cargar consolidado:", err);
      setErrorCarga(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Suma total en efectivo y bancos
  const totalLiquidez = useMemo(() => {
    if (!data?.cuentas) return 0;
    return data.cuentas.reduce((acc, c) => acc + c.saldo, 0);
  }, [data]);

  // Cartera total por cobrar = ejecutivas (facturas) + planta (POS) + campo (avícola).
  const carteraTotal = useMemo(() => {
    if (!data) return 0;
    return (data.totalCobrar || 0) + (data.carteraPlanta || 0) + (data.carteraCampo || 0);
  }, [data]);

  // Balance Neto Comercial (Lo que te deben en total - Cuentas por Pagar)
  const balanceNeto = useMemo(() => {
    if (!data) return 0;
    return carteraTotal + (data.saldoFavorProveedores || 0) - data.totalPagar;
  }, [data, carteraTotal]);

  // Formateador de moneda defensivo
  const formatSoles = (val: number | null | undefined) => {
    const num = val !== null && val !== undefined && !isNaN(Number(val)) ? Number(val) : 0;
    return `S/ ${num.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="text-gray-500 text-sm font-medium animate-pulse">Generando vista consolidada...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiActivity className="text-indigo-600 animate-pulse" /> Consolidado Gerencial
          </h1>
          <p className="text-xs text-gray-500 mt-1">Resumen en tiempo real del flujo financiero, dinero disponible y márgenes.</p>
        </div>
        <button
          onClick={fetchAllData}
          disabled={refreshing}
          className="p-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl transition-all cursor-pointer active:scale-95 disabled:opacity-50 flex items-center gap-1.5 text-xs font-bold shadow-sm"
        >
          <FiRefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando..." : "Refrescar"}
        </button>
      </div>

      <GuiaModulo modulo="consolidado" />

      {/* Aviso de error de carga: evita que los ceros se lean como cifras reales */}
      {errorCarga && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-red-50 border border-red-100 text-red-700 p-4 rounded-2xl">
          <div className="flex items-start gap-2 text-sm">
            <FiAlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span className="font-semibold">
              No se pudieron cargar los datos. Las cifras mostradas pueden estar incompletas o en cero.
            </span>
          </div>
          <button
            onClick={fetchAllData}
            disabled={refreshing}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {refreshing ? "Reintentando..." : "Reintentar"}
          </button>
        </div>
      )}

      {/* Grid Principal Superior: Ventas de Hoy & Liquidez */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: Ventas de Hoy */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-50 pb-3">
            <FiTrendingUp className="text-indigo-600" /> Monitoreo de Ventas de Hoy
          </h3>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100/50">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total confirmado (3 op.)</span>
              <span className="text-lg font-black text-gray-800 mt-1 block">
                {formatSoles(data?.ventasHoy.total_todas || 0)}
              </span>
            </div>
            <div className="bg-blue-50/40 p-4 rounded-2xl border border-blue-100/40">
              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block">🛵 Ejecutivas · confirmado</span>
              <span className="text-lg font-black text-blue-600 mt-1 block">
                {formatSoles(data?.ventasHoy.ventas_asesor || 0)}
              </span>
              {(data?.ventasHoy.ventas_asesor_pendientes || 0) > 0 && (
                <span className="mt-1 block text-[9px] font-semibold text-amber-700">
                  {data?.ventasHoy.ventas_asesor_pendientes} por pesar
                </span>
              )}
            </div>
            <div className="bg-amber-50/40 p-4 rounded-2xl border border-amber-100/40">
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">🏪 Campo</span>
              <span className="text-lg font-black text-amber-600 mt-1 block">
                {formatSoles(data?.ventasHoy.ventas_campo || 0)}
              </span>
            </div>
            <div className="bg-violet-50/40 p-4 rounded-2xl border border-violet-100/40">
              <span className="text-[10px] font-bold text-violet-500 uppercase tracking-wider block">🏭 Planta (POS)</span>
              <span className="text-lg font-black text-violet-600 mt-1 block">
                {formatSoles(data?.ventasHoy.ventas_pos || 0)}
              </span>
            </div>
          </div>

          {/* Tarjeta compacta: Hoy vs Ayer (mismo comparativo de /api/rentabilidad) */}
          {comparativo && (() => {
            const deltaPct =
              comparativo.ayer.monto > 0
                ? ((comparativo.hoy.monto - comparativo.ayer.monto) / comparativo.ayer.monto) * 100
                : null;
            return (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50/50 border border-gray-100/50 p-4 rounded-2xl">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                    Hoy vs Ayer (por fecha de registro)
                  </span>
                  <span className="text-lg font-black text-gray-800 mt-1 block">
                    {formatSoles(comparativo.hoy.monto)}
                    <span className="text-xs text-gray-500 font-semibold ml-2">
                      {comparativo.hoy.pedidos} {comparativo.hoy.pedidos === 1 ? "operación" : "operaciones"}
                    </span>
                  </span>
                  {comparativo.hoy.ejecutivasPorValorizar > 0 && (
                    <span className="mt-1 block text-[10px] font-semibold text-amber-700">
                      {comparativo.hoy.ejecutivasPorValorizar} de Ejecutivas por pesar
                    </span>
                  )}
                </div>
                <div className="text-right">
                  {deltaPct === null ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
                      Sin ventas ayer
                    </span>
                  ) : deltaPct >= 0 ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                      <FiArrowUpRight className="w-3.5 h-3.5" /> +{deltaPct.toFixed(1)}% vs ayer
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-600">
                      <FiArrowDownRight className="w-3.5 h-3.5" /> {deltaPct.toFixed(1)}% vs ayer
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 block mt-1.5">
                    Ayer: {formatSoles(comparativo.ayer.monto)} ({comparativo.ayer.pedidos}{" "}
                    {comparativo.ayer.pedidos === 1 ? "operación" : "operaciones"})
                  </span>
                </div>
              </div>
            );
          })()}

          <div className="text-[10px] text-gray-400 leading-relaxed bg-gray-50 p-3.5 rounded-xl border border-gray-100/50">
            * Venta del día = registro realizado hoy en Lima. En Ejecutivas solo se suma el monto cuando Producción terminó de valorizar todos los ítems; los pedidos por pesar permanecen visibles, pero no inflan el total. Es la misma cifra de <strong>Ventas Generales</strong>.
          </div>
        </div>

        {/* Panel 2: Total Liquidez Disponible */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5">
          <div className="flex justify-between items-center border-b border-gray-50 pb-3">
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
              <FiBriefcase className="text-emerald-500" /> Caja y Bancos (Dinero Disponible)
            </h3>
            <span className="text-base font-black text-emerald-600">
              {formatSoles(totalLiquidez)}
            </span>
          </div>

          {data?.cuentas && data.cuentas.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[120px] overflow-y-auto pr-1">
              {data.cuentas.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50/70 border border-gray-100/50 rounded-xl hover:bg-gray-50 transition-colors">
                  <div>
                    <span className="font-bold text-gray-800 text-xs block">{c.nombre}</span>
                    <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold mt-0.5 block">{c.tipo}</span>
                  </div>
                  <span className="font-extrabold text-xs text-gray-900">{formatSoles(c.saldo)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-xs text-gray-400">Aún no tienes cuentas registradas.</p>
              <Link
                href="/dashboard/cuentas"
                className="inline-block mt-2 text-xs font-bold text-indigo-600 hover:underline"
              >
                + Crear cuenta
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Grid Intermedio: Neteo Comercial & Rentabilidad */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Neteo Comercial (Cobrar vs Pagar) */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 lg:col-span-2">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-50 pb-3">
            <FiDollarSign className="text-amber-500" /> Lo que te deben vs. lo que debes
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-emerald-50/30 p-4 rounded-2xl border border-emerald-100/30 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Por Cobrar (Clientes)</span>
                <span className="text-lg font-black text-emerald-700 mt-1 block">
                  {formatSoles(carteraTotal)}
                </span>
                <div className="mt-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-500 font-semibold">Cartera ejecutivas</span>
                    <span className="font-bold text-gray-700">{formatSoles(data?.totalCobrar || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-500 font-semibold">Cartera planta (POS)</span>
                    <span className="font-bold text-gray-700">{formatSoles(data?.carteraPlanta || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-500 font-semibold">Cartera campo (avícola)</span>
                    <span className="font-bold text-gray-700">{formatSoles(data?.carteraCampo || 0)}</span>
                  </div>
                </div>
              </div>
              <span className="text-[9px] text-gray-400 mt-3 block">Facturas de ejecutivas + saldos de planta + saldos de campo</span>
            </div>

            <div className="bg-red-50/30 p-4 rounded-2xl border border-red-100/30 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider block">Por Pagar (Proveedores)</span>
                <span className="text-lg font-black text-red-600 mt-1 block">
                  {formatSoles(data?.totalPagar || 0)}
                </span>
                {(data?.saldoFavorProveedores || 0) > 0 && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1 text-[10px]">
                    <span className="font-semibold text-emerald-700">Anticipos a favor</span>
                    <span className="font-black text-emerald-700">
                      {formatSoles(data?.saldoFavorProveedores || 0)}
                    </span>
                  </div>
                )}
              </div>
              <span className="text-[9px] text-gray-400 mt-3 block">Deuda y anticipos se calculan por proveedor, sin compensar proveedores distintos</span>
            </div>

            <div className={`p-4 rounded-2xl flex flex-col justify-between border ${
              balanceNeto >= 0 
                ? "bg-indigo-50/30 border-indigo-100/30 text-indigo-900" 
                : "bg-orange-50/30 border-orange-100/30 text-orange-950"
            }`}>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider block">Saldo Comercial Neto</span>
                <span className={`text-lg font-black mt-1 block ${balanceNeto >= 0 ? "text-indigo-600" : "text-orange-600"}`}>
                  {formatSoles(balanceNeto)}
                </span>
              </div>
              <span className="text-[9px] text-gray-400 mt-3 block">
                {balanceNeto >= 0 ? "Saldo a tu favor (te deben más)" : "Saldo en contra (debes más)"}
              </span>
            </div>
          </div>
        </div>

        {/* Métrica de Rentabilidad de Pollo */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-50 pb-3">
            <FiPercent className="text-indigo-600" /> Rendimiento de Pollo (30d)
          </h3>

          {rentabilidad ? (
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Costo de Compra Promedio:</span>
                <span className="font-bold text-gray-800">{formatSoles(rentabilidad.costoCompraPorKg)} / Kg</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Rendimiento Promedio:</span>
                <span className="font-extrabold text-emerald-600">{rentabilidad.rendimientoPorcentaje.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-xs border-t border-gray-50 pt-2 font-semibold">
                <span className="text-gray-700">Costo Real Procesado:</span>
                <span className="font-black text-indigo-600">{formatSoles(rentabilidad.costoRealPorKg)} / Kg</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Margen Promedio de Venta:</span>
                <span className="font-bold text-gray-800">{formatSoles(rentabilidad.margenUtilidadPorKg)} / Kg</span>
              </div>
              <div className="bg-indigo-50/50 p-2.5 rounded-xl text-center mt-2">
                <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block">Utilidad Proyectada del Período</span>
                <span className="text-sm font-black text-indigo-700 block mt-0.5">{formatSoles(rentabilidad.utilidadProyectada)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 text-xs italic">Cargando métricas de rendimiento...</div>
          )}
        </div>
      </div>

      {/* Sección Inferior: Diario de Caja y Transacciones Recientes */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-50">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
            <FiList className="text-indigo-600" /> Últimos movimientos de dinero
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                <th className="py-3 px-6">Fecha / Hora</th>
                <th className="py-3 px-4">Concepto</th>
                <th className="py-3 px-4">Cuenta</th>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4 text-right">Monto</th>
                <th className="py-3 px-6">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!data?.transacciones || data.transacciones.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-6 text-center text-gray-400 italic">
                    No se han registrado transacciones financieras en las cuentas aún.
                    <div className="mt-3 not-italic">
                      <Link
                        href="/dashboard/cuentas"
                        className="inline-block px-4 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 text-xs font-bold rounded-lg transition-colors"
                      >
                        Registrar un movimiento en Cuentas
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                data.transacciones.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3.5 px-6 text-gray-400 font-medium">{t.created_at}</td>
                    <td className="py-3.5 px-4 font-semibold text-gray-800">{t.concepto}</td>
                    <td className="py-3.5 px-4 text-gray-600">{t.cuenta_nombre}</td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] ${
                        t.tipo === "ingreso"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                          : "bg-red-50 text-red-700 border border-red-100"
                      }`}>
                        {t.tipo === "ingreso" ? "Ingreso" : "Egreso"}
                      </span>
                    </td>
                    <td className={`py-3.5 px-4 text-right font-extrabold text-xs ${
                      t.tipo === "ingreso" ? "text-emerald-600" : "text-red-500"
                    }`}>
                      {t.tipo === "ingreso" ? "+" : "-"} {formatSoles(t.monto)}
                    </td>
                    <td className="py-3.5 px-6 text-gray-500 flex items-center gap-1.5">
                      <FiUser className="opacity-40" /> {t.usuario_name}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// src/app/dashboard/rentabilidad/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FiCalendar, FiTrendingUp, FiAlertTriangle, FiDollarSign, FiPercent, FiTrendingDown, FiLoader } from "react-icons/fi";
import GuiaModulo from "@/components/GuiaModulo";

interface ResumenRentabilidad {
  polloComprasMonto: number;
  polloComprasPeso: number;
  costoCompraPorKg: number;
  totalBruto: number;
  totalLimpio: number;
  totalMenudencia: number;
  totalMerma: number;
  mermaPorcentaje: number;
  rendimientoPorcentaje: number;
  costoRealPorKg: number;
  polloVentasMonto: number;
  polloVentasPeso: number;
  precioVentaPromedio: number;
  margenUtilidadPorKg: number;
  utilidadProyectada: number;
}

interface RegistroDiario {
  fecha: string;
  monto?: number;
  peso?: number;
  bruto?: number;
  limpio?: number;
  menudencia?: number;
  merma?: number;
}

interface ComparativoDia {
  monto: number;
  pedidos: number;
  ejecutivasPorValorizar: number;
}

interface Comparativo {
  hoy: ComparativoDia;
  ayer: ComparativoDia;
}

export default function RentabilidadPage() {
  const [fechaInicio, setFechaInicio] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    resumen: ResumenRentabilidad;
    comprasDiarias: RegistroDiario[];
    mermasDiarias: RegistroDiario[];
    comparativo?: Comparativo;
  } | null>(null);

  const [activePreset, setActivePreset] = useState("30"); // "7", "30", "month"
  const [errorCarga, setErrorCarga] = useState(false);

  const fetchRentabilidad = async (start: string, end: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rentabilidad?fechaInicio=${start}&fechaFin=${end}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setErrorCarga(false);
      } else {
        setErrorCarga(true);
      }
    } catch (e) {
      console.error(e);
      setErrorCarga(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRentabilidad(fechaInicio, fechaFin);
  }, [fechaInicio, fechaFin]);

  const handlePreset = (preset: string) => {
    setActivePreset(preset);
    const end = new Date().toISOString().split("T")[0];
    let start = "";
    if (preset === "7") {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    } else if (preset === "30") {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    } else if (preset === "month") {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    }
    setFechaInicio(start);
    setFechaFin(end);
  };

  const resumen = data?.resumen;
  const comparativo = data?.comparativo;
  // Delta % de ventas hoy vs ayer (null si ayer no hubo ventas, para no dividir entre 0).
  const deltaPct =
    comparativo && comparativo.ayer.monto > 0
      ? ((comparativo.hoy.monto - comparativo.ayer.monto) / comparativo.ayer.monto) * 100
      : null;

  return (
    <div className="p-4 md:p-6 w-full max-w-7xl mx-auto space-y-6">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 to-indigo-800 p-6 rounded-2xl text-white shadow-xl">
        <div>
          <span className="bg-indigo-700/50 border border-indigo-500/30 text-indigo-200 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
            Fase 2: Control Comercial (Beta)
          </span>
          <h1 className="text-3xl font-extrabold mt-2 tracking-tight">Análisis de Costos y Rentabilidad</h1>
          <p className="text-indigo-200 text-sm mt-1">
            Cruza costos de compra, mermas de procesamiento en planta y precios reales de venta.
          </p>
        </div>

        {/* Date Selector */}
        <div className="bg-white/10 p-2 rounded-xl border border-white/10 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-white/10 bg-white/5">
            <button
              onClick={() => handlePreset("7")}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${
                activePreset === "7" ? "bg-white text-indigo-950" : "text-white hover:bg-white/5"
              }`}
            >
              7D
            </button>
            <button
              onClick={() => handlePreset("30")}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${
                activePreset === "30" ? "bg-white text-indigo-950" : "text-white hover:bg-white/5"
              }`}
            >
              30D
            </button>
            <button
              onClick={() => handlePreset("month")}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${
                activePreset === "month" ? "bg-white text-indigo-950" : "text-white hover:bg-white/5"
              }`}
            >
              Este Mes
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <FiCalendar className="absolute left-2.5 top-2.5 text-white/50 h-3.5 w-3.5" />
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => {
                  setFechaInicio(e.target.value);
                  setActivePreset("");
                }}
                className="pl-8 pr-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
            <span className="text-white/40 text-xs">al</span>
            <div className="relative">
              <FiCalendar className="absolute left-2.5 top-2.5 text-white/50 h-3.5 w-3.5" />
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => {
                  setFechaFin(e.target.value);
                  setActivePreset("");
                }}
                className="pl-8 pr-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
          </div>
        </div>
      </div>

      <GuiaModulo modulo="rentabilidad" />

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-2xl border border-gray-100 shadow-sm">
          <FiLoader className="h-10 w-10 text-indigo-600 animate-spin mb-4" />
          <p className="text-gray-500 text-sm font-medium">Calculando balances y mermas en tiempo real...</p>
        </div>
      ) : resumen ? (
        <div className="space-y-6">
          {/* Aviso: el refetch del período falló y se muestran los datos anteriores */}
          {errorCarga && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl">
              <div className="flex items-start gap-2 text-sm">
                <FiAlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>No se pudo actualizar el período. Se muestran los datos del período anterior.</span>
              </div>
              <button
                onClick={() => fetchRentabilidad(fechaInicio, fechaFin)}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Tarjeta destacada: Ventas de hoy vs ayer (por fecha de registro, zona Lima) */}
          {comparativo && (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm relative overflow-hidden">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ventas confirmadas de hoy</span>
              <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
                <div>
                  <div className="text-4xl font-extrabold text-gray-900">
                    S/ {comparativo.hoy.monto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 font-semibold mt-1">
                    {comparativo.hoy.pedidos} {comparativo.hoy.pedidos === 1 ? "operación" : "operaciones"}
                  </div>
                  {comparativo.hoy.ejecutivasPorValorizar > 0 && (
                    <div className="mt-1 text-xs font-semibold text-amber-700">
                      {comparativo.hoy.ejecutivasPorValorizar} de Ejecutivas por pesar
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {deltaPct === null ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-gray-100 text-gray-500">
                      Sin ventas ayer
                    </span>
                  ) : deltaPct >= 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-emerald-50 text-emerald-700">
                      <FiTrendingUp className="w-4 h-4" /> +{deltaPct.toFixed(1)}% vs ayer
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-rose-50 text-rose-700">
                      <FiTrendingDown className="w-4 h-4" /> {deltaPct.toFixed(1)}% vs ayer
                    </span>
                  )}
                  <div className="text-xs text-gray-400 mt-2">
                    Ayer: S/ {comparativo.ayer.monto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {" "}({comparativo.ayer.pedidos} {comparativo.ayer.pedidos === 1 ? "operación" : "operaciones"})
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-3">
                Operaciones registradas por fecha de venta (zona Lima). Ejecutivas suma importes solo cuando todos sus ítems están valorizados. No depende del filtro de fechas de arriba.
              </p>
            </div>
          )}

          {/* Main cost KPI Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Compra Card */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
              <div className="absolute top-0 right-0 p-3 text-indigo-100 group-hover:text-indigo-200 transition-colors">
                <FiDollarSign className="h-16 w-16" />
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Costo Materia Prima</span>
              <div className="text-3xl font-extrabold text-gray-900 mt-2">
                S/ {resumen.costoCompraPorKg.toFixed(2)}
                <span className="text-xs text-gray-500 font-semibold block mt-1">
                  Costo promedio de compra por Kg neto comprado.
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between text-xs text-gray-500">
                <span>Total Comprado:</span>
                <span className="font-semibold text-gray-700">{resumen.polloComprasPeso.toLocaleString()} kg</span>
              </div>
            </div>

            {/* Rendimiento Card */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
              <div className="absolute top-0 right-0 p-3 text-orange-100 group-hover:text-orange-200 transition-colors">
                <FiPercent className="h-16 w-16" />
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rendimiento</span>
              <div className="text-3xl font-extrabold text-orange-600 mt-2">
                {resumen.rendimientoPorcentaje.toFixed(1)}%
                <span className="text-xs text-gray-500 font-semibold block mt-1">
                  Merma promedio de la planta: {resumen.mermaPorcentaje.toFixed(1)}%
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between text-xs text-gray-500">
                <span>Total Procesado:</span>
                <span className="font-semibold text-gray-700">{resumen.totalBruto.toLocaleString()} kg</span>
              </div>
            </div>

            {/* Costo Real Card */}
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 rounded-2xl p-6 border border-indigo-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
              <div className="absolute top-0 right-0 p-3 text-indigo-200/50">
                <FiTrendingUp className="h-16 w-16" />
              </div>
              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Costo Real Beneficiado</span>
              <div className="text-3xl font-extrabold text-indigo-950 mt-2">
                S/ {resumen.costoRealPorKg.toFixed(2)}
                <span className="text-xs text-indigo-600 font-semibold block mt-1">
                  Costo ajustado por merma de procesamiento.
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-indigo-100 flex justify-between text-xs text-indigo-700">
                <span>Incremento por Merma:</span>
                <span className="font-bold">
                  + S/ {(resumen.costoRealPorKg - resumen.costoCompraPorKg).toFixed(2)} / kg
                </span>
              </div>
            </div>
          </div>

          {/* Sales and profitability Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Precio Venta Promedio */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Precio Venta Promedio</span>
              <div className="text-3xl font-extrabold text-gray-900 mt-2">
                S/ {resumen.precioVentaPromedio.toFixed(2)}
                <span className="text-xs text-gray-500 font-semibold block mt-1">
                  Ingreso promedio por Kg de pollo vendido.
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between text-xs text-gray-500">
                <span>Total Vendido:</span>
                <span className="font-semibold text-gray-700">{resumen.polloVentasPeso.toLocaleString()} kg</span>
              </div>
            </div>

            {/* Margen Real */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Margen Neto por Kg</span>
              <div className={`text-3xl font-extrabold mt-2 ${resumen.margenUtilidadPorKg >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                S/ {resumen.margenUtilidadPorKg.toFixed(2)}
                <span className="text-xs text-gray-500 font-semibold block mt-1">
                  Utilidad neta real por cada Kg vendido.
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between text-xs text-gray-500">
                <span>Margen sobre Costo Real:</span>
                <span className={`font-semibold ${resumen.margenUtilidadPorKg >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {resumen.costoRealPorKg > 0 ? ((resumen.margenUtilidadPorKg / resumen.costoRealPorKg) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>

            {/* Utilidad Bruta Proyectada */}
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-2xl p-6 border border-emerald-100 shadow-sm hover:shadow-md transition-all">
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">Utilidad Bruta de Ventas</span>
              <div className="text-3xl font-extrabold text-emerald-950 mt-2">
                S/ {resumen.utilidadProyectada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-xs text-emerald-700 font-semibold block mt-1">
                  Ganancia neta total del periodo para Pollo.
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-emerald-100 flex justify-between text-xs text-emerald-800">
                <span>Ingreso Total:</span>
                <span className="font-bold">S/ {resumen.polloVentasMonto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Graphical comparison bar */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-6">
            <h2 className="text-lg font-bold text-gray-900">Análisis Visual del Margen (Por Kilogramo)</h2>
            <div className="space-y-4">
              {/* Cost vs Sale Bar */}
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Estructura de Costo vs Venta</span>
                  <span className="font-semibold text-indigo-950">S/ {resumen.precioVentaPromedio.toFixed(2)} / kg</span>
                </div>
                <div className="h-8 w-full bg-gray-100 rounded-xl overflow-hidden flex font-medium text-xs text-white">
                  {/* Costo MP */}
                  <div 
                    style={{ width: `${(resumen.costoCompraPorKg / resumen.precioVentaPromedio) * 100}%` }}
                    className="bg-indigo-600 flex items-center justify-center"
                    title={`Costo de compra: S/ ${resumen.costoCompraPorKg.toFixed(2)}`}
                  >
                    <span>Costo de compra (S/ {resumen.costoCompraPorKg.toFixed(2)})</span>
                  </div>
                  {/* Costo Merma */}
                  <div 
                    style={{ width: `${((resumen.costoRealPorKg - resumen.costoCompraPorKg) / resumen.precioVentaPromedio) * 100}%` }}
                    className="bg-orange-500 flex items-center justify-center"
                    title={`Costo Merma: S/ ${(resumen.costoRealPorKg - resumen.costoCompraPorKg).toFixed(2)}`}
                  >
                    <span>Merma</span>
                  </div>
                  {/* Margen */}
                  {resumen.margenUtilidadPorKg > 0 ? (
                    <div 
                      style={{ width: `${(resumen.margenUtilidadPorKg / resumen.precioVentaPromedio) * 100}%` }}
                      className="bg-emerald-500 flex items-center justify-center"
                      title={`Margen Neto: S/ ${resumen.margenUtilidadPorKg.toFixed(2)}`}
                    >
                      <span>Margen (S/ {resumen.margenUtilidadPorKg.toFixed(2)})</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Loss warning */}
              {resumen.margenUtilidadPorKg < 0 ? (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-3">
                  <FiAlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-rose-950">Alerta de Pérdida en Ventas</h4>
                    <p className="text-xs text-rose-700 mt-0.5">
                      El costo real de pollo beneficiado (S/ {resumen.costoRealPorKg.toFixed(2)}) supera el precio de venta promedio (S/ {resumen.precioVentaPromedio.toFixed(2)}). Estás perdiendo S/ {Math.abs(resumen.margenUtilidadPorKg).toFixed(2)} por cada kg vendido debido al alto nivel de mermas o bajo precio de venta.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Historical detailed report table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Historial Diario de Mermas y Rendimiento</h2>
            </div>
            <div className="overflow-x-auto">
              {data.mermasDiarias.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">
                  No se registraron mermas ni procesos en este período. Registra procesos en la{" "}
                  <Link href="/dashboard/produccion/mermas" className="font-semibold text-indigo-600 hover:underline">
                    Calculadora de Mermas
                  </Link>.
                </div>
              ) : (
                <table className="w-full text-left text-sm text-gray-700">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-bold border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-4">Fecha</th>
                      <th className="px-6 py-4 text-right">Peso Bruto (Ingreso)</th>
                      <th className="px-6 py-4 text-right">Pollo Limpio</th>
                      <th className="px-6 py-4 text-right">Menudencia</th>
                      <th className="px-6 py-4 text-right">Merma</th>
                      <th className="px-6 py-4 text-right">Rendimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.mermasDiarias.map((m) => {
                      const yieldPct = m.bruto && m.bruto > 0 ? (Number(m.limpio) + Number(m.menudencia)) / Number(m.bruto) * 100 : 100;
                      return (
                        <tr key={m.fecha} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 font-medium text-gray-900">
                            {new Date(m.fecha).toLocaleDateString("es-PE", { timeZone: "UTC" })}
                          </td>
                          <td className="px-6 py-4 text-right font-semibold text-gray-800">
                            {Number(m.bruto).toFixed(2)} kg
                          </td>
                          <td className="px-6 py-4 text-right text-gray-600">
                            {Number(m.limpio).toFixed(2)} kg
                          </td>
                          <td className="px-6 py-4 text-right text-gray-600">
                            {Number(m.menudencia).toFixed(2)} kg
                          </td>
                          <td className="px-6 py-4 text-right text-rose-600 font-medium">
                            -{Number(m.merma).toFixed(2)} kg
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-indigo-900">
                            {yieldPct.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-8 border border-gray-100 text-center text-gray-500">
          <p>Error al cargar los datos de rentabilidad. Inténtalo de nuevo.</p>
          <button
            onClick={() => fetchRentabilidad(fechaInicio, fechaFin)}
            className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

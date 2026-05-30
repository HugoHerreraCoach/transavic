// src/app/dashboard/reportes/ventas-tab.tsx
// Vista "Ventas" — fusiona el viejo Panel Gerencial + Analítica en un solo
// reporte con período (presets + rango), KPIs en dinero, ranking de asesoras,
// top productos y cortes por empresa/distrito. Exportable a Excel y PDF.
// Mide facturación ENTREGADA (ver lib/reportes/datos-ventas.ts).
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FiTrendingUp,
  FiPackage,
  FiCheckCircle,
  FiAward,
  FiMapPin,
  FiTruck,
  FiDownload,
  FiFileText,
  FiBarChart2,
  FiRefreshCw,
  FiAlertTriangle,
} from "react-icons/fi";
import type { ReporteVentas } from "@/lib/reportes/datos-ventas";
import {
  formatSoles,
  KpiCard,
  HeroMetric,
  SelectorPeriodo,
  GraficoBarrasDia,
  presetRango,
  etiquetaRango,
  type Preset,
} from "./ui";

const EMPRESA_COLOR: Record<string, string> = {
  Transavic: "bg-red-500",
  "Avícola de Tony": "bg-amber-500",
};

export default function VentasTab() {
  const [preset, setPreset] = useState<Preset>("mes");
  const [desde, setDesde] = useState(() => presetRango("mes").desde);
  const [hasta, setHasta] = useState(() => presetRango("mes").hasta);
  const [data, setData] = useState<ReporteVentas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const aviso = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Cambiar de preset recalcula el rango (salvo "rango" personalizado).
  const cambiarPreset = (p: Preset) => {
    setPreset(p);
    if (p !== "rango") {
      const r = presetRango(p);
      setDesde(r.desde);
      setHasta(r.hasta);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reportes/ventas?desde=${desde}&hasta=${hasta}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const descargarPdf = async () => {
    if (!data) return;
    setGenerandoPdf(true);
    try {
      const { generarPdfVentas } = await import("@/lib/reportes/pdf-ventas");
      generarPdfVentas(data, etiquetaRango(desde, hasta));
    } catch {
      aviso("No se pudo generar el PDF. Intentá de nuevo.");
    } finally {
      setGenerandoPdf(false);
    }
  };

  const urlExcel = `/api/reportes/ventas/export-xlsx?desde=${desde}&hasta=${hasta}`;
  const pctEntrega =
    data && data.kpis.total_pedidos > 0
      ? Math.round((data.kpis.entregados / data.kpis.total_pedidos) * 100)
      : 0;
  const colorEntrega = pctEntrega >= 80 ? "green" : pctEntrega >= 50 ? "amber" : "red";

  const maxRankingMonto = data ? Math.max(...data.ranking.map((r) => r.facturado), 1) : 1;
  const totalEmpresa = data ? data.porEmpresa.reduce((a, e) => a + e.monto, 0) : 0;
  const maxDistrito = data ? Math.max(...data.porDistrito.map((d) => d.monto), 1) : 1;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-10 max-w-6xl mx-auto">
      {/* ── Toolbar: período + acciones ── */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <SelectorPeriodo
            preset={preset}
            desde={desde}
            hasta={hasta}
            onPreset={cambiarPreset}
            onDesde={setDesde}
            onHasta={setHasta}
          />
          <p className="text-xs text-gray-500 mt-2">
            Mostrando ventas de <span className="font-semibold text-gray-700">{etiquetaRango(desde, hasta)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={urlExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors active:scale-[0.97]"
          >
            <FiDownload size={15} /> Excel
          </a>
          <button
            onClick={descargarPdf}
            disabled={generandoPdf || !data}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors active:scale-[0.97] disabled:opacity-50"
          >
            <FiFileText size={15} /> {generandoPdf ? "Generando…" : "PDF"}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            title="Actualizar"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors active:scale-[0.95]"
          >
            <FiRefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── Estados ── */}
      {loading ? (
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="h-28 bg-gray-100 rounded-2xl col-span-2" />
            <div className="h-28 bg-gray-100 rounded-xl" />
            <div className="h-28 bg-gray-100 rounded-xl" />
          </div>
          <div className="h-60 bg-gray-100 rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="h-72 bg-gray-100 rounded-xl" />
            <div className="h-72 bg-gray-100 rounded-xl" />
          </div>
        </div>
      ) : error || !data ? (
        <div className="max-w-md mx-auto p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <strong>No se pudo cargar el reporte:</strong> {error || "Sin datos"}
          <button
            onClick={fetchData}
            className="mt-3 block w-full px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── KPIs: el dinero manda ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="col-span-2">
              <HeroMetric
                label="Facturado en el período"
                value={formatSoles(data.kpis.total_facturado)}
                sub={`${data.kpis.entregados} pedido${data.kpis.entregados !== 1 ? "s" : ""} entregado${
                  data.kpis.entregados !== 1 ? "s" : ""
                } · ticket promedio ${formatSoles(data.kpis.ticket_promedio)}`}
                icon={<FiTrendingUp size={15} />}
              />
            </div>
            <KpiCard
              color="blue"
              icon={<FiPackage size={14} />}
              label="Pedidos del período"
              value={data.kpis.total_pedidos}
              hint={`${data.kpis.entregados} entregados · ${data.kpis.pendientes} pendientes`}
            />
            <KpiCard
              color={colorEntrega}
              icon={<FiCheckCircle size={14} />}
              label="% de entrega"
              value={`${pctEntrega}%`}
              hint={data.kpis.fallidos > 0 ? `${data.kpis.fallidos} fallidos` : "sin fallidos"}
            />
          </div>

          {/* Aviso: hay entregas pero sin monto → faltan precios en el catálogo */}
          {data.kpis.total_facturado === 0 && data.kpis.entregados > 0 && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 anim-fade">
              <FiAlertTriangle className="flex-shrink-0 mt-0.5" />
              <p>
                El facturado aparece en <strong>S/ 0</strong> porque los pedidos entregados no
                tienen precio de venta cargado.{" "}
                <a
                  href="/dashboard/catalogo"
                  className="font-semibold underline underline-offset-2 hover:text-amber-900"
                >
                  Cargá los precios en el Catálogo
                </a>{" "}
                para ver tus ventas reales acá.
              </p>
            </div>
          )}

          {/* ── Ventas por día ── */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FiBarChart2 className="text-red-500" /> Ventas por día
            </h2>
            <GraficoBarrasDia data={data.ventasPorDia} />
          </section>

          {/* ── Ranking asesoras + Top productos ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Ranking */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
                <FiAward className="text-amber-500" /> Ranking de asesoras
              </h2>
              {data.ranking.length > 0 ? (
                <div className="space-y-3">
                  {data.ranking.map((a, i) => (
                    <div key={a.id} className="flex items-center gap-3">
                      <div className="w-6 text-center flex-shrink-0 text-sm">
                        {i < 3 ? (
                          ["🥇", "🥈", "🥉"][i]
                        ) : (
                          <span className="font-bold text-gray-400">{i + 1}</span>
                        )}
                      </div>
                      <div className="w-28 sm:w-32 flex-shrink-0 min-w-0">
                        <p className="font-semibold text-gray-800 text-sm truncate">
                          {a.name.trim()}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {a.entregados}/{a.total_pedidos} entregados · {a.tasa}%
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="bg-gray-100 rounded-full h-7 relative overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2 ${
                              i === 0 ? "bg-amber-400" : "bg-red-500"
                            }`}
                            style={{
                              width: `${Math.max((a.facturado / maxRankingMonto) * 100, 14)}%`,
                            }}
                          >
                            <span className="text-[11px] font-bold text-white whitespace-nowrap tabular-nums">
                              {formatSoles(a.facturado)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-8 text-sm">
                  Sin ventas entregadas de asesoras en el período.
                </p>
              )}
            </section>

            {/* Top productos */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
                <FiTrendingUp className="text-red-500" /> Top productos
              </h2>
              {data.topProductos.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                      <th className="text-left font-semibold pb-2">Producto</th>
                      <th className="text-right font-semibold pb-2">Cantidad</th>
                      <th className="text-right font-semibold pb-2">Facturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProductos.slice(0, 10).map((p, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 text-gray-800">{p.nombre}</td>
                        <td className="py-2 text-right text-gray-500 tabular-nums whitespace-nowrap">
                          {p.cantidad.toLocaleString("es-PE", { maximumFractionDigits: 1 })}{" "}
                          {p.unidad}
                        </td>
                        <td className="py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">
                          {formatSoles(p.monto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-400 text-center py-8 text-sm">
                  Los productos aparecen cuando uses el catálogo en los pedidos.
                </p>
              )}
            </section>
          </div>

          {/* ── Por empresa + Por distrito ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
                <FiTruck className="text-red-500" /> Por empresa
              </h2>
              <div className="space-y-4">
                {data.porEmpresa.map((e, i) => {
                  const pct = totalEmpresa > 0 ? (e.monto / totalEmpresa) * 100 : 0;
                  return (
                    <div key={i}>
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="font-medium text-gray-700 text-sm">{e.empresa}</span>
                        <span className="text-sm text-gray-500 tabular-nums">
                          {formatSoles(e.monto)}{" "}
                          <span className="text-gray-400">· {e.pedidos} ped.</span>
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            EMPRESA_COLOR[e.empresa] || "bg-gray-400"
                          }`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {data.porEmpresa.length === 0 && (
                  <p className="text-gray-400 text-center py-4 text-sm">Sin datos</p>
                )}
              </div>
            </section>

            <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
                <FiMapPin className="text-red-500" /> Top distritos
              </h2>
              <div className="space-y-2.5">
                {data.porDistrito.map((d, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-24 sm:w-28 flex-shrink-0 text-sm text-gray-700 truncate">
                      {d.distrito}
                    </span>
                    <div className="flex-1 min-w-0 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-400 transition-all duration-500"
                        style={{ width: `${Math.max((d.monto / maxDistrito) * 100, 3)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-800 tabular-nums whitespace-nowrap w-24 text-right">
                      {formatSoles(d.monto)}
                    </span>
                  </div>
                ))}
                {data.porDistrito.length === 0 && (
                  <p className="text-gray-400 text-center py-4 text-sm">Sin datos</p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 anim-toast bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg max-w-xs">
          {toast}
        </div>
      )}
    </div>
  );
}

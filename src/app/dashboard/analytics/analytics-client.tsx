// src/app/dashboard/analytics/analytics-client.tsx
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiBarChart2, FiTrendingUp, FiTruck, FiCheckCircle, FiClock, FiCalendar, FiMapPin, FiUsers, FiAward, FiX, FiAlertTriangle } from 'react-icons/fi';

// ─── Types ───────────────────────────────────────────────────

type AsesoraRanking = {
  id: string; name: string;
  total_pedidos: string; entregados: string; pendientes: string; fallidos: string;
};
type AsesoraProducto = { asesor_id: string; producto: string; unidad: string; total: string };
type AsesoraDiaria = { asesor_id: string; asesor_name: string; fecha: string; fecha_corta: string; total: string };

type PorAsesoraData = {
  ranking: AsesoraRanking[];
  productos: AsesoraProducto[];
  diaria: AsesoraDiaria[];
};

type AnalyticsData = {
  kpis: { total_pedidos: string; entregados: string; pendientes: string };
  topProductos: { nombre: string; unidad: string; total_cantidad: string; total_pedidos: string }[];
  ventasPorDia: { fecha: string; fecha_corta: string; total: string }[];
  porEmpresa: { empresa: string; total: string }[];
  porDistrito: { distrito: string; total: string }[];
  entregasPorPersona: {
    hoy: { persona: string; total: string }[];
    semana: { persona: string; total: string }[];
    mes: { persona: string; total: string }[];
  };
  porAsesora: PorAsesoraData;
  rango: { desde: string; hasta: string };
};

// ─── Date Helpers ────────────────────────────────────────────

function toLimaDate(d: Date): string {
  // Format date as YYYY-MM-DD in Lima timezone
  const lima = new Date(d.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return `${lima.getFullYear()}-${String(lima.getMonth() + 1).padStart(2, '0')}-${String(lima.getDate()).padStart(2, '0')}`;
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

function formatDateRange(desde: string, hasta: string): string {
  if (desde === hasta) return formatShortDate(desde);
  return `${formatShortDate(desde)} – ${formatShortDate(hasta)}`;
}

function getPresetDates(preset: 'hoy' | 'semana' | 'mes'): { desde: string; hasta: string } {
  const now = new Date();
  const today = toLimaDate(now);

  if (preset === 'hoy') {
    return { desde: today, hasta: today };
  }

  if (preset === 'semana') {
    // Monday of current week
    const d = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
    d.setDate(d.getDate() - diff);
    return { desde: toLimaDate(d), hasta: today };
  }

  // mes: first day of current month
  const d = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  d.setDate(1);
  return { desde: toLimaDate(d), hasta: today };
}

// ─── Reusable Components ────────────────────────────────────

function KPICard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className={`bg-white rounded-xl border-l-4 ${color} shadow-sm p-5 flex items-center gap-4`}>
      <div className={`p-3 rounded-lg ${color.replace('border-', 'bg-').replace('-600', '-100')}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}

function BarChart({ data, maxValue }: { data: { label: string; value: number; subLabel?: string }[]; maxValue: number }) {
  if (data.length === 0) return <p className="text-gray-400 text-center py-8">Sin datos para mostrar</p>;
  return (
    <div className="space-y-2.5">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-44 text-sm text-gray-700 truncate font-medium" title={item.label}>
            {item.label}
          </div>
          <div className="flex-1 bg-gray-100 rounded-full h-7 relative overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-700 ease-out flex items-center justify-end pr-2"
              style={{ width: `${Math.max((item.value / maxValue) * 100, 8)}%` }}
            >
              <span className="text-xs font-bold text-white whitespace-nowrap">
                {item.value} {item.subLabel || ''}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniLineChart({ data, color = '#ef4444' }: { data: { fecha_corta: string; total: string }[]; color?: string }) {
  if (data.length === 0) return <p className="text-gray-400 text-center py-8">Sin datos</p>;
  
  const values = data.map(d => Number(d.total));
  const max = Math.max(...values, 1);
  const chartHeight = 160;
  const chartWidth = Math.max(data.length * 60, 400);
  const gradientId = `gradient-${color.replace('#', '')}`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: chartWidth }} className="relative">
        <svg width="100%" height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}>
          {[0, 0.25, 0.5, 0.75, 1].map(pct => (
            <line key={pct} x1="40" y1={chartHeight - chartHeight * pct + 10} x2={chartWidth} y2={chartHeight - chartHeight * pct + 10} stroke="#f3f4f6" strokeWidth="1" />
          ))}
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            points={values.map((v, i) => {
              const x = 50 + (i * (chartWidth - 80)) / Math.max(values.length - 1, 1);
              const y = chartHeight - (v / max) * (chartHeight - 20) + 10;
              return `${x},${y}`;
            }).join(' ')}
          />
          <polygon
            fill={`url(#${gradientId})`}
            opacity="0.15"
            points={[
              ...values.map((v, i) => {
                const x = 50 + (i * (chartWidth - 80)) / Math.max(values.length - 1, 1);
                const y = chartHeight - (v / max) * (chartHeight - 20) + 10;
                return `${x},${y}`;
              }),
              `${50 + ((values.length - 1) * (chartWidth - 80)) / Math.max(values.length - 1, 1)},${chartHeight + 10}`,
              `50,${chartHeight + 10}`,
            ].join(' ')}
          />
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {values.map((v, i) => {
            const x = 50 + (i * (chartWidth - 80)) / Math.max(values.length - 1, 1);
            const y = chartHeight - (v / max) * (chartHeight - 20) + 10;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="4" fill={color} stroke="white" strokeWidth="2" />
                <text x={x} y={y - 10} textAnchor="middle" className="text-xs" fill="#374151" fontSize="11" fontWeight="600">{v}</text>
                <text x={x} y={chartHeight + 32} textAnchor="middle" fill="#9ca3af" fontSize="10">{data[i].fecha_corta}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── Asesora Detail Modal ────────────────────────────────────

function AsesoraModal({
  asesora,
  porAsesora,
  promedioEquipo,
  dateRange,
  onClose,
}: {
  asesora: AsesoraRanking;
  porAsesora: PorAsesoraData;
  promedioEquipo: { pedidos: number; tasa: number };
  dateRange: string;
  onClose: () => void;
}) {
  const total = Number(asesora.total_pedidos);
  const entregados = Number(asesora.entregados);
  const pendientes = Number(asesora.pendientes);
  const fallidos = Number(asesora.fallidos);
  const tasa = total > 0 ? (entregados / total) * 100 : 0;

  // Products for this advisor
  const productos = porAsesora.productos
    .filter(p => p.asesor_id === asesora.id)
    .slice(0, 8);
  const maxProd = Math.max(...productos.map(p => Number(p.total)), 1);

  // Daily trend for this advisor
  const diaria = porAsesora.diaria
    .filter(d => d.asesor_id === asesora.id)
    .map(d => ({ fecha_corta: d.fecha_corta, total: d.total }));

  // Comparison indicators
  const vsPromPedidos = total - promedioEquipo.pedidos;
  const vsPromTasa = tasa - promedioEquipo.tasa;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-lg font-bold">
              {asesora.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold">{asesora.name}</h2>
              <p className="text-red-200 text-sm">{dateRange}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
            <FiX size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* KPIs Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{total}</p>
              <p className="text-xs text-blue-500 font-medium">Total Pedidos</p>
              <p className={`text-[10px] font-semibold mt-1 ${vsPromPedidos >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {vsPromPedidos >= 0 ? '▲' : '▼'} {Math.abs(vsPromPedidos).toFixed(0)} vs prom.
              </p>
            </div>
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{entregados}</p>
              <p className="text-xs text-green-500 font-medium">Entregados</p>
            </div>
            <div className="bg-yellow-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-yellow-700">{pendientes}</p>
              <p className="text-xs text-yellow-500 font-medium">Pendientes</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className={`text-2xl font-bold ${tasa >= 80 ? 'text-green-700' : tasa >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>
                {tasa.toFixed(0)}%
              </p>
              <p className="text-xs text-gray-500 font-medium">Tasa Entrega</p>
              <p className={`text-[10px] font-semibold mt-1 ${vsPromTasa >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {vsPromTasa >= 0 ? '▲' : '▼'} {Math.abs(vsPromTasa).toFixed(0)}% vs prom.
              </p>
            </div>
          </div>

          {/* Fallidos warning */}
          {fallidos > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
              <FiAlertTriangle /> <span><strong>{fallidos}</strong> pedido{fallidos > 1 ? 's' : ''} fallido{fallidos > 1 ? 's' : ''} en el período</span>
            </div>
          )}

          {/* Top Productos */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <FiTrendingUp className="text-red-500" /> Productos Más Vendidos
            </h3>
            {productos.length > 0 ? (
              <div className="space-y-2">
                {productos.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-36 text-sm text-gray-700 truncate" title={p.producto}>{p.producto}</div>
                    <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                        style={{ width: `${Math.max((Number(p.total) / maxProd) * 100, 10)}%` }}
                      >
                        <span className="text-[11px] font-bold text-white whitespace-nowrap">
                          {Number(p.total) % 1 === 0 ? Number(p.total) : Number(p.total).toFixed(1)} {p.unidad}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm text-center py-4">Sin productos registrados en este período</p>
            )}
          </div>

          {/* Tendencia Diaria */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <FiBarChart2 className="text-red-500" /> Actividad Diaria
            </h3>
            {diaria.length > 0 ? (
              <MiniLineChart data={diaria} />
            ) : (
              <p className="text-gray-400 text-sm text-center py-4">Sin datos de actividad diaria</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function AnalyticsClient() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [hasta, setHasta] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedAsesora, setSelectedAsesora] = useState<AsesoraRanking | null>(null);

  // Advisor section: independent date range
  const [asesoraPeriodo, setAsesoraPeriodo] = useState<'hoy' | 'semana' | 'mes' | 'personalizado'>('mes');
  const [asesoraDesde, setAsesoraDesde] = useState(() => getPresetDates('mes').desde);
  const [asesoraHasta, setAsesoraHasta] = useState(() => getPresetDates('mes').hasta);
  const [asesoraData, setAsesoraData] = useState<PorAsesoraData | null>(null);
  const [asesoraLoading, setAsesoraLoading] = useState(false);

  // Despacho stats
  const [despacho, setDespacho] = useState<{
    sinAsignar: number; enCamino: number; entregados: number; fallidos: number; total: number;
    repartidores: { name: string; entregados: number; total: number; estado: string }[];
  } | null>(null);

  // Main data fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?desde=${desde}&hasta=${hasta}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  // Advisor-specific fetch (independent date range)
  const fetchAsesoraData = useCallback(async () => {
    setAsesoraLoading(true);
    try {
      const res = await fetch(`/api/analytics?desde=${asesoraDesde}&hasta=${asesoraHasta}`);
      const json = await res.json();
      setAsesoraData(json.porAsesora);
    } catch (err) {
      console.error('Error fetching asesora data:', err);
    } finally {
      setAsesoraLoading(false);
    }
  }, [asesoraDesde, asesoraHasta]);

  // Handle preset selection
  const handlePresetSelect = useCallback((preset: 'hoy' | 'semana' | 'mes') => {
    setAsesoraPeriodo(preset);
    const { desde: d, hasta: h } = getPresetDates(preset);
    setAsesoraDesde(d);
    setAsesoraHasta(h);
  }, []);

  // Fetch despacho stats
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/despacho');
        if (!res.ok) return;
        const json = await res.json();

        const allPedidos = [
          ...(json.pendientes || []),
          ...(json.repartidores?.flatMap((r: { pedidos: { estado: string }[] }) => r.pedidos) || []),
        ];

        setDespacho({
          sinAsignar: json.pendientes?.length || 0,
          enCamino: allPedidos.filter((p: { estado: string }) => p.estado === 'En_Camino').length,
          entregados: allPedidos.filter((p: { estado: string }) => p.estado === 'Entregado').length,
          fallidos: allPedidos.filter((p: { estado: string }) => p.estado === 'Fallido').length,
          total: allPedidos.length,
          repartidores: (json.repartidores || []).map((r: { name: string; pedidos: { estado: string }[] }) => {
            const rTotal = r.pedidos.length;
            const rEntregados = r.pedidos.filter(p => p.estado === 'Entregado').length;
            const enCamino = r.pedidos.find((p: { estado: string }) => p.estado === 'En_Camino');
            const proximo = r.pedidos.find((p: { estado: string }) => p.estado === 'Asignado');
            const completados = r.pedidos.filter(p => p.estado === 'Entregado' || p.estado === 'Fallido').length;
            return {
              name: r.name,
              entregados: rEntregados,
              total: rTotal,
              estado: completados === rTotal && rTotal > 0 ? '✅ Completado' : enCamino ? '🚗 En camino' : proximo ? '⏳ Próximo' : 'Sin pedidos',
            };
          }),
        });
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchAsesoraData(); }, [fetchAsesoraData]);

  // Compute preset date labels
  const presetLabels = useMemo(() => {
    const hoy = getPresetDates('hoy');
    const semana = getPresetDates('semana');
    const mes = getPresetDates('mes');
    return {
      hoy: formatShortDate(hoy.desde),
      semana: formatDateRange(semana.desde, semana.hasta),
      mes: formatDateRange(mes.desde, mes.hasta),
    };
  }, []);

  if (loading || !data) {
    return (
      <main className="bg-gray-50 min-h-screen p-4 sm:p-6">
        <div className="max-w-[1400px] mx-auto animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-56" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl" />)}</div>
          <div className="h-64 bg-white rounded-xl" />
        </div>
      </main>
    );
  }

  const topProductosData = data.topProductos.map(p => ({
    label: p.nombre,
    value: Number(p.total_cantidad),
    subLabel: p.unidad,
  }));
  const maxProducto = Math.max(...topProductosData.map(d => d.value), 1);

  const empresaTotal = data.porEmpresa.reduce((acc, e) => acc + Number(e.total), 0);

  // ── Asesora computations (from advisor-specific fetch) ──
  const activeAsesoraData = asesoraData || data.porAsesora;
  const ranking = activeAsesoraData.ranking;

  const asesoraDisplay = ranking.map(a => ({
    id: a.id, name: a.name,
    total: Number(a.total_pedidos),
    entregados: Number(a.entregados),
    pendientes: Number(a.pendientes),
    fallidos: Number(a.fallidos),
  }));
  const maxAsesoraPedidos = Math.max(...asesoraDisplay.map(a => a.total), 1);

  // Promedio del equipo
  const promedioEquipo = {
    pedidos: ranking.length > 0 ? ranking.reduce((acc, a) => acc + Number(a.total_pedidos), 0) / ranking.length : 0,
    tasa: ranking.length > 0 ? ranking.reduce((acc, a) => {
      const t = Number(a.total_pedidos);
      return acc + (t > 0 ? (Number(a.entregados) / t) * 100 : 0);
    }, 0) / ranking.length : 0,
  };

  const medals = ['🥇', '🥈', '🥉'];
  const tasaColor = (total: number, entregados: number) => {
    if (total === 0) return 'text-gray-400';
    const pct = (entregados / total) * 100;
    if (pct >= 80) return 'text-green-600';
    if (pct >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const asesoraDateRangeLabel = formatDateRange(asesoraDesde, asesoraHasta);

  return (
    <main className="bg-gray-50 min-h-screen p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
              <FiBarChart2 className="text-red-600" />
              Analítica de Ventas
            </h1>
            <p className="text-gray-500 mt-1">Información para tomar mejores decisiones</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FiCalendar className="text-gray-400" />
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="px-3 py-2 border rounded-lg text-sm text-gray-900 bg-white" />
            <span className="text-gray-400">a</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="px-3 py-2 border rounded-lg text-sm text-gray-900 bg-white" />
          </div>
        </div>

        {/* 🚚 Despacho del Día */}
        {despacho && despacho.total > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <FiTruck className="text-indigo-500" />
                Despacho del Día
              </h2>
              <a href="/dashboard/despacho" className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                Centro de Despacho →
              </a>
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">{despacho.sinAsignar} sin asignar</span>
              <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">{despacho.enCamino} en camino</span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">{despacho.entregados} entregados</span>
              {despacho.fallidos > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-medium">{despacho.fallidos} fallidos</span>}
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{
                  width: `${despacho.total > 0 ? ((despacho.entregados + despacho.fallidos) / despacho.total * 100) : 0}%`,
                  background: despacho.entregados + despacho.fallidos === despacho.total ? '#10b981' : '#6366f1',
                }} />
              </div>
              <span className="text-xs font-semibold text-gray-600">{despacho.entregados + despacho.fallidos}/{despacho.total}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {despacho.repartidores.filter(r => r.total > 0).map(r => (
                <div key={r.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 text-xs">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">{r.name.charAt(0)}</span>
                  <span className="truncate font-medium text-gray-700">{r.name}</span>
                  <span className="ml-auto font-bold text-gray-500">{r.entregados}/{r.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard label="Total Pedidos" value={data.kpis.total_pedidos} icon={<FiTruck className="text-blue-600" size={22} />} color="border-blue-600" />
          <KPICard label="Entregados" value={data.kpis.entregados} icon={<FiCheckCircle className="text-green-600" size={22} />} color="border-green-600" />
          <KPICard label="Pendientes" value={data.kpis.pendientes} icon={<FiClock className="text-yellow-600" size={22} />} color="border-yellow-600" />
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/* 🏆 RENDIMIENTO POR ASESORA                        */}
        {/* ═══════════════════════════════════════════════════ */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Section header */}
          <div className="px-6 py-4 bg-gradient-to-r from-red-50 to-amber-50 border-b border-gray-100">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <FiAward className="text-amber-500" />
                    Rendimiento por Asesora
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Ranking de pedidos registrados · <span className="font-medium text-gray-700">{asesoraDateRangeLabel}</span>
                  </p>
                </div>

                {/* Period selector with date labels */}
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1 bg-white rounded-lg p-1 shadow-sm border">
                    {([
                      { key: 'hoy' as const, label: 'Hoy', dateLabel: presetLabels.hoy },
                      { key: 'semana' as const, label: 'Semana', dateLabel: presetLabels.semana },
                      { key: 'mes' as const, label: 'Mes', dateLabel: presetLabels.mes },
                      { key: 'personalizado' as const, label: '📅 Rango', dateLabel: '' },
                    ]).map(({ key, label, dateLabel }) => (
                      <button
                        key={key}
                        onClick={() => {
                          if (key === 'personalizado') {
                            setAsesoraPeriodo('personalizado');
                          } else {
                            handlePresetSelect(key);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex flex-col items-center ${
                          asesoraPeriodo === key
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span>{label}</span>
                        {dateLabel && (
                          <span className={`text-[9px] font-normal mt-0.5 ${
                            asesoraPeriodo === key ? 'text-red-200' : 'text-gray-400'
                          }`}>
                            {dateLabel}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Custom date range picker (shown when 'personalizado' is selected) */}
              {asesoraPeriodo === 'personalizado' && (
                <div className="flex items-center gap-2 flex-wrap bg-white rounded-lg px-3 py-2 shadow-sm border">
                  <FiCalendar className="text-red-400 flex-shrink-0" size={14} />
                  <span className="text-xs text-gray-500 font-medium">Desde</span>
                  <input
                    type="date"
                    value={asesoraDesde}
                    onChange={e => setAsesoraDesde(e.target.value)}
                    className="px-2 py-1 border rounded-md text-xs text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none"
                  />
                  <span className="text-xs text-gray-400">→</span>
                  <span className="text-xs text-gray-500 font-medium">Hasta</span>
                  <input
                    type="date"
                    value={asesoraHasta}
                    onChange={e => setAsesoraHasta(e.target.value)}
                    className="px-2 py-1 border rounded-md text-xs text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Ranking content */}
          <div className="p-6">
            {asesoraLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex items-center gap-3 p-3">
                    <div className="w-8 h-8 bg-gray-200 rounded-full" />
                    <div className="w-9 h-9 bg-gray-200 rounded-full" />
                    <div className="w-32 h-4 bg-gray-200 rounded" />
                    <div className="flex-1 h-7 bg-gray-100 rounded-full" />
                  </div>
                ))}
              </div>
            ) : asesoraDisplay.length > 0 ? (
              <div className="space-y-3">
                {asesoraDisplay.map((a, i) => {
                  const tasa = a.total > 0 ? (a.entregados / a.total) * 100 : 0;
                  return (
                    <div
                      key={a.id}
                      onClick={() => {
                        const full = ranking.find(r => r.id === a.id);
                        if (full) setSelectedAsesora(full);
                      }}
                      className="group flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-all border border-transparent hover:border-gray-200 hover:shadow-sm"
                    >
                      {/* Position */}
                      <div className="w-8 text-center flex-shrink-0">
                        {i < 3 ? (
                          <span className="text-xl">{medals[i]}</span>
                        ) : (
                          <span className="text-sm font-bold text-gray-400">#{i + 1}</span>
                        )}
                      </div>

                      {/* Avatar */}
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                        i === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600' :
                        i === 1 ? 'bg-gradient-to-br from-gray-400 to-gray-500' :
                        i === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-800' :
                        'bg-gradient-to-br from-red-400 to-red-600'
                      }`}>
                        {a.name.charAt(0)}
                      </div>

                      {/* Name + rate */}
                      <div className="w-32 sm:w-40 flex-shrink-0">
                        <p className="font-semibold text-gray-800 text-sm truncate group-hover:text-red-700 transition-colors">{a.name}</p>
                        <p className={`text-[11px] font-medium ${tasaColor(a.total, a.entregados)}`}>
                          {tasa.toFixed(0)}% entrega
                        </p>
                      </div>

                      {/* Progress bar */}
                      <div className="flex-1 min-w-0">
                        <div className="bg-gray-100 rounded-full h-7 relative overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out flex items-center justify-end pr-2 ${
                              i === 0 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
                              'bg-gradient-to-r from-red-500 to-red-400'
                            }`}
                            style={{ width: `${Math.max((a.total / maxAsesoraPedidos) * 100, 10)}%` }}
                          >
                            <span className="text-xs font-bold text-white whitespace-nowrap">
                              {a.total} pedido{a.total !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Stats chips */}
                      <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                        <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[11px] font-semibold">{a.entregados}✓</span>
                        {a.pendientes > 0 && <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-[11px] font-semibold">{a.pendientes}⏳</span>}
                        {a.fallidos > 0 && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[11px] font-semibold">{a.fallidos}✗</span>}
                      </div>

                      {/* Arrow */}
                      <span className="text-gray-300 group-hover:text-red-500 transition-colors ml-1 flex-shrink-0">→</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">No hay pedidos registrados para este período</p>
            )}

            {/* Team summary */}
            {ranking.length > 1 && asesoraDisplay.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <span>Promedio del equipo: <strong className="text-gray-700">{promedioEquipo.pedidos.toFixed(0)} pedidos</strong></span>
                <span>Tasa promedio: <strong className="text-gray-700">{promedioEquipo.tasa.toFixed(0)}%</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Entregas por Persona */}
        {(() => {
          const ep = data.entregasPorPersona;
          const toMap = (arr: { persona: string; total: string }[]) =>
            Object.fromEntries(arr.map(r => [r.persona, Number(r.total)]));
          const hoyMap = toMap(ep.hoy);
          const semanaMap = toMap(ep.semana);
          const mesMap = toMap(ep.mes);
          const personas = [...new Set([...Object.keys(hoyMap), ...Object.keys(semanaMap), ...Object.keys(mesMap)])];

          return (
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
                <FiUsers className="text-teal-500" />
                Entregas por Persona
              </h2>
              <p className="text-sm text-gray-500 mb-4">Control de entregas realizadas por cada miembro del equipo</p>

              {personas.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-3 font-semibold text-gray-600">Persona</th>
                        <th className="text-center py-3 px-3 font-semibold text-gray-600">Hoy</th>
                        <th className="text-center py-3 px-3 font-semibold text-gray-600">Esta Semana</th>
                        <th className="text-center py-3 px-3 font-semibold text-gray-600">Este Mes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personas.map(persona => (
                        <tr key={persona} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-3 px-3 font-medium text-gray-800">{persona}</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${hoyMap[persona] ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-400'}`}>
                              {hoyMap[persona] || 0}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${semanaMap[persona] ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
                              {semanaMap[persona] || 0}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${mesMap[persona] ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                              {mesMap[persona] || 0}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-center py-6 text-sm">Los datos aparecerán cuando se marquen pedidos como entregados desde la lista de pedidos</p>
              )}
            </div>
          );
        })()}

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Productos */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FiTrendingUp className="text-red-500" />
              Top Productos Más Vendidos
            </h2>
            {topProductosData.length > 0 ? (
              <BarChart data={topProductosData} maxValue={maxProducto} />
            ) : (
              <p className="text-gray-400 text-center py-8">Los productos aparecerán cuando uses el catálogo en los pedidos</p>
            )}
          </div>

          {/* Por Empresa */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FiTruck className="text-red-500" />
              Pedidos por Empresa
            </h2>
            <div className="space-y-4">
              {data.porEmpresa.map((emp, i) => {
                const pct = empresaTotal > 0 ? (Number(emp.total) / empresaTotal) * 100 : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-gray-700">{emp.empresa}</span>
                      <span className="text-sm text-gray-500">{emp.total} pedidos ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-4">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.max(pct, 3)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {data.porEmpresa.length === 0 && <p className="text-gray-400 text-center py-4">Sin datos</p>}
            </div>

            {/* Por Distrito */}
            <h2 className="text-lg font-bold text-gray-800 mt-8 mb-4 flex items-center gap-2">
              <FiMapPin className="text-red-500" />
              Top Distritos
            </h2>
            <div className="space-y-2">
              {data.porDistrito.map((d, i) => (
                <div key={i} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-sm text-gray-700">{d.distrito}</span>
                  <span className="text-sm font-semibold text-gray-800 bg-gray-100 px-2.5 py-0.5 rounded-full">{d.total}</span>
                </div>
              ))}
              {data.porDistrito.length === 0 && <p className="text-gray-400 text-center py-4">Sin datos</p>}
            </div>
          </div>
        </div>

        {/* Ventas por Día */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <FiCalendar className="text-red-500" />
            Pedidos por Día
          </h2>
          <MiniLineChart data={data.ventasPorDia} />
        </div>
      </div>

      {/* Asesora Detail Modal */}
      {selectedAsesora && (
        <AsesoraModal
          asesora={selectedAsesora}
          porAsesora={activeAsesoraData}
          promedioEquipo={promedioEquipo}
          dateRange={asesoraDateRangeLabel}
          onClose={() => setSelectedAsesora(null)}
        />
      )}
    </main>
  );
}

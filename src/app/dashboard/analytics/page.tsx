// src/app/dashboard/analytics/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { FiBarChart2, FiTrendingUp, FiTruck, FiCheckCircle, FiClock, FiCalendar, FiMapPin } from 'react-icons/fi';

type AnalyticsData = {
  kpis: { total_pedidos: string; entregados: string; pendientes: string };
  topProductos: { nombre: string; unidad: string; total_cantidad: string; total_pedidos: string }[];
  ventasPorDia: { fecha: string; fecha_corta: string; total: string }[];
  porEmpresa: { empresa: string; total: string }[];
  porDistrito: { distrito: string; total: string }[];
  rango: { desde: string; hasta: string };
};

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

function MiniLineChart({ data }: { data: { fecha_corta: string; total: string }[] }) {
  if (data.length === 0) return <p className="text-gray-400 text-center py-8">Sin datos</p>;
  
  const values = data.map(d => Number(d.total));
  const max = Math.max(...values, 1);
  const chartHeight = 160;
  const chartWidth = Math.max(data.length * 60, 400);

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: chartWidth }} className="relative">
        <svg width="100%" height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => (
            <line key={pct} x1="40" y1={chartHeight - chartHeight * pct + 10} x2={chartWidth} y2={chartHeight - chartHeight * pct + 10} stroke="#f3f4f6" strokeWidth="1" />
          ))}
          {/* Line */}
          <polyline
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeLinejoin="round"
            points={values.map((v, i) => {
              const x = 50 + (i * (chartWidth - 80)) / Math.max(values.length - 1, 1);
              const y = chartHeight - (v / max) * (chartHeight - 20) + 10;
              return `${x},${y}`;
            }).join(' ')}
          />
          {/* Area fill */}
          <polygon
            fill="url(#gradient)"
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
            <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Dots & labels */}
          {values.map((v, i) => {
            const x = 50 + (i * (chartWidth - 80)) / Math.max(values.length - 1, 1);
            const y = chartHeight - (v / max) * (chartHeight - 20) + 10;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="4" fill="#ef4444" stroke="white" strokeWidth="2" />
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

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [hasta, setHasta] = useState(() => new Date().toISOString().split('T')[0]);

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

  useEffect(() => { fetchData(); }, [fetchData]);

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

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard label="Total Pedidos" value={data.kpis.total_pedidos} icon={<FiTruck className="text-blue-600" size={22} />} color="border-blue-600" />
          <KPICard label="Entregados" value={data.kpis.entregados} icon={<FiCheckCircle className="text-green-600" size={22} />} color="border-green-600" />
          <KPICard label="Pendientes" value={data.kpis.pendientes} icon={<FiClock className="text-yellow-600" size={22} />} color="border-yellow-600" />
        </div>

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
    </main>
  );
}

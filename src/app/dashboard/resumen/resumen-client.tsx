// src/app/dashboard/resumen/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { FiClipboard, FiCalendar, FiCheckCircle, FiClock, FiTruck, FiUser, FiPhone, FiMapPin, FiChevronLeft, FiChevronRight, FiPackage } from 'react-icons/fi';

type PedidoResumen = {
  id: string;
  cliente: string;
  whatsapp: string | null;
  empresa: string;
  direccion: string | null;
  distrito: string | null;
  hora_entrega: string | null;
  notas: string | null;
  detalle: string;
  detalle_final: string | null;
  entregado: boolean;
  fecha_pedido: string;
  asesor_name: string | null;
  items: { producto_nombre: string; cantidad: string; unidad: string }[];
};

type ResumenData = {
  fecha: string;
  kpis: { total: number; entregados: number; pendientes: number };
  pedidos: PedidoResumen[];
  totalesPorProducto: { nombre: string; unidad: string; total: string }[];
};

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const formatted = date.toLocaleDateString('es-PE', options);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export default function ResumenClient() {
  const [data, setData] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fecha, setFecha] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [filtro, setFiltro] = useState<'todos' | 'pendientes' | 'entregados'>('todos');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/resumen-diario?fecha=${fecha}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const prevDay = () => {
    const d = new Date(fecha + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    setFecha(d.toISOString().split('T')[0]);
  };

  const nextDay = () => {
    const d = new Date(fecha + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    setFecha(d.toISOString().split('T')[0]);
  };

  const goYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    setFecha(d.toISOString().split('T')[0]);
  };

  const goToday = () => {
    setFecha(new Date().toISOString().split('T')[0]);
  };

  if (loading || !data) {
    return (
      <main className="bg-gray-50 min-h-screen p-4 sm:p-6">
        <div className="max-w-[1200px] mx-auto animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-xl" />)}</div>
          <div className="h-64 bg-white rounded-xl" />
        </div>
      </main>
    );
  }

  const pedidosFiltrados = data.pedidos.filter(p => {
    if (filtro === 'pendientes') return !p.entregado;
    if (filtro === 'entregados') return p.entregado;
    return true;
  });

  return (
    <main className="bg-gray-50 min-h-screen p-4 sm:p-6">
      <div className="max-w-[1200px] mx-auto space-y-6">
        {/* Header + Date Nav */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
              <FiClipboard className="text-red-600" />
              Resumen del Día
            </h1>
            <p className="text-gray-500 mt-1">{formatDisplayDate(fecha)}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={prevDay} className="p-2 bg-white border rounded-lg hover:bg-gray-50 text-gray-700"><FiChevronLeft /></button>
            <div className="flex items-center gap-1">
              <FiCalendar className="text-gray-400" />
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="px-3 py-2 border rounded-lg text-sm bg-white text-gray-900" />
            </div>
            <button onClick={nextDay} className="p-2 bg-white border rounded-lg hover:bg-gray-50 text-gray-700"><FiChevronRight /></button>
            <div className="flex gap-1 ml-2">
              <button onClick={goYesterday} className="px-3 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200">Ayer</button>
              <button onClick={goToday} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Hoy</button>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-blue-600 text-center">
            <FiTruck className="mx-auto text-blue-600 mb-1" size={20} />
            <p className="text-2xl font-bold text-gray-800">{data.kpis.total}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-green-600 text-center">
            <FiCheckCircle className="mx-auto text-green-600 mb-1" size={20} />
            <p className="text-2xl font-bold text-gray-800">{data.kpis.entregados}</p>
            <p className="text-xs text-gray-500">Entregados</p>
          </div>
          <div className={`bg-white rounded-xl shadow-sm p-4 border-l-4 text-center ${data.kpis.pendientes > 0 ? 'border-yellow-500 bg-yellow-50' : 'border-gray-300'}`}>
            <FiClock className={`mx-auto mb-1 ${data.kpis.pendientes > 0 ? 'text-yellow-600' : 'text-gray-400'}`} size={20} />
            <p className="text-2xl font-bold text-gray-800">{data.kpis.pendientes}</p>
            <p className="text-xs text-gray-500">Pendientes</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pedidos */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filtro */}
            <div className="flex items-center gap-2">
              {(['todos', 'pendientes', 'entregados'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filtro === f ? 'bg-red-600 text-white' : 'bg-white text-gray-700 border hover:bg-gray-50'
                  }`}
                >
                  {f === 'todos' ? `Todos (${data.kpis.total})` : f === 'pendientes' ? `Pendientes (${data.kpis.pendientes})` : `Entregados (${data.kpis.entregados})`}
                </button>
              ))}
            </div>

            {pedidosFiltrados.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <FiClipboard className="mx-auto mb-3" size={48} />
                <p className="text-lg">No hay pedidos para este día</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pedidosFiltrados.map(p => (
                  <div key={p.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${!p.entregado ? 'border-yellow-300 ring-1 ring-yellow-200' : 'border-gray-200'}`}>
                    <div className={`px-4 py-2 flex items-center justify-between ${p.entregado ? 'bg-green-50' : 'bg-yellow-50'}`}>
                      <div className="flex items-center gap-2">
                        {p.entregado ? <FiCheckCircle className="text-green-600" /> : <FiClock className="text-yellow-600 animate-pulse" />}
                        <span className={`text-sm font-semibold ${p.entregado ? 'text-green-700' : 'text-yellow-700'}`}>
                          {p.entregado ? 'Entregado' : '⚠ Pendiente de entrega'}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">{p.empresa}</span>
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <FiUser className="text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-gray-800">{p.cliente}</span>
                      </div>
                      {p.whatsapp && (
                        <div className="flex items-center gap-2">
                          <FiPhone className="text-gray-400 flex-shrink-0" />
                          <a href={`https://wa.me/${p.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm hover:underline">{p.whatsapp}</a>
                        </div>
                      )}
                      {p.direccion && (
                        <div className="flex items-center gap-2">
                          <FiMapPin className="text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-600">{p.direccion}{p.distrito ? ` - ${p.distrito}` : ''}</span>
                        </div>
                      )}
                      {p.hora_entrega && (
                        <div className="flex items-center gap-2">
                          <FiClock className="text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-600">{p.hora_entrega}</span>
                        </div>
                      )}
                      <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{p.detalle}</p>
                      </div>
                      {p.items.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase">Productos:</p>
                          {p.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm bg-blue-50 px-3 py-1.5 rounded">
                              <span className="text-gray-700">{item.producto_nombre}</span>
                              <span className="font-semibold text-blue-700">{item.cantidad} {item.unidad}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {p.detalle_final && (
                        <div className="mt-2 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                          <p className="text-xs font-semibold text-blue-600 mb-1">Detalle Final:</p>
                          <p className="text-sm text-blue-800 whitespace-pre-wrap">{p.detalle_final}</p>
                        </div>
                      )}
                      {p.asesor_name && (
                        <p className="text-xs text-gray-400 mt-2">Asesor: {p.asesor_name}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar: Totales por Producto */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 sticky top-4">
              <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <FiPackage className="text-red-500" />
                Resumen de Productos
              </h2>
              {data.totalesPorProducto.length > 0 ? (
                <div className="space-y-2">
                  {data.totalesPorProducto.map((p, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                      <span className="text-sm text-gray-700">{p.nombre}</span>
                      <span className="text-sm font-bold text-gray-800 bg-red-50 text-red-700 px-2.5 py-0.5 rounded-full">
                        {Number(p.total).toFixed(Number(p.total) % 1 === 0 ? 0 : 1)} {p.unidad}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">
                  Los totales aparecerán cuando uses el catálogo en los pedidos
                </p>
              )}
            </div>

            {/* Quick info */}
            <div className="bg-gradient-to-br from-red-600 to-red-700 rounded-xl shadow-sm p-5 text-white">
              <h3 className="font-bold mb-2">💡 Tip del Día</h3>
              <p className="text-sm text-red-100">
                Usa este resumen cada mañana para planificar tus entregas. Los pedidos pendientes aparecen destacados en amarillo.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// src/app/dashboard/resumen-despacho.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FiPackage,
  FiNavigation,
  FiCheckCircle,
  FiXCircle,
  FiClock,
  FiArrowRight,
  FiRefreshCw,
} from "react-icons/fi";
import { EstadoPedido } from "@/lib/types";

interface PedidoResumen {
  id: string;
  cliente: string;
  estado: EstadoPedido;
  hora_llegada_estimada: string | null;
}

interface RepartidorResumen {
  id: string;
  name: string;
  pedidos: PedidoResumen[];
}

export default function ResumenDespacho() {
  const [data, setData] = useState<{
    pendientes: PedidoResumen[];
    repartidores: RepartidorResumen[];
    alertaPedidosAnteriores: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/despacho");
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh cada 60s
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-48 mb-4" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allPedidos = [
    ...data.pendientes,
    ...data.repartidores.flatMap((r) => r.pedidos),
  ];

  const stats = {
    pendientes: allPedidos.filter((p) => p.estado === "Pendiente").length,
    asignados: allPedidos.filter((p) => p.estado === "Asignado").length,
    enCamino: allPedidos.filter((p) => p.estado === "En_Camino").length,
    entregados: allPedidos.filter((p) => p.estado === "Entregado").length,
    fallidos: allPedidos.filter((p) => p.estado === "Fallido").length,
    total: allPedidos.length,
  };

  const completados = stats.entregados + stats.fallidos;
  const progress = stats.total > 0 ? (completados / stats.total) * 100 : 0;
  const sinAsignar = data.pendientes.length;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-gray-900">📊 Despacho del Día</h2>
          <button onClick={fetchData} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
            <FiRefreshCw size={12} />
          </button>
        </div>
        <button
          onClick={() => router.push("/dashboard/despacho")}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          Centro de Despacho <FiArrowRight size={12} />
        </button>
      </div>

      {/* Alerta de anteriores */}
      {data.alertaPedidosAnteriores > 0 && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
          ⚠️ {data.alertaPedidosAnteriores} pedido(s) de días anteriores sin completar
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <StatCard icon={<FiClock />} label="Pendientes" value={stats.pendientes + stats.asignados} color="amber" badge={sinAsignar > 0 ? `${sinAsignar} sin asignar` : undefined} />
        <StatCard icon={<FiNavigation />} label="En Camino" value={stats.enCamino} color="indigo" />
        <StatCard icon={<FiCheckCircle />} label="Entregados" value={stats.entregados} color="emerald" />
        <StatCard icon={<FiXCircle />} label="Fallidos" value={stats.fallidos} color="red" />
        <StatCard icon={<FiPackage />} label="Total" value={stats.total} color="gray" />
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Progreso del día</span>
          <span className="font-semibold text-gray-700">{completados}/{stats.total} ({Math.round(progress)}%)</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progress}%`,
              background: progress === 100
                ? "linear-gradient(90deg, #10b981, #34d399)"
                : "linear-gradient(90deg, #6366f1, #818cf8)",
            }}
          />
        </div>
      </div>

      {/* Repartidores */}
      {data.repartidores.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Repartidores</h3>
          {data.repartidores.map((r) => {
            const rTotal = r.pedidos.length;
            const rEntregados = r.pedidos.filter((p) => p.estado === "Entregado").length;
            const rCompletados = r.pedidos.filter((p) => p.estado === "Entregado" || p.estado === "Fallido").length;
            const rProgress = rTotal > 0 ? (rCompletados / rTotal) * 100 : 0;
            const enCamino = r.pedidos.find((p) => p.estado === "En_Camino");
            const proximo = r.pedidos.find((p) => p.estado === "Asignado" || p.estado === "Pendiente");

            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {r.name.charAt(0)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800 truncate">{r.name}</span>
                    <span className="text-xs font-bold text-gray-600">{rEntregados}/{rTotal}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${rProgress}%`,
                        background: rProgress === 100
                          ? "#10b981"
                          : "#6366f1",
                      }}
                    />
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400 truncate">
                    {rProgress === 100 ? (
                      <span className="text-emerald-600 font-medium">✅ Completado</span>
                    ) : enCamino ? (
                      <span className="text-indigo-600"><FiNavigation size={8} className="inline mr-0.5" />En camino → {enCamino.cliente}</span>
                    ) : proximo ? (
                      <span>Próximo → {proximo.cliente}</span>
                    ) : (
                      <span>Sin pedidos activos</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Stat Card ──

function StatCard({
  icon,
  label,
  value,
  color,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  badge?: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
    amber: { bg: "bg-amber-50", text: "text-amber-800", icon: "text-amber-500" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-800", icon: "text-indigo-500" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-800", icon: "text-emerald-500" },
    red: { bg: "bg-red-50", text: "text-red-800", icon: "text-red-500" },
    gray: { bg: "bg-gray-50", text: "text-gray-800", icon: "text-gray-500" },
  };
  const c = colorMap[color] || colorMap.gray;

  return (
    <div className={`${c.bg} rounded-xl px-3 py-2.5 text-center`}>
      <div className={`${c.icon} flex justify-center mb-1`}>{icon}</div>
      <p className={`text-xl font-bold ${c.text}`}>{value}</p>
      <p className="text-[10px] text-gray-500 font-medium">{label}</p>
      {badge && <p className="text-[9px] text-amber-600 font-medium mt-0.5">{badge}</p>}
    </div>
  );
}

// src/app/dashboard/asistente-ia/asistente-ia-client.tsx
"use client";

import { useEffect, useState } from "react";
import {
  FiTrendingUp,
  FiAlertCircle,
  FiAward,
  FiSun,
  FiRefreshCw,
  FiZap,
  FiTarget,
  FiShoppingBag,
  FiPhoneCall,
} from "react-icons/fi";

// ════════════════════════════════════════════════════════════════════
// Tipos compartidos
// ════════════════════════════════════════════════════════════════════
interface ProductoCambio {
  nombre: string;
  ventas_mes_actual: number;
  ventas_mes_anterior: number;
  diferencia: number;
  porcentaje_cambio: number;
}
interface ClienteRiesgo {
  cliente_id: string;
  nombre: string;
  ultimo_pedido_fecha: string;
  dias_sin_comprar: number;
  total_historico: number;
  pedidos_total: number;
}
interface AsesoraStats {
  asesor_id: string;
  nombre: string;
  total_ventas_mes: number;
  pedidos_entregados: number;
  ticket_promedio: number;
}
interface ResumenDia {
  fecha: string;
  pedidos_total: number;
  pedidos_entregados: number;
  pedidos_fallidos: number;
  ventas_total: number;
  ticket_promedio: number;
}
interface ProductoCarteraStats {
  nombre: string;
  cantidad_total: number;
  pedidos: number;
  ventas: number;
}
interface ClienteContactarHoy {
  cliente_id: string;
  nombre: string;
  dias_sin_comprar: number;
  total_historico: number;
  patron_dias_semana: number[];
  patron_intervalo_dias: number;
}

interface AdminResponse {
  role: "admin";
  generatedAt: string;
  cached: boolean;
  productos: { texto: string; productosUp: ProductoCambio[]; productosDown: ProductoCambio[] };
  clientes: { texto: string; clientes: ClienteRiesgo[] };
  asesoras: { texto: string; asesoras: AsesoraStats[] };
  dia: { texto: string; resumen: ResumenDia };
}
interface AsesorResponse {
  role: "asesor";
  generatedAt: string;
  cached: boolean;
  performance: {
    texto: string;
    ventasMes: number;
    metaMensual: number;
    porcentajeAvance: number;
    metaDiaria: number;
    diaDelMes: number;
    diasHabilesMes: number;
    ritmoNecesario: number;
  };
  clientes: { texto: string; clientes: ClienteRiesgo[] };
  cartera: { texto: string; productos: ProductoCarteraStats[] };
  sugerencia: { texto: string; candidatos: ClienteContactarHoy[] };
}
type InsightsResponse = AdminResponse | AsesorResponse;

// ════════════════════════════════════════════════════════════════════
// Card genérica
// ════════════════════════════════════════════════════════════════════
function InsightCard({
  icon,
  title,
  color,
  iaText,
  children,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  color: "green" | "red" | "amber" | "blue" | "violet" | "indigo" | "rose" | "teal";
  iaText: string;
  children: React.ReactNode;
  loading?: boolean;
}) {
  const colorMap: Record<string, string> = {
    green: "bg-green-50 border-green-200 text-green-700",
    red: "bg-red-50 border-red-200 text-red-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    violet: "bg-violet-50 border-violet-200 text-violet-700",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
    rose: "bg-rose-50 border-rose-200 text-rose-700",
    teal: "bg-teal-50 border-teal-200 text-teal-700",
  };
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 flex flex-col h-full">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colorMap[color]} mb-4`}>
        {icon}
        <h2 className="font-semibold text-sm">{title}</h2>
      </div>

      {/* Texto generado por Gemini */}
      <div className="mb-4 p-3 bg-gradient-to-br from-violet-50 to-indigo-50 rounded-lg border border-violet-200">
        <div className="flex items-start gap-2">
          <FiZap className="h-4 w-4 text-violet-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-800 leading-relaxed">
            {loading ? (
              <span className="inline-block w-full">
                <span className="block h-3 bg-gray-200 rounded animate-pulse mb-2"></span>
                <span className="block h-3 bg-gray-200 rounded animate-pulse w-4/5"></span>
              </span>
            ) : (
              iaText
            )}
          </p>
        </div>
      </div>

      <div className="flex-1">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Vista Admin (4 cards globales)
// ════════════════════════════════════════════════════════════════════
function VistaAdmin({ data, loading }: { data: AdminResponse | null; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <InsightCard
        icon={<FiTrendingUp className="h-5 w-5" />}
        title="Tendencias de productos"
        color="green"
        loading={loading}
        iaText={data?.productos.texto ?? ""}
      >
        {data && data.productos.productosUp.length + data.productos.productosDown.length > 0 ? (
          <div className="space-y-1.5">
            {data.productos.productosUp.map((p) => (
              <div key={"u-" + p.nombre} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{p.nombre}</span>
                <span className="text-green-600 font-mono font-semibold ml-2 whitespace-nowrap">
                  ▲ +{p.porcentaje_cambio.toFixed(0)}%
                </span>
              </div>
            ))}
            {data.productos.productosDown.map((p) => (
              <div key={"d-" + p.nombre} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{p.nombre}</span>
                <span className="text-red-600 font-mono font-semibold ml-2 whitespace-nowrap">
                  ▼ {p.porcentaje_cambio.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Sin datos suficientes todavía</p>
        )}
      </InsightCard>

      <InsightCard
        icon={<FiAlertCircle className="h-5 w-5" />}
        title="Clientes en riesgo"
        color="red"
        loading={loading}
        iaText={data?.clientes.texto ?? ""}
      >
        {data && data.clientes.clientes.length > 0 ? (
          <div className="space-y-1.5">
            {data.clientes.clientes.map((c) => (
              <div key={c.cliente_id} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{c.nombre}</span>
                <span className="text-red-600 font-mono ml-2 whitespace-nowrap">
                  {c.dias_sin_comprar}d · S/{c.total_historico.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">{loading ? "" : "Todos al día ✨"}</p>
        )}
      </InsightCard>

      <InsightCard
        icon={<FiAward className="h-5 w-5" />}
        title="Ranking de asesoras este mes"
        color="amber"
        loading={loading}
        iaText={data?.asesoras.texto ?? ""}
      >
        {data && data.asesoras.asesoras.length > 0 ? (
          <div className="space-y-1.5">
            {data.asesoras.asesoras.map((a, i) => (
              <div key={a.asesor_id} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {a.nombre}
                </span>
                <span className="text-amber-700 font-mono font-semibold ml-2 whitespace-nowrap">
                  S/ {a.total_ventas_mes.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Sin asesoras registradas</p>
        )}
      </InsightCard>

      <InsightCard
        icon={<FiSun className="h-5 w-5" />}
        title="Resumen de ayer y recomendación para hoy"
        color="blue"
        loading={loading}
        iaText={data?.dia.texto ?? ""}
      >
        {data && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">Pedidos</div>
              <div className="font-semibold text-gray-800">{data.dia.resumen.pedidos_total}</div>
            </div>
            <div className="bg-green-50 rounded p-2">
              <div className="text-green-600">Entregados</div>
              <div className="font-semibold text-green-700">{data.dia.resumen.pedidos_entregados}</div>
            </div>
            <div className="bg-red-50 rounded p-2">
              <div className="text-red-600">Fallidos</div>
              <div className="font-semibold text-red-700">{data.dia.resumen.pedidos_fallidos}</div>
            </div>
            <div className="bg-blue-50 rounded p-2">
              <div className="text-blue-600">Ventas</div>
              <div className="font-semibold text-blue-700">S/ {data.dia.resumen.ventas_total.toFixed(0)}</div>
            </div>
          </div>
        )}
      </InsightCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Vista Asesora (4 cards personalizadas)
// ════════════════════════════════════════════════════════════════════
function VistaAsesora({ data, loading }: { data: AsesorResponse | null; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* CARD 1: Mi performance */}
      <InsightCard
        icon={<FiTarget className="h-5 w-5" />}
        title="Mi performance del mes"
        color="violet"
        loading={loading}
        iaText={data?.performance.texto ?? ""}
      >
        {data && (
          <div className="space-y-3">
            {/* Barra de progreso */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>S/ {data.performance.ventasMes.toFixed(0)}</span>
                <span>Meta: S/ {data.performance.metaMensual.toFixed(0)}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    data.performance.porcentajeAvance >= 100
                      ? "bg-green-500"
                      : data.performance.porcentajeAvance >= 75
                        ? "bg-blue-500"
                        : data.performance.porcentajeAvance >= 50
                          ? "bg-amber-500"
                          : "bg-red-400"
                  }`}
                  style={{ width: `${Math.min(100, data.performance.porcentajeAvance)}%` }}
                ></div>
              </div>
              <div className="text-right text-xs text-gray-500 mt-1">
                {data.performance.porcentajeAvance.toFixed(0)}% del mes
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-violet-50 rounded p-2">
                <div className="text-violet-600">Día del mes</div>
                <div className="font-semibold text-violet-800">
                  {data.performance.diaDelMes} / {data.performance.diasHabilesMes}
                </div>
              </div>
              <div className="bg-indigo-50 rounded p-2">
                <div className="text-indigo-600">Ritmo necesario</div>
                <div className="font-semibold text-indigo-800">
                  S/ {data.performance.ritmoNecesario.toFixed(0)}/día
                </div>
              </div>
            </div>
          </div>
        )}
      </InsightCard>

      {/* CARD 2: Mis clientes en riesgo */}
      <InsightCard
        icon={<FiAlertCircle className="h-5 w-5" />}
        title="Mis clientes que dejaron de pedir"
        color="rose"
        loading={loading}
        iaText={data?.clientes.texto ?? ""}
      >
        {data && data.clientes.clientes.length > 0 ? (
          <div className="space-y-1.5">
            {data.clientes.clientes.map((c) => (
              <div key={c.cliente_id} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{c.nombre}</span>
                <span className="text-rose-600 font-mono ml-2 whitespace-nowrap">
                  {c.dias_sin_comprar}d · S/{c.total_historico.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">{loading ? "" : "Tu cartera está al día ✨"}</p>
        )}
      </InsightCard>

      {/* CARD 3: Productos top de mi cartera */}
      <InsightCard
        icon={<FiShoppingBag className="h-5 w-5" />}
        title="Top productos de mi cartera (90 días)"
        color="teal"
        loading={loading}
        iaText={data?.cartera.texto ?? ""}
      >
        {data && data.cartera.productos.length > 0 ? (
          <div className="space-y-1.5">
            {data.cartera.productos.map((p, i) => (
              <div key={p.nombre} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">
                  {i + 1}. {p.nombre}
                </span>
                <span className="text-teal-700 font-mono ml-2 whitespace-nowrap">
                  {p.pedidos} ped.
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Sin datos suficientes todavía</p>
        )}
      </InsightCard>

      {/* CARD 4: Sugerencia del día */}
      <InsightCard
        icon={<FiPhoneCall className="h-5 w-5" />}
        title="¿A quién contactar hoy?"
        color="indigo"
        loading={loading}
        iaText={data?.sugerencia.texto ?? ""}
      >
        {data && data.sugerencia.candidatos.length > 0 ? (
          <div className="space-y-1.5">
            {data.sugerencia.candidatos.map((c) => (
              <div key={c.cliente_id} className="text-xs bg-indigo-50 rounded p-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-800 truncate flex-1">{c.nombre}</span>
                  <span className="text-indigo-700 font-mono ml-2 whitespace-nowrap">
                    {c.dias_sin_comprar}d
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Suele pedir cada {c.patron_intervalo_dias}d · histórico S/{c.total_historico.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            {loading ? "" : "Sin candidatos por patrón hoy"}
          </p>
        )}
      </InsightCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Pantalla principal
// ════════════════════════════════════════════════════════════════════
export default function AsistenteIAClient({
  role,
  nombre,
}: {
  role: "admin" | "asesor";
  nombre: string;
}) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const url = force ? "/api/asistente-ia?refresh=1" : "/api/asistente-ia";
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInsights(false);
  }, []);

  // Heading depende del rol
  const heading =
    role === "admin"
      ? "Asistente IA"
      : `Hola ${nombre.split(" ")[0]}, tu Asistente IA`;
  const subtitle =
    role === "admin"
      ? "Análisis automático del negocio — se actualiza cada hora"
      : "Tus números, tu cartera, tu sugerencia del día — actualizado cada hora";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiZap className="text-violet-600" />
            {heading}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {data && !error && (
            <span className="text-xs text-gray-400">
              {data.cached ? "📦 desde cache" : "✨ recién generado"} ·{" "}
              {new Date(data.generatedAt).toLocaleTimeString("es-PE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <button
            onClick={() => fetchInsights(true)}
            disabled={refreshing}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
          >
            <FiRefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Generando…" : "Refrescar análisis"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <strong>⚠️ Error:</strong> {error}
        </div>
      )}

      {role === "admin" ? (
        <VistaAdmin data={data as AdminResponse | null} loading={loading} />
      ) : (
        <VistaAsesora data={data as AsesorResponse | null} loading={loading} />
      )}

      {/* Disclaimer */}
      <div className="mt-6 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
        🔒 <strong>Privacidad:</strong> antes de enviar datos a Gemini, los nombres de
        {role === "admin" ? " los clientes" : " tus clientes"} se reemplazan por códigos
        anónimos (Cliente A, Cliente B…). Gemini solo ve montos, cantidades y nombres de
        productos.
      </div>
    </div>
  );
}

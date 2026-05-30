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
  FiLock,
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

type Accent = "green" | "red" | "amber" | "blue" | "teal";

// ════════════════════════════════════════════════════════════════════
// Card genérica — el texto de la IA es el protagonista; los datos, apoyo.
// Acento de color SOLO en el ícono del encabezado (significado), sin
// gradientes ni bloques de color (que daban "look de IA").
// ════════════════════════════════════════════════════════════════════
function InsightCard({
  icon,
  title,
  accent,
  iaText,
  children,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  accent: Accent;
  iaText: string;
  children: React.ReactNode;
  loading?: boolean;
}) {
  const accentBg: Record<Accent, string> = {
    green: "bg-green-50 text-green-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
    teal: "bg-teal-50 text-teal-600",
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col h-full">
      {/* Encabezado sobrio */}
      <div className="flex items-center gap-2.5 mb-4">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${accentBg[accent]}`}>
          {icon}
        </span>
        <h2 className="font-bold text-gray-800 text-sm">{title}</h2>
      </div>

      {/* Texto generado por la IA — protagonista */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 text-red-600 mb-1.5">
          <FiZap className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-wide">Sugerencia de la IA</span>
        </div>
        {loading ? (
          <div className="space-y-2">
            <span className="block h-3 bg-gray-100 rounded animate-pulse"></span>
            <span className="block h-3 bg-gray-100 rounded animate-pulse w-11/12"></span>
            <span className="block h-3 bg-gray-100 rounded animate-pulse w-4/5"></span>
          </div>
        ) : (
          <p className="text-[15px] text-gray-800 leading-relaxed">{iaText}</p>
        )}
      </div>

      {/* Datos de apoyo */}
      <div className="flex-1 pt-3 border-t border-gray-100">{children}</div>
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
        icon={<FiTrendingUp className="h-4 w-4" />}
        title="Tendencias de productos"
        accent="green"
        loading={loading}
        iaText={data?.productos.texto ?? ""}
      >
        {data && data.productos.productosUp.length + data.productos.productosDown.length > 0 ? (
          <div className="space-y-1.5">
            {data.productos.productosUp.map((p) => (
              <div key={"u-" + p.nombre} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{p.nombre}</span>
                <span className="text-green-600 font-semibold ml-2 whitespace-nowrap tabular-nums">
                  ▲ +{p.porcentaje_cambio.toFixed(0)}%
                </span>
              </div>
            ))}
            {data.productos.productosDown.map((p) => (
              <div key={"d-" + p.nombre} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{p.nombre}</span>
                <span className="text-red-600 font-semibold ml-2 whitespace-nowrap tabular-nums">
                  ▼ {p.porcentaje_cambio.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Sin datos suficientes todavía.</p>
        )}
      </InsightCard>

      <InsightCard
        icon={<FiAlertCircle className="h-4 w-4" />}
        title="Clientes en riesgo"
        accent="red"
        loading={loading}
        iaText={data?.clientes.texto ?? ""}
      >
        {data && data.clientes.clientes.length > 0 ? (
          <div className="space-y-1.5">
            {data.clientes.clientes.map((c) => (
              <div key={c.cliente_id} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{c.nombre.trim()}</span>
                <span className="text-gray-500 ml-2 whitespace-nowrap tabular-nums">
                  {c.dias_sin_comprar}d · S/{c.total_historico.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">{loading ? "" : "Todos al día."}</p>
        )}
      </InsightCard>

      <InsightCard
        icon={<FiAward className="h-4 w-4" />}
        title="Ranking de asesoras este mes"
        accent="amber"
        loading={loading}
        iaText={data?.asesoras.texto ?? ""}
      >
        {data && data.asesoras.asesoras.length > 0 ? (
          <div className="space-y-1.5">
            {data.asesoras.asesoras.map((a, i) => (
              <div key={a.asesor_id} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {a.nombre.trim()}
                </span>
                <span className="text-gray-800 font-semibold ml-2 whitespace-nowrap tabular-nums">
                  S/ {a.total_ventas_mes.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Sin asesoras registradas.</p>
        )}
      </InsightCard>

      <InsightCard
        icon={<FiSun className="h-4 w-4" />}
        title="Resumen de ayer y recomendación para hoy"
        accent="blue"
        loading={loading}
        iaText={data?.dia.texto ?? ""}
      >
        {data && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded-lg p-2.5">
              <div className="text-gray-500">Pedidos</div>
              <div className="font-bold text-gray-800 text-base tabular-nums">{data.dia.resumen.pedidos_total}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2.5">
              <div className="text-gray-500">Entregados</div>
              <div className="font-bold text-green-700 text-base tabular-nums">{data.dia.resumen.pedidos_entregados}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2.5">
              <div className="text-gray-500">Fallidos</div>
              <div className="font-bold text-red-700 text-base tabular-nums">{data.dia.resumen.pedidos_fallidos}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2.5">
              <div className="text-gray-500">Ventas</div>
              <div className="font-bold text-gray-800 text-base tabular-nums">S/ {data.dia.resumen.ventas_total.toFixed(0)}</div>
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
        icon={<FiTarget className="h-4 w-4" />}
        title="Mi avance del mes"
        accent="blue"
        loading={loading}
        iaText={data?.performance.texto ?? ""}
      >
        {data && (
          <div className="space-y-3">
            {/* Barra de progreso */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1 tabular-nums">
                <span>S/ {data.performance.ventasMes.toFixed(0)}</span>
                <span>Meta: S/ {data.performance.metaMensual.toFixed(0)}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
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
              <div className="text-right text-xs text-gray-500 mt-1 tabular-nums">
                {data.performance.porcentajeAvance.toFixed(0)}% del mes
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-gray-500">Día del mes</div>
                <div className="font-bold text-gray-800 tabular-nums">
                  {data.performance.diaDelMes} / {data.performance.diasHabilesMes}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-gray-500">Ritmo necesario</div>
                <div className="font-bold text-gray-800 tabular-nums">
                  S/ {data.performance.ritmoNecesario.toFixed(0)}/día
                </div>
              </div>
            </div>
          </div>
        )}
      </InsightCard>

      {/* CARD 2: Mis clientes en riesgo */}
      <InsightCard
        icon={<FiAlertCircle className="h-4 w-4" />}
        title="Mis clientes que dejaron de pedir"
        accent="red"
        loading={loading}
        iaText={data?.clientes.texto ?? ""}
      >
        {data && data.clientes.clientes.length > 0 ? (
          <div className="space-y-1.5">
            {data.clientes.clientes.map((c) => (
              <div key={c.cliente_id} className="flex justify-between items-center text-xs">
                <span className="truncate flex-1 text-gray-700">{c.nombre.trim()}</span>
                <span className="text-gray-500 ml-2 whitespace-nowrap tabular-nums">
                  {c.dias_sin_comprar}d · S/{c.total_historico.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">{loading ? "" : "Tu cartera está al día."}</p>
        )}
      </InsightCard>

      {/* CARD 3: Productos top de mi cartera */}
      <InsightCard
        icon={<FiShoppingBag className="h-4 w-4" />}
        title="Top productos de mi cartera (90 días)"
        accent="teal"
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
                <span className="text-gray-500 ml-2 whitespace-nowrap tabular-nums">{p.pedidos} ped.</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Sin datos suficientes todavía.</p>
        )}
      </InsightCard>

      {/* CARD 4: Sugerencia del día */}
      <InsightCard
        icon={<FiPhoneCall className="h-4 w-4" />}
        title="¿A quién contactar hoy?"
        accent="amber"
        loading={loading}
        iaText={data?.sugerencia.texto ?? ""}
      >
        {data && data.sugerencia.candidatos.length > 0 ? (
          <div className="space-y-1.5">
            {data.sugerencia.candidatos.map((c) => (
              <div key={c.cliente_id} className="text-xs bg-gray-50 rounded-lg p-2.5">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-800 truncate flex-1">{c.nombre.trim()}</span>
                  <span className="text-gray-500 ml-2 whitespace-nowrap tabular-nums">{c.dias_sin_comprar}d</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                  Suele pedir cada {c.patron_intervalo_dias}d · histórico S/{c.total_historico.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">{loading ? "" : "Sin candidatos por patrón hoy."}</p>
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
    role === "admin" ? "Asistente IA" : `Hola ${nombre.split(" ")[0]}, tu Asistente IA`;
  const subtitle =
    role === "admin"
      ? "Análisis automático del negocio, actualizado cada hora"
      : "Tus números, tu cartera y tu sugerencia del día, actualizados cada hora";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiZap className="text-red-600" />
            {heading}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {data && !error && (
            <span className="text-xs text-gray-400">
              {data.cached ? "Desde caché" : "Recién generado"} ·{" "}
              {new Date(data.generatedAt).toLocaleTimeString("es-PE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <button
            onClick={() => fetchInsights(true)}
            disabled={refreshing}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors active:scale-[0.97]"
          >
            <FiRefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Generando…" : "Refrescar análisis"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {role === "admin" ? (
        <VistaAdmin data={data as AdminResponse | null} loading={loading} />
      ) : (
        <VistaAsesora data={data as AsesorResponse | null} loading={loading} />
      )}

      {/* Disclaimer de privacidad */}
      <div className="mt-6 flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
        <FiLock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <p>
          <strong className="text-gray-600">Privacidad:</strong> antes de enviar datos a la IA, los
          nombres de {role === "admin" ? "los clientes" : "tus clientes"} se reemplazan por códigos
          anónimos (Cliente A, Cliente B…). La IA solo ve montos, cantidades y nombres de productos.
        </p>
      </div>
    </div>
  );
}

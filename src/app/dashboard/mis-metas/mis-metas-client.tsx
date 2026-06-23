// src/app/dashboard/mis-metas/mis-metas-client.tsx
// Vista "Mis Metas" para la asesora (panel motivacional):
//   - "Hoy" como protagonista (qué tan cerca está de su meta del día)
//   - Semana y Mes como apoyo
//   - Indicador de ritmo + bloques de incentivo activos (racha, equipo, ranking)
// Aplica "No me hagas pensar": números grandes, color de semáforo, sin tecnicismos.
"use client";

import { useState } from "react";
import { usePollingVisible } from "@/lib/use-polling-visible";
import {
  FiTarget,
  FiTrendingUp,
  FiTrendingDown,
  FiRefreshCw,
  FiEye,
  FiZap,
  FiUsers,
  FiAward,
  FiGift,
} from "react-icons/fi";
import InsightCard from "@/components/InsightCard";

interface MetaData {
  metaDiaria: number;
  metaMensual: number;
  ventasMesAnterior: number;
  ventasMesActual: number;
  ventasHoy: number;
  ventasSemana: number;
  metaSemanal: number;
  racha: number;
  diasHabilesMes: number;
  diaDelMes: number;
  metaAcumuladaHoy: number;
  porcentajeAvanceMensual: number;
  porcentajeAvanceDiario: number;
  porcentajeAvanceSemanal: number;
  diferenciaVsMetaAcumulada: number;
  bono: string; // bono personalizado al cumplir la meta del mes ("" si no hay)
}

type CriterioRanking = "monto" | "pedidos";
interface DiaRacha {
  fechaIso: string;
  label: string;
  nombre: string;
  monto: number;
  pedidos: number;
  cumplido: boolean;
  esFuturo: boolean;
  esHoy: boolean;
}
interface IncentivosData {
  criterio: CriterioRanking;
  equipo: {
    activo: boolean;
    criterio: CriterioRanking;
    meta: number;
    vendido: number;
    premio: string;
    porcentaje: number;
  } | null;
  ranking: Array<{
    asesorId: string;
    nombre: string;
    valor: number;
    puesto: number;
    premio: string | null;
    esTu: boolean;
  }>;
  racha: {
    activo: boolean;
    diaFin: number;
    premio: string;
    criterio: CriterioRanking;
    minimoDiario: number;
    dias: DiaRacha[];
    diasCumplidos: number;
    totalDias: number;
    diasTranscurridos: number;
    semanaPerfecta: boolean;
  } | null;
  metasIndividuales?: { activo: boolean };
}

const soles = (n: number) => `S/ ${n.toFixed(2)}`;

function formatValor(valor: number, criterio: CriterioRanking): string {
  // "pedidos" hoy cuenta comprobantes de venta (facturas/boletas) → lo mostramos
  // como "venta(s)", que es lo que la asesora entiende.
  if (criterio === "pedidos") return `${valor} venta${valor === 1 ? "" : "s"}`;
  return soles(valor);
}

function medalla(puesto: number): string {
  return puesto === 1 ? "🥇" : puesto === 2 ? "🥈" : puesto === 3 ? "🥉" : `${puesto}°`;
}

// Semáforo de progreso (verde llegó / ámbar buen ritmo / rojo atrás).
function colorPorProgreso(pct: number): {
  bg: string;
  border: string;
  text: string;
  bar: string;
} {
  if (pct >= 100)
    return { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", bar: "bg-green-500" };
  if (pct >= 70)
    return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", bar: "bg-amber-500" };
  return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", bar: "bg-red-500" };
}

// Tarjeta compacta de apoyo (semana / mes).
function MetaMini({
  titulo,
  pct,
  actual,
  meta,
}: {
  titulo: string;
  pct: number;
  actual: number;
  meta: number;
}) {
  const c = colorPorProgreso(pct);
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">{titulo}</h3>
        <span className={`text-xl font-bold ${c.text} tabular-nums`}>{pct}%</span>
      </div>
      <div className="bg-gray-100 rounded-full h-2.5 overflow-hidden mb-2">
        <div
          className={`h-full ${c.bar} transition-all duration-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 tabular-nums">
        {soles(actual)} <span className="text-gray-400">de {soles(meta)}</span>
      </div>
    </div>
  );
}

export default function MisMetasClient({
  nombre,
  esVistaPrevia = false,
}: {
  nombre: string;
  esVistaPrevia?: boolean;
}) {
  const [data, setData] = useState<MetaData | null>(null);
  const [inc, setInc] = useState<IncentivosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [res, resInc] = await Promise.all([fetch("/api/metas"), fetch("/api/incentivos")]);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
      if (resInc.ok) setInc(await resInc.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Refresh cada 60s, solo con la pestaña visible (no consume Neon en segundo plano).
  usePollingVisible(fetchData, 60_000);

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="inline-block h-6 w-6 border-2 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
        <div className="mt-2 text-sm">Cargando tu meta…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <strong>No pude cargar tu meta:</strong> {error || "Sin datos"}
          <button
            onClick={fetchData}
            className="mt-3 block w-full px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const colorDia = colorPorProgreso(data.porcentajeAvanceDiario);
  const enRitmo = data.diferenciaVsMetaAcumulada >= 0;
  const faltaHoy = Math.max(0, data.metaDiaria - data.ventasHoy);
  const muestraMetasPersonales = inc?.metasIndividuales?.activo ?? true;

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        {/* ── Header ── */}
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <FiTarget className="text-red-600" />
              Mis Metas
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {esVistaPrevia
                ? "Vista previa: así ven sus metas las asesoras"
                : `Hola ${nombre.split(" ")[0]}, así vas hoy y este mes`}
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 hover:bg-gray-50 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors active:scale-[0.97]"
          >
            <FiRefreshCw className={refreshing ? "animate-spin" : ""} />
            Refrescar
          </button>
        </header>

        {esVistaPrevia && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            <FiEye className="mt-0.5 flex-shrink-0" />
            <span>
              <strong>Vista previa de administrador.</strong> Así ven sus metas las asesoras. Tú no
              compites: tus tarjetas personales (Hoy / Esta semana / Este mes) salen en S/&nbsp;0, pero
              el ranking y la meta de equipo muestran datos reales del equipo.
            </span>
          </div>
        )}

        {/* Tarjetas de progreso personal — solo si las metas individuales están activas */}
        {muestraMetasPersonales && (
          <>
            {/* ── HERO: Hoy ── */}
            <section className={`rounded-2xl p-5 mb-4 border ${colorDia.border} ${colorDia.bg}`}>
              <div className="flex items-end justify-between mb-1">
                <h2 className={`font-bold text-lg ${colorDia.text}`}>Hoy</h2>
                <span className={`text-5xl font-extrabold ${colorDia.text} tabular-nums leading-none`}>
                  {data.porcentajeAvanceDiario}%
                </span>
              </div>
              <div className="bg-white rounded-full h-5 overflow-hidden my-3">
                <div
                  className={`h-full ${colorDia.bar} transition-all duration-500`}
                  style={{ width: `${Math.min(100, data.porcentajeAvanceDiario)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  Vendiste <strong className="tabular-nums">{soles(data.ventasHoy)}</strong>
                </span>
                {data.metaDiaria <= 0 ? (
                  <span className="text-gray-500">Aún no tienes meta para hoy</span>
                ) : faltaHoy > 0 ? (
                  <span className={colorDia.text}>
                    Te faltan <strong className="tabular-nums">{soles(faltaHoy)}</strong> para tu meta
                  </span>
                ) : (
                  <span className="text-green-700 font-semibold">¡Meta del día cumplida!</span>
                )}
              </div>
            </section>

            {/* ── Semana + Mes (apoyo) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <MetaMini
                titulo="Esta semana"
                pct={data.porcentajeAvanceSemanal}
                actual={data.ventasSemana}
                meta={data.metaSemanal}
              />
              <MetaMini
                titulo="Este mes"
                pct={data.porcentajeAvanceMensual}
                actual={data.ventasMesActual}
                meta={data.metaMensual}
              />
            </div>

            {/* ── Indicador de ritmo ── */}
            <div
              className={`rounded-xl p-3.5 mb-4 flex items-start gap-3 border ${
                enRitmo ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
              }`}
            >
              {enRitmo ? (
                <FiTrendingUp className="text-green-600 h-5 w-5 flex-shrink-0 mt-0.5" />
              ) : (
                <FiTrendingDown className="text-amber-600 h-5 w-5 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-sm">
                <div className={`font-semibold ${enRitmo ? "text-green-700" : "text-amber-700"}`}>
                  {enRitmo ? "Vas con buen ritmo" : "Vas un poco atrás"}
                </div>
                <div className={`mt-0.5 ${enRitmo ? "text-green-600" : "text-amber-600"}`}>
                  Estás{" "}
                  <strong className="tabular-nums">
                    {soles(Math.abs(data.diferenciaVsMetaAcumulada))}
                  </strong>{" "}
                  {enRitmo ? "por encima" : "por debajo"} de lo esperado para el día {data.diaDelMes}{" "}
                  del mes.
                </div>
              </div>
            </div>

            {/* ── Bono personalizado al cumplir la meta del mes (si el admin lo definió) ── */}
            {data.bono ? (
              <div
                className={`rounded-xl p-3.5 mb-4 flex items-start gap-3 border ${
                  data.porcentajeAvanceMensual >= 100
                    ? "bg-green-50 border-green-200"
                    : "bg-amber-50 border-amber-200"
                }`}
              >
                <FiGift
                  className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                    data.porcentajeAvanceMensual >= 100 ? "text-green-600" : "text-amber-600"
                  }`}
                />
                <div className="flex-1 text-sm">
                  <div
                    className={`font-semibold ${
                      data.porcentajeAvanceMensual >= 100 ? "text-green-700" : "text-amber-700"
                    }`}
                  >
                    {data.porcentajeAvanceMensual >= 100
                      ? "¡Ganaste tu bono de este mes!"
                      : "Bono por cumplir tu meta del mes"}
                  </div>
                  <div
                    className={`mt-0.5 ${
                      data.porcentajeAvanceMensual >= 100 ? "text-green-600" : "text-amber-700"
                    }`}
                  >
                    {data.porcentajeAvanceMensual >= 100 ? (
                      <>
                        Llegaste a tu meta del mes. Tu bono: <strong>{data.bono}</strong>
                      </>
                    ) : (
                      <>
                        Si llegas a tu meta del mes ganas: <strong>{data.bono}</strong>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* ── Consejo de la IA ── */}
        <InsightCard tipo="sugerencia" />

        {/* ── Racha de consistencia ── */}
        {inc?.racha?.activo && inc.racha.dias.length > 0 && (
          <section
            className={`rounded-2xl p-5 mb-4 border ${
              inc.racha.semanaPerfecta ? "border-green-300 bg-green-50" : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <FiZap className="text-amber-500" />
                Racha de consistencia
              </h2>
              <span className="text-xs text-gray-500 tabular-nums">
                {inc.racha.diasCumplidos}/{inc.racha.totalDias} días
              </span>
            </div>

            <p className="text-xs text-gray-500 mb-3">
              Cada día cuenta si{" "}
              {inc.racha.criterio === "pedidos" ? (
                <>
                  facturas <strong>{inc.racha.minimoDiario}</strong> venta
                  {inc.racha.minimoDiario === 1 ? "" : "s"} o más
                </>
              ) : (
                <>
                  facturas <strong>S/ {inc.racha.minimoDiario}</strong> o más
                </>
              )}
              .
            </p>

            {/* Cuadro por día: verde ✓ cumplió, rojo ✗ no, gris · futuro */}
            <div className="flex gap-1.5 mb-3">
              {inc.racha.dias.map((d) => {
                const estado = d.esFuturo
                  ? "bg-gray-50 border-gray-200 text-gray-400"
                  : d.cumplido
                    ? "bg-green-100 border-green-300 text-green-700"
                    : "bg-red-50 border-red-200 text-red-600";
                const valorDia =
                  inc.racha!.criterio === "pedidos"
                    ? `${d.pedidos} venta${d.pedidos === 1 ? "" : "s"}`
                    : soles(d.monto);
                return (
                  <div
                    key={d.fechaIso}
                    title={`${d.nombre}: ${valorDia}${d.esFuturo ? " (aún no llega)" : ""}`}
                    className={`flex-1 text-center py-2 rounded-lg border ${estado} ${
                      d.esHoy ? "ring-2 ring-amber-400" : ""
                    }`}
                  >
                    <div className="text-xs font-medium">{d.label}</div>
                    <div className="text-lg font-bold leading-none mt-1">
                      {d.esFuturo ? "·" : d.cumplido ? "✓" : "✗"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mensaje de progreso + premio */}
            {inc.racha.semanaPerfecta ? (
              <div className="text-center text-sm font-bold text-green-700 bg-green-100 rounded-lg py-2 px-3">
                ¡Semana perfecta!{inc.racha.premio ? ` Ganaste: ${inc.racha.premio}` : ""}
              </div>
            ) : inc.racha.diasCumplidos === inc.racha.diasTranscurridos &&
              inc.racha.diasTranscurridos > 0 ? (
              <div className="text-center text-sm text-gray-600">
                ¡Vas perfecto! Te falta
                {inc.racha.totalDias - inc.racha.diasCumplidos === 1 ? "" : "n"}{" "}
                <strong>{inc.racha.totalDias - inc.racha.diasCumplidos}</strong> día
                {inc.racha.totalDias - inc.racha.diasCumplidos === 1 ? "" : "s"} para
                {inc.racha.premio ? (
                  <>
                    {" "}
                    ganar <span className="text-amber-600 font-medium">{inc.racha.premio}</span>.
                  </>
                ) : (
                  " la semana perfecta."
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-gray-600">
                Cumpliste <strong>{inc.racha.diasCumplidos}</strong> de {inc.racha.totalDias} días.
                {inc.racha.premio ? (
                  <>
                    {" "}
                    Premio por semana perfecta:{" "}
                    <span className="text-amber-600 font-medium">{inc.racha.premio}</span>.
                  </>
                ) : null}
              </div>
            )}
          </section>
        )}

        {/* ── Meta de equipo (semana) ── */}
        {inc?.equipo?.activo &&
          (() => {
            const c = colorPorProgreso(inc.equipo.porcentaje);
            return (
              <section className="rounded-2xl p-5 mb-4 border border-gray-200 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-bold text-gray-800 flex items-center gap-2">
                    <FiUsers className="text-blue-500" />
                    Meta del equipo
                  </h2>
                  <span className={`text-xl font-bold ${c.text} tabular-nums`}>
                    {inc.equipo.porcentaje}%
                  </span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden mb-3">
                  <div
                    className={`h-full ${c.bar} transition-all duration-500`}
                    style={{ width: `${Math.min(100, inc.equipo.porcentaje)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>
                    El equipo lleva{" "}
                    <strong>{formatValor(inc.equipo.vendido, inc.equipo.criterio)}</strong>
                  </span>
                  <span className="text-gray-400">
                    de {formatValor(inc.equipo.meta, inc.equipo.criterio)}
                  </span>
                </div>
                {inc.equipo.premio && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <FiGift className="flex-shrink-0" />
                    <span>
                      Premio si lo logran: <strong>{inc.equipo.premio}</strong>
                    </span>
                  </div>
                )}
              </section>
            );
          })()}

        {/* ── Ranking del mes ── */}
        {inc && inc.ranking.length > 0 && (
          <section className="rounded-2xl p-5 mb-4 border border-gray-200 bg-white shadow-sm">
            <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
              <FiAward className="text-amber-500" />
              Ranking del mes
            </h2>
            <div className="space-y-1.5">
              {inc.ranking.map((r) => (
                <div
                  key={r.asesorId}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                    r.esTu ? "bg-red-50 border border-red-200 font-semibold" : "bg-gray-50"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-7 text-center flex-shrink-0">{medalla(r.puesto)}</span>
                    <span className="text-gray-800 truncate">
                      {r.nombre.trim()}
                      {r.esTu ? " (tú)" : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {r.premio && (
                      <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <FiGift className="h-3 w-3" /> {r.premio}
                      </span>
                    )}
                    <span className="text-gray-700 tabular-nums">
                      {formatValor(r.valor, inc.criterio)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Detalle ── */}
        {muestraMetasPersonales && (
          <details className="bg-white rounded-xl border border-gray-200 p-4">
            <summary className="cursor-pointer font-semibold text-gray-700 text-sm">
              Detalle del cálculo
            </summary>
            <dl className="mt-3 space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <dt>Ventas del mes anterior:</dt>
                <dd className="font-medium tabular-nums">{soles(data.ventasMesAnterior)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Crecimiento esperado (+15%):</dt>
                <dd className="font-medium tabular-nums">{soles(data.metaMensual)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Días hábiles del mes:</dt>
                <dd className="font-medium tabular-nums">{data.diasHabilesMes}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Meta por día hábil:</dt>
                <dd className="font-medium tabular-nums">{soles(data.metaDiaria)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Hoy es el día {data.diaDelMes} hábil del mes:</dt>
                <dd className="font-medium tabular-nums">
                  Meta acumulada: {soles(data.metaAcumuladaHoy)}
                </dd>
              </div>
            </dl>
          </details>
        )}
      </div>
    </div>
  );
}

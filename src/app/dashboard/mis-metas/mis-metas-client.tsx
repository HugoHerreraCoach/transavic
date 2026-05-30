// src/app/dashboard/mis-metas/mis-metas-client.tsx
// Vista "Mis Metas" para asesora:
//   - Barra de progreso DEL DÍA grande arriba (verde si llegó, amarillo si va por buen ritmo, rojo si va atrás)
//   - Barra de progreso DEL MES debajo (con monto y % avance)
//   - Card con detalle: meta diaria, mensual, ventas mes anterior, días hábiles
// Aplica "No me hagas pensar": numeros grandes, colores claros, sin tecnicismos.
"use client";

import { useEffect, useState } from "react";
import { FiTarget, FiTrendingUp, FiTrendingDown, FiRefreshCw, FiEye } from "react-icons/fi";
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

function formatValor(valor: number, criterio: CriterioRanking): string {
  if (criterio === "pedidos") return `${valor} pedido${valor === 1 ? "" : "s"}`;
  return `S/ ${valor.toFixed(2)}`;
}

function medalla(puesto: number): string {
  return puesto === 1 ? "🥇" : puesto === 2 ? "🥈" : puesto === 3 ? "🥉" : `${puesto}°`;
}

function colorPorProgreso(pct: number): { bg: string; text: string; bar: string } {
  if (pct >= 100) return { bg: "bg-green-50", text: "text-green-700", bar: "bg-green-500" };
  if (pct >= 70) return { bg: "bg-yellow-50", text: "text-yellow-700", bar: "bg-yellow-500" };
  return { bg: "bg-red-50", text: "text-red-700", bar: "bg-red-500" };
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
      const [res, resInc] = await Promise.all([
        fetch("/api/metas"),
        fetch("/api/incentivos"),
      ]);
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

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60_000); // 60s
    return () => clearInterval(t);
  }, []);

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
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <strong>⚠️ No pude cargar tu meta:</strong> {error || "Sin datos"}
          <button
            onClick={fetchData}
            className="mt-2 block w-full px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const colorDia = colorPorProgreso(data.porcentajeAvanceDiario);
  const colorSemana = colorPorProgreso(data.porcentajeAvanceSemanal);
  const colorMes = colorPorProgreso(data.porcentajeAvanceMensual);
  const enRitmo = data.diferenciaVsMetaAcumulada >= 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      {/* ── Header ── */}
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiTarget className="text-red-600" />
            Mis Metas
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {esVistaPrevia
              ? "Vista previa — así ven sus metas las asesoras"
              : `Hola ${nombre}, así vas hoy y este mes`}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={refreshing}
          className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1 disabled:opacity-50"
        >
          <FiRefreshCw className={refreshing ? "animate-spin" : ""} />
          Refrescar
        </button>
      </header>

      {esVistaPrevia && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          <FiEye className="mt-0.5 flex-shrink-0" />
          <span>
            <strong>Vista previa de administrador.</strong> Así ven sus metas las
            asesoras. Tú no compites: tus tarjetas personales (Hoy / Esta semana /
            Este mes) salen en S/&nbsp;0, pero el ranking y la meta de equipo muestran
            datos reales del equipo.
          </span>
        </div>
      )}

      <InsightCard tipo="sugerencia" />

      {inc?.racha?.activo && inc.racha.dias.length > 0 && (
        <section
          className={`rounded-2xl p-5 mb-4 border-2 ${
            inc.racha.semanaPerfecta
              ? "border-orange-300 bg-gradient-to-r from-orange-50 to-amber-50"
              : "border-gray-200 bg-white"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              🔥 Racha de consistencia
            </h2>
            <span className="text-xs text-gray-500">
              {inc.racha.diasCumplidos}/{inc.racha.totalDias} días
            </span>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Cada día cuenta si{" "}
            {inc.racha.criterio === "pedidos" ? (
              <>
                vendes <strong>{inc.racha.minimoDiario}</strong> pedido
                {inc.racha.minimoDiario === 1 ? "" : "s"} o más
              </>
            ) : (
              <>
                vendes <strong>S/ {inc.racha.minimoDiario}</strong> o más
              </>
            )}
            .
          </p>

          {/* Cuadro por día: verde ✓ si cumplió el mínimo, rojo ✗ si no, gris · si es futuro */}
          <div className="flex gap-1.5 mb-3">
            {inc.racha.dias.map((d) => {
              const estado = d.esFuturo
                ? "bg-gray-50 border-gray-200 text-gray-400"
                : d.cumplido
                ? "bg-green-100 border-green-300 text-green-700"
                : "bg-red-50 border-red-200 text-red-600";
              const valorDia =
                inc.racha!.criterio === "pedidos"
                  ? `${d.pedidos} pedido${d.pedidos === 1 ? "" : "s"}`
                  : `S/ ${d.monto.toFixed(2)}`;
              return (
                <div
                  key={d.fechaIso}
                  title={`${d.nombre}: ${valorDia}${d.esFuturo ? " (aún no llega)" : ""}`}
                  className={`flex-1 text-center py-2 rounded-lg border ${estado} ${
                    d.esHoy ? "ring-2 ring-orange-400" : ""
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
            <div className="text-center text-sm font-bold text-green-700 bg-green-100 rounded-full py-1.5 px-3">
              🎉 ¡Semana perfecta!
              {inc.racha.premio ? ` Ganaste: ${inc.racha.premio}` : ""}
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
                  ganar <span className="text-orange-600 font-medium">{inc.racha.premio}</span>.
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
                  <span className="text-orange-600 font-medium">{inc.racha.premio}</span>.
                </>
              ) : null}
            </div>
          )}
        </section>
      )}

      {/* Tarjetas de progreso personal — solo si las metas individuales están activas */}
      {(inc?.metasIndividuales?.activo ?? true) && (
        <>
      {/* ── Barra del DÍA — más grande ── */}
      <section className={`rounded-2xl p-5 mb-4 border-2 ${colorDia.bg}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-bold text-lg ${colorDia.text}`}>Hoy</h2>
          <span className={`text-3xl font-extrabold ${colorDia.text}`}>
            {data.porcentajeAvanceDiario}%
          </span>
        </div>
        <div className="bg-white rounded-full h-6 overflow-hidden mb-3 shadow-inner">
          <div
            className={`h-full ${colorDia.bar} transition-all duration-500 flex items-center justify-end pr-3`}
            style={{ width: `${Math.min(100, data.porcentajeAvanceDiario)}%` }}
          >
            {data.porcentajeAvanceDiario >= 15 && (
              <span className="text-xs font-bold text-white">
                S/ {data.ventasHoy.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            Vendiste hoy: <strong>S/ {data.ventasHoy.toFixed(2)}</strong>
          </span>
          <span className="text-gray-600">
            Meta del día: <strong>S/ {data.metaDiaria.toFixed(2)}</strong>
          </span>
        </div>
      </section>

      {/* ── Barra de la SEMANA ── */}
      <section className={`rounded-2xl p-5 mb-4 border ${colorSemana.bg}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-semibold ${colorSemana.text}`}>Esta semana</h2>
          <span className={`text-2xl font-bold ${colorSemana.text}`}>
            {data.porcentajeAvanceSemanal}%
          </span>
        </div>
        <div className="bg-white rounded-full h-4 overflow-hidden mb-3 shadow-inner">
          <div
            className={`h-full ${colorSemana.bar} transition-all duration-500`}
            style={{ width: `${Math.min(100, data.porcentajeAvanceSemanal)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            Esta semana: <strong>S/ {data.ventasSemana.toFixed(2)}</strong>
          </span>
          <span className="text-gray-600">
            Meta semanal: <strong>S/ {data.metaSemanal.toFixed(2)}</strong>
          </span>
        </div>
      </section>

      {/* ── Barra del MES ── */}
      <section className={`rounded-2xl p-5 mb-4 border ${colorMes.bg}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-semibold ${colorMes.text}`}>Este mes</h2>
          <span className={`text-2xl font-bold ${colorMes.text}`}>
            {data.porcentajeAvanceMensual}%
          </span>
        </div>
        <div className="bg-white rounded-full h-4 overflow-hidden mb-3 shadow-inner">
          <div
            className={`h-full ${colorMes.bar} transition-all duration-500`}
            style={{ width: `${Math.min(100, data.porcentajeAvanceMensual)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            Acumulado: <strong>S/ {data.ventasMesActual.toFixed(2)}</strong>
          </span>
          <span className="text-gray-600">
            Meta del mes: <strong>S/ {data.metaMensual.toFixed(2)}</strong>
          </span>
        </div>
      </section>

      {/* ── Indicador de ritmo ── */}
      <div
        className={`rounded-xl p-4 mb-4 flex items-start gap-3 ${
          enRitmo ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"
        }`}
      >
        {enRitmo ? (
          <FiTrendingUp className="text-green-600 text-2xl flex-shrink-0 mt-0.5" />
        ) : (
          <FiTrendingDown className="text-amber-600 text-2xl flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          {enRitmo ? (
            <>
              <div className="font-semibold text-green-700">Vas con buen ritmo 🎉</div>
              <div className="text-sm text-green-600 mt-0.5">
                Estás <strong>S/ {data.diferenciaVsMetaAcumulada.toFixed(2)}</strong> por encima
                de la meta acumulada del día {data.diaDelMes} del mes.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold text-amber-700">Vas un poco atrás</div>
              <div className="text-sm text-amber-600 mt-0.5">
                Estás <strong>S/ {Math.abs(data.diferenciaVsMetaAcumulada).toFixed(2)}</strong>{" "}
                debajo de la meta acumulada del día {data.diaDelMes} del mes.
              </div>
            </>
          )}
        </div>
      </div>
        </>
      )}

      {/* ── Meta de equipo (semana) ── */}
      {inc?.equipo?.activo && (
        <section className="rounded-2xl p-5 mb-4 border border-indigo-200 bg-indigo-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-indigo-700">🏆 Meta del equipo (semana)</h2>
            <span className="text-xl font-bold text-indigo-700">{inc.equipo.porcentaje}%</span>
          </div>
          <div className="bg-white rounded-full h-4 overflow-hidden mb-3 shadow-inner">
            <div
              className="h-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${Math.min(100, inc.equipo.porcentaje)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              El equipo lleva <strong>{formatValor(inc.equipo.vendido, inc.equipo.criterio)}</strong>
            </span>
            <span>
              Meta: <strong>{formatValor(inc.equipo.meta, inc.equipo.criterio)}</strong>
            </span>
          </div>
          {inc.equipo.premio && (
            <div className="mt-3 text-sm text-indigo-800 bg-white/70 rounded-lg px-3 py-2">
              🎁 Premio si lo logran: <strong>{inc.equipo.premio}</strong>
            </div>
          )}
        </section>
      )}

      {/* ── Ranking del mes ── */}
      {inc && inc.ranking.length > 0 && (
        <section className="rounded-2xl p-5 mb-4 border bg-white">
          <h2 className="font-bold text-gray-800 mb-3">🥇 Ranking del mes</h2>
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
                    {r.nombre}
                    {r.esTu ? " (vos)" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {r.premio && (
                    <span className="text-[11px] text-indigo-700 bg-indigo-50 rounded px-1.5 py-0.5">
                      🎁 {r.premio}
                    </span>
                  )}
                  <span className="text-gray-700">{formatValor(r.valor, inc.criterio)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Detalle ── */}
      <details className="bg-white rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold text-gray-700">
          Detalle del cálculo
        </summary>
        <dl className="mt-3 space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <dt>Ventas del mes anterior:</dt>
            <dd className="font-medium">S/ {data.ventasMesAnterior.toFixed(2)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Crecimiento esperado (+15%):</dt>
            <dd className="font-medium">S/ {data.metaMensual.toFixed(2)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Días hábiles del mes:</dt>
            <dd className="font-medium">{data.diasHabilesMes}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Meta por día hábil:</dt>
            <dd className="font-medium">S/ {data.metaDiaria.toFixed(2)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Hoy es el día {data.diaDelMes} hábil del mes:</dt>
            <dd className="font-medium">
              Meta acumulada: S/ {data.metaAcumuladaHoy.toFixed(2)}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

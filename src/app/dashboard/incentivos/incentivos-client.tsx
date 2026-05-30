// src/app/dashboard/incentivos/incentivos-client.tsx
// Pantalla admin: configura el sistema de incentivos.
//   1) Metas individuales por asesora (override mensual).
//   2) Meta de equipo semanal + premio (texto libre).
//   3) Ranking mensual: criterio + premios por puesto (configurables).
"use client";

import { useEffect, useState } from "react";
import { FiAward, FiSave, FiPlus, FiTrash2, FiRefreshCw } from "react-icons/fi";

type Criterio = "monto" | "pedidos";
interface Premio {
  puesto: number;
  premio: string;
}
interface Config {
  metaEquipoSemanal: { activo: boolean; criterio: Criterio; monto: number; premio: string };
  rankingMensual: { activo: boolean; criterio: Criterio; premios: Premio[] };
  rachaSemanal: {
    activo: boolean;
    diaFin: number;
    criterio: Criterio;
    minimoDiario: number;
    premio: string;
  };
  metasIndividuales: { activo: boolean };
}
interface AsesoraRow {
  id: string;
  nombre: string;
  metaMensual: number;
  metaDiaria: number;
  ventasMesActual: number;
}

const DEFAULT_CONFIG: Config = {
  metaEquipoSemanal: { activo: false, criterio: "monto", monto: 0, premio: "" },
  rankingMensual: { activo: false, criterio: "monto", premios: [] },
  rachaSemanal: { activo: false, diaFin: 6, criterio: "monto", minimoDiario: 0, premio: "" },
  metasIndividuales: { activo: true },
};

const CRITERIOS: { v: Criterio; l: string }[] = [
  { v: "monto", l: "Monto vendido (S/)" },
  { v: "pedidos", l: "N° de pedidos vendidos" },
];

const DIAS_FIN: { v: number; l: string }[] = [
  { v: 5, l: "Lunes a Viernes (5 días)" },
  { v: 6, l: "Lunes a Sábado (6 días)" },
];

function mesActualISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function IncentivosClient() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [asesoras, setAsesoras] = useState<AsesoraRow[]>([]);
  const [metaInputs, setMetaInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingMetaId, setSavingMetaId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; txt: string } | null>(null);

  const cargar = async () => {
    try {
      const [rInc, rAse] = await Promise.all([
        fetch("/api/incentivos"),
        fetch("/api/metas/asesoras"),
      ]);
      if (rInc.ok) {
        const j = await rInc.json();
        if (j.config) setConfig({ ...DEFAULT_CONFIG, ...j.config });
      }
      if (rAse.ok) {
        const j = await rAse.json();
        const lista: AsesoraRow[] = j.asesoras ?? [];
        setAsesoras(lista);
        setMetaInputs(
          Object.fromEntries(
            lista.map((a) => [a.id, a.metaMensual > 0 ? String(a.metaMensual) : ""])
          )
        );
      }
    } catch {
      setMsg({ tipo: "error", txt: "No pude cargar la configuración." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  async function guardarMeta(id: string) {
    const monto = parseFloat(metaInputs[id] || "0");
    if (!(monto > 0)) {
      setMsg({ tipo: "error", txt: "Ingresá un monto mayor a 0." });
      return;
    }
    setSavingMetaId(id);
    try {
      const res = await fetch("/api/metas/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asesor_id: id, mes: mesActualISO(), monto_meta: monto }),
      });
      if (!res.ok) throw new Error();
      setMsg({ tipo: "ok", txt: "Meta guardada." });
      setAsesoras((prev) =>
        prev.map((a) => (a.id === id ? { ...a, metaMensual: monto } : a))
      );
    } catch {
      setMsg({ tipo: "error", txt: "No se pudo guardar la meta." });
    } finally {
      setSavingMetaId(null);
    }
  }

  async function guardarConfig() {
    setSavingConfig(true);
    try {
      const res = await fetch("/api/incentivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error();
      setMsg({ tipo: "ok", txt: "Configuración guardada." });
    } catch {
      setMsg({ tipo: "error", txt: "No se pudo guardar la configuración." });
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="inline-block h-6 w-6 border-2 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
        <div className="mt-2 text-sm">Cargando incentivos…</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FiAward className="text-red-600" />
          Incentivos
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Racha de consistencia, meta de equipo, ranking y metas individuales — cada uno se activa o desactiva por separado, y la asesora solo ve lo que esté activo.
        </p>
      </header>

      {msg && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm font-medium ${
            msg.tipo === "ok"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {msg.txt}
        </div>
      )}

      {/* ── 1. Racha semanal de consistencia (lo más importante) ── */}
      <section className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-gray-800">1 · Racha semanal de consistencia</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={config.rachaSemanal.activo}
              onChange={(e) =>
                setConfig({
                  ...config,
                  rachaSemanal: { ...config.rachaSemanal, activo: e.target.checked },
                })
              }
              className="rounded"
            />
            Activa
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          La asesora ve un cuadro por día: <span className="text-green-600 font-medium">verde</span> si
          ese día alcanzó el mínimo, <span className="text-red-600 font-medium">rojo</span> si no. Si
          cumple todos los días de la semana gana el premio.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Se mide por…</label>
            <select
              value={config.rachaSemanal.criterio}
              onChange={(e) =>
                setConfig({
                  ...config,
                  rachaSemanal: { ...config.rachaSemanal, criterio: e.target.value as Criterio },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {CRITERIOS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {config.rachaSemanal.criterio === "pedidos"
                ? "Mínimo de pedidos por día"
                : "Mínimo por día (S/)"}
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step={config.rachaSemanal.criterio === "pedidos" ? "1" : "0.01"}
              value={config.rachaSemanal.minimoDiario || ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  rachaSemanal: {
                    ...config.rachaSemanal,
                    minimoDiario: parseFloat(e.target.value) || 0,
                  },
                })
              }
              placeholder={config.rachaSemanal.criterio === "pedidos" ? "Ej. 3" : "Ej. 300.00"}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Cuenta de lunes hasta…
            </label>
            <select
              value={config.rachaSemanal.diaFin}
              onChange={(e) =>
                setConfig({
                  ...config,
                  rachaSemanal: {
                    ...config.rachaSemanal,
                    diaFin: parseInt(e.target.value) || 6,
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {DIAS_FIN.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Premio por semana perfecta (texto libre)
            </label>
            <input
              type="text"
              value={config.rachaSemanal.premio}
              onChange={(e) =>
                setConfig({
                  ...config,
                  rachaSemanal: { ...config.rachaSemanal, premio: e.target.value },
                })
              }
              placeholder="Ej. S/100, medio día libre, un detalle…"
              maxLength={120}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>
      </section>

      {/* ── 2. Meta de equipo semanal ── */}
      <section className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">2 · Meta de equipo (semanal)</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={config.metaEquipoSemanal.activo}
              onChange={(e) =>
                setConfig({
                  ...config,
                  metaEquipoSemanal: { ...config.metaEquipoSemanal, activo: e.target.checked },
                })
              }
              className="rounded"
            />
            Activa
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Se mide por…</label>
            <select
              value={config.metaEquipoSemanal.criterio}
              onChange={(e) =>
                setConfig({
                  ...config,
                  metaEquipoSemanal: {
                    ...config.metaEquipoSemanal,
                    criterio: e.target.value as Criterio,
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {CRITERIOS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {config.metaEquipoSemanal.criterio === "pedidos"
                ? "N° de pedidos en la semana"
                : "Monto a vender en la semana (S/)"}
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step={config.metaEquipoSemanal.criterio === "pedidos" ? "1" : "0.01"}
              value={config.metaEquipoSemanal.monto || ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  metaEquipoSemanal: {
                    ...config.metaEquipoSemanal,
                    monto: parseFloat(e.target.value) || 0,
                  },
                })
              }
              placeholder={config.metaEquipoSemanal.criterio === "pedidos" ? "Ej. 120" : "0.00"}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Premio (texto libre)
            </label>
            <input
              type="text"
              value={config.metaEquipoSemanal.premio}
              onChange={(e) =>
                setConfig({
                  ...config,
                  metaEquipoSemanal: { ...config.metaEquipoSemanal, premio: e.target.value },
                })
              }
              placeholder="Ej. Una cena para el equipo"
              maxLength={120}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>
      </section>

      {/* ── 3. Ranking mensual ── */}
      <section className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">3 · Ranking del mes</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={config.rankingMensual.activo}
              onChange={(e) =>
                setConfig({
                  ...config,
                  rankingMensual: { ...config.rankingMensual, activo: e.target.checked },
                })
              }
              className="rounded"
            />
            Activo
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Se ordena por…
          </label>
          <select
            value={config.rankingMensual.criterio}
            onChange={(e) =>
              setConfig({
                ...config,
                rankingMensual: {
                  ...config.rankingMensual,
                  criterio: e.target.value as Criterio,
                },
              })
            }
            className="w-full sm:w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {CRITERIOS.map((c) => (
              <option key={c.v} value={c.v}>
                {c.l}
              </option>
            ))}
          </select>
        </div>

        <label className="block text-xs font-medium text-gray-500 mb-2">
          Premios por puesto
        </label>
        <div className="space-y-2">
          {config.rankingMensual.premios.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500">Puesto</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={p.puesto}
                  onChange={(e) => {
                    const premios = [...config.rankingMensual.premios];
                    premios[i] = { ...premios[i], puesto: parseInt(e.target.value) || 1 };
                    setConfig({ ...config, rankingMensual: { ...config.rankingMensual, premios } });
                  }}
                  className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <input
                type="text"
                value={p.premio}
                onChange={(e) => {
                  const premios = [...config.rankingMensual.premios];
                  premios[i] = { ...premios[i], premio: e.target.value };
                  setConfig({ ...config, rankingMensual: { ...config.rankingMensual, premios } });
                }}
                placeholder="Premio (ej. S/200, 1 día libre, un almuerzo…)"
                maxLength={120}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={() => {
                  const premios = config.rankingMensual.premios.filter((_, idx) => idx !== i);
                  setConfig({ ...config, rankingMensual: { ...config.rankingMensual, premios } });
                }}
                title="Quitar"
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
              >
                <FiTrash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            const premios = [...config.rankingMensual.premios];
            const nextPuesto = premios.length > 0 ? Math.max(...premios.map((p) => p.puesto)) + 1 : 1;
            premios.push({ puesto: nextPuesto, premio: "" });
            setConfig({ ...config, rankingMensual: { ...config.rankingMensual, premios } });
          }}
          className="mt-3 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1 text-gray-700"
        >
          <FiPlus className="h-4 w-4" /> Agregar puesto
        </button>
      </section>

      {/* ── 4. Meta mensual de cada asesora (con interruptor) ── */}
      <section className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-gray-800">4 · Meta mensual de cada asesora</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={config.metasIndividuales.activo}
              onChange={(e) =>
                setConfig({
                  ...config,
                  metasIndividuales: { activo: e.target.checked },
                })
              }
              className="rounded"
            />
            Activa
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Si está <strong>activa</strong>, la asesora ve sus tarjetas de progreso (Hoy / Esta semana /
          Este mes) en su panel. La meta se calcula sola (mes anterior +15%); ajustá un monto abajo solo
          si querés fijarle una meta distinta a alguien. Mes: <strong>{mesActualISO()}</strong>.
        </p>
        {asesoras.length === 0 && (
          <p className="text-sm text-gray-400">No hay asesoras registradas.</p>
        )}
        <div className="space-y-2">
          {asesoras.map((a) => (
            <div key={a.id} className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[120px]">
                <div className="font-medium text-gray-800">{a.nombre}</div>
                <div className="text-[11px] text-gray-400">
                  Vendido este mes: S/ {a.ventasMesActual.toFixed(2)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500">S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={metaInputs[a.id] ?? ""}
                  onChange={(e) => setMetaInputs({ ...metaInputs, [a.id]: e.target.value })}
                  placeholder="Meta del mes"
                  className="w-32 px-2.5 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <button
                onClick={() => guardarMeta(a.id)}
                disabled={savingMetaId === a.id}
                className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
              >
                {savingMetaId === a.id ? (
                  <FiRefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <FiSave className="h-4 w-4" />
                )}
                Guardar
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Guardar config (racha + equipo + ranking + metas individuales) */}
      <button
        onClick={guardarConfig}
        disabled={savingConfig}
        className="w-full px-4 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {savingConfig ? <FiRefreshCw className="h-5 w-5 animate-spin" /> : <FiSave className="h-5 w-5" />}
        Guardar configuración de incentivos
      </button>
    </div>
  );
}

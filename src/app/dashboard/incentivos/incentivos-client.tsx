// src/app/dashboard/incentivos/incentivos-client.tsx
// Pantalla admin: configura el sistema de incentivos.
//   • Racha semanal de consistencia
//   • Meta de equipo semanal
//   • Ranking mensual (premios por puesto)
//   • Metas individuales por asesora (override mensual)
// Cada bono se prende/apaga por separado; la asesora solo ve los que estén
// activos. La configuración de los bonos se guarda con el botón principal;
// las metas por asesora se guardan por fila (endpoint aparte).
"use client";

import { useEffect, useState } from "react";
import {
  FiAward,
  FiSave,
  FiPlus,
  FiTrash2,
  FiRefreshCw,
  FiZap,
  FiUsers,
  FiTarget,
} from "react-icons/fi";

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
  metasIndividuales: { activo: boolean; factorCrecimientoPct: number };
}
interface AsesoraRow {
  id: string;
  nombre: string;
  metaMensual: number; // meta efectiva (override o automática)
  metaDiaria: number;
  ventasMesActual: number;
  metaOverride: number | null; // null = meta automática; número = meta fija
  bono: string; // bono al cumplir la meta del mes ("" = sin bono)
}

const DEFAULT_CONFIG: Config = {
  metaEquipoSemanal: { activo: false, criterio: "monto", monto: 0, premio: "" },
  rankingMensual: { activo: false, criterio: "monto", premios: [] },
  rachaSemanal: { activo: false, diaFin: 6, criterio: "monto", minimoDiario: 0, premio: "" },
  metasIndividuales: { activo: true, factorCrecimientoPct: 15 },
};

const CRITERIOS: { v: Criterio; l: string }[] = [
  { v: "monto", l: "Monto vendido (S/)" },
  { v: "pedidos", l: "N° de pedidos vendidos" },
];

const DIAS_FIN: { v: number; l: string }[] = [
  { v: 5, l: "Lunes a Viernes (5 días)" },
  { v: 6, l: "Lunes a Sábado (6 días)" },
];

const INPUT_CLS =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-200";

function mesActualISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Interruptor on/off (claro y visible — es la acción central) ──
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors active:scale-95 ${
        checked ? "bg-red-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// ── Tarjeta de un bono: header con interruptor; campos colapsan si está apagado ──
function BonoCard({
  icon,
  titulo,
  resumen,
  activo,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  resumen: string;
  activo: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border shadow-sm transition-colors ${
        activo ? "bg-white border-gray-200" : "bg-gray-50 border-gray-200"
      }`}
    >
      <header className="flex items-start justify-between gap-3 p-5">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
              activo ? "bg-red-50 text-red-600" : "bg-gray-200 text-gray-400"
            }`}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className={`font-bold ${activo ? "text-gray-800" : "text-gray-500"}`}>{titulo}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{resumen}</p>
          </div>
        </div>
        <Toggle checked={activo} onChange={onToggle} />
      </header>
      {activo ? (
        <div className="px-5 pb-5 anim-fade">{children}</div>
      ) : (
        <div className="px-5 pb-4 -mt-2">
          <span className="text-xs text-gray-400">Apagado · la asesora no lo ve en su panel.</span>
        </div>
      )}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── Chip de estado para el panorama de arriba ──
function EstadoChip({ activo, icon, label }: { activo: boolean; icon: React.ReactNode; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        activo
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-gray-50 text-gray-400 border-gray-200"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

export default function IncentivosClient() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [asesoras, setAsesoras] = useState<AsesoraRow[]>([]);
  const [metaInputs, setMetaInputs] = useState<Record<string, string>>({});
  const [bonoInputs, setBonoInputs] = useState<Record<string, string>>({});
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
        // El input de meta refleja el OVERRIDE (vacío = automática), no la meta efectiva.
        setMetaInputs(
          Object.fromEntries(
            lista.map((a) => [a.id, a.metaOverride != null ? String(a.metaOverride) : ""])
          )
        );
        setBonoInputs(Object.fromEntries(lista.map((a) => [a.id, a.bono ?? ""])));
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
    // Meta opcional: vacío = automática. Si hay valor, debe ser > 0.
    const raw = (metaInputs[id] || "").trim();
    let montoMeta: number | null = null;
    if (raw !== "") {
      const n = parseFloat(raw);
      if (!(n > 0)) {
        setMsg({
          tipo: "error",
          txt: "La meta debe ser mayor a 0 (o déjala vacía para automática).",
        });
        return;
      }
      montoMeta = n;
    }
    const bono = (bonoInputs[id] || "").trim();
    setSavingMetaId(id);
    try {
      const res = await fetch("/api/metas/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asesor_id: id,
          mes: mesActualISO(),
          monto_meta: montoMeta,
          bono: bono || null,
        }),
      });
      if (!res.ok) throw new Error();
      setMsg({ tipo: "ok", txt: "Guardado." });
      await cargar(); // refresca meta efectiva, override y bono desde el servidor
    } catch {
      setMsg({ tipo: "error", txt: "No se pudo guardar." });
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

  const totalActivos =
    [
      config.rachaSemanal.activo,
      config.metaEquipoSemanal.activo,
      config.rankingMensual.activo,
      config.metasIndividuales.activo,
    ].filter(Boolean).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FiAward className="text-red-600" />
          Incentivos
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Prende o apaga cada bono. La asesora solo ve en su panel los que estén activos.
        </p>
      </header>

      {/* ── Panorama: qué está activo de un vistazo ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700">
            {totalActivos} de 4 bonos activos
          </span>
          <span className="text-xs text-gray-400">Lo apagado no le aparece a la asesora</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <EstadoChip activo={config.rachaSemanal.activo} icon={<FiZap size={12} />} label="Racha" />
          <EstadoChip
            activo={config.metaEquipoSemanal.activo}
            icon={<FiUsers size={12} />}
            label="Meta de equipo"
          />
          <EstadoChip
            activo={config.rankingMensual.activo}
            icon={<FiAward size={12} />}
            label="Ranking del mes"
          />
          <EstadoChip
            activo={config.metasIndividuales.activo}
            icon={<FiTarget size={12} />}
            label="Metas individuales"
          />
        </div>
      </div>

      <div className="space-y-5">
        {/* ── Racha semanal de consistencia ── */}
        <BonoCard
          icon={<FiZap size={16} />}
          titulo="Racha semanal de consistencia"
          resumen="Premia a la asesora que vende todos los días de la semana."
          activo={config.rachaSemanal.activo}
          onToggle={(v) =>
            setConfig({ ...config, rachaSemanal: { ...config.rachaSemanal, activo: v } })
          }
        >
          <p className="text-xs text-gray-500 mb-4">
            La asesora ve un cuadro por día: <span className="text-green-600 font-medium">verde</span>{" "}
            si alcanzó el mínimo, <span className="text-red-600 font-medium">rojo</span> si no. Semana
            completa = gana el premio.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Se mide por…">
              <select
                value={config.rachaSemanal.criterio}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    rachaSemanal: { ...config.rachaSemanal, criterio: e.target.value as Criterio },
                  })
                }
                className={INPUT_CLS}
              >
                {CRITERIOS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.l}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              label={
                config.rachaSemanal.criterio === "pedidos"
                  ? "Mínimo de pedidos por día"
                  : "Mínimo por día (S/)"
              }
            >
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
                className={INPUT_CLS}
              />
            </Campo>
            <Campo label="Cuenta de lunes hasta…">
              <select
                value={config.rachaSemanal.diaFin}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    rachaSemanal: { ...config.rachaSemanal, diaFin: parseInt(e.target.value) || 6 },
                  })
                }
                className={INPUT_CLS}
              >
                {DIAS_FIN.map((d) => (
                  <option key={d.v} value={d.v}>
                    {d.l}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Premio por semana perfecta">
              <input
                type="text"
                value={config.rachaSemanal.premio}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    rachaSemanal: { ...config.rachaSemanal, premio: e.target.value },
                  })
                }
                placeholder="Ej. S/100, medio día libre…"
                maxLength={120}
                className={INPUT_CLS}
              />
            </Campo>
          </div>
        </BonoCard>

        {/* ── Meta de equipo semanal ── */}
        <BonoCard
          icon={<FiUsers size={16} />}
          titulo="Meta de equipo (semanal)"
          resumen="Todas suman hacia un objetivo común; si lo logran, ganan juntas."
          activo={config.metaEquipoSemanal.activo}
          onToggle={(v) =>
            setConfig({
              ...config,
              metaEquipoSemanal: { ...config.metaEquipoSemanal, activo: v },
            })
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Se mide por…">
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
                className={INPUT_CLS}
              >
                {CRITERIOS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.l}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              label={
                config.metaEquipoSemanal.criterio === "pedidos"
                  ? "N° de pedidos en la semana"
                  : "Monto a vender en la semana (S/)"
              }
            >
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
                className={INPUT_CLS}
              />
            </Campo>
            <div className="sm:col-span-2">
              <Campo label="Premio">
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
                  className={INPUT_CLS}
                />
              </Campo>
            </div>
          </div>
        </BonoCard>

        {/* ── Ranking mensual ── */}
        <BonoCard
          icon={<FiAward size={16} />}
          titulo="Ranking del mes"
          resumen="Las mejores del mes ganan un premio según su puesto."
          activo={config.rankingMensual.activo}
          onToggle={(v) =>
            setConfig({ ...config, rankingMensual: { ...config.rankingMensual, activo: v } })
          }
        >
          <div className="mb-4 sm:max-w-xs">
            <Campo label="Se ordena por…">
              <select
                value={config.rankingMensual.criterio}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    rankingMensual: { ...config.rankingMensual, criterio: e.target.value as Criterio },
                  })
                }
                className={INPUT_CLS}
              >
                {CRITERIOS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.l}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <label className="block text-xs font-medium text-gray-500 mb-2">Premios por puesto</label>
          <div className="space-y-2">
            {config.rankingMensual.premios.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-shrink-0">
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
                    className="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-200"
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
                  placeholder="Premio (ej. S/200, 1 día libre…)"
                  maxLength={120}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-200"
                />
                <button
                  onClick={() => {
                    const premios = config.rankingMensual.premios.filter((_, idx) => idx !== i);
                    setConfig({ ...config, rankingMensual: { ...config.rankingMensual, premios } });
                  }}
                  title="Quitar puesto"
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors active:scale-95"
                >
                  <FiTrash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {config.rankingMensual.premios.length === 0 && (
              <p className="text-xs text-gray-400">Todavía no agregaste premios. Suma al menos el puesto 1.</p>
            )}
          </div>
          <button
            onClick={() => {
              const premios = [...config.rankingMensual.premios];
              const nextPuesto =
                premios.length > 0 ? Math.max(...premios.map((p) => p.puesto)) + 1 : 1;
              premios.push({ puesto: nextPuesto, premio: "" });
              setConfig({ ...config, rankingMensual: { ...config.rankingMensual, premios } });
            }}
            className="mt-3 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1 text-gray-700 transition-colors active:scale-[0.97]"
          >
            <FiPlus className="h-4 w-4" /> Agregar puesto
          </button>
        </BonoCard>

        {/* ── Metas individuales por asesora ── */}
        <BonoCard
          icon={<FiTarget size={16} />}
          titulo="Metas individuales"
          resumen="Cada asesora ve su progreso del día, la semana y el mes."
          activo={config.metasIndividuales.activo}
          onToggle={(v) =>
            setConfig({
              ...config,
              metasIndividuales: { ...config.metasIndividuales, activo: v },
            })
          }
        >
          {/* % de crecimiento de la meta automática (configurable). Se guarda con el
              botón grande "Guardar configuración de bonos" de abajo, junto al resto. */}
          <div className="mb-4 rounded-xl bg-gray-50 px-3 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-600">
              Meta automática = ventas del mes anterior
            </span>
            <span className="text-sm text-gray-400">+</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                step="1"
                value={config.metasIndividuales.factorCrecimientoPct}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setConfig({
                    ...config,
                    metasIndividuales: {
                      ...config.metasIndividuales,
                      factorCrecimientoPct: isNaN(n) || n < 0 ? 0 : n,
                    },
                  });
                }}
                className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-800 tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-red-200"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <span className="text-[11px] text-gray-400">
              (puedes poner 10, 15 o el número que quieras)
            </span>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Abajo puedes fijarle a alguien una meta distinta y, si quieres, un{" "}
            <strong>bono</strong> que gana al cumplir su meta del mes. Ambos son opcionales.
          </p>
          {asesoras.length === 0 ? (
            <p className="text-sm text-gray-400">No hay asesoras registradas.</p>
          ) : (
            <div className="space-y-2">
              {asesoras.map((a) => {
                const origMeta = a.metaOverride != null ? String(a.metaOverride) : "";
                const origBono = a.bono ?? "";
                const valMeta = metaInputs[a.id] ?? "";
                const valBono = bonoInputs[a.id] ?? "";
                const dirty = valMeta.trim() !== origMeta || valBono !== origBono;
                const saving = savingMetaId === a.id;
                return (
                  <div key={a.id} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-800 text-sm truncate">
                          {a.nombre.trim()}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {a.metaOverride != null ? (
                            <>
                              Meta fija:{" "}
                              <span className="tabular-nums">S/ {a.metaOverride.toFixed(2)}</span>
                            </>
                          ) : (
                            <>
                              Meta automática:{" "}
                              <span className="tabular-nums">S/ {a.metaMensual.toFixed(2)}</span>
                            </>
                          )}
                          {a.bono ? (
                            <span className="text-amber-600"> · Bono: {a.bono}</span>
                          ) : null}
                        </div>
                      </div>
                      {dirty ? (
                        <button
                          onClick={() => guardarMeta(a.id)}
                          disabled={saving}
                          className="px-2.5 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 flex items-center gap-1 transition-colors active:scale-95 flex-shrink-0"
                        >
                          {saving ? (
                            <FiRefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FiSave className="h-3.5 w-3.5" />
                          )}
                          Guardar
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">
                        Meta
                        <span className="text-gray-400">S/</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={valMeta}
                          onChange={(e) =>
                            setMetaInputs({ ...metaInputs, [a.id]: e.target.value })
                          }
                          placeholder="automática"
                          className="w-28 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-red-200"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 flex-1 min-w-[180px]">
                        Bono al cumplir
                        <input
                          type="text"
                          maxLength={200}
                          value={valBono}
                          onChange={(e) =>
                            setBonoInputs({ ...bonoInputs, [a.id]: e.target.value })
                          }
                          placeholder="opcional — ej. S/ 100 o un día libre"
                          className="flex-1 min-w-[120px] px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-200"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2">
            La meta y el bono de cada asesora se guardan al instante con su botón{" "}
            <strong>Guardar</strong>. El % de arriba se guarda con el botón grande de abajo.
          </p>
        </BonoCard>
      </div>

      {/* ── Acción primaria: guarda los 4 bonos (no las metas, que ya se guardan arriba) ── */}
      <div className="mt-6">
        <button
          onClick={guardarConfig}
          disabled={savingConfig}
          className="w-full px-4 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.99]"
        >
          {savingConfig ? (
            <FiRefreshCw className="h-5 w-5 animate-spin" />
          ) : (
            <FiSave className="h-5 w-5" />
          )}
          Guardar configuración de bonos
        </button>
      </div>

      {/* ── Toast ── */}
      {msg && (
        <div
          className={`fixed bottom-6 right-6 z-50 anim-toast text-sm font-medium px-4 py-3 rounded-xl shadow-lg max-w-xs ${
            msg.tipo === "ok" ? "bg-gray-900 text-white" : "bg-red-600 text-white"
          }`}
        >
          {msg.txt}
        </div>
      )}
    </div>
  );
}

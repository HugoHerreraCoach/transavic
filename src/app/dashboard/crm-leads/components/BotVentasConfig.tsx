"use client";

// src/app/dashboard/crm-leads/components/BotVentasConfig.tsx
// Configura el bot de ventas REAL (Antonella): cuándo habla y en qué horario
// atienden las asesoras. Guarda en `settings.bot_ventas`, que es la clave que
// lee el orquestador.
//
// Reemplaza a WelcomeBotConfig, que guardaba en `crm_welcome_bot` — una clave
// que NINGÚN proceso leía. Mostraba "Horario Comercial" y "Mensaje Fuera de
// Horario" y no hacía nada: por eso parecía que había un segundo bot.
//
// Acá SOLO se exponen los campos que un no-técnico debe poder tocar. El resto de
// `bot_ventas` (distritos, mínimos, beneficios, temperatura, instrucciones extra)
// se sigue editando por API, a propósito: un cambio ahí altera lo que el bot le
// dice a un cliente real.

import { useEffect, useState } from "react";
import { FiClock, FiLoader, FiSave, FiX } from "react-icons/fi";

const DIAS = [
  { valor: 1, corto: "Lun" },
  { valor: 2, corto: "Mar" },
  { valor: 3, corto: "Mié" },
  { valor: 4, corto: "Jue" },
  { valor: 5, corto: "Vie" },
  { valor: 6, corto: "Sáb" },
  { valor: 7, corto: "Dom" },
];

type CuandoResponde = "fuera_horario" | "siempre";

interface Editable {
  activo: boolean;
  cuando_responde: CuandoResponde;
  atencion_hora_inicio: number;
  atencion_hora_fin: number;
  dias_atencion: number[];
}

const DEFAULTS: Editable = {
  activo: true,
  cuando_responde: "fuera_horario",
  atencion_hora_inicio: 8,
  atencion_hora_fin: 20,
  dias_atencion: [1, 2, 3, 4, 5, 6],
};

/** "lunes a sábado" a partir de los días numéricos. Espejo de textoDias del server. */
function textoDias(dias: number[]): string {
  const nombres = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const orden = [...new Set(dias)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (orden.length === 0) return "ningún día";
  if (orden.length === 1) return nombres[orden[0] - 1];
  const consecutivos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1);
  if (consecutivos) return `${nombres[orden[0] - 1]} a ${nombres[orden[orden.length - 1] - 1]}`;
  return orden.map((d) => nombres[d - 1]).join(", ");
}

export default function BotVentasConfig({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<Editable>(DEFAULTS);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  /** Lo que había en la base: se conserva para no pisar los campos que no se editan. */
  const [crudo, setCrudo] = useState<Record<string, unknown>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          const bv = (data?.bot_ventas ?? {}) as Record<string, unknown>;
          setCrudo(bv);
          setCfg({
            activo: typeof bv.activo === "boolean" ? bv.activo : DEFAULTS.activo,
            cuando_responde:
              bv.cuando_responde === "siempre" ? "siempre" : DEFAULTS.cuando_responde,
            atencion_hora_inicio:
              typeof bv.atencion_hora_inicio === "number"
                ? bv.atencion_hora_inicio
                : DEFAULTS.atencion_hora_inicio,
            atencion_hora_fin:
              typeof bv.atencion_hora_fin === "number"
                ? bv.atencion_hora_fin
                : DEFAULTS.atencion_hora_fin,
            dias_atencion: Array.isArray(bv.dias_atencion)
              ? (bv.dias_atencion as number[])
              : DEFAULTS.dias_atencion,
          });
        }
      } catch (e) {
        console.error("Error al cargar la configuración del bot:", e);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const guardar = async () => {
    if (cfg.atencion_hora_fin <= cfg.atencion_hora_inicio) {
      alert("La hora de cierre debe ser mayor que la de apertura.");
      return;
    }
    if (cfg.dias_atencion.length === 0) {
      alert("Elige al menos un día de atención.");
      return;
    }
    setGuardando(true);
    try {
      // Merge sobre lo que ya había: POST /api/settings reescribe la clave
      // COMPLETA, así que mandar solo estos campos borraría distritos, mínimos y
      // el resto de la configuración del bot.
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "bot_ventas", value: { ...crudo, ...cfg } }),
      });
      if (!res.ok) throw new Error(`Estado ${res.status}`);
      alert("Configuración del bot guardada.");
      onClose();
    } catch (e) {
      console.error("Error al guardar la configuración del bot:", e);
      alert("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  const alternarDia = (d: number) =>
    setCfg((p) => ({
      ...p,
      dias_atencion: p.dias_atencion.includes(d)
        ? p.dias_atencion.filter((x) => x !== d)
        : [...p.dias_atencion, d].sort((a, b) => a - b),
    }));

  const resumen =
    cfg.cuando_responde === "fuera_horario"
      ? `Las asesoras atienden ${textoDias(cfg.dias_atencion)} de ${cfg.atencion_hora_inicio}:00 a ${cfg.atencion_hora_fin}:00. Fuera de ese horario responde el bot.`
      : `El bot responde a toda hora. Las asesoras atienden ${textoDias(cfg.dias_atencion)} de ${cfg.atencion_hora_inicio}:00 a ${cfg.atencion_hora_fin}:00.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white px-5 pb-3 pt-5">
          <div>
            <h2 className="text-xl font-black text-gray-900">Bot de ventas</h2>
            <p className="text-sm text-gray-500">Antonella, la que responde por WhatsApp</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-gray-500 hover:text-gray-800">
            <FiX size={24} />
          </button>
        </div>

        {cargando ? (
          <div className="py-16 text-center">
            <FiLoader className="mx-auto animate-spin text-violet-600" size={32} />
          </div>
        ) : (
          <div className="space-y-5 px-5 pb-6 pt-4">
            {/* Interruptor general */}
            <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3">
              <input
                type="checkbox"
                checked={cfg.activo}
                onChange={(e) => setCfg((p) => ({ ...p, activo: e.target.checked }))}
                className="mt-1 h-5 w-5 accent-violet-600"
              />
              <span>
                <span className="block font-bold text-gray-900">Bot encendido</span>
                <span className="block text-xs text-gray-500">
                  Si lo apagas, el bot no responde nunca y todos los mensajes esperan a una asesora.
                </span>
              </span>
            </label>

            {/* Cuándo responde */}
            <div>
              <p className="mb-2 text-sm font-bold text-gray-700">¿Cuándo responde el bot?</p>
              <div className="space-y-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    cfg.cuando_responde === "fuera_horario"
                      ? "border-violet-400 bg-violet-50"
                      : "border-gray-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="cuando"
                    checked={cfg.cuando_responde === "fuera_horario"}
                    onChange={() => setCfg((p) => ({ ...p, cuando_responde: "fuera_horario" }))}
                    disabled={!cfg.activo}
                    className="mt-1 h-4 w-4 accent-violet-600"
                  />
                  <span>
                    <span className="block font-bold text-gray-900">
                      Solo cuando no hay asesoras
                    </span>
                    <span className="block text-xs text-gray-500">
                      En el horario de abajo responden ellas. Fuera de ese horario —noches y días de
                      descanso— atiende el bot y avisa que le confirman al abrir.
                    </span>
                  </span>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    cfg.cuando_responde === "siempre"
                      ? "border-violet-400 bg-violet-50"
                      : "border-gray-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="cuando"
                    checked={cfg.cuando_responde === "siempre"}
                    onChange={() => setCfg((p) => ({ ...p, cuando_responde: "siempre" }))}
                    disabled={!cfg.activo}
                    className="mt-1 h-4 w-4 accent-violet-600"
                  />
                  <span>
                    <span className="block font-bold text-gray-900">A toda hora</span>
                    <span className="block text-xs text-gray-500">
                      El bot contesta siempre; la asesora lo pausa al entrar al chat.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Horario */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700">
                <FiClock size={14} /> Horario en que atienden las asesoras
              </p>
              <div className="flex items-center gap-2">
                <label className="flex-1">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Desde
                  </span>
                  <select
                    value={cfg.atencion_hora_inicio}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, atencion_hora_inicio: Number(e.target.value) }))
                    }
                    className="min-h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex-1">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Hasta
                  </span>
                  <select
                    value={cfg.atencion_hora_fin}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, atencion_hora_fin: Number(e.target.value) }))
                    }
                    className="min-h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Días
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map((d) => {
                  const activo = cfg.dias_atencion.includes(d.valor);
                  return (
                    <button
                      key={d.valor}
                      type="button"
                      onClick={() => alternarDia(d.valor)}
                      className={`min-h-10 rounded-lg border px-3 text-xs font-semibold transition ${
                        activo
                          ? "border-violet-400 bg-violet-50 text-violet-700"
                          : "border-gray-300 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {d.corto}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Resumen en palabras: que se entienda sin interpretar los controles */}
            <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
              {cfg.activo ? resumen : "El bot está apagado: nunca responde."}
            </p>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="min-h-12 flex-1 rounded-lg border-2 border-gray-300 font-bold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 font-bold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {guardando ? <FiLoader className="animate-spin" size={18} /> : <FiSave size={18} />}
                Guardar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// src/app/dashboard/reportes/ui.tsx
// Componentes compartidos por las pestañas de Reportes (Ventas + Día a día).
// Mismo lenguaje visual que comprobantes/catálogo/cobranzas: tarjetas blancas,
// un solo acento rojo, sin gradientes. Krug: que cada cosa diga qué es.
"use client";

import { toLocalDateString } from "@/lib/utils";

// ── Formato de dinero peruano ──
export function formatSoles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Presets de período ─────────────────────────────────────
export type Preset = "hoy" | "semana" | "mes" | "mes_pasado" | "rango";

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "mes_pasado", label: "Mes pasado" },
  { id: "rango", label: "Personalizado" },
];

/** Calcula {desde, hasta} (YYYY-MM-DD, zona local) para cada preset. */
export function presetRango(preset: Exclude<Preset, "rango">): {
  desde: string;
  hasta: string;
} {
  const hoy = new Date();
  const fmt = toLocalDateString;
  if (preset === "hoy") return { desde: fmt(hoy), hasta: fmt(hoy) };
  if (preset === "semana") {
    const d = new Date(hoy);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // lunes como inicio
    d.setDate(d.getDate() - diff);
    return { desde: fmt(d), hasta: fmt(hoy) };
  }
  if (preset === "mes") {
    return { desde: fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fmt(hoy) };
  }
  // mes_pasado
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0); // último día del mes anterior
  return { desde: fmt(ini), hasta: fmt(fin) };
}

/** Etiqueta legible del rango: "1 may – 29 may 2026" o un solo día. */
export function etiquetaRango(desde: string, hasta: string): string {
  const fmt = (iso: string, conAnio = false) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-PE", {
      day: "numeric",
      month: "short",
      ...(conAnio ? { year: "numeric" } : {}),
    });
  };
  if (desde === hasta) return fmt(desde, true);
  return `${fmt(desde)} – ${fmt(hasta, true)}`;
}

// ── Selector de período (presets + rango personalizado) ─────
export function SelectorPeriodo({
  preset,
  desde,
  hasta,
  onPreset,
  onDesde,
  onHasta,
}: {
  preset: Preset;
  desde: string;
  hasta: string;
  onPreset: (p: Preset) => void;
  onDesde: (v: string) => void;
  onHasta: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPreset(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors active:scale-[0.97] ${
              preset === p.id
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "rango" && (
        <div className="flex items-center gap-2 flex-wrap anim-fade">
          <input
            type="date"
            value={desde}
            max={hasta}
            onChange={(e) => onDesde(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none"
          />
          <span className="text-sm text-gray-400">a</span>
          <input
            type="date"
            value={hasta}
            min={desde}
            onChange={(e) => onHasta(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none"
          />
        </div>
      )}
    </div>
  );
}

// ── Tarjeta KPI (mismo patrón que comprobantes) ─────────────
export function KpiCard({
  color,
  icon,
  label,
  value,
  hint,
  onClick,
}: {
  color: "gray" | "green" | "red" | "blue" | "amber";
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  onClick?: () => void;
}) {
  const iconBg: Record<string, string> = {
    gray: "bg-gray-100 text-gray-600",
    green: "bg-green-100 text-green-600",
    red: "bg-red-100 text-red-600",
    blue: "bg-blue-100 text-blue-600",
    amber: "bg-amber-100 text-amber-600",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`text-left border border-gray-200 rounded-xl px-3 py-2.5 shadow-sm bg-white ${
        onClick ? "hover:shadow-md transition-shadow cursor-pointer active:scale-[0.98]" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${iconBg[color]}`}>
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-800 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{hint}</div>}
    </Tag>
  );
}

// ── Métrica protagonista (el dinero manda) ──────────────────
export function HeroMetric({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="border border-red-200 bg-red-50 rounded-2xl p-5 shadow-sm flex flex-col justify-center">
      <div className="flex items-center gap-2 text-red-600 mb-1">
        <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center">
          {icon}
        </span>
        <span className="text-[11px] uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <div className="text-4xl font-bold text-red-700 tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-sm text-red-600/80 mt-1">{sub}</div>}
    </div>
  );
}

// ── Gráfico de barras por día (un color sólido, sin degradé) ─
export function GraficoBarrasDia({
  data,
}: {
  data: { fecha_corta: string; monto: number; pedidos: number }[];
}) {
  const hayMontos = data.some((d) => d.monto > 0);
  if (data.length === 0 || !hayMontos) {
    return (
      <p className="text-gray-400 text-center py-12 text-sm">
        {data.length === 0
          ? "Sin pedidos entregados en este período."
          : "No hay montos facturados para graficar. Cargá los precios en el catálogo."}
      </p>
    );
  }
  const max = Math.max(...data.map((d) => d.monto), 1);
  const pocas = data.length <= 14;
  // cada N etiquetas en el eje cuando hay muchos días
  const step = Math.ceil(data.length / 15);

  return (
    <div className="overflow-x-auto">
      <div
        className="flex items-end gap-1.5 h-52"
        style={{ minWidth: data.length > 20 ? data.length * 22 : undefined }}
      >
        {data.map((d, i) => {
          const pct = (d.monto / max) * 100;
          return (
            <div
              key={i}
              className="flex-1 min-w-[10px] flex flex-col items-center justify-end h-full group"
              title={`${d.fecha_corta}: ${formatSoles(d.monto)} · ${d.pedidos} pedido${
                d.pedidos !== 1 ? "s" : ""
              }`}
            >
              {pocas && d.monto > 0 && (
                <span className="text-[9px] font-semibold text-gray-500 mb-1 tabular-nums whitespace-nowrap">
                  {Math.round(d.monto)}
                </span>
              )}
              <div className="w-full flex items-end justify-center h-full">
                <div
                  className="w-full max-w-[28px] bg-red-500 group-hover:bg-red-600 rounded-t-md transition-all"
                  style={{ height: `${Math.max(pct, d.monto > 0 ? 3 : 0)}%` }}
                />
              </div>
              {i % step === 0 && (
                <span className="text-[9px] text-gray-400 mt-1.5 whitespace-nowrap">
                  {d.fecha_corta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

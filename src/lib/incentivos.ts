// src/lib/incentivos.ts
// Sistema de incentivos: configuración (en tabla settings, JSONB) + cálculos de
// meta de equipo semanal y ranking mensual. Desde jul 2026 las cifras de venta
// salen de PEDIDOS (monto de pedido_items por fecha de registro, sin POS) — la
// regla y sus variantes viven en lib/ventas-metricas.ts (única fuente, la misma
// que usa lib/metas.ts para que todas las pantallas midan igual).
import { neon } from "@neondatabase/serverless";
import { ventasMesActual } from "@/lib/metas";
import { contarPedidosAsesora, ventasEquipo } from "@/lib/ventas-metricas";

// Cómo se mide un incentivo: por monto vendido (S/) o por N° de pedidos.
export type Criterio = "monto" | "pedidos";
export type CriterioRanking = Criterio; // alias por compatibilidad

export interface IncentivosConfig {
  // Meta de equipo semanal: `monto` es el objetivo (S/ si criterio=monto, o N° de
  // pedidos si criterio=pedidos).
  metaEquipoSemanal: { activo: boolean; criterio: Criterio; monto: number; premio: string };
  rankingMensual: {
    activo: boolean;
    criterio: Criterio;
    premios: Array<{ puesto: number; premio: string }>;
  };
  // Racha semanal de consistencia: un día "cuenta" si el valor del día (S/ vendido
  // o N° de pedidos, según `criterio`) alcanza `minimoDiario`. De lunes a `diaFin`
  // (1=lun … 6=sáb). Cumplir toda la semana gana el `premio` (texto libre).
  rachaSemanal: {
    activo: boolean;
    diaFin: number;
    criterio: Criterio;
    minimoDiario: number;
    premio: string;
  };
  // Metas individuales (mensual por asesora). Si está activo, la asesora ve sus
  // tarjetas de progreso (Hoy/Semana/Mes) en el panel.
  // `factorCrecimientoPct`: % de crecimiento de la meta automática mensual
  // (meta = ventas_del_mes_anterior × (1 + pct/100)). Configurable por el admin
  // (10, 15, cualquier número ≥ 0). El override manual por asesora lo pisa.
  metasIndividuales: { activo: boolean; factorCrecimientoPct: number };
}

export const DEFAULT_INCENTIVOS: IncentivosConfig = {
  metaEquipoSemanal: { activo: false, criterio: "monto", monto: 0, premio: "" },
  rankingMensual: { activo: false, criterio: "monto", premios: [] },
  rachaSemanal: { activo: false, diaFin: 6, criterio: "monto", minimoDiario: 0, premio: "" },
  metasIndividuales: { activo: true, factorCrecimientoPct: 15 },
};

export async function getIncentivosConfig(): Promise<IncentivosConfig> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT value FROM settings WHERE key = 'incentivos_config'
  `) as Array<{ value: unknown }>;
  if (rows.length === 0) return DEFAULT_INCENTIVOS;
  const v = (rows[0].value ?? {}) as Partial<IncentivosConfig>;
  // Merge con default para tolerar configs viejas/incompletas.
  // Normaliza cualquier criterio no soportado (ej. "cumplimiento" viejo) a "monto".
  const norm = (c: unknown): Criterio => (c === "pedidos" ? "pedidos" : "monto");
  const metaEquipoSemanal = { ...DEFAULT_INCENTIVOS.metaEquipoSemanal, ...(v.metaEquipoSemanal ?? {}) };
  metaEquipoSemanal.criterio = norm(metaEquipoSemanal.criterio);
  const rankingMensual = { ...DEFAULT_INCENTIVOS.rankingMensual, ...(v.rankingMensual ?? {}) };
  rankingMensual.criterio = norm(rankingMensual.criterio);
  const rachaSemanal = { ...DEFAULT_INCENTIVOS.rachaSemanal, ...(v.rachaSemanal ?? {}) };
  rachaSemanal.criterio = norm(rachaSemanal.criterio);
  const metasIndividuales = {
    ...DEFAULT_INCENTIVOS.metasIndividuales,
    ...(v.metasIndividuales ?? {}),
  };
  // El % de crecimiento debe ser un número ≥ 0; si viene corrupto, default 15.
  if (
    typeof metasIndividuales.factorCrecimientoPct !== "number" ||
    !isFinite(metasIndividuales.factorCrecimientoPct) ||
    metasIndividuales.factorCrecimientoPct < 0
  ) {
    metasIndividuales.factorCrecimientoPct =
      DEFAULT_INCENTIVOS.metasIndividuales.factorCrecimientoPct;
  }
  return {
    metaEquipoSemanal,
    rankingMensual,
    rachaSemanal,
    metasIndividuales,
  };
}

export async function saveIncentivosConfig(cfg: IncentivosConfig): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  const json = JSON.stringify(cfg);
  await sql`
    INSERT INTO settings (key, value)
    VALUES ('incentivos_config', ${json}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = NOW()
  `;
}

/** Lunes de esta semana en formato YYYY-MM-DD (zona Lima aproximada por fecha local del server). */
function lunesISO(): string {
  const x = new Date();
  const dow = x.getDay();
  const diff = dow === 0 ? 6 : dow - 1;
  x.setDate(x.getDate() - diff);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate()
  ).padStart(2, "0")}`;
}

/** Hoy en formato YYYY-MM-DD (fecha local del server, igual que lunesISO). */
function hoyISO(): string {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Avance del equipo en la semana actual (lun→hoy), medido por PEDIDOS registrados
 * por las asesoras (variante "vigentes": cuenta salvo Fallido, sin POS). Según
 * `criterio`: monto vendido (S/) o N° de pedidos de TODO el equipo. Solo pedidos
 * de usuarias con rol asesor, para que el total cuadre con la suma del ranking.
 * Fuente única: lib/ventas-metricas.ts.
 */
export async function getVendidoEquipoSemana(criterio: Criterio = "monto"): Promise<number> {
  return ventasEquipo(lunesISO(), hoyISO(), "vigentes", criterio);
}

export interface RankingRow {
  asesorId: string;
  nombre: string;
  valor: number;
  puesto: number;
}

/** Ranking mensual de asesoras según el criterio configurado, medido por PEDIDOS
 * del mes actual (variante "entregadas": solo pedidos ya Entregados — la misma
 * cifra confirmada que ven las metas individuales). `monto` = S/ vendido,
 * `pedidos` = N° de pedidos. Fuente única: lib/ventas-metricas.ts. */
export async function getRankingMensual(criterio: CriterioRanking): Promise<RankingRow[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const asesores = (await sql`
    SELECT id, name FROM users WHERE role = 'asesor' ORDER BY name
  `) as Array<{ id: string; name: string }>;

  const now = new Date();
  const mesIniIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const hoyIso = hoyISO();

  const filas: Array<Omit<RankingRow, "puesto">> = [];
  for (const a of asesores) {
    let valor = 0;
    if (criterio === "pedidos") {
      valor = await contarPedidosAsesora(a.id, mesIniIso, hoyIso, "entregadas");
    } else {
      valor = await ventasMesActual(a.id); // "monto" vendido (misma regla que Mis Metas)
    }
    filas.push({ asesorId: a.id, nombre: (a.name || "").trim(), valor });
  }

  filas.sort((x, y) => y.valor - x.valor);
  return filas.map((f, i) => ({ ...f, puesto: i + 1 }));
}

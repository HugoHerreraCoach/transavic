// src/lib/incentivos.ts
// Sistema de incentivos: configuración (en tabla settings, JSONB) + cálculos de
// meta de equipo semanal y ranking mensual. Todo derivado de pedidos/pedido_items.
import { neon } from "@neondatabase/serverless";
import { ventasMesActual } from "@/lib/metas";

// Cómo se mide un incentivo: por facturación (S/) o por N° de pedidos entregados.
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
  metasIndividuales: { activo: boolean };
}

export const DEFAULT_INCENTIVOS: IncentivosConfig = {
  metaEquipoSemanal: { activo: false, criterio: "monto", monto: 0, premio: "" },
  rankingMensual: { activo: false, criterio: "monto", premios: [] },
  rachaSemanal: { activo: false, diaFin: 6, criterio: "monto", minimoDiario: 0, premio: "" },
  metasIndividuales: { activo: true },
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
  return {
    metaEquipoSemanal,
    rankingMensual,
    rachaSemanal,
    metasIndividuales: { ...DEFAULT_INCENTIVOS.metasIndividuales, ...(v.metasIndividuales ?? {}) },
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

/**
 * Avance del equipo en la semana actual (lun→hoy), medido por VENTAS (día de registro
 * del pedido — `created_at`, zona Lima — no por entrega). Según `criterio`: monto
 * vendido (S/, `subtotal`) o N° de pedidos vendidos por TODO el equipo. Sin filtrar estado.
 */
export async function getVendidoEquipoSemana(criterio: Criterio = "monto"): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const desde = lunesISO();
  if (criterio === "pedidos") {
    const r = (await sql`
      SELECT COUNT(*)::int AS total
      FROM pedidos p
      WHERE (p.created_at AT TIME ZONE 'America/Lima')::date
            BETWEEN ${desde}::date AND (NOW() AT TIME ZONE 'America/Lima')::date
    `) as Array<{ total: number }>;
    return Number(r[0]?.total ?? 0);
  }
  const r = (await sql`
    SELECT COALESCE(SUM(COALESCE(pi.subtotal, 0)), 0)::numeric AS total
    FROM pedidos p
    JOIN pedido_items pi ON pi.pedido_id = p.id
    WHERE (p.created_at AT TIME ZONE 'America/Lima')::date
          BETWEEN ${desde}::date AND (NOW() AT TIME ZONE 'America/Lima')::date
  `) as Array<{ total: string | number }>;
  return Number(r[0]?.total ?? 0);
}

export interface RankingRow {
  asesorId: string;
  nombre: string;
  valor: number;
  puesto: number;
}

/** Ranking mensual de asesoras según el criterio configurado, medido por VENTAS
 * (pedidos registrados en el mes, `created_at`; monto = `subtotal`). No por entrega. */
export async function getRankingMensual(criterio: CriterioRanking): Promise<RankingRow[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const asesores = (await sql`
    SELECT id, name FROM users WHERE role = 'asesor' ORDER BY name
  `) as Array<{ id: string; name: string }>;

  const filas: Array<Omit<RankingRow, "puesto">> = [];
  for (const a of asesores) {
    let valor = 0;
    if (criterio === "pedidos") {
      const r = (await sql`
        SELECT COUNT(*)::int AS n FROM pedidos
        WHERE asesor_id = ${a.id}
          AND DATE_TRUNC('month', (created_at AT TIME ZONE 'America/Lima'))
              = DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Lima'))
      `) as Array<{ n: number }>;
      valor = Number(r[0]?.n ?? 0);
    } else {
      valor = await ventasMesActual(a.id); // "monto" vendido (created_at)
    }
    filas.push({ asesorId: a.id, nombre: (a.name || "").trim(), valor });
  }

  filas.sort((x, y) => y.valor - x.valor);
  return filas.map((f, i) => ({ ...f, puesto: i + 1 }));
}

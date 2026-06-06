// src/lib/incentivos.ts
// Sistema de incentivos: configuración (en tabla settings, JSONB) + cálculos de
// meta de equipo semanal y ranking mensual. Desde jun 2026 las cifras de venta
// salen de lo FACTURADO (vista `ventas_facturadas` — comprobantes emitidos, NC
// restando), no de pedidos/pedido_items (que daban S/0 por falta de precios).
import { neon } from "@neondatabase/serverless";
import { ventasMesActual } from "@/lib/metas";

// Cómo se mide un incentivo: por facturación (S/) o por N° de comprobantes de venta
// (facturas + boletas emitidas). El valor "pedidos" se mantiene por compatibilidad
// con la config guardada, pero hoy cuenta comprobantes, no pedidos.
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

/**
 * Avance del equipo en la semana actual (lun→hoy), medido por lo FACTURADO (fecha de
 * emisión del comprobante, zona Lima — no por pedido ni por entrega). Según `criterio`:
 * monto facturado (S/, con IGV, NC restan) o N° de comprobantes de venta de TODO el
 * equipo. Solo cuenta comprobantes atribuibles a una asesora (`asesora_id IS NOT NULL`)
 * para que el total del equipo cuadre con la suma del ranking. Fuente: vista
 * `ventas_facturadas`.
 */
export async function getVendidoEquipoSemana(criterio: Criterio = "monto"): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const desde = lunesISO();
  if (criterio === "pedidos") {
    const r = (await sql`
      SELECT COALESCE(SUM(es_venta), 0)::int AS total
      FROM ventas_facturadas
      WHERE asesora_id IS NOT NULL
        AND fecha BETWEEN ${desde}::date AND (NOW() AT TIME ZONE 'America/Lima')::date
    `) as Array<{ total: number }>;
    return Number(r[0]?.total ?? 0);
  }
  const r = (await sql`
    SELECT COALESCE(SUM(monto_neto), 0)::numeric AS total
    FROM ventas_facturadas
    WHERE asesora_id IS NOT NULL
      AND fecha BETWEEN ${desde}::date AND (NOW() AT TIME ZONE 'America/Lima')::date
  `) as Array<{ total: string | number }>;
  return Number(r[0]?.total ?? 0);
}

export interface RankingRow {
  asesorId: string;
  nombre: string;
  valor: number;
  puesto: number;
}

/** Ranking mensual de asesoras según el criterio configurado, medido por lo
 * FACTURADO en el mes (comprobantes emitidos, por fecha de emisión; monto con IGV y
 * NC restando, o N° de comprobantes de venta). Fuente: vista `ventas_facturadas`. */
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
        SELECT COALESCE(SUM(es_venta), 0)::int AS n
        FROM ventas_facturadas
        WHERE asesora_id = ${a.id}
          AND DATE_TRUNC('month', fecha)
              = DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Lima')::date)
      `) as Array<{ n: number }>;
      valor = Number(r[0]?.n ?? 0);
    } else {
      valor = await ventasMesActual(a.id); // "monto" facturado (vista)
    }
    filas.push({ asesorId: a.id, nombre: (a.name || "").trim(), valor });
  }

  filas.sort((x, y) => y.valor - x.valor);
  return filas.map((f, i) => ({ ...f, puesto: i + 1 }));
}

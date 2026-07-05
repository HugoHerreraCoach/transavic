// src/lib/metas.ts
// Cálculo de meta diaria/mensual por asesora.
// Fórmula: meta_mensual = ventas_mes_anterior × 1.15 (override manual posible en tabla metas_asesoras)
// meta_diaria = meta_mensual / días_hábiles_del_mes (lunes a sábado)
// IMPORTANTE (jul 2026): "ventas" = PEDIDOS de la asesora (monto de pedido_items),
// por fecha de REGISTRO del pedido y zona Lima, excluyendo el POS de planta.
// La regla completa y sus dos variantes (entregadas/vigentes) viven en
// lib/ventas-metricas.ts — ÚNICA fuente; no dupliques la query aquí.
import { neon } from "@neondatabase/serverless";
import { sumarVentasAsesora, ventasPorDiaAsesora } from "@/lib/ventas-metricas";

const FACTOR_CRECIMIENTO = 1.15; // +15% sobre mes anterior (decisión Antonio)

export interface MetaResult {
  metaDiaria: number;
  metaMensual: number;
  ventasMesAnterior: number;
  diasHabilesMes: number;
  diaDelMes: number; // contador de días hábiles transcurridos
  metaAcumuladaHoy: number; // monto que ya debería haber vendido
}

/**
 * Suma del MONTO VENDIDO por la asesora en un rango (variante "entregadas":
 * solo pedidos ya Entregados — cifra confirmada). Ver lib/ventas-metricas.ts.
 */
async function sumarVentasCreadas(
  asesorId: string,
  desdeIso: string,
  hastaIso: string
): Promise<number> {
  return sumarVentasAsesora(asesorId, desdeIso, hastaIso, "entregadas");
}

/**
 * Cuenta días hábiles (lunes a sábado) entre dos fechas inclusive.
 */
function contarDiasHabiles(desde: Date, hasta: Date): number {
  let cnt = 0;
  const cur = new Date(desde);
  cur.setHours(0, 0, 0, 0);
  const fin = new Date(hasta);
  fin.setHours(0, 0, 0, 0);
  while (cur <= fin) {
    const dow = cur.getDay();
    if (dow !== 0) cnt++; // 0 = domingo. Sábado SÍ cuenta.
    cur.setDate(cur.getDate() + 1);
  }
  return cnt;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Factor de crecimiento de la meta automática (meta = ventas_mes_anterior × factor).
 * Configurable por el admin en settings.incentivos_config.metasIndividuales.factorCrecimientoPct
 * (un porcentaje, ej. 15 → factor 1.15; 10 → 1.10; cualquier número ≥ 0). Lo leemos
 * directo de `settings` para NO importar lib/incentivos.ts (que importa de este
 * módulo → crearía dependencia circular). Si no está configurado o es inválido,
 * cae al default histórico (+15%).
 */
async function getFactorCrecimiento(): Promise<number> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT value FROM settings WHERE key = 'incentivos_config'
    `) as Array<{ value: unknown }>;
    const v = (rows[0]?.value ?? {}) as {
      metasIndividuales?: { factorCrecimientoPct?: unknown };
    };
    const pct = v.metasIndividuales?.factorCrecimientoPct;
    if (typeof pct === "number" && isFinite(pct) && pct >= 0) {
      return 1 + pct / 100;
    }
  } catch {
    /* fallback al default */
  }
  return FACTOR_CRECIMIENTO;
}

/**
 * Bono personalizado (texto libre) que el admin definió para esta asesora en el
 * mes actual, al alcanzar su meta individual. Devuelve "" si no hay bono.
 */
export async function getBonoMensual(
  asesorId: string,
  fechaRef: Date = new Date()
): Promise<string> {
  const sql = neon(process.env.DATABASE_URL!);
  const mesIni = toIsoDate(
    new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1)
  );
  const rows = (await sql`
    SELECT bono FROM metas_asesoras
    WHERE asesor_id = ${asesorId} AND mes = ${mesIni}::date
  `) as Array<{ bono: string | null }>;
  return (rows[0]?.bono ?? "").trim();
}

export async function calcularMetaDiaria(
  asesorId: string,
  fechaRef: Date = new Date()
): Promise<MetaResult> {
  const sql = neon(process.env.DATABASE_URL!);

  // Rango: mes anterior
  const mesAnteriorIni = new Date(fechaRef.getFullYear(), fechaRef.getMonth() - 1, 1);
  const mesAnteriorFin = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 0);

  const ventasMesAnterior = await sumarVentasCreadas(
    asesorId,
    toIsoDate(mesAnteriorIni),
    toIsoDate(mesAnteriorFin)
  );

  // Override manual del admin (si existe Y tiene monto). Una fila puede existir
  // solo para el bono personalizado, con monto_meta NULL → en ese caso la meta
  // sigue siendo automática (ventas_mes_anterior × factor configurable).
  const mesActualIni = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1);
  const mesActualIniIso = toIsoDate(mesActualIni);
  const override = (await sql`
    SELECT monto_meta FROM metas_asesoras
    WHERE asesor_id = ${asesorId} AND mes = ${mesActualIniIso}::date
  `) as Array<{ monto_meta: string | number | null }>;
  const overrideMonto =
    override.length > 0 && override[0].monto_meta != null
      ? Number(override[0].monto_meta)
      : null;
  const factor = await getFactorCrecimiento();
  const metaMensual =
    overrideMonto != null
      ? overrideMonto
      : Number((ventasMesAnterior * factor).toFixed(2));

  const mesActualFin = new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0);
  const diasHabilesMes = contarDiasHabiles(mesActualIni, mesActualFin);

  const metaDiaria =
    diasHabilesMes > 0 ? Number((metaMensual / diasHabilesMes).toFixed(2)) : 0;

  const diaDelMes = contarDiasHabiles(mesActualIni, fechaRef);
  const metaAcumuladaHoy = Number((metaDiaria * diaDelMes).toFixed(2));

  return {
    metaDiaria,
    metaMensual,
    ventasMesAnterior,
    diasHabilesMes,
    diaDelMes,
    metaAcumuladaHoy,
  };
}

/**
 * Monto vendido por la asesora en el mes actual (por día de registro del pedido).
 */
export async function ventasMesActual(asesorId: string): Promise<number> {
  const now = new Date();
  const ini = new Date(now.getFullYear(), now.getMonth(), 1);
  const fin = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return sumarVentasCreadas(asesorId, toIsoDate(ini), toIsoDate(fin));
}

/**
 * Monto vendido HOY por la asesora (pedidos que registró hoy; barra de progreso diaria).
 */
export async function ventasHoy(asesorId: string): Promise<number> {
  const hoy = toIsoDate(new Date());
  return sumarVentasCreadas(asesorId, hoy, hoy);
}

/** Lunes de la semana de la fecha dada. */
function lunesDeLaSemana(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=domingo .. 6=sábado
  const diff = dow === 0 ? 6 : dow - 1; // días transcurridos desde el lunes
  x.setDate(x.getDate() - diff);
  return x;
}

/** Monto vendido en la semana actual (lunes → hoy, por día de registro del pedido). */
export async function ventasSemana(asesorId: string): Promise<number> {
  const hoy = new Date();
  return sumarVentasCreadas(asesorId, toIsoDate(lunesDeLaSemana(hoy)), toIsoDate(hoy));
}

/**
 * Racha (legado, ya no se muestra): días hábiles (lun–sáb) consecutivos cumpliendo
 * la meta diaria por VENTAS (monto vendido = pedidos registrados ese día). Los
 * domingos se saltan. Reemplazada en el panel por `getRachaSemanal`.
 */
export async function rachaDiaria(asesorId: string): Promise<number> {
  const { metaDiaria } = await calcularMetaDiaria(asesorId);
  if (metaDiaria <= 0) return 0;
  // Variante "vigentes": lo registrado cuenta de inmediato (deja de contar solo
  // si termina Fallido) — la mayoría de pedidos se entrega días después.
  const hace40 = new Date();
  hace40.setDate(hace40.getDate() - 40);
  const rows = await ventasPorDiaAsesora(
    asesorId,
    toIsoDate(hace40),
    toIsoDate(new Date()),
    "vigentes"
  );
  const porDia = new Map<string, number>(rows.map((r) => [r.dia, r.monto]));
  let racha = 0;
  const cur = new Date();
  // Si hoy todavía no cumplió, arrancar a contar desde ayer.
  if ((porDia.get(toIsoDate(cur)) ?? 0) < metaDiaria) cur.setDate(cur.getDate() - 1);
  for (let i = 0; i < 60; i++) {
    if (cur.getDay() === 0) {
      cur.setDate(cur.getDate() - 1); // saltar domingo
      continue;
    }
    if ((porDia.get(toIsoDate(cur)) ?? 0) >= metaDiaria) {
      racha++;
      cur.setDate(cur.getDate() - 1);
    } else {
      break;
    }
  }
  return racha;
}

// ── Racha SEMANAL de consistencia (estilo "cuadros por día") ────────────────

export interface DiaRacha {
  fechaIso: string;
  label: string; // "L" "M" "X" "J" "V" "S"
  nombre: string; // "Lunes" …
  monto: number; // S/ vendido ese día (pedidos registrados, no fallidos)
  pedidos: number; // N° de pedidos registrados ese día (no fallidos)
  cumplido: boolean;
  esFuturo: boolean;
  esHoy: boolean;
}

export interface RachaSemanal {
  dias: DiaRacha[];
  diasCumplidos: number;
  totalDias: number; // = diaFin (1..6)
  diasTranscurridos: number;
  semanaPerfecta: boolean; // cumplió TODOS los días de lun..diaFin
  criterio: "monto" | "pedidos";
  minimoDiario: number;
}

/**
 * Racha semanal de consistencia: para cada día de la semana actual desde el lunes
 * hasta `diaFin` (1=lunes … 6=sábado), indica si la asesora alcanzó el mínimo del
 * día. El mínimo se mide según `criterio`: facturación (`monto`, S/) o `pedidos`
 * (N° entregados); el día cuenta si el valor del día >= `minimoDiario`. Días aún
 * por venir se marcan `esFuturo`. `semanaPerfecta` = cumplió TODOS los días del
 * rango. Reinicia cada semana (a diferencia de `rachaDiaria`, sin tope semanal).
 */
export async function getRachaSemanal(
  asesorId: string,
  diaFin = 6,
  criterio: "monto" | "pedidos" = "monto",
  minimoDiario = 0
): Promise<RachaSemanal> {
  const finIdx = Math.min(Math.max(Math.trunc(diaFin), 1), 6); // 1..6

  const lunes = lunesDeLaSemana(new Date());
  lunes.setHours(0, 0, 0, 0);
  const finSemana = new Date(lunes);
  finSemana.setDate(lunes.getDate() + (finIdx - 1));

  // Monto y N° de pedidos por día de registro (variante "vigentes": cuenta lo
  // registrado salvo que termine Fallido). Fuente única: lib/ventas-metricas.ts.
  const rows = await ventasPorDiaAsesora(
    asesorId,
    toIsoDate(lunes),
    toIsoDate(finSemana),
    "vigentes"
  );
  const porDia = new Map<string, { monto: number; pedidos: number }>(
    rows.map((r) => [r.dia, { monto: r.monto, pedidos: r.pedidos }])
  );

  const LABELS = ["L", "M", "X", "J", "V", "S"];
  const NOMBRES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const hoyIso = toIsoDate(new Date());

  const dias: DiaRacha[] = [];
  for (let i = 0; i < finIdx; i++) {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    const iso = toIsoDate(d);
    const agg = porDia.get(iso) ?? { monto: 0, pedidos: 0 };
    const esFuturo = iso > hoyIso; // YYYY-MM-DD ordena lexicográficamente
    const esHoy = iso === hoyIso;
    const valor = criterio === "pedidos" ? agg.pedidos : agg.monto;
    const cumplido = minimoDiario > 0 && !esFuturo && valor >= minimoDiario;
    dias.push({
      fechaIso: iso,
      label: LABELS[i],
      nombre: NOMBRES[i],
      monto: Number(agg.monto.toFixed(2)),
      pedidos: agg.pedidos,
      cumplido,
      esFuturo,
      esHoy,
    });
  }

  const diasCumplidos = dias.filter((d) => d.cumplido).length;
  const diasTranscurridos = dias.filter((d) => !d.esFuturo).length;
  const semanaPerfecta = diasCumplidos === finIdx;

  return {
    dias,
    diasCumplidos,
    totalDias: finIdx,
    diasTranscurridos,
    semanaPerfecta,
    criterio,
    minimoDiario,
  };
}

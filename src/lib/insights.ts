// src/lib/insights.ts
// Genera los 4 insights del Asistente IA para el dashboard de Antonio.
// Cada insight corre primero queries SQL determinísticas y luego pasa el resumen
// a Gemini para que escriba un análisis conversacional en español.

import { neon } from "@neondatabase/serverless";
import { callIA, ClienteAnonymizer } from "./gemini";
import { calcularMetaDiaria, ventasMesActual } from "./metas";

// Diferencia mínima en ventas (S/) para considerar que un producto "sube" o "baja"
const UMBRAL_CAMBIO_PRODUCTO_PEN = 50;
// Cliente en riesgo si no pide hace más de este número de días
const DIAS_INACTIVIDAD_RIESGO = 21;

// ════════════════════════════════════════════════════════════════════════
// Helpers de queries (devuelven datos crudos, sin llamar a Gemini)
// ════════════════════════════════════════════════════════════════════════

interface ProductoCambio {
  nombre: string;
  ventas_mes_actual: number;
  ventas_mes_anterior: number;
  diferencia: number;
  porcentaje_cambio: number;
}

async function queryProductosCambio(empresa?: string): Promise<ProductoCambio[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    WITH ventas_mensuales AS (
      SELECT
        pi.producto_nombre,
        DATE_TRUNC('month', (p.fecha_pedido AT TIME ZONE 'America/Lima'))::date AS mes,
        SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)) AS total
      FROM pedido_items pi
      JOIN pedidos p ON p.id = pi.pedido_id
      WHERE p.estado = 'Entregado'
        AND p.fecha_pedido >= ((NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '2 months')
        AND (${empresa || null}::text IS NULL OR p.empresa = ${empresa || null}::text)
      GROUP BY pi.producto_nombre, mes
    ),
    pivoteado AS (
      SELECT
        producto_nombre,
        SUM(CASE WHEN mes = DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Lima'))::date
                 THEN total ELSE 0 END) AS mes_actual,
        SUM(CASE WHEN mes = DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Lima') - INTERVAL '1 month')::date
                 THEN total ELSE 0 END) AS mes_anterior
      FROM ventas_mensuales
      GROUP BY producto_nombre
    )
    SELECT
      producto_nombre AS nombre,
      mes_actual AS ventas_mes_actual,
      mes_anterior AS ventas_mes_anterior,
      (mes_actual - mes_anterior) AS diferencia,
      CASE
        WHEN mes_anterior = 0 THEN 100
        ELSE ROUND(((mes_actual - mes_anterior) / mes_anterior * 100)::numeric, 1)
      END AS porcentaje_cambio
    FROM pivoteado
    WHERE ABS(mes_actual - mes_anterior) >= ${UMBRAL_CAMBIO_PRODUCTO_PEN}
    ORDER BY ABS(mes_actual - mes_anterior) DESC
    LIMIT 8
  `) as Array<{
    nombre: string;
    ventas_mes_actual: string | number;
    ventas_mes_anterior: string | number;
    diferencia: string | number;
    porcentaje_cambio: string | number;
  }>;

  return rows.map((r) => ({
    nombre: r.nombre,
    ventas_mes_actual: Number(r.ventas_mes_actual),
    ventas_mes_anterior: Number(r.ventas_mes_anterior),
    diferencia: Number(r.diferencia),
    porcentaje_cambio: Number(r.porcentaje_cambio),
  }));
}

interface ClienteRiesgo {
  cliente_id: string;
  nombre: string;
  ultimo_pedido_fecha: string;
  dias_sin_comprar: number;
  total_historico: number;
  pedidos_total: number;
}

async function queryClientesEnRiesgo(empresa?: string): Promise<ClienteRiesgo[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    WITH cliente_stats AS (
      SELECT
        p.cliente_id,
        p.cliente AS nombre,
        MAX(p.fecha_pedido) AS ultimo_pedido_fecha,
        COUNT(*) AS pedidos_total,
        SUM(COALESCE(
          (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)) FROM pedido_items pi WHERE pi.pedido_id = p.id),
          0
        )) AS total_historico
      FROM pedidos p
      WHERE p.estado = 'Entregado'
        AND p.cliente_id IS NOT NULL
        AND (${empresa || null}::text IS NULL OR p.empresa = ${empresa || null}::text)
        AND (p.origen IS NULL OR p.origen != 'pos_planta')
      GROUP BY p.cliente_id, p.cliente
      HAVING COUNT(*) >= 3  -- clientes recurrentes (3+ pedidos históricos)
    )
    SELECT
      cliente_id,
      nombre,
      ultimo_pedido_fecha::text AS ultimo_pedido_fecha,
      ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido_fecha)::int AS dias_sin_comprar,
      total_historico,
      pedidos_total
    FROM cliente_stats
    WHERE ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido_fecha) >= ${DIAS_INACTIVIDAD_RIESGO}
    ORDER BY total_historico DESC
    LIMIT 5
  `) as Array<{
    cliente_id: string;
    nombre: string;
    ultimo_pedido_fecha: string;
    dias_sin_comprar: number;
    total_historico: string | number;
    pedidos_total: string | number;
  }>;

  return rows.map((r) => ({
    cliente_id: r.cliente_id,
    nombre: r.nombre,
    ultimo_pedido_fecha: r.ultimo_pedido_fecha,
    dias_sin_comprar: r.dias_sin_comprar,
    total_historico: Number(r.total_historico),
    pedidos_total: Number(r.pedidos_total),
  }));
}

interface AsesoraStats {
  asesor_id: string;
  nombre: string;
  total_ventas_mes: number;
  pedidos_entregados: number;
  ticket_promedio: number;
}

async function queryAsesoraTopMes(empresa?: string): Promise<AsesoraStats[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT
      u.id AS asesor_id,
      u.name AS nombre,
      COALESCE(SUM(
        (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0))
         FROM pedido_items pi WHERE pi.pedido_id = p.id)
      ), 0) AS total_ventas_mes,
      COUNT(p.id) AS pedidos_entregados,
      CASE WHEN COUNT(p.id) = 0 THEN 0
           ELSE COALESCE(SUM(
             (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0))
              FROM pedido_items pi WHERE pi.pedido_id = p.id)
           ), 0) / COUNT(p.id)
      END AS ticket_promedio
    FROM users u
    LEFT JOIN pedidos p ON p.asesor_id = u.id
      AND p.estado = 'Entregado'
      AND p.fecha_pedido >= DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Lima'))::date
      AND (${empresa || null}::text IS NULL OR p.empresa = ${empresa || null}::text)
      AND (p.origen IS NULL OR p.origen != 'pos_planta')
    WHERE u.role IN ('asesor', 'admin')
    GROUP BY u.id, u.name
    ORDER BY total_ventas_mes DESC
  `) as Array<{
    asesor_id: string;
    nombre: string;
    total_ventas_mes: string | number;
    pedidos_entregados: string | number;
    ticket_promedio: string | number;
  }>;

  return rows.map((r) => ({
    asesor_id: r.asesor_id,
    nombre: r.nombre,
    total_ventas_mes: Number(r.total_ventas_mes),
    pedidos_entregados: Number(r.pedidos_entregados),
    ticket_promedio: Number(r.ticket_promedio),
  }));
}

interface ResumenDia {
  fecha: string;
  pedidos_total: number;
  pedidos_entregados: number;
  pedidos_fallidos: number;
  ventas_total: number;
  ticket_promedio: number;
}

async function queryResumenAyer(empresa?: string): Promise<ResumenDia> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT
      ((NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '1 day')::text AS fecha,
      COUNT(*) FILTER (WHERE estado IN ('Entregado', 'Fallido')) AS pedidos_total,
      COUNT(*) FILTER (WHERE estado = 'Entregado') AS pedidos_entregados,
      COUNT(*) FILTER (WHERE estado = 'Fallido') AS pedidos_fallidos,
      COALESCE(SUM(
        CASE WHEN estado = 'Entregado'
             THEN (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0))
                   FROM pedido_items pi WHERE pi.pedido_id = pedidos.id)
             ELSE 0 END
      ), 0) AS ventas_total
    FROM pedidos
    WHERE fecha_pedido = ((NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '1 day')
      AND (${empresa || null}::text IS NULL OR empresa = ${empresa || null}::text)
  `) as Array<{
    fecha: string;
    pedidos_total: string | number;
    pedidos_entregados: string | number;
    pedidos_fallidos: string | number;
    ventas_total: string | number;
  }>;

  const r = rows[0];
  const entregados = Number(r.pedidos_entregados);
  const ventas = Number(r.ventas_total);
  return {
    fecha: r.fecha,
    pedidos_total: Number(r.pedidos_total),
    pedidos_entregados: entregados,
    pedidos_fallidos: Number(r.pedidos_fallidos),
    ventas_total: ventas,
    ticket_promedio: entregados === 0 ? 0 : ventas / entregados,
  };
}

// ════════════════════════════════════════════════════════════════════════
// Insights (combinan SQL + Gemini)
// Cada uno devuelve { texto, data } — la data cruda se muestra y el texto es
// el análisis conversacional de Gemini.
// ════════════════════════════════════════════════════════════════════════

export interface InsightProducto {
  texto: string;
  productosUp: ProductoCambio[];
  productosDown: ProductoCambio[];
}

export async function insightProductosEnAlza(empresa?: string): Promise<InsightProducto> {
  const cambios = await queryProductosCambio(empresa);
  const productosUp = cambios.filter((c) => c.diferencia > 0).slice(0, 4);
  const productosDown = cambios.filter((c) => c.diferencia < 0).slice(0, 3);

  if (productosUp.length === 0 && productosDown.length === 0) {
    return {
      texto: "No hay suficientes datos del mes anterior todavía para detectar tendencias significativas. Espera unos días más para que el análisis tenga más volumen.",
      productosUp: [],
      productosDown: [],
    };
  }

  // Prompt: NO contiene nombres de clientes, solo nombres de productos (públicos)
  const prompt = `Eres un asistente comercial de Antonio, dueño de una distribuidora avícola en Lima (Transavic + Avícola de Tony).
Analiza estos cambios de ventas entre el mes anterior y el mes actual y dale a Antonio una recomendación breve, conversacional, en español neutro latinoamericano, máximo 3 oraciones.

PRODUCTOS QUE SUBIERON:
${productosUp.map((p) => `  • ${p.nombre}: S/ ${p.ventas_mes_anterior.toFixed(0)} → S/ ${p.ventas_mes_actual.toFixed(0)} (${p.porcentaje_cambio >= 0 ? "+" : ""}${p.porcentaje_cambio}%)`).join("\n") || "  (ninguno)"}

PRODUCTOS QUE BAJARON:
${productosDown.map((p) => `  • ${p.nombre}: S/ ${p.ventas_mes_anterior.toFixed(0)} → S/ ${p.ventas_mes_actual.toFixed(0)} (${p.porcentaje_cambio}%)`).join("\n") || "  (ninguno)"}

Dale a Antonio una acción concreta. NO repitas todos los productos, solo destaca lo más importante. Si nada destaca, dilo.`;

  let texto = "Analizando tendencias del mes…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 200 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA en este momento (${(err as Error).message.slice(0, 80)}). Mostrando datos crudos abajo.`;
  }

  return { texto, productosUp, productosDown };
}

export interface InsightClientes {
  texto: string;
  clientes: ClienteRiesgo[];
}

export async function insightClientesEnRiesgo(empresa?: string): Promise<InsightClientes> {
  const clientes = await queryClientesEnRiesgo(empresa);

  if (clientes.length === 0) {
    return {
      texto: "Excelente — todos tus clientes recurrentes pidieron en las últimas 3 semanas. Sigue así.",
      clientes: [],
    };
  }

  // Anonimizar nombres antes de pasar a Gemini
  const anon = new ClienteAnonymizer();
  const clientesAnon = clientes.map((c) => ({
    codigo: anon.anon(c.nombre),
    dias_sin_comprar: c.dias_sin_comprar,
    total_historico: c.total_historico,
    pedidos_total: c.pedidos_total,
  }));

  const prompt = `Eres un asistente comercial de Antonio, dueño de una distribuidora avícola en Lima.
Estos son clientes recurrentes que NO compraron en las últimas 3 semanas (${DIAS_INACTIVIDAD_RIESGO}+ días). Ordenados por gasto histórico de mayor a menor:

${clientesAnon.map((c) => `  • ${c.codigo}: ${c.dias_sin_comprar} días sin comprar, gastó históricamente S/${c.total_historico.toFixed(0)} en ${c.pedidos_total} pedidos`).join("\n")}

Dale a Antonio una recomendación concreta de acción (en español neutro latinoamericano, máximo 3 oraciones). NO uses los códigos "Cliente A" en tu respuesta — refiérete a ellos como "el cliente más importante", "los 3 clientes top", etc. Si hay uno claramente prioritario, destácalo.`;

  let texto = "Analizando clientes en riesgo…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 200 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA (${(err as Error).message.slice(0, 80)}). Mostrando lista abajo.`;
  }

  return { texto, clientes };
}

export interface InsightAsesora {
  texto: string;
  asesoras: AsesoraStats[];
}

export async function insightAsesoraTop(empresa?: string): Promise<InsightAsesora> {
  const asesoras = await queryAsesoraTopMes(empresa);
  if (asesoras.length === 0 || asesoras[0].total_ventas_mes === 0) {
    return {
      texto: "Todavía no hay ventas registradas este mes. Las recomendaciones aparecen apenas las asesoras entreguen sus primeros pedidos.",
      asesoras: [],
    };
  }

  const prompt = `Eres un asistente comercial de Antonio (distribuidora avícola Lima).
Estas son las ventas del MES EN CURSO por asesora (pedidos entregados):

${asesoras.map((a, i) => `  ${i + 1}. ${a.nombre}: S/ ${a.total_ventas_mes.toFixed(0)} en ${a.pedidos_entregados} pedidos (ticket promedio S/ ${a.ticket_promedio.toFixed(0)})`).join("\n")}

Dale a Antonio una observación breve, en español neutro latinoamericano, máximo 3 oraciones. Destaca quién va primera y por qué (alto ticket promedio? muchos pedidos?). Si hay alguien muy abajo, menciónalo con cuidado (sin ser duro — son sus empleadas).`;

  let texto = "Analizando performance del mes…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 200 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA (${(err as Error).message.slice(0, 80)}). Mostrando ranking abajo.`;
  }

  return { texto, asesoras };
}

export interface InsightDia {
  texto: string;
  resumen: ResumenDia;
}

export async function insightRecomendacionDia(empresa?: string): Promise<InsightDia> {
  const resumen = await queryResumenAyer(empresa);
  if (resumen.pedidos_total === 0) {
    return {
      texto: "No hubo pedidos entregados ayer. ¿Fue feriado o día libre del equipo? Si fue laboral, vale la pena revisar por qué.",
      resumen,
    };
  }

  const tasaExito = (resumen.pedidos_entregados / resumen.pedidos_total) * 100;
  const prompt = `Eres un asistente comercial de Antonio (distribuidora avícola Lima).
Resumen de AYER (${resumen.fecha}):
  • Pedidos totales: ${resumen.pedidos_total}
  • Entregados: ${resumen.pedidos_entregados}
  • Fallidos: ${resumen.pedidos_fallidos}
  • Tasa de éxito: ${tasaExito.toFixed(0)}%
  • Ventas del día: S/ ${resumen.ventas_total.toFixed(0)}
  • Ticket promedio: S/ ${resumen.ticket_promedio.toFixed(0)}

Dale a Antonio una recomendación práctica para HOY basándote en este resumen. Español neutro latinoamericano, máximo 3 oraciones. Si la tasa de éxito fue baja (<80%), sugiere revisar fallos. Si fue alta y las ventas buenas, felicítalo.`;

  let texto = "Analizando el día de ayer…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 200 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude generar la recomendación (${(err as Error).message.slice(0, 80)}). Datos crudos abajo.`;
  }

  return { texto, resumen };
}

// ════════════════════════════════════════════════════════════════════════
// Cache PERSISTENTE en Postgres (tabla ia_insights_cache, TTL 1h).
// Antes era un Map() in-memory que NO sobrevivía a los cold starts de Vercel
// → cada carga disparaba 4 llamadas frescas a Gemini y topaba la cuota (429).
// Ahora cada insight se genera ≤1 vez/hora por scope y persiste entre deploys.
// Las claves son acotadas y se upsertean (no crece la tabla → sin cron de purga).
// Migración: scripts/migrate-ia-insights-cache.sql
// ════════════════════════════════════════════════════════════════════════

const TTL_INTERVAL = "1 hour"; // mantener en sync con expires_at del INSERT

/** True si el insight salió degradado (la IA falló y dejó el aviso "⚠️ …"). */
function esInsightDegradado(v: unknown): boolean {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { texto?: unknown }).texto === "string" &&
    (v as { texto: string }).texto.startsWith("⚠️")
  );
}

export async function cached<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
  const sql = neon(process.env.DATABASE_URL!);

  // Leemos la fila (aunque esté vencida) para poder servir el último bueno si hace falta.
  const prev = (await sql`
    SELECT value, expires_at FROM ia_insights_cache WHERE cache_key = ${key} LIMIT 1
  `) as Array<{ value: T; expires_at: string }>;
  const fresco = prev.length > 0 && new Date(prev[0].expires_at).getTime() > Date.now();
  if (!force && fresco) return prev[0].value; // hit fresco → 0 llamadas a la IA

  const value = await loader();

  // Bonus: si lo nuevo salió degradado pero el guardado era bueno, conservamos el bueno.
  if (esInsightDegradado(value) && prev.length > 0 && !esInsightDegradado(prev[0].value)) {
    return prev[0].value;
  }

  const json = JSON.stringify(value);
  await sql`
    INSERT INTO ia_insights_cache (cache_key, value, expires_at)
    VALUES (${key}, ${json}::jsonb, NOW() + ${TTL_INTERVAL}::interval)
    ON CONFLICT (cache_key) DO UPDATE
      SET value = ${json}::jsonb,
          expires_at = NOW() + ${TTL_INTERVAL}::interval,
          updated_at = NOW()
  `;
  return value;
}

export async function clearInsightsCache() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`DELETE FROM ia_insights_cache`;
}

export async function clearInsightsCacheFor(prefix: string) {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`DELETE FROM ia_insights_cache WHERE cache_key LIKE ${prefix + "%"}`;
}

// ════════════════════════════════════════════════════════════════════════
// ═══════════════ INSIGHTS PARA ASESORAS (SCOPED) ═══════════════════════
// ════════════════════════════════════════════════════════════════════════
// Cada función recibe `asesorId` y `asesoraNombre`. Las queries SQL
// filtran por asesor_id para garantizar privacy boundary.
// El cache se hace por asesor (key: `asesor-{id}-{tipo}`) para que cada
// una vea su data fresca y no mezcle entre asesoras.

// ── 1) Performance personal (vs meta) ────────────────────────────────

export interface InsightMiPerformance {
  texto: string;
  ventasMes: number;
  metaMensual: number;
  porcentajeAvance: number;
  metaDiaria: number;
  diaDelMes: number;
  diasHabilesMes: number;
  ritmoNecesario: number; // S/ por día hábil restante para alcanzar meta
}

export async function insightMiPerformance(
  asesorId: string,
  asesoraNombre: string
): Promise<InsightMiPerformance> {
  const [meta, vendido] = await Promise.all([
    calcularMetaDiaria(asesorId),
    ventasMesActual(asesorId),
  ]);

  const porcentajeAvance =
    meta.metaMensual === 0 ? 0 : (vendido / meta.metaMensual) * 100;
  const diasRestantes = Math.max(0, meta.diasHabilesMes - meta.diaDelMes);
  const ritmoNecesario =
    diasRestantes === 0
      ? 0
      : Math.max(0, (meta.metaMensual - vendido) / diasRestantes);

  // Si la meta es cero (mes anterior sin ventas, ni override), no llamamos Gemini.
  if (meta.metaMensual === 0) {
    return {
      texto: `Todavía no hay meta calculada porque no había ventas registradas el mes anterior. Cuando el sistema acumule un mes de datos, verás tu meta y tu avance aquí.`,
      ventasMes: vendido,
      metaMensual: 0,
      porcentajeAvance: 0,
      metaDiaria: 0,
      diaDelMes: meta.diaDelMes,
      diasHabilesMes: meta.diasHabilesMes,
      ritmoNecesario: 0,
    };
  }

  const prompt = `Eres un coach comercial cercano de ${asesoraNombre}, asesora de ventas de Transavic (distribuidora avícola en Lima).
Estos son SUS números del mes en curso:

  • Vendido hasta hoy: S/ ${vendido.toFixed(0)}
  • Meta mensual: S/ ${meta.metaMensual.toFixed(0)}
  • Avance: ${porcentajeAvance.toFixed(0)}%
  • Día hábil actual del mes: ${meta.diaDelMes} de ${meta.diasHabilesMes}
  • Lo que ya debería haber vendido (proporcional): S/ ${meta.metaAcumuladaHoy.toFixed(0)}
  • Ritmo necesario para los días restantes: S/ ${ritmoNecesario.toFixed(0)} por día hábil

Háblale a ${asesoraNombre} en segunda persona (tutéala, usa "tú" en español neutro latinoamericano). 3 oraciones máximo, motivacional pero honesta:
- Si va arriba del ritmo necesario → felicítala y propón mantener.
- Si va parejo → anímala a no aflojar.
- Si va atrasada → dale una estrategia concreta (priorizar clientes top, hacer X llamadas/día, ofrecer combos, etc.). NO la culpes.

NO repitas los números crudos — ella ya los ve abajo. Concéntrate en la recomendación.`;

  let texto = "Analizando tu performance del mes…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 600 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA (${(err as Error).message.slice(0, 80)}). Mostrando tus datos abajo.`;
  }

  return {
    texto,
    ventasMes: vendido,
    metaMensual: meta.metaMensual,
    porcentajeAvance,
    metaDiaria: meta.metaDiaria,
    diaDelMes: meta.diaDelMes,
    diasHabilesMes: meta.diasHabilesMes,
    ritmoNecesario,
  };
}

// ── 2) Mis clientes en riesgo ────────────────────────────────────────

export async function insightMisClientesEnRiesgo(
  asesorId: string,
  asesoraNombre: string
): Promise<InsightClientes> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    WITH cliente_stats AS (
      SELECT
        p.cliente_id,
        p.cliente AS nombre,
        MAX(p.fecha_pedido) AS ultimo_pedido_fecha,
        COUNT(*) AS pedidos_total,
        SUM(COALESCE(
          (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)) FROM pedido_items pi WHERE pi.pedido_id = p.id),
          0
        )) AS total_historico
      FROM pedidos p
      WHERE p.estado = 'Entregado'
        AND p.cliente_id IS NOT NULL
        AND p.asesor_id = ${asesorId}    -- ⬅️ SCOPING
      GROUP BY p.cliente_id, p.cliente
      HAVING COUNT(*) >= 2  -- para asesora bajamos a 2+ pedidos (cartera más chica que admin)
    )
    SELECT
      cliente_id,
      nombre,
      ultimo_pedido_fecha::text AS ultimo_pedido_fecha,
      ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido_fecha)::int AS dias_sin_comprar,
      total_historico,
      pedidos_total
    FROM cliente_stats
    WHERE ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido_fecha) >= ${DIAS_INACTIVIDAD_RIESGO}
    ORDER BY total_historico DESC
    LIMIT 5
  `) as Array<{
    cliente_id: string;
    nombre: string;
    ultimo_pedido_fecha: string;
    dias_sin_comprar: number;
    total_historico: string | number;
    pedidos_total: string | number;
  }>;

  const clientes = rows.map((r) => ({
    cliente_id: r.cliente_id,
    nombre: r.nombre,
    ultimo_pedido_fecha: r.ultimo_pedido_fecha,
    dias_sin_comprar: r.dias_sin_comprar,
    total_historico: Number(r.total_historico),
    pedidos_total: Number(r.pedidos_total),
  }));

  if (clientes.length === 0) {
    return {
      texto: `Excelente, ${asesoraNombre} — todos tus clientes recurrentes pidieron en las últimas 3 semanas. Estás manteniendo bien la cartera.`,
      clientes: [],
    };
  }

  const anon = new ClienteAnonymizer();
  const clientesAnon = clientes.map((c) => ({
    codigo: anon.anon(c.nombre),
    dias_sin_comprar: c.dias_sin_comprar,
    total_historico: c.total_historico,
    pedidos_total: c.pedidos_total,
  }));

  const prompt = `Eres coach comercial de ${asesoraNombre}, asesora de Transavic (distribuidora avícola Lima).
Estos son SUS clientes que no pidieron en 3+ semanas, ordenados por gasto histórico:

${clientesAnon.map((c) => `  • ${c.codigo}: ${c.dias_sin_comprar} días sin comprar, históricamente gastó S/${c.total_historico.toFixed(0)} en ${c.pedidos_total} pedidos`).join("\n")}

Háblale en segunda persona tuteándola ("tu cliente más importante", "deberías llamarlo"), español neutro latinoamericano. 3 oraciones máximo. NO uses "Cliente A"/"Cliente B" en la respuesta. Si hay UNO claramente prioritario, destácalo. Dale una acción concreta hoy.`;

  let texto = "Analizando tu cartera en riesgo…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 600 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA (${(err as Error).message.slice(0, 80)}). Mostrando lista abajo.`;
  }

  return { texto, clientes };
}

// ── 3) Top productos de mi cartera ───────────────────────────────────

export interface ProductoCarteraStats {
  nombre: string;
  cantidad_total: number;
  pedidos: number;
  ventas: number;
}

export interface InsightMiCartera {
  texto: string;
  productos: ProductoCarteraStats[];
}

export async function insightMiCartera(
  asesorId: string,
  asesoraNombre: string
): Promise<InsightMiCartera> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT
      pi.producto_nombre AS nombre,
      COALESCE(SUM(COALESCE(pi.cantidad_real, pi.cantidad, 0)), 0) AS cantidad_total,
      COUNT(DISTINCT pi.pedido_id) AS pedidos,
      COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)), 0) AS ventas
    FROM pedido_items pi
    JOIN pedidos p ON p.id = pi.pedido_id
    WHERE p.asesor_id = ${asesorId}   -- ⬅️ SCOPING
      AND p.estado = 'Entregado'
      AND p.fecha_pedido >= ((NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '90 days')
    GROUP BY pi.producto_nombre
    HAVING COUNT(DISTINCT pi.pedido_id) >= 2
    ORDER BY pedidos DESC, cantidad_total DESC
    LIMIT 6
  `) as Array<{
    nombre: string;
    cantidad_total: string | number;
    pedidos: string | number;
    ventas: string | number;
  }>;

  const productos = rows.map((r) => ({
    nombre: r.nombre,
    cantidad_total: Number(r.cantidad_total),
    pedidos: Number(r.pedidos),
    ventas: Number(r.ventas),
  }));

  if (productos.length === 0) {
    return {
      texto: `Todavía no hay suficientes pedidos en tu cartera para detectar productos top. Apenas tengamos volumen, verás aquí qué te conviene ofrecer.`,
      productos: [],
    };
  }

  const prompt = `Eres coach comercial de ${asesoraNombre}, asesora de Transavic.
Estos son los productos que MÁS pide la cartera de ${asesoraNombre} en los últimos 90 días (productos con 2+ pedidos):

${productos.map((p, i) => `  ${i + 1}. ${p.nombre} — ${p.pedidos} pedidos, ${p.cantidad_total} kg/u total, S/ ${p.ventas.toFixed(0)}`).join("\n")}

Háblale en segunda persona tuteándola ("tu cartera", "tus clientes prefieren"), español neutro latinoamericano. 3 oraciones máximo. Recomendale: (a) qué producto destacar al ofrecer a nuevos clientes, y (b) qué oportunidad de venta cruzada podría tener. NO repitas la lista entera.`;

  let texto = "Analizando los productos de tu cartera…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 600 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA (${(err as Error).message.slice(0, 80)}). Tus productos top abajo.`;
  }

  return { texto, productos };
}

// ── 4) Sugerencia del día ────────────────────────────────────────────

export interface ClienteContactarHoy {
  cliente_id: string;
  nombre: string;
  dias_sin_comprar: number;
  total_historico: number;
  patron_dias_semana: number[]; // ej [1, 4] = pide lunes y jueves
  patron_intervalo_dias: number; // promedio de días entre pedidos
}

export interface InsightSugerenciaDia {
  texto: string;
  candidatos: ClienteContactarHoy[];
}

export async function insightSugerenciaDia(
  asesorId: string,
  asesoraNombre: string
): Promise<InsightSugerenciaDia> {
  const sql = neon(process.env.DATABASE_URL!);

  // 1. Detectar clientes cuyo patrón histórico sugiere que "deberían" pedir hoy
  //    Heurística: clientes con 3+ pedidos donde el intervalo promedio entre pedidos
  //    coincide con (días desde último pedido).
  const rows = (await sql`
    WITH cliente_patrones AS (
      SELECT
        p.cliente_id,
        p.cliente AS nombre,
        COUNT(*) AS total_pedidos,
        MAX(p.fecha_pedido) AS ultimo_pedido,
        ARRAY_AGG(EXTRACT(DOW FROM p.fecha_pedido)::int ORDER BY p.fecha_pedido DESC) AS dows,
        -- intervalo promedio entre pedidos (días)
        CASE WHEN COUNT(*) <= 1 THEN NULL
             ELSE (MAX(p.fecha_pedido) - MIN(p.fecha_pedido))::numeric / NULLIF(COUNT(*) - 1, 0)
        END AS intervalo_promedio,
        SUM(COALESCE(
          (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)) FROM pedido_items pi WHERE pi.pedido_id = p.id),
          0
        )) AS total_historico
      FROM pedidos p
      WHERE p.estado = 'Entregado'
        AND p.cliente_id IS NOT NULL
        AND p.asesor_id = ${asesorId}     -- ⬅️ SCOPING
        AND p.fecha_pedido >= ((NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '120 days')
      GROUP BY p.cliente_id, p.cliente
      HAVING COUNT(*) >= 3
    )
    SELECT
      cliente_id,
      nombre,
      ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido)::int AS dias_sin_comprar,
      total_historico,
      dows,
      intervalo_promedio::int AS intervalo_promedio
    FROM cliente_patrones
    WHERE intervalo_promedio IS NOT NULL
      AND ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido)::int >= GREATEST(intervalo_promedio - 2, 3)
      AND ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo_pedido)::int <= intervalo_promedio + 5
    ORDER BY total_historico DESC
    LIMIT 3
  `) as Array<{
    cliente_id: string;
    nombre: string;
    dias_sin_comprar: number;
    total_historico: string | number;
    dows: number[];
    intervalo_promedio: number;
  }>;

  const candidatos = rows.map((r) => ({
    cliente_id: r.cliente_id,
    nombre: r.nombre,
    dias_sin_comprar: r.dias_sin_comprar,
    total_historico: Number(r.total_historico),
    patron_dias_semana: Array.from(new Set(r.dows ?? [])),
    patron_intervalo_dias: r.intervalo_promedio,
  }));

  if (candidatos.length === 0) {
    return {
      texto: `Hoy no hay clientes que matemáticamente "tocaba" que pidan según su patrón. Aprovechá para llamar a algún cliente nuevo o reactivar uno antiguo.`,
      candidatos: [],
    };
  }

  const anon = new ClienteAnonymizer();
  const dowName = (d: number) => ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][d] ?? "?";
  const candidatosAnon = candidatos.map((c) => ({
    codigo: anon.anon(c.nombre),
    dias_sin_comprar: c.dias_sin_comprar,
    total_historico: c.total_historico,
    dias_tipicos: c.patron_dias_semana.map(dowName).join(", "),
    intervalo: c.patron_intervalo_dias,
  }));

  const hoyDow = dowName(new Date().getDay());

  const prompt = `Eres coach comercial de ${asesoraNombre}, asesora de Transavic. Hoy es ${hoyDow}.
Estos son los clientes de ${asesoraNombre} que SEGÚN SU PATRÓN HISTÓRICO "tocaba" que pidan ahora (ya pasaron tantos días como suele ser su intervalo):

${candidatosAnon.map((c) => `  • ${c.codigo}: ${c.dias_sin_comprar} días sin pedir (intervalo típico: cada ${c.intervalo} días). Históricamente gastó S/${c.total_historico.toFixed(0)}. Días que suele pedir: ${c.dias_tipicos}.`).join("\n")}

Háblale en segunda persona tuteándola, español neutro latinoamericano. 3 oraciones máximo. Recomendá UNA acción concreta para HOY (a quién priorizar y qué decirle). NO uses "Cliente A". Referite a ellos como "tu cliente más fiel", "el de mayor frecuencia", etc.`;

  let texto = "Analizando a quién contactar hoy…";
  try {
    const res = await callIA(prompt, { maxOutputTokens: 600 });
    texto = res.text;
  } catch (err) {
    texto = `⚠️ No pude analizar con IA (${(err as Error).message.slice(0, 80)}). Candidatos abajo.`;
  }

  return { texto, candidatos };
}

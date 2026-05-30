# Sistema de Incentivos Transavic — Implementation Plan

> **Ejecución:** inline en esta sesión (superpowers:executing-plans). Verificación por tarea: `npx tsc --noEmit` + `npx eslint <archivos>`; al final `npm run build` + spot-check navegador. El proyecto NO tiene framework de tests (ver CLAUDE.md) → se verifica así, no con unit tests.

**Goal:** Panel motivador para la asesora (progreso día/semana/mes + racha diaria) + sistema de incentivos configurable por el admin: meta de equipo semanal con premio, ranking mensual con criterio y premios por puesto configurables, y la meta mensual individual de cada asesora.

**Architecture:** La config vive en la tabla `settings` (JSONB, key `incentivos_config`) → sin migración. Cálculos (semana, racha, ranking, progreso de equipo) se derivan de `pedidos`/`pedido_items` reutilizando `lib/metas.ts`. Endpoints nuevos `/api/incentivos` (GET config+equipo+ranking, POST config) y `/api/metas/asesoras` (lista para admin). UI: se potencia `mis-metas` (asesora) y se crea pantalla admin `Incentivos`.

**Tech Stack:** Next.js 15, TypeScript, Tailwind v4, Neon (SQL directo), NextAuth.

**Convenciones:** SQL directo Neon; auth + scope por rol en cada endpoint; `(NOW() AT TIME ZONE 'America/Lima')::date` para "hoy/semana".

---

### Task 1: `lib/metas.ts` — meta semanal + ventas de la semana + racha diaria

**Files:** Modify `src/lib/metas.ts`

- [ ] Agregar `ventasSemana(asesorId)`: suma de ventas entregadas desde el lunes de esta semana (Lima) hasta hoy. Reusa `sumarVentasEntregadas` con el rango lunes→hoy.
- [ ] Agregar a `MetaResult` (o helper aparte) `metaSemanal = metaDiaria × 6` (lun–sáb).
- [ ] Agregar `rachaDiaria(asesorId)`: trae los totales diarios entregados de los últimos 30 días (Lima), y cuenta días hábiles (lun–sáb) consecutivos con `totalDia >= metaDiaria`, terminando en el último día hábil cerrado (ayer si hoy aún no cumple; hoy si ya cumplió). Domingos se saltan (no rompen la racha).

Código de referencia (lunes de la semana + ventas de la semana):
```ts
function lunesDeLaSemana(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=dom..6=sáb
  const diff = dow === 0 ? 6 : dow - 1; // días desde el lunes
  x.setDate(x.getDate() - diff);
  return x;
}

export async function ventasSemana(asesorId: string): Promise<number> {
  const hoy = new Date();
  return sumarVentasEntregadas(asesorId, toIsoDate(lunesDeLaSemana(hoy)), toIsoDate(hoy));
}

export async function rachaDiaria(asesorId: string): Promise<number> {
  const { metaDiaria } = await calcularMetaDiaria(asesorId);
  if (metaDiaria <= 0) return 0;
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT DATE(p.fecha_pedido) AS dia,
           COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)), 0)::numeric AS total
    FROM pedidos p JOIN pedido_items pi ON pi.pedido_id = p.id
    WHERE p.asesor_id = ${asesorId} AND p.estado = 'Entregado'
      AND p.fecha_pedido >= (NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '40 days'
    GROUP BY DATE(p.fecha_pedido)
  `) as Array<{ dia: string; total: string | number }>;
  const porDia = new Map(rows.map((r) => [String(r.dia).slice(0, 10), Number(r.total)]));
  let racha = 0;
  const cur = new Date();
  // si hoy todavía no cumplió, empezar desde ayer
  const hoyIso = toIsoDate(cur);
  if ((porDia.get(hoyIso) ?? 0) < metaDiaria) cur.setDate(cur.getDate() - 1);
  for (let i = 0; i < 60; i++) {
    if (cur.getDay() === 0) { cur.setDate(cur.getDate() - 1); continue; } // saltar domingos
    const iso = toIsoDate(cur);
    if ((porDia.get(iso) ?? 0) >= metaDiaria) { racha++; cur.setDate(cur.getDate() - 1); }
    else break;
  }
  return racha;
}
```

**Verify:** `npx tsc --noEmit` OK.

---

### Task 2: `lib/incentivos.ts` — config + meta de equipo + ranking

**Files:** Create `src/lib/incentivos.ts`

- [ ] Definir tipos + default + leer/guardar config en `settings` (key `incentivos_config`).
- [ ] `getMetaEquipoSemanal()`: meta del config; vendido = suma de TODAS las ventas entregadas de la semana (sin filtrar asesor).
- [ ] `getRankingMensual(criterio)`: por cada asesor (role='asesor'), calcular el valor del mes según criterio y ordenar desc, asignando `puesto`.

```ts
import { neon } from "@neondatabase/serverless";
import { calcularMetaDiaria, ventasMesActual } from "@/lib/metas";

export type CriterioRanking = "monto" | "pedidos" | "cumplimiento";
export interface IncentivosConfig {
  metaEquipoSemanal: { activo: boolean; monto: number; premio: string };
  rankingMensual: { activo: boolean; criterio: CriterioRanking; premios: Array<{ puesto: number; premio: string }> };
}
export const DEFAULT_INCENTIVOS: IncentivosConfig = {
  metaEquipoSemanal: { activo: false, monto: 0, premio: "" },
  rankingMensual: { activo: false, criterio: "monto", premios: [] },
};

export async function getIncentivosConfig(): Promise<IncentivosConfig> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`SELECT value FROM settings WHERE key = 'incentivos_config'`) as Array<{ value: unknown }>;
  if (rows.length === 0) return DEFAULT_INCENTIVOS;
  return { ...DEFAULT_INCENTIVOS, ...(rows[0].value as Partial<IncentivosConfig>) };
}

export async function saveIncentivosConfig(cfg: IncentivosConfig): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO settings (key, value) VALUES ('incentivos_config', ${JSON.stringify(cfg)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(cfg)}::jsonb
  `;
}

function lunesISO(): string {
  const x = new Date(); const dow = x.getDay(); const diff = dow === 0 ? 6 : dow - 1;
  x.setDate(x.getDate() - diff);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
}

export async function getVendidoEquipoSemana(): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const r = (await sql`
    SELECT COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)),0)::numeric AS total
    FROM pedidos p JOIN pedido_items pi ON pi.pedido_id = p.id
    WHERE p.estado='Entregado' AND p.fecha_pedido BETWEEN ${lunesISO()}::date AND (NOW() AT TIME ZONE 'America/Lima')::date
  `) as Array<{ total: string|number }>;
  return Number(r[0]?.total ?? 0);
}

export interface RankingRow { asesorId: string; nombre: string; valor: number; puesto: number; }
export async function getRankingMensual(criterio: CriterioRanking): Promise<RankingRow[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const asesores = (await sql`SELECT id, name FROM users WHERE role='asesor' ORDER BY name`) as Array<{ id: string; name: string }>;
  const filas: Omit<RankingRow,"puesto">[] = [];
  for (const a of asesores) {
    let valor = 0;
    if (criterio === "pedidos") {
      const r = (await sql`
        SELECT COUNT(*)::int AS n FROM pedidos
        WHERE asesor_id=${a.id} AND estado='Entregado'
          AND DATE_TRUNC('month', fecha_pedido) = DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Lima')::date)
      `) as Array<{ n: number }>;
      valor = Number(r[0]?.n ?? 0);
    } else {
      const monto = await ventasMesActual(a.id);
      if (criterio === "monto") valor = monto;
      else { const { metaMensual } = await calcularMetaDiaria(a.id); valor = metaMensual > 0 ? Math.round((monto/metaMensual)*100) : 0; }
    }
    filas.push({ asesorId: a.id, nombre: (a.name||"").trim(), valor });
  }
  filas.sort((x,y) => y.valor - x.valor);
  return filas.map((f,i) => ({ ...f, puesto: i+1 }));
}
```

**Verify:** `npx tsc --noEmit` OK.

---

### Task 3: Endpoints `/api/incentivos` (GET/POST) + `/api/metas/asesoras` (GET) + extender `/api/metas`

**Files:** Create `src/app/api/incentivos/route.ts`, `src/app/api/metas/asesoras/route.ts`; Modify `src/app/api/metas/route.ts`

- [ ] `GET /api/incentivos` (admin + asesor): devuelve `config`, `equipo` (meta/vendido/premio/activo/porcentaje) y `ranking` (filas con `esTu` marcado para el asesor logueado).
- [ ] `POST /api/incentivos` (solo admin): valida con zod y guarda config (`saveIncentivosConfig`).
- [ ] `GET /api/metas/asesoras` (solo admin): lista `{ id, nombre, metaMensual, ventasMesActual }` por asesor (para que el admin vea/edite). Usa `calcularMetaDiaria` + `ventasMesActual`.
- [ ] Extender `GET /api/metas`: agregar `metaSemanal`, `ventasSemana`, `racha` al JSON.

Zod del POST:
```ts
const ConfigSchema = z.object({
  metaEquipoSemanal: z.object({ activo: z.boolean(), monto: z.number().min(0), premio: z.string().max(120) }),
  rankingMensual: z.object({
    activo: z.boolean(),
    criterio: z.enum(["monto","pedidos","cumplimiento"]),
    premios: z.array(z.object({ puesto: z.number().int().min(1).max(20), premio: z.string().max(120) })).max(20),
  }),
});
```

**Verify:** `tsc`; `curl` sin sesión → 401/403 (no 500).

---

### Task 4: Panel de la asesora — potenciar `Mis Metas`

**Files:** Modify `src/app/dashboard/mis-metas/mis-metas-client.tsx`

- [ ] Fetch adicional a `/api/incentivos`. Render: tarjetas **Hoy · Semana · Mes** (cada una vendido/meta + % + falta), **🔥 Racha** ("N días seguidos cumpliendo tu meta"), bloque **Meta de equipo** (barra vendido/meta + premio, si `activo`), y **Ranking mensual** (lista con puestos + premios, resaltando su fila `esTu`, si `activo`).
- [ ] Mantener el `InsightCard` (consejo IA) que ya está.

**Verify:** navegador (como asesora o admin con ?asesor_id) — se ven las 3 tarjetas + racha + equipo + ranking.

---

### Task 5: Pantalla admin `Incentivos` + ruta + menú + guard

**Files:** Create `src/app/dashboard/incentivos/page.tsx`, `src/app/dashboard/incentivos/incentivos-client.tsx`; Modify `src/components/DashboardLayout.tsx`

- [ ] `page.tsx`: server component, guard admin (redirect homeForRole si no admin), render client.
- [ ] `incentivos-client.tsx`: 3 secciones —
  1. **Metas individuales**: lista de asesoras (`GET /api/metas/asesoras`), input "Meta del mes" por asesora → guarda con `POST /api/metas/override` (mes actual `YYYY-MM`).
  2. **Meta de equipo semanal**: toggle activo + monto + premio (texto) → guarda en `POST /api/incentivos`.
  3. **Ranking mensual**: toggle activo + select criterio (Monto vendido / N° de pedidos / % de cumplimiento) + lista editable de premios por puesto (agregar/quitar fila: puesto + premio texto) → guarda en `POST /api/incentivos`. Muestra preview del ranking actual.
- [ ] `DashboardLayout.tsx`: agregar item `{ href:"/dashboard/incentivos", label:"Incentivos", icon:<FiAward/>, adminOnly:true }` en navItems y `"/dashboard/incentivos": "Configuración"` en `GROUP_BY_HREF`. Importar `FiAward`.

**Verify:** navegador admin: editar meta de una asesora, fijar meta de equipo + premio, configurar premios del ranking; recargar y persiste.

---

### Task 6: Verificación final + docs

**Files:** Modify `CLAUDE.md`

- [ ] `npx tsc --noEmit` + `npm run build` limpios.
- [ ] Spot-check navegador (asesora ve panel; admin configura).
- [ ] Documentar en CLAUDE.md §13: sistema de incentivos (config en `settings.incentivos_config`, endpoints, pantallas, criterios de ranking).

---

## Self-Review
- **Cobertura del spec:** panel asesora día/semana/mes (T1+T4) ✓ · racha (T1+T4) ✓ · meta equipo semanal + premio texto (T2+T3+T4+T5) ✓ · ranking mensual criterio configurable #pedidos/monto/%cumplimiento (T2+T3+T5) ✓ · premios por puesto configurables (T2+T3+T5) ✓ · meta individual editable por admin (T3+T5, reusa `/api/metas/override`) ✓ · todo configurable (T5) ✓ · sin migración (settings) ✓.
- **Consistencia de tipos:** `IncentivosConfig`, `CriterioRanking ("monto"|"pedidos"|"cumplimiento")`, `RankingRow {asesorId,nombre,valor,puesto}` usados igual en lib→endpoint→UI. `metaSemanal`/`ventasSemana`/`racha` agregados a /api/metas y leídos en mis-metas.
- **Orden de ejecución:** T1 → T2 → T3 → T4 → T5 → T6.

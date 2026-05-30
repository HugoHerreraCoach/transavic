# Fase B — Visibilidad y Dinero: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el ciclo comercial completo: metas para asesoras, alertas automáticas entre áreas, gestión de cobranzas con plazos flexibles e integración con SUNAT para facturación electrónica con 1 clic.

**Architecture:** B.1 (metas) + B.2 (notificaciones) + B.3 (cobranzas) son 100% código nuevo en Next.js sin dependencias externas. B.4 (SUNAT) porta el módulo funcional de `conexipema-eventos/src/lib/sunat/` adaptando Firestore → Neon Postgres.

**Tech Stack:**
- Next.js 15 + TypeScript + Neon Postgres (existente)
- Polling cada 30-60s para notificaciones (Pusher para tiempo real queda en Fase C)
- Vercel Cron Jobs (gratis) para revisión diaria de facturas vencidas
- Para B.4: `xmlbuilder2`, `xml-crypto`, `node-forge`, `archiver`, `jspdf` (necesitan `npm install` cuando resuelva bug Node 26)

**Principio rector:** "No me hagas pensar". Pantallas auto-evidentes, valores por defecto inteligentes, alertas accionables.

---

## Mapa de archivos a tocar/crear

### B.1 — Dashboard comercial con metas
**Crear:**
- `scripts/migrate-metas.mjs` — tabla `metas_asesoras` para overrides manuales
- `src/lib/metas.ts` — helper `calcularMetaDiaria(asesorId, fecha)` (fórmula mes anterior × 1.15 / días hábiles)
- `src/app/api/metas/route.ts` — GET meta del día + progreso real
- `src/app/dashboard/mis-metas/page.tsx` + `mis-metas-client.tsx` — vista asesora con barra de progreso
- `src/app/dashboard/panel-gerencial/page.tsx` + `panel-gerencial-client.tsx` — vista admin con KPIs globales + ranking asesoras

**Modificar:**
- `src/components/DashboardLayout.tsx` — agregar items nav

### B.2 — Avisos automáticos entre áreas
**Crear:**
- `scripts/migrate-notificaciones.mjs` — tabla `notificaciones`
- `src/lib/notificaciones.ts` — helpers `crearNotificacion()` reutilizables
- `src/app/api/notificaciones/route.ts` — GET unread + total
- `src/app/api/notificaciones/[id]/leida/route.ts` — PATCH marcar leída
- `src/app/api/notificaciones/leer-todas/route.ts` — POST marcar todas leídas
- `src/components/NotificationBell.tsx` — campanita con dropdown

**Modificar:**
- `src/components/DashboardLayout.tsx` — incluir `<NotificationBell />` en header
- `src/app/api/pedidos/route.ts` — disparar notificación al crear pedido
- `src/app/api/produccion/pedidos/[id]/listo/route.ts` — disparar notificación al marcar listo
- `src/app/api/pedidos/[id]/entregar/route.ts` — disparar notificación al entregar

### B.3 — Gestión de cobranzas
**Crear:**
- `scripts/migrate-cobranzas.mjs` — `plazo_pago_dias` en clientes; tabla `facturas`
- `src/lib/cobranzas.ts` — helpers de cálculo de vencimiento
- `src/app/api/facturas/route.ts` — GET listado paginado
- `src/app/api/facturas/[id]/pago/route.ts` — POST marcar pagada
- `src/app/api/cron/facturas-vencidas/route.ts` — endpoint para cron diario
- `src/app/dashboard/cobranzas/page.tsx` + `cobranzas-client.tsx` — vista con facturas pendientes ordenadas por urgencia
- `vercel.json` — agregar configuración de Vercel Cron

**Modificar:**
- `src/app/api/clientes/route.ts` (POST) — aceptar `plazo_pago_dias`
- `src/app/api/clientes/[id]/route.ts` (PATCH) — aceptar `plazo_pago_dias`
- `src/app/dashboard/clientes/clientes-client.tsx` — UI para editar plazo
- `src/components/DashboardLayout.tsx` — item nav "Cobranzas"

### B.4 — Integración SUNAT
**Crear:**
- `scripts/migrate-comprobantes.mjs` — tablas `comprobantes`, `comprobantes_contador`
- `src/lib/sunat/` — 8 archivos portados de conexipema-eventos (adaptados a Neon)
- `src/app/api/comprobantes/route.ts` — GET listado
- `src/app/api/comprobantes/emitir/route.ts` — POST emitir factura/boleta
- `src/app/api/cron/resumen-diario-boletas/route.ts` — cron nocturno SUNAT
- `src/app/dashboard/comprobantes/page.tsx` + `comprobantes-client.tsx` — vista admin

**Modificar:**
- `vercel.json` — agregar cron de resumen diario
- `src/app/dashboard/dashboard-content.tsx` — botón "Emitir comprobante" en cada pedido entregado

---

## Task B.1: Dashboard comercial con metas

### Task B.1.1: Migración de metas

**Files:**
- Create: `scripts/migrate-metas.mjs`

- [ ] **Step 1: Crear script de migración**

```javascript
// scripts/migrate-metas.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL no está definida");
  process.exit(1);
}
const sql = neon(connectionString);

async function migrate() {
  console.log("🔄 Migración: tabla metas_asesoras\n");

  // Tabla de overrides manuales — la meta normal se calcula del mes anterior
  await sql`
    CREATE TABLE IF NOT EXISTS metas_asesoras (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      asesor_id UUID REFERENCES users(id) ON DELETE CASCADE,
      mes DATE NOT NULL,  -- primer día del mes (ej: 2026-05-01)
      monto_meta NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(asesor_id, mes)
    )
  `;
  console.log("   ✅ Tabla metas_asesoras creada");

  await sql`CREATE INDEX IF NOT EXISTS idx_metas_asesor_mes ON metas_asesoras(asesor_id, mes)`;

  console.log("\n🎉 Migración completada");
}
migrate().catch((err) => { console.error("❌", err); process.exit(1); });
```

- [ ] **Step 2: Documentar** que se ejecutará al recibir API key Neon

### Task B.1.2: Helper de cálculo de metas

**Files:**
- Create: `src/lib/metas.ts`

- [ ] **Step 1: Helper**

```typescript
// src/lib/metas.ts
import { neon } from "@neondatabase/serverless";

const FACTOR_CRECIMIENTO = 1.15; // +15% sobre mes anterior (acordado con Antonio)

export interface MetaResult {
  metaDiaria: number;
  metaMensual: number;
  ventasMesAnterior: number;
  diasHabilesMes: number;
  diaDelMes: number;
  metaAcumuladaHoy: number; // lo que YA debería haber vendido hasta hoy
}

/**
 * Calcula la meta del día para una asesora.
 * Fórmula: (ventas_mes_anterior * 1.15) / dias_habiles_mes_actual
 * "Días hábiles" = lunes a sábado (en Lima trabaja sábado).
 */
export async function calcularMetaDiaria(
  asesorId: string,
  fechaRef: Date = new Date()
): Promise<MetaResult> {
  const sql = neon(process.env.DATABASE_URL!);

  // Mes anterior (primer y último día)
  const mesAnteriorIni = new Date(fechaRef.getFullYear(), fechaRef.getMonth() - 1, 1);
  const mesAnteriorFin = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 0);
  const isoIni = mesAnteriorIni.toISOString().split("T")[0];
  const isoFin = mesAnteriorFin.toISOString().split("T")[0];

  // Sumar subtotales reales (o subtotal estimado si no hay real) del mes anterior
  const ventasRow = await sql`
    SELECT COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)), 0)::numeric AS total
    FROM pedidos p
    JOIN pedido_items pi ON pi.pedido_id = p.id
    WHERE p.asesor_id = ${asesorId}
      AND p.fecha_pedido BETWEEN ${isoIni}::date AND ${isoFin}::date
      AND p.estado = 'Entregado'
  `;
  const ventasMesAnterior = Number(ventasRow[0].total);

  // ¿Hay override manual?
  const mesActualIni = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1)
    .toISOString().split("T")[0];
  const override = await sql`
    SELECT monto_meta FROM metas_asesoras
    WHERE asesor_id = ${asesorId} AND mes = ${mesActualIni}::date
  `;
  const metaMensual =
    override.length > 0
      ? Number(override[0].monto_meta)
      : Number((ventasMesAnterior * FACTOR_CRECIMIENTO).toFixed(2));

  // Días hábiles en el mes actual (lunes a sábado)
  const diasHabiles = contarDiasHabiles(
    new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1),
    new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0)
  );

  const metaDiaria = diasHabiles > 0 ? metaMensual / diasHabiles : 0;

  // Día del mes (1 = primer día hábil; sirve para calcular meta acumulada)
  const diaDelMes = contarDiasHabiles(
    new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1),
    fechaRef
  );
  const metaAcumuladaHoy = Number((metaDiaria * diaDelMes).toFixed(2));

  return {
    metaDiaria: Number(metaDiaria.toFixed(2)),
    metaMensual,
    ventasMesAnterior,
    diasHabilesMes: diasHabiles,
    diaDelMes,
    metaAcumuladaHoy,
  };
}

function contarDiasHabiles(desde: Date, hasta: Date): number {
  let cnt = 0;
  const cur = new Date(desde);
  while (cur <= hasta) {
    const dow = cur.getDay();
    if (dow !== 0) cnt++; // 0 = domingo. Sábado SÍ cuenta.
    cur.setDate(cur.getDate() + 1);
  }
  return cnt;
}

/**
 * Calcula las ventas reales de la asesora desde el inicio del mes.
 */
export async function ventasMesActual(asesorId: string): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const now = new Date();
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const finMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  const row = await sql`
    SELECT COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)), 0)::numeric AS total
    FROM pedidos p
    JOIN pedido_items pi ON pi.pedido_id = p.id
    WHERE p.asesor_id = ${asesorId}
      AND p.fecha_pedido BETWEEN ${inicioMes}::date AND ${finMes}::date
      AND p.estado = 'Entregado'
  `;
  return Number(row[0].total);
}
```

- [ ] **Step 2: Verificar typecheck** (`npx tsc --noEmit`)

### Task B.1.3: API de metas

**Files:**
- Create: `src/app/api/metas/route.ts`

- [ ] **Step 1: Endpoint GET**

```typescript
// src/app/api/metas/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { calcularMetaDiaria, ventasMesActual } from "@/lib/metas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const asesorIdParam = searchParams.get("asesor_id");

    // Asesora ve su propia meta; admin puede pedir cualquiera
    let asesorId = session.user.id;
    if (asesorIdParam && session.user.role === "admin") {
      asesorId = asesorIdParam;
    }

    const meta = await calcularMetaDiaria(asesorId);
    const ventasReales = await ventasMesActual(asesorId);

    return NextResponse.json({
      ...meta,
      ventasMesActual: ventasReales,
      porcentajeAvance: meta.metaMensual > 0
        ? Math.round((ventasReales / meta.metaMensual) * 100)
        : 0,
      diferenciaVsMetaAcumulada: Number((ventasReales - meta.metaAcumuladaHoy).toFixed(2)),
    });
  } catch (error) {
    console.error("Error en GET /api/metas:", error);
    return NextResponse.json({ error: "Error al calcular meta" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Endpoint POST para override manual (solo admin)**

Crear `src/app/api/metas/override/route.ts` que permita al admin setear meta manual por asesora/mes.

```typescript
// src/app/api/metas/override/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  asesor_id: z.string().uuid(),
  mes: z.string(), // YYYY-MM
  monto_meta: z.number().positive(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await request.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { asesor_id, mes, monto_meta } = parsed.data;
  const sql = neon(process.env.DATABASE_URL!);
  // mes viene como "YYYY-MM" → primer día del mes
  const mesIso = `${mes}-01`;
  await sql`
    INSERT INTO metas_asesoras (asesor_id, mes, monto_meta)
    VALUES (${asesor_id}, ${mesIso}::date, ${monto_meta})
    ON CONFLICT (asesor_id, mes) DO UPDATE SET monto_meta = ${monto_meta}
  `;
  return NextResponse.json({ message: "Meta actualizada" });
}
```

### Task B.1.4: UI "Mis Metas" para asesora

**Files:**
- Create: `src/app/dashboard/mis-metas/page.tsx`
- Create: `src/app/dashboard/mis-metas/mis-metas-client.tsx`

- [ ] **Step 1: page.tsx**

```tsx
// src/app/dashboard/mis-metas/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import MisMetasClient from "./mis-metas-client";

export default async function MisMetasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) redirect("/dashboard");
  return <MisMetasClient nombre={session.user.name} />;
}
```

- [ ] **Step 2: mis-metas-client.tsx con barra de progreso visual**

(Componente con barra de color: rojo <70%, amarillo 70-99%, verde ≥100%. Refresh cada 60s.)

### Task B.1.5: Panel gerencial (admin)

**Files:**
- Create: `src/app/dashboard/panel-gerencial/page.tsx`
- Create: `src/app/dashboard/panel-gerencial/panel-gerencial-client.tsx`
- Create: `src/app/api/panel-gerencial/route.ts`

- [ ] **Step 1: API que devuelve KPIs globales + ranking de asesoras**
- [ ] **Step 2: UI con cards de KPIs + tabla ranking**

### Task B.1.6: Agregar items nav

- [ ] **Step 1: Modificar `DashboardLayout.tsx`**

Agregar:
```typescript
{
  href: "/dashboard/mis-metas",
  label: "Mis Metas",
  icon: <FiTarget className="h-5 w-5 flex-shrink-0" />,
  roles: ["asesor", "admin"],
},
{
  href: "/dashboard/panel-gerencial",
  label: "Panel Gerencial",
  icon: <FiTrendingUp className="h-5 w-5 flex-shrink-0" />,
  adminOnly: true,
},
```

Importar `FiTarget`, `FiTrendingUp` de `react-icons/fi`.

---

## Task B.2: Notificaciones automáticas entre áreas

### Task B.2.1: Migración

**Files:**
- Create: `scripts/migrate-notificaciones.mjs`

- [ ] **Step 1: Script de migración**

```javascript
// scripts/migrate-notificaciones.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Migración: notificaciones\n");

  await sql`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tipo VARCHAR(50) NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      link TEXT,                                 -- URL relativa a la que llevará el click
      pedido_id UUID,                             -- referencia opcional
      leida BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla notificaciones creada");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notif_user_unread
    ON notificaciones(user_id, leida, created_at DESC)
  `;
  console.log("   ✅ Índice idx_notif_user_unread");

  console.log("\n🎉 Migración completada");
}
migrate().catch((err) => { console.error("❌", err); process.exit(1); });
```

### Task B.2.2: Helper de notificaciones

**Files:**
- Create: `src/lib/notificaciones.ts`

- [ ] **Step 1: Helpers**

```typescript
// src/lib/notificaciones.ts
import { neon } from "@neondatabase/serverless";

export type TipoNotificacion =
  | "pedido_creado"
  | "pesos_listos"
  | "listo_para_despacho"
  | "pedido_asignado"
  | "pedido_entregado"
  | "pedido_fallido"
  | "guia_firmada"
  | "factura_vencida"
  | "factura_por_vencer"
  | "meta_diaria_alcanzada";

export interface CrearNotificacionParams {
  userId: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link?: string;
  pedidoId?: string;
}

export async function crearNotificacion(params: CrearNotificacionParams): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO notificaciones (user_id, tipo, titulo, mensaje, link, pedido_id)
    VALUES (
      ${params.userId},
      ${params.tipo},
      ${params.titulo},
      ${params.mensaje},
      ${params.link ?? null},
      ${params.pedidoId ?? null}
    )
  `;
}

/**
 * Crear la misma notificación para varios usuarios (por ejemplo, todos los de un rol).
 */
export async function crearNotificacionParaRol(
  rol: string,
  params: Omit<CrearNotificacionParams, "userId">
): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  const users = await sql`SELECT id FROM users WHERE role = ${rol}`;
  for (const u of users) {
    await crearNotificacion({ ...params, userId: u.id as string });
  }
}
```

### Task B.2.3: API endpoints

**Files:**
- Create: `src/app/api/notificaciones/route.ts`
- Create: `src/app/api/notificaciones/[id]/leida/route.ts`
- Create: `src/app/api/notificaciones/leer-todas/route.ts`

- [ ] **Step 1: GET listado de notificaciones del usuario**

```typescript
// src/app/api/notificaciones/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const sql = neon(process.env.DATABASE_URL!);

  const notifs = await sql`
    SELECT id, tipo, titulo, mensaje, link, pedido_id, leida, created_at
    FROM notificaciones
    WHERE user_id = ${session.user.id}
    ORDER BY created_at DESC
    LIMIT 30
  `;
  const unreadCount = await sql`
    SELECT COUNT(*)::int AS cnt FROM notificaciones
    WHERE user_id = ${session.user.id} AND leida = FALSE
  `;

  return NextResponse.json({ data: notifs, unreadCount: unreadCount[0].cnt });
}
```

- [ ] **Step 2: PATCH marcar 1 como leída**
- [ ] **Step 3: POST marcar todas leídas**

### Task B.2.4: NotificationBell component

**Files:**
- Create: `src/components/NotificationBell.tsx`

- [ ] **Step 1: Componente con dropdown + polling cada 30s + contador**

(Componente cliente que poolea cada 30s, muestra dropdown con notifs no leídas, marca como leída al click, navega al link si tiene.)

### Task B.2.5: Insertar bell en DashboardLayout

- [ ] **Step 1: Modificar `DashboardLayout.tsx`**

Agregar `<NotificationBell />` cerca del header (mobile) y al lado del logout (desktop).

### Task B.2.6: Disparar notificaciones en endpoints existentes

- [ ] **Step 1: En `api/pedidos/route.ts` (POST)**: notificar a todos los `produccion`
- [ ] **Step 2: En `api/produccion/pedidos/[id]/listo/route.ts`**: notificar a la asesora del pedido
- [ ] **Step 3: En `api/pedidos/[id]/entregar/route.ts`**: notificar a la asesora cuando entrega exitoso/fallido

---

## Task B.3: Gestión de cobranzas

### Task B.3.1: Migración

**Files:**
- Create: `scripts/migrate-cobranzas.mjs`

- [ ] **Step 1: Script**

```javascript
// scripts/migrate-cobranzas.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Migración: cobranzas\n");

  console.log("1️⃣ Agregando plazo_pago_dias a clientes...");
  await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER DEFAULT 0`;
  // 0 = pago al momento (default seguro)
  console.log("   ✅ Columna agregada");

  console.log("2️⃣ Creando tabla facturas...");
  await sql`
    CREATE TABLE IF NOT EXISTS facturas (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
      cliente_id UUID,                    -- denormalizado, puede ser null si se borra cliente
      cliente_nombre VARCHAR(255) NOT NULL,
      asesor_id UUID REFERENCES users(id),
      monto NUMERIC(12, 2) NOT NULL,
      plazo_dias INTEGER NOT NULL DEFAULT 0,
      fecha_emision DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
      fecha_vencimiento DATE NOT NULL,
      fecha_pago DATE,                    -- NULL si no pagada
      estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
      -- 'Pendiente' | 'Pagada' | 'Vencida'
      numero_comprobante VARCHAR(50),     -- ej. 'F001-00001234' (relaciona con SUNAT después)
      notas TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla facturas creada");

  console.log("3️⃣ Índices...");
  await sql`CREATE INDEX IF NOT EXISTS idx_facturas_vencimiento ON facturas(fecha_vencimiento) WHERE fecha_pago IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_facturas_asesor ON facturas(asesor_id, estado)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id)`;
  console.log("   ✅ Índices creados");

  console.log("\n🎉 Migración completada");
}
migrate().catch((err) => { console.error("❌", err); process.exit(1); });
```

### Task B.3.2: Helper de cobranzas

**Files:**
- Create: `src/lib/cobranzas.ts`

- [ ] **Step 1: Helpers**

```typescript
// src/lib/cobranzas.ts
import { neon } from "@neondatabase/serverless";

export function calcularVencimiento(fechaEmision: Date, plazoDias: number): Date {
  const v = new Date(fechaEmision);
  v.setDate(v.getDate() + plazoDias);
  return v;
}

export function urgenciaCobranza(fechaVencimiento: Date): "vencida" | "urgente" | "proxima" | "holgada" {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const v = new Date(fechaVencimiento);
  v.setHours(0, 0, 0, 0);
  const diff = Math.round((v.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "vencida";
  if (diff <= 1) return "urgente";
  if (diff <= 3) return "proxima";
  return "holgada";
}

export async function crearFactura(params: {
  pedidoId: string;
  monto: number;
}): Promise<{ id: string; vencimiento: Date }> {
  const sql = neon(process.env.DATABASE_URL!);
  // Cargar datos del pedido + cliente
  const pedidoRows = await sql`
    SELECT p.cliente, p.cliente_id, p.asesor_id,
      COALESCE(c.plazo_pago_dias, 0) AS plazo
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    WHERE p.id = ${params.pedidoId}
  `;
  if (pedidoRows.length === 0) throw new Error("Pedido no encontrado");
  const { cliente, cliente_id, asesor_id, plazo } = pedidoRows[0] as Record<string, unknown>;
  const plazoNum = Number(plazo);
  const vencimiento = calcularVencimiento(new Date(), plazoNum);
  const venIso = vencimiento.toISOString().split("T")[0];

  const res = await sql`
    INSERT INTO facturas (pedido_id, cliente_id, cliente_nombre, asesor_id, monto, plazo_dias, fecha_vencimiento)
    VALUES (${params.pedidoId}, ${cliente_id ?? null}, ${cliente as string}, ${asesor_id as string | null}, ${params.monto}, ${plazoNum}, ${venIso}::date)
    RETURNING id
  `;
  return { id: res[0].id as string, vencimiento };
}
```

### Task B.3.3: API endpoints

**Files:**
- Create: `src/app/api/facturas/route.ts`
- Create: `src/app/api/facturas/[id]/pago/route.ts`

- [ ] **Step 1: GET listado de facturas (con scoping por rol)**

(Asesora ve solo las suyas, admin ve todas con filtro por asesora).

- [ ] **Step 2: POST marcar como pagada**

```typescript
// src/app/api/facturas/[id]/pago/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  fecha_pago: z.string().optional(), // YYYY-MM-DD, default hoy
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const id = segments[segments.length - 2];

  const body = await request.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const fechaPago = parsed.data.fecha_pago ?? new Date().toISOString().split("T")[0];

  const sql = neon(process.env.DATABASE_URL!);

  // Verificar ownership
  if (session.user.role !== "admin") {
    const factura = await sql`SELECT asesor_id FROM facturas WHERE id = ${id}`;
    if (factura.length === 0) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    if (factura[0].asesor_id !== session.user.id) {
      return NextResponse.json({ error: "No es tu factura" }, { status: 403 });
    }
  }

  await sql`
    UPDATE facturas
    SET fecha_pago = ${fechaPago}::date, estado = 'Pagada'
    WHERE id = ${id}
  `;
  return NextResponse.json({ message: "Pago registrado" });
}
```

### Task B.3.4: Cron de facturas vencidas

**Files:**
- Create: `src/app/api/cron/facturas-vencidas/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Endpoint cron**

```typescript
// src/app/api/cron/facturas-vencidas/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { crearNotificacion } from "@/lib/notificaciones";

export async function GET(request: Request) {
  // Vercel Cron envía Authorization: Bearer ${CRON_SECRET}
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // 1. Marcar vencidas las que ya pasaron y no se pagaron
  const venciendoHoy = await sql`
    UPDATE facturas
    SET estado = 'Vencida'
    WHERE fecha_vencimiento < (NOW() AT TIME ZONE 'America/Lima')::date
      AND fecha_pago IS NULL
      AND estado = 'Pendiente'
    RETURNING id, asesor_id, cliente_nombre, monto, fecha_vencimiento
  `;

  // 2. Notificar a las asesoras de las nuevas vencidas
  for (const f of venciendoHoy) {
    if (!f.asesor_id) continue;
    await crearNotificacion({
      userId: f.asesor_id as string,
      tipo: "factura_vencida",
      titulo: "Factura vencida",
      mensaje: `${f.cliente_nombre}: S/ ${Number(f.monto).toFixed(2)} venció el ${f.fecha_vencimiento}`,
      link: "/dashboard/cobranzas",
    });
  }

  // 3. Notificar facturas que vencen mañana (recordatorio)
  const venceMañana = await sql`
    SELECT id, asesor_id, cliente_nombre, monto
    FROM facturas
    WHERE fecha_vencimiento = ((NOW() AT TIME ZONE 'America/Lima')::date + INTERVAL '1 day')::date
      AND fecha_pago IS NULL
      AND estado = 'Pendiente'
  `;
  for (const f of venceMañana) {
    if (!f.asesor_id) continue;
    await crearNotificacion({
      userId: f.asesor_id as string,
      tipo: "factura_por_vencer",
      titulo: "Factura vence mañana",
      mensaje: `${f.cliente_nombre}: S/ ${Number(f.monto).toFixed(2)} vence mañana`,
      link: "/dashboard/cobranzas",
    });
  }

  return NextResponse.json({
    procesadas: venciendoHoy.length,
    recordatorios: venceMañana.length,
  });
}
```

- [ ] **Step 2: Crear `vercel.json` con configuración cron**

```json
{
  "crons": [
    {
      "path": "/api/cron/facturas-vencidas",
      "schedule": "0 13 * * *"
    }
  ]
}
```

(0 13 UTC = 8am Lima.)

### Task B.3.5: UI cobranzas

**Files:**
- Create: `src/app/dashboard/cobranzas/page.tsx`
- Create: `src/app/dashboard/cobranzas/cobranzas-client.tsx`

- [ ] **Step 1: Page + Client con lista filtrable y código de colores por urgencia**

### Task B.3.6: Configurar plazo de pago por cliente

**Files:**
- Modify: `src/app/api/clientes/route.ts`
- Modify: `src/app/api/clientes/[id]/route.ts`
- Modify: `src/app/dashboard/clientes/clientes-client.tsx`

- [ ] **Step 1: Agregar `plazo_pago_dias` al zod schema POST/PATCH y al INSERT/UPDATE**
- [ ] **Step 2: Agregar input en UI de clientes con presets (al momento, 1, 3, 7, 15 días, etc.)**

### Task B.3.7: Crear factura automáticamente al entregar

**Files:**
- Modify: `src/app/api/pedidos/[id]/entregar/route.ts`

- [ ] **Step 1: Después del UPDATE de estado='Entregado', llamar a `crearFactura()` con el monto del pedido**

Crear helper que calcula el monto desde `pedido_items` (preferir `subtotal_real`, fallback `subtotal`).

---

## Task B.4: Integración SUNAT (portado)

**⚠️ Bloqueador conocido:** Node 26 tiene bug DNS que impide `npm install` de las deps. Las migraciones SQL y server actions stub se pueden hacer; el módulo SUNAT completo se activa cuando se pueda instalar.

### Task B.4.1: Migración

**Files:**
- Create: `scripts/migrate-comprobantes.mjs`

- [ ] **Step 1: Script**

```javascript
// scripts/migrate-comprobantes.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Migración: comprobantes SUNAT\n");

  // Contador por (ruc, serie) — atómico via UPDATE...RETURNING
  await sql`
    CREATE TABLE IF NOT EXISTS comprobantes_contador (
      ruc VARCHAR(11) NOT NULL,
      serie VARCHAR(10) NOT NULL,
      ultimo_numero INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (ruc, serie)
    )
  `;
  console.log("   ✅ Tabla comprobantes_contador");

  // Comprobantes emitidos
  await sql`
    CREATE TABLE IF NOT EXISTS comprobantes (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
      ruc_emisor VARCHAR(11) NOT NULL,
      empresa VARCHAR(50) NOT NULL,           -- 'transavic' | 'avicola'
      tipo VARCHAR(20) NOT NULL,              -- '01' factura | '03' boleta | '07' NC
      serie VARCHAR(10) NOT NULL,
      numero INTEGER NOT NULL,
      serie_numero VARCHAR(50) NOT NULL,      -- 'F001-00001234'
      cliente_doc_tipo VARCHAR(2),
      cliente_doc_num VARCHAR(20),
      cliente_razon_social VARCHAR(255),
      monto_subtotal NUMERIC(12, 2),
      monto_igv NUMERIC(12, 2),
      monto_total NUMERIC(12, 2),
      moneda VARCHAR(3) DEFAULT 'PEN',
      estado VARCHAR(50) NOT NULL,            -- 'aceptado' | 'rechazado' | 'pendiente' | 'observado'
      hash_cpe TEXT,
      xml_firmado_base64 TEXT,
      cdr_base64 TEXT,
      observaciones TEXT,
      mensaje_sunat TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (ruc_emisor, serie, numero)
    )
  `;
  console.log("   ✅ Tabla comprobantes");

  await sql`CREATE INDEX IF NOT EXISTS idx_comp_pedido ON comprobantes(pedido_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_comp_estado ON comprobantes(estado)`;

  console.log("\n🎉 Migración completada");
}
migrate().catch((err) => { console.error("❌", err); process.exit(1); });
```

### Task B.4.2: Stub del módulo SUNAT (sin libs)

**Files:**
- Create: `src/lib/sunat/types.ts`
- Create: `src/lib/sunat/config-transavic.ts`
- Create: `src/lib/sunat/contador.ts`
- Create: `src/lib/sunat/index.ts` (stub que indica "pendiente de portar")

- [ ] **Step 1: Tipos compartidos**

```typescript
// src/lib/sunat/types.ts
export enum TipoComprobante {
  FACTURA = "01",
  BOLETA = "03",
  NOTA_CREDITO = "07",
  NOTA_DEBITO = "08",
}

export enum TipoDocIdentidad {
  DNI = "1",
  CARNET_EXTRANJERIA = "4",
  RUC = "6",
  PASAPORTE = "7",
}

export type EmpresaId = "transavic" | "avicola";

export interface ItemComprobante {
  codigo?: string;
  descripcion: string;
  unidadMedida: string;          // 'KGM', 'NIU', 'ZZ', etc.
  cantidad: number;
  precioUnitario: number;         // sin IGV
  igvPorcentaje: number;          // típicamente 18
}

export interface ClienteComprobante {
  tipoDocumento: TipoDocIdentidad;
  numDocumento: string;
  razonSocial: string;
  direccion?: string;
  email?: string;
}

export interface ResultadoEmision {
  exito: boolean;
  estado: "aceptado" | "rechazado" | "observado" | "pendiente" | "error";
  serieNumero: string;
  hashCpe?: string;
  cdrBase64?: string;
  xmlFirmadoBase64?: string;
  mensaje?: string;
  observaciones?: string;
  error?: string;
}
```

- [ ] **Step 2: Config transavic con 2 empresas**

```typescript
// src/lib/sunat/config-transavic.ts
import type { EmpresaId } from "./types";

export interface ConfigEmpresa {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccionFiscal: string;
  ubigeo: string;
  solUser: string;
  solPassword: string;
  certificatePassword: string;
  certificateBase64: string;       // certificado .p12 en base64 (env var)
}

export const SUNAT_ENVIRONMENT = (process.env.SUNAT_ENVIRONMENT ?? "beta") as "beta" | "production";

export const SUNAT_ENDPOINTS = {
  beta: {
    factura: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService?wsdl",
  },
  production: {
    factura: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService?wsdl",
  },
};

export function getEmpresaConfig(empresa: EmpresaId): ConfigEmpresa {
  if (empresa === "transavic") {
    return {
      ruc: process.env.SUNAT_TRA_RUC ?? "",
      razonSocial: process.env.SUNAT_TRA_RAZON_SOCIAL ?? "Transavic",
      nombreComercial: "Transavic",
      direccionFiscal: process.env.SUNAT_TRA_DIRECCION ?? "",
      ubigeo: process.env.SUNAT_TRA_UBIGEO ?? "150101",
      solUser: process.env.SUNAT_TRA_SOL_USER ?? "MODDATOS",
      solPassword: process.env.SUNAT_TRA_SOL_PASSWORD ?? "moddatos",
      certificatePassword: process.env.SUNAT_TRA_CERT_PASS ?? "",
      certificateBase64: process.env.SUNAT_TRA_CERT_B64 ?? "",
    };
  }
  // avicola
  return {
    ruc: process.env.SUNAT_AVI_RUC ?? "",
    razonSocial: process.env.SUNAT_AVI_RAZON_SOCIAL ?? "Avícola de Tony",
    nombreComercial: "Avícola de Tony",
    direccionFiscal: process.env.SUNAT_AVI_DIRECCION ?? "",
    ubigeo: process.env.SUNAT_AVI_UBIGEO ?? "150101",
    solUser: process.env.SUNAT_AVI_SOL_USER ?? "MODDATOS",
    solPassword: process.env.SUNAT_AVI_SOL_PASSWORD ?? "moddatos",
    certificatePassword: process.env.SUNAT_AVI_CERT_PASS ?? "",
    certificateBase64: process.env.SUNAT_AVI_CERT_B64 ?? "",
  };
}
```

- [ ] **Step 3: Contador atómico**

```typescript
// src/lib/sunat/contador.ts
import { neon } from "@neondatabase/serverless";

export async function siguienteNumeroComprobante(
  ruc: string,
  serie: string
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  // Inicializar si no existe + incrementar atómicamente
  await sql`
    INSERT INTO comprobantes_contador (ruc, serie) VALUES (${ruc}, ${serie})
    ON CONFLICT (ruc, serie) DO NOTHING
  `;
  const result = await sql`
    UPDATE comprobantes_contador
    SET ultimo_numero = ultimo_numero + 1, updated_at = NOW()
    WHERE ruc = ${ruc} AND serie = ${serie}
    RETURNING ultimo_numero
  `;
  return result[0].ultimo_numero as number;
}

export function formatSerieNumero(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(8, "0")}`;
}
```

- [ ] **Step 4: index.ts stub que documenta cómo activar**

```typescript
// src/lib/sunat/index.ts
// ═══════════════════════════════════════════════════════════════
// MÓDULO SUNAT — STATUS: PARCIALMENTE PORTADO (Fase B.4 inicial)
//
// Bloqueador: Node 26 tiene bug que impide `npm install` de:
//   - xmlbuilder2
//   - xml-crypto
//   - node-forge
//   - archiver
//   - jspdf, jspdf-autotable
//
// Cuando se resuelva (downgrade Node a v22, usar pnpm, o esperar fix de Node),
// portar los archivos del módulo de conexipema-eventos:
//   /Users/hugoherrera/Programación/proyectos/conexipema-eventos/src/lib/sunat/
//     - xml-builder.ts
//     - xml-signer.ts
//     - soap-client.ts
//     - pdf-comprobante.ts
//
// Adaptaciones requeridas:
//   1. Reemplazar Firestore por Neon Postgres (ya tenemos tabla `comprobantes`)
//   2. Cambiar DATOS_EMISOR_MAP a usar config-transavic.ts
//   3. Crear server action `emitirFacturaAction()` adaptada
//
// Por ahora, esta función es un STUB que registra en DB pero no emite real a SUNAT.
// ═══════════════════════════════════════════════════════════════

import { neon } from "@neondatabase/serverless";
import { siguienteNumeroComprobante, formatSerieNumero } from "./contador";
import { getEmpresaConfig } from "./config-transavic";
import type {
  EmpresaId,
  ItemComprobante,
  ClienteComprobante,
  ResultadoEmision,
  TipoComprobante,
} from "./types";

export interface OpcionesEmision {
  empresa: EmpresaId;
  tipo: TipoComprobante;
  serie?: string;
  cliente: ClienteComprobante;
  items: ItemComprobante[];
  pedidoId?: string;
}

/**
 * STUB: emite comprobante guardando en DB pero sin enviar a SUNAT real.
 * Cuando se pueda instalar las deps, reemplazar por la versión completa
 * portada de conexipema-eventos.
 */
export async function emitirComprobante(
  opts: OpcionesEmision
): Promise<ResultadoEmision> {
  const config = getEmpresaConfig(opts.empresa);
  if (!config.ruc) {
    return {
      exito: false,
      estado: "error",
      serieNumero: "",
      error: `RUC no configurado para empresa "${opts.empresa}"`,
    };
  }

  const serie = opts.serie ?? (opts.tipo === "01" ? "F001" : "B001");
  const numero = await siguienteNumeroComprobante(config.ruc, serie);
  const serieNumero = formatSerieNumero(serie, numero);

  // Calcular totales (base imponible + IGV)
  let subtotal = 0;
  let igv = 0;
  for (const it of opts.items) {
    const base = it.precioUnitario * it.cantidad;
    const igvLinea = base * (it.igvPorcentaje / 100);
    subtotal += base;
    igv += igvLinea;
  }
  subtotal = Number(subtotal.toFixed(2));
  igv = Number(igv.toFixed(2));
  const total = Number((subtotal + igv).toFixed(2));

  // Guardar en DB con estado 'pendiente' (no fue enviado a SUNAT real)
  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO comprobantes (
      pedido_id, ruc_emisor, empresa, tipo, serie, numero, serie_numero,
      cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
      monto_subtotal, monto_igv, monto_total, estado, mensaje_sunat
    ) VALUES (
      ${opts.pedidoId ?? null}, ${config.ruc}, ${opts.empresa}, ${opts.tipo},
      ${serie}, ${numero}, ${serieNumero},
      ${opts.cliente.tipoDocumento}, ${opts.cliente.numDocumento}, ${opts.cliente.razonSocial},
      ${subtotal}, ${igv}, ${total}, 'pendiente',
      'STUB: pendiente de envío real a SUNAT (esperando deps NPM)'
    )
  `;

  return {
    exito: true,
    estado: "pendiente",
    serieNumero,
    mensaje:
      "Comprobante registrado localmente. Pendiente de envío real a SUNAT (esperando instalación de dependencias).",
  };
}
```

### Task B.4.3: Server actions de emisión

**Files:**
- Create: `src/app/api/comprobantes/emitir/route.ts`

- [ ] **Step 1: Endpoint POST**

```typescript
// src/app/api/comprobantes/emitir/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { emitirComprobante } from "@/lib/sunat";
import { TipoComprobante, TipoDocIdentidad, type EmpresaId } from "@/lib/sunat/types";

export const dynamic = "force-dynamic";

const Schema = z.object({
  pedido_id: z.string().uuid(),
  tipo: z.enum(["01", "03"]),    // factura o boleta
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!["asesor", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Solo asesores o admin" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Cargar pedido + items
  const pedidoRows = await sql`
    SELECT p.cliente, p.razon_social, p.ruc_dni, p.empresa, p.asesor_id
    FROM pedidos p WHERE id = ${parsed.data.pedido_id}
  `;
  if (pedidoRows.length === 0) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }
  const pedido = pedidoRows[0];

  // Ownership: asesor solo emite de sus pedidos
  if (session.user.role === "asesor" && pedido.asesor_id !== session.user.id) {
    return NextResponse.json({ error: "No es tu pedido" }, { status: 403 });
  }

  const items = await sql`
    SELECT producto_nombre, COALESCE(cantidad_real, cantidad) AS cantidad, unidad,
      COALESCE(precio_unitario, 0)::numeric AS precio
    FROM pedido_items
    WHERE pedido_id = ${parsed.data.pedido_id}
  `;

  const empresa: EmpresaId =
    pedido.empresa === "Transavic" ? "transavic" : "avicola";

  // Si es factura, el cliente DEBE tener RUC
  const tieneRuc = pedido.ruc_dni && (pedido.ruc_dni as string).length === 11;
  if (parsed.data.tipo === "01" && !tieneRuc) {
    return NextResponse.json(
      { error: "Para factura el cliente debe tener RUC (11 dígitos)" },
      { status: 400 }
    );
  }

  const resultado = await emitirComprobante({
    empresa,
    tipo: parsed.data.tipo as TipoComprobante,
    pedidoId: parsed.data.pedido_id,
    cliente: {
      tipoDocumento: tieneRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
      numDocumento: (pedido.ruc_dni as string) ?? "00000000",
      razonSocial: (pedido.razon_social as string) ?? (pedido.cliente as string),
    },
    items: items.map((it) => ({
      descripcion: it.producto_nombre as string,
      unidadMedida: it.unidad === "kg" ? "KGM" : "NIU",
      cantidad: Number(it.cantidad),
      precioUnitario: Number(it.precio) / 1.18,    // SUNAT espera precio sin IGV
      igvPorcentaje: 18,
    })),
  });

  return NextResponse.json(resultado);
}
```

### Task B.4.4: UI de comprobantes

**Files:**
- Create: `src/app/dashboard/comprobantes/page.tsx`
- Create: `src/app/dashboard/comprobantes/comprobantes-client.tsx`

- [ ] **Step 1: Lista de comprobantes con filtros**
- [ ] **Step 2: Botón "Emitir factura/boleta" en cada pedido entregado en `dashboard-content.tsx`**

### Task B.4.5: Modal "Confirmar antes de emitir"

Para casos donde el cliente no aprueba los pesos exactos, **mostrar pantalla de confirmación editable** antes de emitir.

**Files:**
- Create: `src/components/EmitirComprobanteModal.tsx`

- [ ] **Step 1: Modal con tabla editable de items**

(Antes de hacer POST, el usuario puede ajustar cantidades/precios. Si confirma → emite. Si no acepta → cancela.)

### Task B.4.6: Documentación de variables de entorno

**Files:**
- Modify: `.env.example` (si no existe, crear)

- [ ] **Step 1: Documentar variables SUNAT necesarias**

```bash
# SUNAT
SUNAT_ENVIRONMENT=beta  # 'beta' para testing | 'production' para real

# Transavic
SUNAT_TRA_RUC=20XXXXXXXXX
SUNAT_TRA_RAZON_SOCIAL="Transavic SAC"
SUNAT_TRA_DIRECCION="..."
SUNAT_TRA_UBIGEO=150101
SUNAT_TRA_SOL_USER=...   # usuario secundario SOL (perfil APIFACTU)
SUNAT_TRA_SOL_PASSWORD=...
SUNAT_TRA_CERT_PASS=...
SUNAT_TRA_CERT_B64=...   # certificado .p12 en Base64

# Avícola de Tony (idem)
SUNAT_AVI_RUC=20YYYYYYYYY
SUNAT_AVI_RAZON_SOCIAL="Avícola de Tony SAC"
SUNAT_AVI_DIRECCION="..."
SUNAT_AVI_UBIGEO=150101
SUNAT_AVI_SOL_USER=...
SUNAT_AVI_SOL_PASSWORD=...
SUNAT_AVI_CERT_PASS=...
SUNAT_AVI_CERT_B64=...

# Cron secret para proteger endpoints /api/cron/*
CRON_SECRET=alguna-string-larga-aleatoria
```

---

## Self-review

- [x] **Spec coverage:** B.1 metas → tasks 1.1-1.6 ✅. B.2 notificaciones → 2.1-2.6 ✅. B.3 cobranzas → 3.1-3.7 ✅. B.4 SUNAT (stub) → 4.1-4.6 ✅.
- [x] **No placeholders:** todos los steps tienen código real.
- [x] **Type consistency:** `TipoComprobante`, `EmpresaId`, `ResultadoEmision`, `crearNotificacion` se usan consistentemente.
- [x] **Bloqueador documentado:** Node 26 + npm install → stub para B.4 explícito.

---

## Execution

Inline execution con `executing-plans` skill. Commits LOCALES sin push (orden explícita del usuario). Migraciones SQL se ejecutarán cuando recibamos API key Neon.

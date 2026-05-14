# 01 — Visión General de la Arquitectura

> **Última verificación contra código:** 2026-05-13
> **Commit del proyecto:** `d2a49cd`
> **Archivos clave:** `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/middleware.ts`, `src/components/VersionChecker.tsx`, `src/app/api/version/route.ts`, `src/app/globals.css`

---

## 1. El producto en una página

**Transavic** es un sistema interno de gestión de pedidos para una distribuidora avícola de Lima, Perú que opera dos marcas comerciales del mismo dueño: **Transavic** y **Avícola de Tony**. No es un e-commerce público — es un **ERP ligero interno** donde:

- Las **asesoras** reciben pedidos por WhatsApp y los registran en el sistema generando un ticket (JPEG) que comparten de vuelta al cliente.
- El **admin** ve todos los pedidos del día en un tablero kanban con mapa y los **asigna a repartidores** (drag-and-drop).
- Los **repartidores** abren su pantalla "Mi Ruta" en el celular, ven los pedidos asignados en mapa con orden óptimo, transmiten estado en vivo (Asignado → En_Camino → Entregado) y pueden trabajar offline.
- El sistema soporta los **18 distritos** de Lima Metropolitana donde opera el negocio.

**Volumen actual** (mayo 2026): ~30 pedidos/día, 6 repartidores activos, 4 asesoras, 1 admin.

---

## 2. Diagrama de capas

```mermaid
flowchart TB
    subgraph "Cliente Web (Next.js Pages + Components)"
        UI_AS[/"/dashboard/nuevo-pedido<br/>(asesor)"/]
        UI_AD[/"/dashboard/despacho<br/>(admin)"/]
        UI_RE[/"/dashboard/mi-ruta<br/>(repartidor)"/]
        UI_OTROS[/"/dashboard/clientes<br/>/productos /users /analytics /resumen"/]
    end

    subgraph "Server (Next.js Route Handlers + Server Actions)"
        API_PED["/api/pedidos/*"]
        API_DES["/api/despacho/*"]
        API_REP["/api/repartidor/*"]
        API_CRUD["/api/clientes, /productos, /users"]
        API_ANA["/api/analytics, /resumen-diario, /settings, /version"]
        AUTH["NextAuth v5<br/>(Credentials + JWT)"]
        DATA_LAYER["src/lib/data.ts<br/>(queries reutilizables)"]
    end

    subgraph "Persistencia"
        NEON[("Neon Postgres<br/>(serverless HTTP)")]
    end

    subgraph "Servicios externos"
        GMAPS["Google Maps Platform<br/>(Directions, Maps JS, Places)"]
        VERCEL["Vercel<br/>(Hosting + BUILD_ID)"]
    end

    subgraph "Cliente del repartidor"
        LS["localStorage<br/>(offline queue)"]
        GPS["Geolocation API<br/>(GPS bajo demanda)"]
    end

    UI_AS --> API_PED
    UI_AS --> API_CRUD
    UI_AD --> API_DES
    UI_AD --> API_PED
    UI_RE --> API_REP
    UI_RE --> API_PED
    UI_RE -.->|optimistic + offline| LS
    UI_OTROS --> API_CRUD
    UI_OTROS --> API_ANA

    API_PED --> DATA_LAYER
    API_DES --> DATA_LAYER
    API_REP --> DATA_LAYER
    DATA_LAYER --> NEON

    API_PED --> AUTH
    API_DES --> AUTH
    API_REP --> AUTH
    AUTH --> NEON

    API_DES -->|distancia<br/>asignar/optimizar| GMAPS
    API_PED -->|ETA<br/>iniciar-viaje| GMAPS
    UI_AS -->|Maps JS<br/>+ Places| GMAPS
    UI_AD -->|Maps JS<br/>+ Places| GMAPS
    UI_RE -->|Maps JS| GMAPS

    UI_RE -.-> GPS

    VERCEL -.->|BUILD_ID| UI_AS
    VERCEL -.->|BUILD_ID| UI_AD
    VERCEL -.->|BUILD_ID| UI_RE
```

**Lectura del diagrama:**
- Las **3 UIs principales** (asesor, admin, repartidor) cada una con sus endpoints específicos.
- El **data layer** (`src/lib/data.ts`) centraliza queries reutilizables con **scoping por rol**.
- **Neon Postgres** es la fuente de verdad. No hay caché intermedio (Redis/etc.).
- **Google Maps** se invoca tanto server-side (con `Maps_SERVER_KEY` para distancias y ETAs) como client-side (con `NEXT_PUBLIC_MAPS_API_KEY` para visualización y autocomplete).
- **localStorage** es el storage del repartidor para acciones offline.
- **Vercel** entrega `BUILD_ID` al cliente que detecta cuando hay un nuevo deploy.

---

## 3. Stack técnico

### 3.1 Versiones exactas (verificadas en `package.json`)

| Categoría | Tecnología | Versión |
|---|---|---|
| Framework | **Next.js** (App Router) | `^15.5.10` |
| UI runtime | **React** | `^19.0.0` |
| Lenguaje | **TypeScript** | `^5` (strict mode) |
| Auth | **NextAuth** | `^5.0.0-beta.29` (beta) |
| Base de datos (cliente) | `@neondatabase/serverless` | `^1.0.1` |
| Hash de contraseñas | `bcrypt` | `^6.0.0` |
| Validación | `zod` | `^4.0.5` |
| Estilos | **TailwindCSS** | `^4` (vía `@tailwindcss/postcss`) |
| Drag & drop | `@hello-pangea/dnd` | `^18.0.1` (fork de `react-beautiful-dnd`) |
| Mapas | `@react-google-maps/api` | `^2.20.7` |
| Imágenes a JPEG | `html-to-image` | `^1.11.13` |
| Iconos | `react-icons` | `^5.5.0` (set Feather) |
| Debounce de UI | `use-debounce` | `^10.0.5` |
| Linter | `eslint` + `eslint-config-next` | `^9` + `^15.5.10` |

### 3.2 Configuración TypeScript (`tsconfig.json`)

```jsonc
{
  "compilerOptions": {
    "target": "ES2017",
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

**Lo crítico:** `"strict": true` (línea 11) activa todas las flags de strictness — `noImplicitAny`, `strictNullChecks`, etc. Path alias `@/*` apunta a `src/`, permite imports como `import { Pedido } from '@/lib/types'`.

### 3.3 Configuración Next.js (`next.config.ts`)

```typescript
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  /* config options here */
};
export default nextConfig;
```

**Vacío.** Sin opciones custom — usa defaults de Next.js 15. No hay experimental flags, ni rewrites, ni redirects en config.

### 3.4 Tailwind v4 (no usa archivo de config tradicional)

- En `src/app/globals.css:3`: **`@import "tailwindcss";`** — patrón **nativo de Tailwind v4** (reemplaza `@tailwind base/components/utilities` de v3).
- En el mismo archivo (líneas ~10-15): `@theme inline` block define variables CSS custom:
  - `--color-background`, `--color-foreground` (con dark mode media query).
  - `--font-sans`, `--font-mono` mapeados a Geist (`next/font/google`).
- **Existe** un `tailwind.config.js` legacy con `content` paths viejos, pero **no es la fuente principal de config en v4**. Es vestigio del scaffolding.

### 3.5 Estilos de impresión (`globals.css:44-148`)

Hay ~100 líneas dedicadas a **`@media print`** con dos tamaños:
- **A4** (`@page { size: A4 }`) — para reportes batch de pedidos.
- **Ticket térmico 80mm** (`@page { size: 80mm 297mm }`) — formato compacto para impresora de tickets.

Estas reglas ocultan sidebar/header, fuerzan `table-layout: fixed`, reducen padding y manejan saltos de página (`page-break-inside: avoid`). Son críticas para los flujos de impresión (`/dashboard/print-modal.tsx`, etc.) y para los tickets JPEG generados con `html-to-image`.

---

## 4. Estructura de carpetas

```
transavic/
├── src/
│   ├── app/
│   │   ├── api/                     # Route Handlers (backend)
│   │   │   ├── pedidos/             # CRUD + transiciones (iniciar-viaje, entregar, cancelar, print)
│   │   │   ├── despacho/            # Vista admin: asignar, asignar-externo, optimizar-ruta, reordenar
│   │   │   ├── repartidor/mi-ruta/  # Endpoint para vista del repartidor
│   │   │   ├── clientes/            # CRUD clientes + autocomplete + pedidos del cliente
│   │   │   ├── productos/           # CRUD catálogo
│   │   │   ├── users/               # CRUD usuarios (admin) + listado por rol
│   │   │   ├── analytics/           # KPIs y rankings
│   │   │   ├── resumen-diario/      # Reporte agrupado por día
│   │   │   ├── settings/            # Key/value (base_location)
│   │   │   ├── version/             # BUILD_ID (VersionChecker)
│   │   │   ├── dashboard/pedidos/   # Wrapper de fetchFilteredPedidos
│   │   │   └── auth/logout/         # GET logout
│   │   │
│   │   ├── dashboard/               # Páginas con auth requerida
│   │   │   ├── layout.tsx           # Aplica DashboardLayout (sidebar)
│   │   │   ├── page.tsx             # Lista de pedidos (redirige a mi-ruta si rol=repartidor)
│   │   │   ├── nuevo-pedido/        # Formulario de creación (asesor/admin)
│   │   │   ├── despacho/            # Tablero kanban con mapa (admin)
│   │   │   ├── mi-ruta/             # Vista mobile del repartidor (offline-first)
│   │   │   ├── clientes/, productos/, users/, analytics/, resumen/
│   │   │   └── (componentes locales por feature: dashboard-content.tsx, etc.)
│   │   │
│   │   ├── login/page.tsx           # Página pública de login
│   │   ├── layout.tsx               # Root layout (fonts Geist, metadata)
│   │   ├── page.tsx                 # Raíz: redirige a /dashboard/nuevo-pedido
│   │   ├── globals.css              # Tailwind v4 + print styles
│   │   └── favicon.ico
│   │
│   ├── components/                  # Componentes compartidos cross-feature
│   │   ├── DashboardLayout.tsx      # Sidebar con filtro por rol
│   │   ├── VersionChecker.tsx       # Detector de BUILD_ID
│   │   ├── PedidoForm.tsx           # Form de creación de pedido (638 LOC)
│   │   ├── ClienteAutocomplete.tsx  # Búsqueda con debounce 300ms
│   │   ├── ProductSelector.tsx      # Catálogo + carrito de items
│   │   ├── MapInput.tsx             # Captura de lat/lng (3 modos)
│   │   ├── PesoModal.tsx            # Registro de peso real post-entrega
│   │   ├── TimeRangePicker.tsx      # Rango horario "HH:MM AM - HH:MM PM"
│   │   ├── TicketPedido.tsx         # Renderiza ticket JPEG
│   │   └── VistaImpresion.tsx       # Reporte batch (A4)
│   │
│   ├── lib/
│   │   ├── types.ts                 # Tipos TS: Pedido, User, Producto, PedidoItem, PedidoRuta, EstadoPedido
│   │   ├── data.ts                  # Queries reutilizables (fetchFilteredPedidos, fetchAsesores, etc.)
│   │   ├── actions.ts               # Server actions (authenticate, doLogout)
│   │   ├── offline-queue.ts         # Queue en localStorage del repartidor
│   │   └── utils.ts                 # Utilidades generales
│   │
│   ├── auth.ts                      # NextAuth setup (Credentials + bcrypt)
│   ├── auth.config.ts               # Callbacks JWT/session/authorized + type augmentation
│   └── middleware.ts                # NextAuth middleware con matcher
│
├── scripts/                         # Migraciones manuales (.mjs) + seed
│   ├── seed.mjs                     # Crea users + pedidos (estructura legacy)
│   ├── migrate-products.mjs         # Crea productos + pedido_items
│   ├── migrate-estados.mjs          # Agrega estado, repartidor_id, etc. a pedidos
│   ├── migrate-direccion-mapa.mjs   # Agrega direccion_mapa
│   ├── migrate-entregado-por.mjs    # Agrega entregado_por, entregado_at
│   ├── migrate-despacho-v2.mjs      # Crea settings + agrega distancia_km, duracion_estimada_min
│   ├── run-migration.mjs            # Agrega asesor_id a clientes (ejecuta SQL adjunto)
│   ├── migration_add_asesor_to_clientes.sql
│   └── generar-propuesta-pdf.py     # Script Python para PDF de propuesta comercial (no app)
│
├── public/
│   ├── transavic.jpg, avicola.jpg   # Logos de las 2 marcas (usados en tickets)
│   └── *.svg                        # Assets default de Next.js (no se usan)
│
├── docs/
│   ├── arquitectura/                # ← Estás acá
│   └── superpowers/specs/           # Specs de diseño (proceso de superpowers)
│
├── CLAUDE.md                        # Contexto fundamental para agentes IA
├── propuesta-mejoras-transavic.pdf  # Cotización comercial actual
├── .env                             # NO commiteado (DATABASE_URL, AUTH_SECRET, etc.)
├── next.config.ts                   # Vacío
├── tsconfig.json                    # Strict mode + path alias
├── tailwind.config.js               # Vestigio v3 (no es la config real)
├── postcss.config.mjs               # Plugin único: @tailwindcss/postcss
└── eslint.config.mjs                # next/core-web-vitals + next/typescript
```

### 4.1 Convención de naming de archivos

| Tipo | Convención | Ejemplo |
|---|---|---|
| Páginas (App Router) | `page.tsx`, `layout.tsx` | `src/app/dashboard/page.tsx` |
| Componentes de página locales | `kebab-case.tsx` | `dashboard-content.tsx`, `edit-modal.tsx` |
| Componentes compartidos | `PascalCase.tsx` | `PedidoForm.tsx`, `DashboardLayout.tsx` |
| Route handlers | `route.ts` | `api/pedidos/route.ts` |
| Lib utilities | `kebab-case.ts` o nombre directo | `data.ts`, `offline-queue.ts` |
| Migraciones | `migrate-<feature>.mjs` | `migrate-estados.mjs` |

---

## 5. Cómo correr en local

### 5.1 Variables de entorno mínimas (`.env`)

```bash
# Postgres (Neon)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host/db?sslmode=require  # opcional

# NextAuth
AUTH_SECRET=<string aleatorio largo>
AUTH_URL=http://localhost:3000

# Google Maps (DOS variables)
NEXT_PUBLIC_MAPS_API_KEY=<key con permisos Maps JS + Places>
Maps_SERVER_KEY=<key con permisos Directions API>
# ⚠️ Ojo el naming: M mayúscula + guion bajo, no MAPS_SERVER_KEY

# Ubicación base del almacén (fallback si no hay row en settings.base_location)
BASE_LATITUDE=-12.0464
BASE_LONGITUDE=-77.0428
```

`.env` define más variables (POSTGRES_*, PGHOST, NEXT_PUBLIC_STACK_*) pero **no se usan en código activo** — son residuo de templates de Vercel/Neon Auth.

### 5.2 Comandos básicos

```bash
npm install                          # Instalar dependencias
npm run seed                         # Crear tablas users + pedidos (DESTRUCTIVO: DROP TABLE)
node scripts/migrate-products.mjs    # Crear productos + pedido_items + catálogo
node scripts/migrate-estados.mjs     # Agregar estado moderno + índices
node scripts/migrate-direccion-mapa.mjs
node scripts/migrate-entregado-por.mjs
node scripts/migrate-despacho-v2.mjs
node scripts/run-migration.mjs       # Agrega asesor_id a clientes (REQUIERE tabla clientes existente)
npm run dev                          # http://localhost:3000
```

**⚠️ Gotcha crítico:** la tabla `clientes` **no se crea por ninguna migración del repo**. Existe en producción pero su `CREATE TABLE` no está documentado en `/scripts/`. Si estás levantando una base nueva, vas a tener que crear `clientes` a mano basándote en el código que la usa (`api/clientes/route.ts`).

### 5.3 Comandos npm definidos en `package.json`

| Script | Para qué |
|---|---|
| `npm run dev` | Dev server en `:3000` |
| `npm run build` | Build de producción |
| `npm run start` | Servir build |
| `npm run lint` | ESLint (`next/core-web-vitals` + `next/typescript`) |
| `npm run seed` | Ejecuta `./scripts/seed.mjs` (recrea users + pedidos) |

---

## 6. Deployment (Vercel)

### 6.1 Cómo se despliega

- **Hosting:** Vercel (cuenta `hugoherreradeveloper@gmail.com`).
- **Trigger:** push a `main` → deploy continuo (configuración estándar de Vercel).
- **Build command:** `next build` (implícito).
- **Output:** `.next/` con un `BUILD_ID` único generado por Next.js en cada build.
- **URL producción:** `transavic.app` (dominio custom).

### 6.2 VersionChecker — por qué existe

Cada vez que Vercel hace un deploy nuevo, **`BUILD_ID` cambia**. Para evitar que repartidores trabajando en la calle queden con el bundle JS viejo (que apunta a APIs viejas o tiene bugs que ya se corrigieron), el sistema implementa un **detector de versión**:

```
┌──────────────────┐
│ VersionChecker   │  cada 60s y al volver al foreground
│ (cliente)        │ ──────────────────────────────────┐
└──────────────────┘                                   │
        │                                              ▼
        │                                  ┌──────────────────────┐
        │                                  │ GET /api/version     │
        │                                  │ → { buildId: "abc" } │
        │                                  └──────────────────────┘
        │                                              │
        ▼                                              │
┌──────────────────────────────────┐                   │
│ Compara con buildId inicial      │ ◀─────────────────┘
│ guardado en useRef               │
└──────────────────────────────────┘
        │
        │ ¿cambió?
        ▼
┌──────────────────────────────────┐
│ Muestra toast: "Hay actualización"│
│ Botón → window.location.reload()  │
└──────────────────────────────────┘
```

**Implementación** (`src/components/VersionChecker.tsx`):
- `CHECK_INTERVAL_MS = 60_000` (60s).
- Re-check inmediato cuando `document.visibilitychange` y el tab vuelve a estar activo.
- `fetch('/api/version', { cache: 'no-store' })` — sin caché.
- Al detectar cambio, **detiene el polling** (no inunda con toasts).

**Backend** (`src/app/api/version/route.ts`):
- En dev (`NODE_ENV === "development"`) retorna literal `"development"`.
- En prod lee `.next/BUILD_ID` desde el filesystem (`fs.readFileSync`).
- Si no encuentra archivo (caso edge en boot), genera un fallback con `Date.now()` que persiste en memoria del proceso.
- Headers: `Cache-Control: no-store, no-cache, must-revalidate` para forzar re-fetch.

`VersionChecker` se monta en el layout de `/dashboard` (no en login ni en `/`), así solo afecta a usuarios autenticados.

---

## 7. Decisiones arquitectónicas clave

Una tabla con las decisiones no-obvias del proyecto, su motivación, y dónde se ven aplicadas en el código:

| Decisión | Motivación | Aplicado en |
|---|---|---|
| **No usar ORM** | Schema simple, queries claras con SQL nativo. Neon HTTP no se beneficia de ORM. | Todo el data layer usa `sql\`SELECT...\`` directo (`lib/data.ts`, `api/*/route.ts`). |
| **No PWA pura para repartidor** | iOS bloquea GPS en background para PWAs. Estamos planeando wrap con Capacitor para apps nativas (Android primero). | Decisión de roadmap. Hoy la PWA funciona pero el GPS solo se activa con app abierta. |
| **Pedidos denormalizados** | Preservar histórico: si el cliente cambia dirección, los pedidos pasados no se reescriben. | `pedidos` copia `cliente`, `whatsapp`, `direccion`, etc. del cliente al INSERT. Hay también `cliente_id` (FK viva). Ver doc 02. |
| **Doble fuente de verdad estado/entregado** | Migración progresiva del legacy `entregado: boolean` al moderno `estado: varchar`. Se mantienen sincronizados. | Sync en `PATCH /api/pedidos/[id]` (`api/pedidos/[id]/route.ts:80-114`). Ver doc 02 y 04. |
| **distancia_km se congela al asignar** | El admin/repartidor quiere saber "este cliente está a X km del local", no la distancia desde el pedido anterior en la ruta. | `optimizar-ruta` solo actualiza `orden_ruta` y `duracion_estimada_min`, no `distancia_km` (`api/despacho/optimizar-ruta/route.ts:198-201`). |
| **Polling en lugar de websockets** | Volumen actual (~30 pedidos/día, ~10 conexiones simultáneas) no justifica websockets. Se planea Pusher para tracking GPS en vivo (mejoras 2026). | `/despacho` refresca cada **15s**, `/mi-ruta` cada **60s**. |
| **GPS bajo demanda** | Ahorrar batería del motorizado. | El navegador solo pide ubicación cuando el mapa está visible o hay un pedido `En_Camino` (`mi-ruta-content.tsx`, hook `useGeolocation`). |
| **Reinstanciación de cliente Neon** | El driver HTTP de Neon no es un pool — es seguro y barato reinstanciar por handler. | `const sql = neon(process.env.DATABASE_URL!)` aparece en cada `route.ts`. |
| **Settings como key/value JSONB** | Extensible sin migraciones futuras. Hoy solo hay 1 entrada (`base_location`). | `scripts/migrate-despacho-v2.mjs` crea tabla. `api/settings/route.ts` lee/escribe. |
| **Offline-first solo en el repartidor** | El repartidor está en la moto, las asesoras están en oficina con WiFi. | `src/lib/offline-queue.ts` solo se usa en `mi-ruta-content.tsx`. Ver doc 04. |
| **Optimistic updates** | UX inmediata aunque la API tarde 1-2s o falle. | Drag-and-drop en `/despacho` y transiciones de estado en `/mi-ruta` actualizan UI antes de la API. |
| **Dos rutas de logout** | Inconsistencia histórica — `/api/auth/logout` (GET, redirige a `/`) y `doLogout()` (server action, redirige a `/login`). | Ver `api/auth/logout/route.ts` y `lib/actions.ts:doLogout`. **Pendiente unificar.** |
| **Roles dispersos en lugar de constantes centralizadas** | Bug de simplicidad inicial. Los strings `'admin' | 'asesor' | 'repartidor'` se repiten en zod schemas de `api/users/route.ts`, `api/users/[id]/route.ts`, `dashboard/users/user-modal.tsx`. | **Pendiente refactor:** centralizar en `lib/constants.ts` o `lib/types.ts`. |

---

## 8. Página raíz y middleware

### 8.1 `src/app/page.tsx` (raíz `/`)

```typescript
import { redirect } from "next/navigation";
export default function Home() {
  redirect("/dashboard/nuevo-pedido");
}
```

**Asume que el usuario está autenticado** — si no lo está, el middleware lo intercepta antes de llegar acá y lo manda a `/login`.

### 8.2 `src/middleware.ts`

```typescript
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};
```

**Matcher exclusivo:** se aplica el middleware (que ejecuta el callback `authorized` de `auth.config.ts`) a **todas las rutas excepto**:
- `/api/*` (las APIs manejan su propia auth con `auth()` server-side)
- `/_next/static/*`, `/_next/image/*` (assets)
- Archivos `.png` (logos, favicons)

**Implicación:** las páginas (`/dashboard/*`, `/login`, `/`) pasan por el middleware. Las APIs **no**, así que cada handler debe llamar `await auth()` manualmente si requiere autenticación.

### 8.3 Layout raíz (`src/app/layout.tsx`)

- Importa **fuentes Geist** (sans + mono) de `next/font/google` con `next/font` (optimización automática).
- Define CSS variables `--font-geist-sans` y `--font-geist-mono` en `<body>`.
- Metadata: `title: "Transavic"`, `description: "Generador de pedidos"`.
- HTML `lang="en"` — **pendiente actualizar a `es-PE`** para coherencia con el contenido en español.

---

## 9. Cómo verificar que este documento sigue vigente

Cuando agregues funcionalidad nueva, ejecuta estas verificaciones y actualiza este documento si alguna cambia:

```bash
# 1. Versiones del stack
cat package.json | grep -E '"(next|react|next-auth|tailwindcss|zod|@neondatabase)"'

# 2. Configuración Next.js — sigue sin custom config?
cat next.config.ts

# 3. Configuración TypeScript — strict sigue activo?
grep -E '"(strict|target|paths)"' tsconfig.json

# 4. Estructura de carpetas top-level
ls src/app/ src/components/ src/lib/

# 5. ¿Hay APIs nuevas que agregar al diagrama?
ls src/app/api/

# 6. ¿Hay rutas de dashboard nuevas?
ls src/app/dashboard/

# 7. ¿Hay scripts/migraciones nuevas?
ls scripts/

# 8. ¿Sigue VersionChecker con polling de 60s?
grep -n "CHECK_INTERVAL_MS" src/components/VersionChecker.tsx

# 9. ¿Sigue el matcher del middleware igual?
cat src/middleware.ts

# 10. ¿La página raíz sigue redirigiendo a nuevo-pedido?
cat src/app/page.tsx
```

Si encuentras drift, actualizá las secciones afectadas y bumpeá la fecha del header.

---

## Siguientes documentos

- **`02-modelo-de-datos.md`** — todas las tablas, columnas, relaciones, decisiones de schema.
- **`03-autenticacion-y-roles.md`** — NextAuth, JWT, scoping por rol con código real.
- **`04-flujos-de-negocio.md`** — vida del pedido paso a paso, máquina de estados.
- **`05-apis-e-integraciones.md`** — referencia de endpoints + Google Maps + offline queue.

# 01 — Visión General de la Arquitectura

> **Última verificación contra código:** 2026-06-02 · **actualizado 2026-06-04** (app del repartidor / GPS en vivo pasó a producción)
> **Commit del proyecto:** `main` (post-lanzamiento a producción del 30 may 2026)
> **Archivos clave:** `package.json`, `tsconfig.json`, `next.config.ts`, `vercel.json`, `src/app/layout.tsx`, `src/middleware.ts`, `src/auth.config.ts`, `src/lib/roles.ts`, `src/lib/types.ts`, `src/components/DashboardLayout.tsx`, `src/components/VersionChecker.tsx`, `src/app/api/version/route.ts`, `src/app/globals.css`

> **🚀 Estado: LANZADO A PRODUCCIÓN (30 may 2026).** El sistema base + las mejoras de las Fases A/B/C están desplegadas en `main` → Vercel (plan **Pro**). **La app nativa del motorizado (Capacitor, carpeta `android/`) también pasó a producción el 4 jun 2026** (PRs #18–#22; tabla `rider_locations` migrada a prod; validada en teléfono real; publicada en Google Play — Prueba Interna). Ver §10.

---

## 1. El producto en una página

**Transavic** es un **ERP ligero interno** de gestión de pedidos para una distribuidora avícola de Lima, Perú que opera dos marcas comerciales del mismo dueño: **Transavic** y **Avícola de Tony**. No es un e-commerce público — los clientes finales no se loguean. El sistema cubre el ciclo completo del negocio:

- Las **asesoras** reciben pedidos por WhatsApp y los registran generando un ticket (JPEG) que comparten de vuelta al cliente. Gestionan sus clientes, comprobantes y cobranzas, y tienen su panel de metas e incentivos.
- El equipo de **producción** ve la cola del día, ingresa los pesos reales de cada pedido y lo marca "listo para despacho".
- El **admin** (Antonio) ve todos los pedidos del día en un tablero kanban con mapa y los **asigna a repartidores** (drag-and-drop); gestiona catálogo, usuarios, incentivos y ve todos los reportes.
- Los **repartidores** (motorizados) abren su pantalla "Mi Ruta" en el celular, ven los pedidos asignados en mapa con orden óptimo, transmiten estado en vivo (Asignado → En_Camino → Entregado/Fallido) y pueden trabajar offline.
- El negocio cierra el **loop del dinero**: factura electrónicamente ante SUNAT (boleta/factura/nota de crédito, 2 RUCs), genera cobranzas y mide la cartera (aging, morosos).
- Un **módulo de IA comercial** (Gemini) da insights al admin y a cada asesora (con privacy boundary por asesora).
- El sistema cubre los **18 distritos** de Lima Metropolitana donde opera el negocio.

**Volumen actual** (mayo–junio 2026): ~30 pedidos/día, 6 repartidores activos, 4 asesoras, 1 admin, 1 asistente de producción.

Para el detalle funcional de cada módulo nuevo (SUNAT, cobranzas, incentivos, IA, reportes, catálogo, perfil 360°, etc.), ver **`/CLAUDE.md`** §§ 12–13 y §16. Este documento cubre la **arquitectura macro**: stack, capas, estructura, deployment y decisiones.

---

## 2. Diagrama de capas

```mermaid
flowchart TB
    subgraph "Cliente Web (Next.js Pages + Components)"
        UI_AS[/"asesor<br/>nuevo-pedido · clientes · comprobantes<br/>cobranzas · mis-metas · mi-dia"/]
        UI_AD[/"admin<br/>despacho · reportes · catalogo<br/>incentivos · users"/]
        UI_PR[/"produccion<br/>produccion · resumen"/]
        UI_RE[/"repartidor<br/>mi-ruta"/]
    end

    subgraph "Server (Next.js Route Handlers + Server Actions)"
        API_PED["/api/pedidos · /despacho · /repartidor · /produccion"]
        API_COM["/api/comprobantes · /facturas · /cobranzas<br/>(SUNAT + cobranzas)"]
        API_CRUD["/api/clientes · /productos · /users · /settings"]
        API_INT["/api/reportes · /metas · /incentivos<br/>/asistente-ia · /buscar · /notificaciones"]
        CRONS["/api/cron/* (4 jobs, Vercel)"]
        AUTH["NextAuth v5<br/>(Credentials + JWT)"]
        DATA["src/lib/* (data, sunat, cobranzas,<br/>metas, incentivos, insights, notificaciones)"]
    end

    subgraph "Persistencia"
        NEON[("Neon Postgres<br/>(serverless HTTP, sin RLS)")]
    end

    subgraph "Servicios externos"
        GMAPS["Google Maps Platform<br/>(Directions · Maps JS · Places · Geocoding)"]
        SUNAT["SUNAT SEE<br/>(SOAP, XML UBL 2.1 firmado)"]
        GEMINI["Gemini Flash<br/>(IA comercial)"]
        BREVO["Brevo / SMTP<br/>(correo de comprobantes)"]
        APISPERU["apisperu<br/>(consulta RUC/DNI)"]
        VERCEL["Vercel Pro<br/>(Hosting + BUILD_ID + crons)"]
    end

    subgraph "Cliente del repartidor"
        LS["localStorage<br/>(offline queue)"]
        GPS["Geolocation API<br/>(GPS bajo demanda)"]
    end

    UI_AS --> API_PED & API_COM & API_CRUD & API_INT
    UI_AD --> API_PED & API_COM & API_CRUD & API_INT
    UI_PR --> API_PED
    UI_RE --> API_PED
    UI_RE -.->|optimistic + offline| LS

    API_PED --> DATA
    API_COM --> DATA
    API_CRUD --> DATA
    API_INT --> DATA
    CRONS --> DATA
    DATA --> NEON

    API_PED --> AUTH
    API_COM --> AUTH
    AUTH --> NEON

    API_PED -->|distancia / ETA| GMAPS
    UI_AS -->|Maps JS + Places| GMAPS
    UI_AD -->|Maps JS + Places| GMAPS
    API_COM -->|emisión/baja/resumen| SUNAT
    API_COM -->|envío PDF/XML| BREVO
    API_COM -->|consulta doc| APISPERU
    API_INT -->|insights| GEMINI

    UI_RE -.-> GPS
    VERCEL -.->|BUILD_ID| UI_AS & UI_AD & UI_RE & UI_PR
    VERCEL -.->|Authorization Bearer CRON_SECRET| CRONS
```

**Lectura del diagrama:**
- Hay **4 UIs por rol** (asesor, admin, produccion, repartidor) — cada una ve solo sus pantallas (ver §6 / doc 03).
- La **capa `lib/`** centraliza la lógica reutilizable: `data.ts` (queries con **scoping por rol**), `sunat/*` (facturación electrónica), `cobranzas.ts`, `metas.ts`/`incentivos.ts`, `insights.ts`/`gemini.ts` (IA), `notificaciones.ts`.
- **Neon Postgres** es la fuente de verdad. No hay caché intermedio (Redis/etc.); el caché de IA es in-memory por proceso (ver gotcha #16 de CLAUDE.md). **Neon no tiene RLS** — todos los permisos viven en la capa de aplicación (cada API route hace `auth()` + filtra por rol en SQL).
- **Google Maps** se invoca server-side (con `Maps_SERVER_KEY` para distancias y ETAs) y client-side (con `NEXT_PUBLIC_MAPS_API_KEY` para visualización y autocomplete).
- **SUNAT, Brevo, apisperu y Gemini** son integraciones server-only (claves nunca expuestas al cliente).
- **localStorage** es el storage del repartidor para acciones offline.
- **Vercel** entrega `BUILD_ID` al cliente (VersionChecker) y dispara los **4 cron jobs** (protegidos con `CRON_SECRET`).

---

## 3. Stack técnico

### 3.1 Versiones exactas (verificadas en `package.json`, 2026-06-02)

| Categoría | Tecnología | Versión |
|---|---|---|
| Framework | **Next.js** (App Router) | `^15.5.10` |
| UI runtime | **React** | `^19.0.0` |
| Lenguaje | **TypeScript** | `^5` (strict mode) |
| Auth | **NextAuth** | `^5.0.0-beta.29` (beta) |
| Base de datos (cliente) | `@neondatabase/serverless` | `^1.0.1` (HTTP, **sin RLS** — permisos en la app) |
| Hash de contraseñas | `bcrypt` | `^6.0.0` |
| Validación | `zod` | `^4.0.5` |
| Estilos | **TailwindCSS** | `^4` (vía `@tailwindcss/postcss`) |
| Drag & drop | `@hello-pangea/dnd` | `^18.0.1` (fork de `react-beautiful-dnd`) |
| Mapas | `@react-google-maps/api` | `^2.20.7` |
| Imágenes a JPEG | `html-to-image` | `^1.11.13` |
| Compresión de imágenes | `browser-image-compression` | `^2.0.2` (foto firmada / captura de cobranza) |
| Iconos | `react-icons` | `^5.5.0` (set Feather) |
| Debounce de UI | `use-debounce` | `^10.0.5` |
| Carga de `.env` (scripts) | `dotenv` | `^17.2.0` |
| Linter | `eslint` + `eslint-config-next` | `^9` + `^15.5.10` |

**Dependencias del módulo SUNAT / facturación electrónica** (todas server-side):

| Categoría | Tecnología | Versión | Para qué |
|---|---|---|---|
| XML UBL 2.1 | `xmlbuilder2` | `^4.0.3` | Construir el comprobante electrónico (factura/boleta/NC) |
| Firma digital | `xml-crypto` | `^6.1.2` | Firmar el XML con XML-DSig (cert .p12) |
| Lectura de certificado | `node-forge` | `^1.4.0` | Leer el certificado `.p12` |
| Compresión ZIP | `archiver` | `^7.0.1` | Empaquetar el XML para el SOAP de SUNAT (**no v8**, es ESM-only y cambió API) |
| Correo | `nodemailer` | `^7.0.13` | Fallback SMTP cuando no hay `BREVO_API_KEY` (envío de comprobantes) |

> `archiver`, `node-forge` y `xml-crypto` están en `next.config.ts:serverExternalPackages` para que webpack no los bundlee (bindings nativos / CJS pesados). Ver §3.3.

**Dependencias de PDF y Excel** (reportes, comprobantes, órdenes de pedido):

| Categoría | Tecnología | Versión | Para qué |
|---|---|---|---|
| PDF | `jspdf` | `^4.2.1` | Generar PDFs en el cliente (comprobante SUNAT, reporte de ventas) |
| Tablas en PDF | `jspdf-autotable` | `^5.0.8` | Tablas dentro de los PDFs |
| Excel | `xlsx` (SheetJS) | `^0.18.5` | Exportar reportes de comprobantes y ventas a `.xlsx` |

> El PDF de la **orden de pedido** (ex "guía de remisión") y los **tickets** de WhatsApp no usan estas libs: se imprimen con `window.print()` (HTML + `@media print`) y `html-to-image` respectivamente. Decisión deliberada de costo $0 (ver §7 y CLAUDE.md gotcha #20).

**Servicios externos sin SDK** (se llaman por `fetch`): SUNAT (SOAP), Gemini (REST), Brevo (API v3), apisperu (REST). Sus claves van en env vars, nunca en el cliente.

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
  // Paquetes que NO deben ser bundleados por webpack — se cargan en runtime
  // desde node_modules (módulos CJS pesados o con bindings nativos del SUNAT).
  serverExternalPackages: ["archiver", "node-forge", "xml-crypto"],
};
export default nextConfig;
```

**Ya no está vacío** (cambió respecto a la versión anterior de este doc): la única opción custom es `serverExternalPackages`, que evita que webpack mal-bundlee las 3 libs del módulo de firma SUNAT. Sin esto, la emisión rompe en runtime. No hay experimental flags, rewrites ni redirects en config (los redirects de rutas legacy se hacen con `redirect()` en cada `page.tsx`; ver §4).

### 3.4 Tailwind v4 + light-mode forzado

- En `src/app/globals.css`: **`@import "tailwindcss";`** — patrón **nativo de Tailwind v4** (reemplaza `@tailwind base/components/utilities` de v3).
- `@theme inline` define variables CSS custom: `--color-background`/`--color-foreground` y `--font-sans`/`--font-mono` mapeados a Geist (`next/font/google`).
- **Light-mode forzado (NO re-agregar dark mode):** `globals.css` fija `color-scheme: light` y **ya no tiene** el bloque `@media (prefers-color-scheme: dark)`. La app está diseñada solo para modo claro (tarjetas blancas, texto oscuro); con el dark del SO activo los textos quedaban invisibles. Ver CLAUDE.md gotcha #15.
- **Animaciones de UI:** `globals.css` define keyframes reutilizables `fadeIn`/`modalIn`/`toastIn` (clases `.anim-fade`/`.anim-modal`/`.anim-toast`, curva ease-out) + un bloque global `@media (prefers-reduced-motion: reduce)`. Los modales y toasts del dashboard los usan (introducidos en el barrido de `/mejora-diseño`).
- **Existe** un `tailwind.config.js` legacy con `content` paths viejos, pero **no es la fuente principal de config en v4**. Es vestigio del scaffolding.

### 3.5 Estilos de impresión (`globals.css`, bloque `@media print`)

Hay ~100 líneas dedicadas a **`@media print`** con dos tamaños:
- **A4** (`@page { size: A4 }`) — para reportes batch de pedidos.
- **Ticket térmico 80mm** (`@page { size: 80mm 297mm }`) — formato compacto para impresora de tickets / ticketera.

Estas reglas ocultan sidebar/header, fuerzan `table-layout: fixed`, reducen padding y manejan saltos de página (`page-break-inside: avoid`). Son críticas para la **orden de pedido** imprimible (Ticket 80mm por defecto o A4, ver CLAUDE.md gotcha #20), los flujos de impresión (`/dashboard/print-modal.tsx`) y los tickets JPEG generados con `html-to-image`.

---

## 4. Estructura de carpetas

```
transavic/
├── src/
│   ├── app/
│   │   ├── api/                     # Route Handlers (backend) — ~26 grupos
│   │   │   ├── pedidos/             # CRUD + transiciones (entregar, iniciar-viaje, cancelar) + /ediciones (historial) + /guia
│   │   │   ├── despacho/            # Vista admin: asignar, asignar-externo, optimizar-ruta, reordenar
│   │   │   ├── repartidor/          # Endpoints de la vista del repartidor (mi-ruta)
│   │   │   ├── produccion/          # Cola + pesos (rol produccion)
│   │   │   ├── comprobantes/        # SUNAT: emitir, emitir-manual, [id] (xml/cdr/enviar/reintentar/anular/nota-credito), resumen-diario, export-xlsx
│   │   │   ├── facturas/            # Cobranzas (deudas; /[id]/pago)
│   │   │   ├── cobranzas/           # Aging de cartera
│   │   │   ├── consulta-documento/  # Proxy a apisperu (RUC/DNI)
│   │   │   ├── reportes/            # Reporte de ventas + export-xlsx
│   │   │   ├── metas/, incentivos/  # Metas individuales + config de incentivos
│   │   │   ├── asistente-ia/        # Insights Gemini (scoped por rol)
│   │   │   ├── buscar/              # Búsqueda global (Cmd+K)
│   │   │   ├── notificaciones/      # Campanita in-app
│   │   │   ├── mi-dia/              # Panel "Mi Día" de la asesora
│   │   │   ├── clientes/            # CRUD + autocomplete + /[id]/perfil (360°) + /[id]/pedidos
│   │   │   ├── productos/           # CRUD catálogo (devuelve/acepta codigo, precio_venta, precio_compra)
│   │   │   ├── users/, settings/    # Usuarios (admin) · key/value (base_location)
│   │   │   ├── sunat/               # Helpers/config SUNAT expuestos
│   │   │   ├── cron/                # 4 jobs: facturas-vencidas, recordatorios-asesoras, resumen-diario-sunat, daily-digest-admin
│   │   │   ├── precios/             # @deprecated (vive en /productos) — red de seguridad
│   │   │   ├── analytics/           # @deprecated (vive en /reportes)
│   │   │   ├── version/             # BUILD_ID (VersionChecker)
│   │   │   ├── dashboard/pedidos/   # Wrapper de fetchFilteredPedidos
│   │   │   └── auth/logout/         # GET logout
│   │   │
│   │   ├── dashboard/               # Páginas con auth requerida (filtradas por rol en el sidebar)
│   │   │   ├── layout.tsx           # Aplica DashboardLayout (sidebar agrupado) + VersionChecker + FloatingAssistant
│   │   │   ├── page.tsx             # Lista de pedidos (admin/asesor)
│   │   │   ├── nuevo-pedido/        # Form de creación (asesor/admin)
│   │   │   ├── mi-dia/              # Panel del día de la asesora (admin = vista previa)
│   │   │   ├── resumen/             # "Resumen del día": totales por producto (admin + produccion)
│   │   │   ├── produccion/          # Cola + pesos (admin + produccion)
│   │   │   ├── despacho/            # Tablero kanban + mapa en vivo (admin)
│   │   │   ├── mi-ruta/             # Vista mobile del repartidor (offline-first)
│   │   │   ├── clientes/            # Directorio + /[id] perfil 360°
│   │   │   ├── comprobantes/        # Lista SUNAT + /nuevo (emisión standalone)
│   │   │   ├── cobranzas/           # Cobranzas + aging
│   │   │   ├── mis-metas/           # Panel de metas/incentivos de la asesora (admin = vista previa)
│   │   │   ├── reportes/            # Hub: pestañas Ventas + Día a día (admin)
│   │   │   ├── catalogo/            # Catálogo unificado: productos + precios (admin)
│   │   │   ├── incentivos/          # Config de bonos/metas/ranking (admin)
│   │   │   ├── users/               # CRUD usuarios (admin)
│   │   │   ├── productos/, precios/, analytics/, panel-gerencial/  # → redirect() a catalogo/reportes (rutas legacy)
│   │   │   └── (componentes locales por feature: table.tsx, edit-modal.tsx, historial-pedido-modal.tsx,
│   │   │        ticket-share-modal.tsx, search.tsx, print-modal.tsx, etc.)
│   │   │
│   │   ├── login/page.tsx           # Página pública de login
│   │   ├── layout.tsx               # Root layout (fonts Geist, metadata)
│   │   ├── page.tsx                 # Raíz: redirige a /dashboard/nuevo-pedido
│   │   ├── globals.css              # Tailwind v4 + light-mode + animaciones + print styles
│   │   └── favicon.ico
│   │
│   ├── components/                  # Componentes compartidos cross-feature
│   │   ├── DashboardLayout.tsx      # Sidebar agrupado (Operación/Comercial/Reportes/Configuración) con filtro por rol
│   │   ├── VersionChecker.tsx       # Detector de BUILD_ID
│   │   ├── NotificationBell.tsx     # Campanita (polling 30s)
│   │   ├── FloatingAssistant.tsx    # Botón flotante de IA (admin/asesor)
│   │   ├── InsightCard.tsx          # Insight de IA embebido (Reportes / Mis Metas)
│   │   ├── CmdKModal.tsx            # Command palette de búsqueda global (⌘K)
│   │   ├── PedidoForm.tsx           # Form de creación de pedido
│   │   ├── ClienteAutocomplete.tsx  # Búsqueda con debounce 300ms
│   │   ├── ProductSelector.tsx      # Catálogo + carrito de items
│   │   ├── MapInput.tsx             # Captura de lat/lng (3 modos)
│   │   ├── ModalShell.tsx           # Contenedor de modal reutilizable
│   │   ├── TimeRangePicker.tsx      # Rango horario "HH:MM AM - HH:MM PM"
│   │   ├── TicketPedido.tsx         # Renderiza ticket JPEG
│   │   └── VistaImpresion.tsx       # Reporte batch (A4)
│   │
│   ├── lib/
│   │   ├── types.ts                 # Tipos: Pedido, User, Producto, PedidoItem, PedidoRuta, EstadoPedido
│   │   ├── data.ts                  # Queries reutilizables (fetchFilteredPedidos, fetchAsesores, …)
│   │   ├── roles.ts                 # homeForRole(): pantalla de inicio por rol
│   │   ├── actions.ts               # Server actions (authenticate, doLogout)
│   │   ├── offline-queue.ts         # Queue en localStorage del repartidor
│   │   ├── pedido-historial.ts      # Diff auditable de ediciones de pedido
│   │   ├── notificaciones.ts        # Helpers de la campanita + tipos + purga
│   │   ├── cobranzas.ts             # Crear/gestionar cobranzas (lazo factura↔cobranza)
│   │   ├── metas.ts, incentivos.ts  # Cálculo de metas/racha + config de incentivos
│   │   ├── insights.ts, gemini.ts   # IA comercial (8 insights + anonimizador + helper Gemini)
│   │   ├── reportes/                # datos-ventas.ts, excel-ventas.ts, pdf-ventas.ts
│   │   ├── sunat/                   # Facturación electrónica (ver §16 de CLAUDE.md)
│   │   │   ├── index.ts             # Orquesta XML → firma → SOAP → DB
│   │   │   ├── xml-builder.ts, xml-signer.ts, soap-client.ts
│   │   │   ├── config-transavic.ts  # Multi-empresa (2 RUCs), endpoints BETA/prod
│   │   │   ├── contador.ts, correlativos.ts  # Numeración atómica
│   │   │   ├── pdf-comprobante.ts, parse-cpe-items.ts, reporte-excel-comprobantes.ts
│   │   │   ├── resumen-diario.ts, duplicado.ts, validacion-cliente.ts
│   │   │   └── types.ts
│   │   ├── apisperu.ts, brevo.ts, email.ts  # Consulta RUC/DNI · correo (Brevo o SMTP)
│   │   ├── descargar-comprobante.ts, comprobante-scope.ts
│   │   └── utils.ts
│   │
│   ├── auth.ts                      # NextAuth setup (Credentials + bcrypt)
│   ├── auth.config.ts               # Callbacks JWT/session/authorized + redirect por rol
│   └── middleware.ts                # NextAuth middleware con matcher
│
├── scripts/                         # Migraciones manuales (.mjs y .sql) + seed — NO hay sistema automatizado
│   ├── seed.mjs                     # Crea users + pedidos (estructura legacy)
│   ├── migrate-*.mjs                # Migraciones históricas (products, estados, cobranzas, metas, …)
│   ├── migrate-*.sql                # Migraciones recientes (se aplican con psql, no .mjs — gotcha #13)
│   ├── migrate-produccion-2026-05-29.sql   # Consolidado del lanzamiento (8 tablas + 14 columnas, idempotente)
│   ├── rollback-produccion-2026-05-29.sql  # Rollback del consolidado
│   ├── migrate-pedido-ediciones.sql, migrate-meta-bono.sql, migrate-comprobante-{referencia,emisor,…}.sql
│   └── generar-propuesta-pdf.py     # Script Python para PDF de propuesta comercial (no app)
│
├── android/                         # Wrapper Capacitor del repartidor — EN PRODUCCIÓN (tracked desde 4 jun 2026, ver §10)
│
├── public/
│   ├── transavic.jpg, avicola.jpg   # Logos de las 2 marcas (tickets + comprobantes)
│   └── *.svg                        # Assets default de Next.js (no se usan)
│
├── docs/
│   ├── arquitectura/                # ← Estás acá (5 documentos temáticos)
│   └── superpowers/                 # specs/ + plans/ (proceso de superpowers)
│
├── CLAUDE.md                        # Contexto fundamental para agentes IA (fuente de verdad más actual)
├── vercel.json                      # Definición de los 4 cron jobs
├── .env                             # NO commiteado (DATABASE_URL, AUTH_SECRET, SUNAT_*, etc.)
├── .env.local                       # NO commiteado — override que apunta a la Neon branch dev-hugo
├── next.config.ts                   # serverExternalPackages (SUNAT)
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
| Migraciones | `migrate-<feature>.mjs` o `.sql` | `migrate-estados.mjs`, `migrate-meta-bono.sql` |

### 4.2 Los 4 roles (resumen — detalle en doc 03)

El sistema tiene **4 roles**, todos ya en producción. Los permisos viven **100% en la capa de aplicación** (no hay RLS en Neon): cada `page.tsx` server-side y cada API route hace `auth()` y filtra por rol; el sidebar (`DashboardLayout.tsx`) muestra solo las pantallas del rol vía `roles[]`/`adminOnly`.

| Rol | Quién es | Pantalla de inicio (`lib/roles.ts` + `auth.config.ts`) | Alcance |
|---|---|---|---|
| `admin` | Antonio (dueño) | `/dashboard` | Ve TODO; gestiona usuarios, catálogo, despacho, incentivos, reportes |
| `asesor` | Vendedoras (4) | `/dashboard` | Solo sus pedidos y sus clientes (scoping SQL por `asesor_id`); crea pedidos/clientes, comprobantes, cobranzas, mis-metas, mi-día |
| `repartidor` | Motorizados (6) | `/dashboard/mi-ruta` | Solo `/mi-ruta` con SUS pedidos del día (scoping por `repartidor_id`); cambia estado offline-first |
| `produccion` | Asistente de producción | `/dashboard/produccion` | `/produccion` (cola + pesos) y `/resumen` (totales por producto). En prod desde 30 may 2026 |

> **Comprobantes:** todas las asesoras ven TODOS los comprobantes (cambio del 2 jun 2026); la separación por asesora se mantiene solo en los insights de IA. Ver CLAUDE.md §13.

> **Ojo (drift de CLAUDE.md):** CLAUDE.md §6 dice que admin/asesor redirigen a `/dashboard/nuevo-pedido`, pero el código (`auth.config.ts` + `lib/roles.ts`) los manda a `/dashboard` (Lista de Pedidos). Este doc refleja el **código**.

---

## 5. Cómo correr en local

### 5.1 Variables de entorno (`.env`)

El **núcleo mínimo** para levantar la app (pedidos + despacho + auth + mapas):

```bash
# Postgres (Neon)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host/db?sslmode=require  # migraciones largas / psql

# NextAuth
AUTH_SECRET=<string aleatorio largo>
AUTH_URL=http://localhost:3000

# Google Maps (DOS variables)
NEXT_PUBLIC_MAPS_API_KEY=<key con permisos Maps JS + Places>   # cliente
Maps_SERVER_KEY=<key con permisos Directions + Geocoding>      # servidor
# ⚠️ Ojo el naming: M mayúscula + guion bajo, no MAPS_SERVER_KEY

# Ubicación base del almacén (fallback si no hay row en settings.base_location)
BASE_LATITUDE=-12.0464
BASE_LONGITUDE=-77.0428
```

Los **módulos nuevos** requieren más vars (en producción están todas en Vercel; en local en `.env`/`.env.local`):

| Módulo | Vars (ver CLAUDE.md §4 para el detalle completo) |
|---|---|
| SUNAT / facturación | `SUNAT_ENVIRONMENT` (beta/production) + `SUNAT_TRA_*` y `SUNAT_AVI_*` (RUC, razón social, dirección, ubigeo, usuario/clave SOL, cert `.p12` en base64). 2 empresas. |
| Comprobante automático | `AUTO_EMITIR_COMPROBANTE` (flag opcional `"true"`) |
| Correo de comprobantes | `BREVO_API_KEY` + `BREVO_SENDER_*` (preferido); fallback `SMTP_*` + `SMTP_FROM_*` |
| Consulta RUC/DNI | `APISPERU_TOKEN` |
| IA comercial | `GEMINI_API_KEY` |
| Cron jobs | `CRON_SECRET` (sin él, los 4 crons devuelven 503) |

> `.env` define más variables (POSTGRES_*, PGHOST, NEXT_PUBLIC_STACK_*) pero **no se usan en código activo** — residuo de templates de Vercel/Neon Auth. `ADMIN_USER`/`ADMIN_PASSWORD` también son legacy: la auth real lee de la tabla `users`.
>
> **`.env.local`** (no commiteado) apunta a la Neon branch `dev-hugo` para testing aislado de producción; Next.js lo carga con prioridad sobre `.env`.

### 5.2 Comandos básicos y migraciones

```bash
npm install                          # Instalar dependencias
npm run seed                         # Crear tablas users + pedidos (DESTRUCTIVO: DROP TABLE)
node scripts/migrate-products.mjs    # Crear productos + pedido_items + catálogo
node scripts/migrate-estados.mjs     # Agregar estado moderno + índices
# ... resto de scripts/migrate-*.mjs históricos ...
npm run dev                          # http://localhost:3000
```

**No hay sistema de migraciones automatizado** — son scripts manuales en `/scripts/`. Hay dos generaciones:
- **`.mjs`** (los históricos): se corren con `node scripts/migrate-X.mjs`.
- **`.sql`** (los recientes): se aplican con **psql**, NO con `node` — el bug DNS de Node 26 + `@neondatabase/serverless` los rompe (`fetch failed`, gotcha #13). Ejemplo: `psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-<feature>.sql`.

**Para levantar una base nueva desde cero**, lo más rápido es aplicar el consolidado del lanzamiento, que es **idempotente y aditivo** (8 tablas + 14 columnas que faltaban respecto al seed legacy):

```bash
psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-produccion-2026-05-29.sql
# rollback: scripts/rollback-produccion-2026-05-29.sql
```

> **Flujo de cambios de esquema** (post-lanzamiento): probar en la branch `dev-hugo`, y al mergear a `main` aplicar la migración a **producción por psql ANTES** de que el deploy del código nuevo quede activo (si no, el código choca con columnas/tablas que faltan). Al agregar una migración nueva, crear un archivo nuevo siguiendo el patrón — **no modificar** migraciones existentes ni el `seed.mjs`.

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

- **Hosting:** Vercel, proyecto `hugoherrerateam/transavic`, plan **Pro** (cuenta `hugoherreracoach@gmail.com`).
- **Trigger:** push a `main` → deploy continuo. **Rollback instantáneo** disponible si algo sale mal.
- **Build command:** `next build` (implícito).
- **Output:** `.next/` con un `BUILD_ID` único generado por Next.js en cada build.
- **URL producción:** `transavic.vercel.app`.
- **Env vars de producción:** las ~24 vars del lanzamiento (SUNAT reales con `SUNAT_ENVIRONMENT=production`, certs `.p12` en base64, `APISPERU_TOKEN`, `BREVO_*`, `GEMINI_API_KEY`, `CRON_SECRET`) viven SOLO en Vercel + archivos gitignored — nunca en el repo.

### 6.2 Cron jobs (`vercel.json`)

Vercel dispara **4 cron jobs** (el plan Pro permite hasta 40 crons; Hobby solo 2). Todos están protegidos con `CRON_SECRET` (Vercel los invoca con `Authorization: Bearer <CRON_SECRET>`; sin él devuelven **503**). Horarios en UTC (Lima es UTC-5):

| Cron | Schedule (UTC) | Hora Lima | Qué hace |
|---|---|---|---|
| `/api/cron/facturas-vencidas` | `0 13 * * *` | 08:00 | Marca/avisa cobranzas vencidas |
| `/api/cron/daily-digest-admin` | `30 13 * * *` | 08:30 | Digest consolidado a Antonio (cobranzas + comprobantes en error + pendientes) + **purga notificaciones leídas > 30 días** |
| `/api/cron/recordatorios-asesoras` | `0 17 * * *` | 12:00 | Recordatorios a las asesoras |
| `/api/cron/resumen-diario-sunat` | `0 7 * * *` | 02:00 | Envía el Resumen Diario de boletas a SUNAT (idempotente) |

> Las tareas de mantenimiento (ej. purga de notificaciones) se **enganchan a un cron existente** en vez de crear uno nuevo, para no consumir el cupo.

### 6.3 VersionChecker — por qué existe

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
| **No usar ORM** | Schema simple, queries claras con SQL nativo. Neon HTTP no se beneficia de ORM. | Todo el data layer usa `sql\`SELECT...\`` directo (`lib/data.ts`, `api/*/route.ts`). Hay `sql.query(query, params)` para queries dinámicas. |
| **Permisos en la app, no en la DB** | Neon no usa RLS; el scoping por rol es más simple y testeable en SQL de la app. | Cada `page.tsx` server-side hace `auth()` + `homeForRole` redirect; cada API filtra por rol (ver `lib/data.ts:fetchFilteredPedidos`). Ver doc 03. |
| **No PWA pura para repartidor** | iOS bloquea GPS en background para PWAs. Por eso se envuelve `/mi-ruta` con Capacitor (app nativa Android). | Carpeta `android/` (Capacitor) — **en producción** (commiteada a `main`, publicada en Google Play). La app nativa rastrea en segundo plano (foreground service); la web manda GPS solo con la app abierta. Ver §10. |
| **Pedidos denormalizados** | Preservar histórico: si el cliente cambia dirección, los pedidos pasados no se reescriben. | `pedidos` copia `cliente`, `whatsapp`, `direccion`, etc. del cliente al INSERT. Hay también `cliente_id` (FK viva). Ver doc 02. |
| **Doble fuente de verdad estado/entregado** | Migración progresiva del legacy `entregado: boolean` al moderno `estado: varchar`. Se mantienen sincronizados. | Sync en `PATCH /api/pedidos/[id]`. Ver doc 02, doc 04 y CLAUDE.md gotcha #1. |
| **Medición de asesora por VENTAS (`created_at`), no por entregas** | La asesora vende, el repartidor entrega días después (~86% en fecha posterior). Medir por entrega mezclaría esfuerzos. | Metas/racha/ranking/equipo cuentan por `created_at` (`lib/metas.ts`). Los reportes de admin sí miden facturación ENTREGADA. Ver CLAUDE.md gotcha #8 / §13. |
| **Precios CON IGV incluido** | Es lo que Antonio cobra al cliente. | `productos.precio_venta` y `pedido_items.precio_unitario` con IGV; se divide entre 1.18 antes de mandar a SUNAT (`api/comprobantes/emitir`). Ver CLAUDE.md gotcha #10. |
| **distancia_km se congela al asignar** | El admin/repartidor quiere saber "este cliente está a X km del local", no la distancia desde el pedido anterior en la ruta. | `optimizar-ruta` solo actualiza `orden_ruta` y `duracion_estimada_min`, no `distancia_km`. |
| **Polling en lugar de websockets** | Volumen actual (~30 pedidos/día) no justifica websockets. El tracking GPS en vivo (Fase C) **también salió con polling** — Pusher se evaluó pero se descartó (cero infra, $0). | `/despacho` refresca cada **15s** (y ahí levanta la ubicación viva de cada moto), `/mi-ruta` cada **60s**, campanita `NotificationBell` cada **30s**. La app reporta su GPS cada ~12s a `/api/repartidor/ubicacion`. |
| **GPS bajo demanda** | Ahorrar batería del motorizado. | El navegador solo pide ubicación cuando el mapa está visible o hay un pedido `En_Camino` (`mi-ruta-content.tsx`). |
| **Reinstanciación de cliente Neon** | El driver HTTP de Neon no es un pool — es seguro y barato reinstanciar por handler. | `const sql = neon(process.env.DATABASE_URL!)` aparece en cada `route.ts`. |
| **Settings como key/value JSONB** | Extensible sin migraciones futuras. | Hoy hay 2 entradas: `base_location` y `incentivos_config`. `api/settings/route.ts` lee/escribe. |
| **PDFs/tickets HTML, no servicios de PDF** | Costo $0. | Orden de pedido por `window.print()` (`@media print`); ticket WhatsApp por `html-to-image`; PDF de comprobante/reporte por `jspdf` en cliente. |
| **Offline-first solo en el repartidor** | El repartidor está en la moto, las asesoras están en oficina con WiFi. | `src/lib/offline-queue.ts` solo se usa en `mi-ruta-content.tsx`. Ver doc 04. |
| **Optimistic updates** | UX inmediata aunque la API tarde 1-2s o falle. | Drag-and-drop en `/despacho` y transiciones de estado en `/mi-ruta` actualizan UI antes de la API. |
| **Pantalla de inicio por rol centralizada** | Evitar loops de redirección a vistas que el rol no puede ver. | `lib/roles.ts:homeForRole()` lo usan los guards de página; `auth.config.ts` redirige al loguear. |
| **Dos rutas de logout** | Inconsistencia histórica — `/api/auth/logout` (GET, redirige a `/`) y `doLogout()` (server action, redirige a `/login`). | Ver `api/auth/logout/route.ts` y `lib/actions.ts:doLogout`. **Pendiente unificar.** |

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

**Implicación:** las páginas (`/dashboard/*`, `/login`, `/`) pasan por el middleware. Las APIs **no**, así que cada handler debe llamar `await auth()` manualmente si requiere autenticación. Los `/api/cron/*` no tienen sesión de usuario: validan el `CRON_SECRET` que manda Vercel (sin él, 503).

### 8.3 Layout raíz (`src/app/layout.tsx`)

- Importa **fuentes Geist** (sans + mono) de `next/font/google` con `next/font` (optimización automática).
- Define CSS variables `--font-geist-sans` y `--font-geist-mono` en `<body>`.
- Metadata: `title: "Transavic"`, `description: "Generador de pedidos"`.
- HTML `lang="en"` — **pendiente actualizar a `es-PE`** para coherencia con el contenido en español.

---

## 9. Cómo verificar que este documento sigue vigente

Cuando agregues funcionalidad nueva, ejecuta estas verificaciones y actualiza este documento si alguna cambia:

```bash
# 1. Versiones del stack (incluye libs de SUNAT/PDF/Excel)
cat package.json | grep -E '"(next|react|next-auth|tailwindcss|zod|@neondatabase|xmlbuilder2|xml-crypto|node-forge|archiver|jspdf|xlsx|nodemailer|browser-image-compression)"'

# 2. Configuración Next.js — ¿sigue solo con serverExternalPackages?
cat next.config.ts

# 3. Configuración TypeScript — strict sigue activo?
grep -E '"(strict|target|paths)"' tsconfig.json

# 4. Estructura de carpetas top-level
ls src/app/ src/components/ src/lib/ src/lib/sunat/ src/lib/reportes/

# 5. ¿Hay APIs nuevas que agregar al diagrama?
ls src/app/api/

# 6. ¿Hay rutas de dashboard nuevas?
ls src/app/dashboard/

# 7. ¿Hay scripts/migraciones nuevas?
ls scripts/

# 8. ¿Cambió el set de cron jobs?
cat vercel.json

# 9. ¿Sigue VersionChecker con polling de 60s?
grep -n "CHECK_INTERVAL_MS" src/components/VersionChecker.tsx

# 10. ¿Sigue el matcher del middleware igual?
cat src/middleware.ts

# 11. ¿La página raíz sigue redirigiendo a nuevo-pedido? ¿Y el redirect por rol?
cat src/app/page.tsx src/lib/roles.ts

# 12. ¿Sigue el enum de estados y los 4 roles?
grep -n "EstadoPedido" src/lib/types.ts
grep -n "roles:\|adminOnly" src/components/DashboardLayout.tsx
```

Si encuentras drift, actualizá las secciones afectadas y bumpeá la fecha del header.

---

## 10. Estado del proyecto y roadmap

### 🚀 Lanzado a producción — 30 may 2026

El sistema base + las 8 mejoras acordadas con Antonio están **desplegadas y en vivo** en `main` → Vercel (`transavic.vercel.app`, plan Pro). La DB de producción se migró con `scripts/migrate-produccion-2026-05-29.sql` (por psql); la data real quedó intacta. Resumen del estado (detalle en CLAUDE.md §13):

| # | Mejora | Estado |
|---|---|---|
| 1 | Pesos digitales + flujo de producción (estados `En_Produccion`/`Listo_Para_Despacho`, rol `produccion`) | ✅ En producción |
| 2 | Orden de pedido digital (HTML imprimible, ticket 80mm/A4) + foto firmada | ✅ En producción |
| 4 | Avisos automáticos entre áreas (campanita, polling 30s) | ✅ En producción |
| 5 | Dashboard comercial + metas/incentivos + reportes | ✅ En producción |
| 6 | Cobranzas con plazos + aging + cron diario | ✅ En producción |
| 7 | SUNAT con 2 RUCs (XML UBL 2.1 + firma + SOAP + CDR) + emisión standalone + NC + consulta RUC/DNI + correo Brevo | ✅ En producción · validado en BETA |
| 8 | IA comercial Gemini (admin + asesoras scoped) | ✅ En producción ⚠️ (caché 429 — gotcha #16) |
| 3 | Seguimiento del motorizado en vivo (Capacitor, **polling** — sin Pusher) | ✅ En producción (4 jun 2026) — ver abajo |

### App nativa del motorizado (Capacitor) — EN PRODUCCIÓN (4 jun 2026)

La carpeta **`android/`** (wrapper Capacitor de `/mi-ruta` para tener GPS en background, que iOS/PWA bloquean) **se commiteó a `main`** y la app se **publicó en Google Play** (Prueba Interna). La app "cascarón" **carga la web** (`server.url=https://transavic.vercel.app`) y aporta lo que el navegador no puede: GPS en segundo plano vía *foreground service*. Reporta su posición cada ~12s a `POST /api/repartidor/ubicacion` (UPSERT en `rider_locations`, 1 fila viva por motorizado); el mapa de despacho del admin la levanta en su poll de 15s. **El tracking en vivo NO usa Pusher** — quedó descartado a favor del polling existente (cero infra, $0). Validada en teléfono real (HONOR Android 15) con la pantalla bloqueada. Todos los motorizados usan Android (no hay app iOS planificada). Detalle técnico completo en CLAUDE.md → sección "App Repartidor — Capacitor + GPS en vivo".

### Próximas fases (no cotizadas)

- CRM con WhatsApp Business API (Antonio lo postpuso).
- Persistir el caché de IA en la DB para evitar el 429 de Gemini bajo carga (gotcha #16).

---

## Siguientes documentos

- **`02-modelo-de-datos.md`** — todas las tablas, columnas, relaciones, decisiones de schema.
- **`03-autenticacion-y-roles.md`** — NextAuth, JWT, scoping por rol con código real.
- **`04-flujos-de-negocio.md`** — vida del pedido paso a paso, máquina de estados.
- **`05-apis-e-integraciones.md`** — referencia de endpoints + Google Maps + offline queue.

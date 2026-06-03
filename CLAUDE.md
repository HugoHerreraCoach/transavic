# CLAUDE.md — Transavic

Contexto del proyecto para agentes de IA. Léeme **antes** de tocar código.

> **📚 Para profundizar en cualquier área:** ver `docs/arquitectura/` (5 documentos temáticos verificados contra código). Empezar por [`docs/arquitectura/README.md`](./docs/arquitectura/README.md) que tiene un mapa "si vas a tocar X, lee Y".

---

## 1. Qué es este proyecto

**Sistema interno de gestión de pedidos** para una distribuidora avícola en Lima, Perú que opera dos marcas comerciales bajo el mismo dueño:

- **Transavic** — marca principal (pollo, gallinas, menudencia)
- **Avícola de Tony** — segunda marca (mismo flujo)

**Dueño / cliente final:** Antonio Resurrección.
**Productos:** pollo (entero, despresado, filetes), carnes (res, cerdo), huevos.
**Modelo:** venta al por mayor y menor a restaurantes, mayoristas y consumidores finales.
**Cobertura operativa:** 18 distritos de Lima Metropolitana.
**Volumen actual:** ~30 pedidos/día, 6 motorizados, 4 asesoras, 1 admin.

**No es** un e-commerce público ni un marketplace. Es un **ERP ligero interno** para la operación diaria. Los clientes finales no se loguean — los pedidos los crean las asesoras al recibirlos por WhatsApp.

---

## 2. Stack técnico

| Área | Tecnología |
|---|---|
| Framework | **Next.js 15** (App Router, Server Components + Server Actions) |
| Lenguaje | **TypeScript** (`strict: true`) |
| UI | **TailwindCSS v4** + `react-icons` (Feather) |
| Auth | **NextAuth v5 beta** + Credentials provider + `bcrypt` |
| Base de datos | **Neon Postgres** vía `@neondatabase/serverless` (HTTP, no pool) |
| Validación | **zod** (en cada API route) |
| Drag & drop | `@hello-pangea/dnd` (fork mantenido de react-beautiful-dnd) |
| Mapas | `@react-google-maps/api` + Google Maps Platform (Maps JS, Directions, Geocoding, Places) |
| Imágenes a JPEG | `html-to-image` (para compartir tickets por WhatsApp) |
| Offline | `localStorage` (NO IndexedDB) — ver `src/lib/offline-queue.ts` |
| Hosting | **Vercel** (deploy continuo desde main) |

**No usar ORM.** Las queries son SQL directo con tagged template literals de Neon (`sql\`SELECT ... \``). Hay queries dinámicas con `sql.query(query, params)` cuando hace falta.

**No usar PWA con background GPS.** iOS lo bloquea. Para el repartidor estamos planificando envolver `/dashboard/mi-ruta` con **Capacitor** (wrapper nativo) para tener GPS en background.

---

## 3. Comandos

```bash
npm run dev      # Desarrollo local en http://localhost:3000
npm run build    # Build de producción
npm run start    # Servir build
npm run lint     # ESLint (next/core-web-vitals + next/typescript)
npm run seed     # ./scripts/seed.mjs — crea tablas users + pedidos + seed inicial
```

**Migraciones:** scripts .mjs manuales en `/scripts/`. **No hay sistema automatizado.** Ejecutarlos uno a uno:

```bash
node scripts/migrate-products.mjs
node scripts/migrate-estados.mjs
node scripts/migrate-direccion-mapa.mjs
node scripts/migrate-entregado-por.mjs
node scripts/migrate-despacho-v2.mjs
node scripts/run-migration.mjs            # agrega asesor_id a clientes
# scripts/migration_add_asesor_to_clientes.sql — ejecutar manualmente en Neon
```

Cuando agregues una migración nueva, **crear nuevo archivo `migrate-<feature>.mjs`** siguiendo el patrón existente (con `CREATE EXTENSION IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.). No modificar migraciones existentes.

> **Migración a producción (30 may 2026):** el esquema de producción se puso al día con **`scripts/migrate-produccion-2026-05-29.sql`** (consolida 8 tablas + 14 columnas que faltaban; idempotente y aditivo). Se aplica con **psql**, NO con los `.mjs` (Node 26 + `@neondatabase/serverless` falla — gotcha #13): `psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-produccion-2026-05-29.sql`. Rollback: `scripts/rollback-produccion-2026-05-29.sql`. Para futuros cambios de esquema, aplicar a producción por psql **antes** de que el deploy del código nuevo quede activo.

---

## 4. Variables de entorno

Definidas en `.env` (no comiteado). Las críticas:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión Neon (pooled) |
| `DATABASE_URL_UNPOOLED` | Conexión Neon directa (para migraciones largas) |
| `AUTH_SECRET` | Firma JWT de NextAuth |
| `AUTH_URL` | URL base para callbacks NextAuth |
| `NEXT_PUBLIC_MAPS_API_KEY` | Google Maps JS (cliente) |
| `Maps_SERVER_KEY` | Google Directions / Geocoding (server-side) — **ojo el naming inusual** (camelCase con M mayúscula y guión bajo, NO `MAPS_SERVER_KEY` ni `GOOGLE_MAPS_SERVER_KEY`) |
| `BASE_LATITUDE`, `BASE_LONGITUDE` | Fallback de ubicación del almacén; la fuente real es la tabla `settings.base_location` |
| `GEMINI_API_KEY` | Gemini Flash Latest para módulo de IA comercial (Fase C). Cuenta dedicada `transavicdev@gmail.com` (project 88126347805) — separada de otros proyectos personales |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP para enviar comprobantes por correo (Gmail con app password, SendGrid, Mailgun, etc.) |
| `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Override de remitente del correo (default name="Transavic", email=SMTP_USER) |
| `APISPERU_TOKEN` | Token de apisperu.com (cuenta `transavicdev@gmail.com`) para consultar RUC/DNI y auto-llenar datos del cliente (form de clientes, módulo emitir comprobante). Solo server-side vía `/api/consulta-documento`. **Configurar también en Vercel.** |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Brevo (correos transaccionales, free 300/día). Si `BREVO_API_KEY` está, `lib/email.ts` usa la API de Brevo (preferida); si no, cae a SMTP/nodemailer. El sender debe estar verificado en Brevo (hoy `transavicdev@gmail.com`, activo). **Configurar también en Vercel.** |
| `CRON_SECRET` | Secreto que protege los **4 cron jobs** de Vercel (`/api/cron/facturas-vencidas`, `/recordatorios-asesoras`, `/resumen-diario-sunat`, `/daily-digest-admin`). Sin él, esos endpoints devuelven **503**. Vercel lo manda como `Authorization: Bearer <CRON_SECRET>`. **Obligatorio en Vercel** para que los crons corran. **Ojo con el límite de Vercel: Hobby permite solo 2 crons (1×/día); Pro permite 40.** Por eso las tareas de mantenimiento (ej. purga de notificaciones viejas) se enganchan a un cron existente en vez de crear uno nuevo. |
| `AUTO_EMITIR_COMPROBANTE` | Flag opcional (`"true"`) para emitir el comprobante automáticamente al cerrar un pedido. Si no está o es falso, la emisión es manual desde `/dashboard/comprobantes`. |
| `SUNAT_TRA_NOMBRE_COMERCIAL`, `SUNAT_TRA_DEPARTAMENTO`, `SUNAT_TRA_PROVINCIA`, `SUNAT_TRA_DISTRITO` (idem `SUNAT_AVI_*`) | Override del domicilio fiscal del emisor en el XML. El default del `DATOS_EMISOR_MAP` es placeholder ("LA VICTORIA"); en producción **conviene** setear el distrito/provincia/departamento reales. La dirección y el `UBIGEO` (lo legalmente crítico) ya se overridean con `SUNAT_*_DIRECCION` / `SUNAT_*_UBIGEO`. Además **`SUNAT_*_URBANIZACION`** → `cbc:CitySubdivisionName`: **vacío por defecto = se OMITE** del XML (un valor vacío dispara la observación SUNAT 4095); setealo solo si la ficha RUC tiene urbanización. |

`ADMIN_USER`/`ADMIN_PASSWORD` están en `.env` pero **no se usan en código activo** (legacy del scaffolding inicial). La auth real lee de la tabla `users`.

**`.env.local` (NO comiteado, override de `.env`)** apunta a la branch Neon `dev-hugo` para testing aislado de producción. Next.js lo carga con prioridad sobre `.env`. Sigue en `SUNAT_ENVIRONMENT=beta` (con `MODDATOS`) para testing local.

**Producción (Vercel) ya tiene TODAS estas vars configuradas (30 may 2026):** las 24 del lanzamiento — todas las `SUNAT_*` reales (`APIFACTU`/`Transavic123`, `SUNAT_ENVIRONMENT=production`, certs `.p12` en base64), `APISPERU_TOKEN`, `BREVO_*`, `GEMINI_API_KEY`, `CRON_SECRET` — además de las que ya existían (DB, Auth, Maps). Se cargaron por `vercel env add` (cuenta `hugoherreracoach`, proyecto `hugoherrerateam/transavic`). Las credenciales reales viven SOLO en Vercel + `.env.local`/`CREDENCIALES-PRODUCCION.local.md` (gitignored), nunca en el repo.

---

## 5. Estructura del código (alto nivel)

```
src/
├── app/
│   ├── api/                      # Backend (Route Handlers)
│   │   ├── pedidos/              # CRUD de pedidos + transiciones
│   │   ├── despacho/             # Vista admin de despacho (kanban + asignación + ruta)
│   │   ├── repartidor/mi-ruta/   # Endpoint específico del repartidor
│   │   ├── clientes/, productos/, users/, analytics/, settings/, resumen-diario/
│   │   └── version/              # BUILD_ID para VersionChecker
│   ├── dashboard/                # UI con auth obligatoria
│   │   ├── (rutas por feature)/
│   │   └── layout.tsx            # Aplica DashboardLayout con sidebar
│   ├── login/, layout.tsx, page.tsx
├── components/                   # Componentes compartidos cross-feature
├── lib/
│   ├── types.ts                  # Pedido, Cliente, User, EstadoPedido, etc.
│   ├── data.ts                   # Queries reutilizables (fetchFilteredPedidos, fetchAsesores...)
│   ├── actions.ts                # Server actions (authenticate, doLogout)
│   ├── offline-queue.ts          # Queue de acciones del repartidor (localStorage)
│   └── utils.ts
├── auth.ts                       # NextAuth setup
├── auth.config.ts                # Callbacks + redirects por rol
└── middleware.ts                 # Protege /dashboard/*

scripts/                          # Migraciones manuales + seed
public/                           # transavic.jpg, avicola.jpg (logos para tickets)
```

**Path alias:** `@/*` → `./src/*`.

---

## 6. Roles y permisos

El sistema tiene **4 roles** (el de `produccion` ya está en producción desde el 30 may 2026):

| Rol | Quién es | Qué ve | Permisos clave |
|---|---|---|---|
| `admin` | Antonio (dueño) | Todo | Gestionar usuarios, productos, despacho, base_location, ver TODOS los pedidos |
| `asesor` | Vendedoras (Leslie, Yoshelin, Sarai, Yesica) | Solo sus pedidos y sus clientes | Crear pedidos y clientes; ver lista propia. Scoping en SQL por `asesor_id = userId` |
| `repartidor` | Motorizados (Marco, Yhorner, Anghelo, etc.) | Solo `/mi-ruta` con SUS pedidos del día | Cambiar estado de SUS pedidos. Scoping por `repartidor_id = userId` |
| `produccion` | Asistente de producción (en otro distrito que la oficina) | Solo `/dashboard/produccion`: cola del día + búsqueda + ingresar pesos reales | Marcar pesos y "listo para despacho" en SUS pedidos. Scoping en `/api/produccion/*`. Login redirige a `/dashboard/produccion` (`auth.config.ts`). ✅ en producción |

**Login redirige por rol** (fuente central: `lib/roles.ts:homeForRole`, usado por los guards de página):
- `repartidor` → `/dashboard/mi-ruta`
- `produccion` → `/dashboard/produccion`
- `admin` / `asesor` → `/dashboard` (lista de pedidos)

> Matiz (el código tiene dos caminos): el login por formulario (`lib/actions.ts`) cae en `/dashboard`, y ahí `dashboard/page.tsx` deja a admin/asesor o reenvía a repartidor/producción con `homeForRole`. En cambio, el callback `auth.config.ts:authorized` (cuando un usuario YA logueado entra a `/login`) y la raíz `/` mandan a admin/asesor a `/dashboard/nuevo-pedido`. Ambos destinos son válidos para esos roles.

**El scoping NO está en middleware**, está en cada query SQL. Si agregas un nuevo endpoint, **NO te olvides de filtrar por rol** (ver `lib/data.ts:fetchFilteredPedidos` como referencia).

---

## 7. Modelo de datos (resumen)

### Tablas

```
users              → auth + roles (admin/asesor/repartidor)
clientes           → directorio de clientes recurrentes (con asesor_id)
pedidos            → tabla central (DENORMALIZADA del cliente — ver §8)
pedido_items       → relación pedido↔producto con cantidad/unidad
productos          → catálogo (Pollo/Carnes/Huevos)
settings           → key/value JSONB (hoy solo 'base_location')
```

### Convenciones

- **DB columnas:** `snake_case` (`fecha_pedido`, `repartidor_id`).
- **TypeScript propiedades:** mantiene `snake_case` cuando viene de DB; `camelCase` cuando son campos derivados o de UI.
- **Fechas:** `DATE` para `fecha_pedido`, `TIMESTAMP WITH TIME ZONE` para timestamps de evento.
- **Timezone en queries:** SIEMPRE `(NOW() AT TIME ZONE 'America/Lima')::date` cuando se compara "hoy". Lima está en UTC-5 sin DST.
- **IDs:** UUID v4 (`uuid_generate_v4()`).
- **Numéricos:** `NUMERIC(6,2)` para distancias km, `DECIMAL(10,2)` para cantidades de productos, `DECIMAL(10,8)` para latitude / `DECIMAL(11,8)` para longitude.

### Decisión: pedidos denormalizados

`pedidos` **copia** `cliente`, `whatsapp`, `direccion`, `lat/lng` del `cliente` al crear el pedido. Esto es deliberado:

- Preserva historial — si el cliente cambia de dirección, los pedidos pasados no se reescriben.
- `cliente_id` se inserta en `pedidos` (vínculo "vivo") pero **no está en el tipo `Pedido` de TS** todavía. Si lo necesitas, agrégalo a `lib/types.ts`.

---

## 8. Máquina de estados del pedido

```
Pendiente ──asignar──▶ Asignado ──iniciar viaje──▶ En_Camino ──entregar──▶ Entregado
                          │                            │                    │
                          │                            ├──cancelar──┐       │
                          ├──entrega directa──┐        │            │       │
                          │                   ▼        ▼            ▼       ▼
                          └──fallar──▶  Fallido    Asignado    Asignado  (revertible)
```

**Estados:** `Pendiente | Asignado | En_Camino | Entregado | Fallido` (PascalCase con underscore).

**Reglas importantes:**

1. **Saltos permitidos** (no obligatorio pasar por En_Camino): el repartidor puede ir Asignado → Entregado/Fallido directo (entrega mostrador). Ver `api/pedidos/[id]/entregar/route.ts`.
2. **Reverso completo**: PATCH `/entregar` revierte cualquier completado de vuelta a `Asignado` limpiando timestamps.
3. **Fallido REQUIERE `razon_fallo`** (≥5 caracteres). Validado con zod refine.
4. **`entregado_por` se llena con `session.user.name`** desde quien dispara la transición — útil cuando admin marca por el repartidor.
5. **`distancia_km` se congela al asignar**, NO se sobreescribe al optimizar ruta. Solo `orden_ruta` y `duracion_estimada_min` cambian.

**Los dos estados de producción YA EXISTEN y están en producción** (Mejora 1, desde 30 may 2026): `En_Produccion` y `Listo_Para_Despacho` van antes de `Asignado` (ver el enum `EstadoPedido` en `lib/types.ts`). Si en el futuro amplías el enum de nuevo, actualizar también `lib/types.ts`, las validaciones zod en `/api/pedidos/[id]/route.ts` y los `CASE` de orden en queries.

---

## 9. Convenciones de código

- **Idioma:** Español en variables, funciones, comentarios, mensajes de UI, errores y commits. Excepción: identificadores estándar como `useState`, `Map`, etc. Mantener consistencia.
  - **Español NEUTRO (tuteo), NUNCA voseo argentino** en todo texto visible al usuario (JSX, placeholders, labels, toasts, errores mostrados, notificaciones, correos) **y en los prompts de la IA** (`lib/insights.ts`). Transavic es de Lima, Perú. Usar "carga / toca / quieres / aquí / eres / ingresa / revisa", NO "cargá / tocá / querés / acá / sos / ingresá / revisá". En los prompts de Gemini pedir explícitamente "español neutro latinoamericano" (no "rioplatense"). Los comentarios de código son tolerables en cualquier registro (no los ve el usuario), pero al escribir copys nuevos, neutro siempre. (Barrido de neutralización hecho en mayo 2026; ver [[copys-espanol-neutro]] en memoria.)
- **Validación de input en APIs:** zod siempre, antes de tocar DB. Patrón: `Schema.safeParse(body)` → si falla, 400 con `error.flatten().fieldErrors`.
- **Errores en APIs:** `try/catch` con `console.error("Mensaje:", error)` + `NextResponse.json({ error: "..." }, { status: N })`.
- **Status codes:** 400 input inválido, 401 no autenticado, 403 sin permisos, 404 no encontrado, 409 conflicto, 500 error servidor.
- **Auth check en cada API:** `const session = await auth(); if (!session?.user) return 401`. Si requiere admin: `session.user.role !== "admin"` → 403.
- **`export const dynamic = "force-dynamic"`** en rutas que dependen de sesión o leen DB en tiempo real.
- **Cliente Neon:** instanciar dentro del handler (`const sql = neon(process.env.DATABASE_URL!)`) — el cliente HTTP de Neon no es un pool, es seguro reinstanciar.
- **Componentes cliente:** `"use client"` en la primera línea cuando usan hooks/eventos.
- **Naming de archivos:** `kebab-case.tsx` (`dashboard-content.tsx`), excepto componentes compartidos (`PedidoForm.tsx`, `DashboardLayout.tsx`).
- **No usar emojis en strings de Paragraph de reportlab** (cuando generes PDFs) — usar texto plano.

---

## 10. Integraciones externas

### Google Maps Platform
- **Maps JS** (cliente): `useJsApiLoader({ googleMapsApiKey: NEXT_PUBLIC_MAPS_API_KEY, libraries: ["places"] })`.
- **Directions** (server): en asignar pedido, iniciar viaje, optimizar ruta. Usa `Maps_SERVER_KEY`.
- **Optimización de ruta:** Directions con `waypoints=optimize:true` — Google resuelve TSP heurístico. Límite 25 waypoints (handle remaining en `optimizar-ruta/route.ts`).
- **Fallback Haversine** si no hay key o falla Google (`haversineKm()` en `asignar/route.ts`).
- **Costo actual:** ~$48/mes consumido, dentro de los $200/mes gratis de Google. Margen amplio.

### Neon Postgres
- HTTP serverless driver — no es un pool, reinstanciar por request.
- Conexión pooled (`DATABASE_URL`) para uso normal; unpooled (`DATABASE_URL_UNPOOLED`) si necesitas transacciones largas o migraciones pesadas.
- **No hay migraciones automáticas** — ver §3.

### Vercel
- Deploy continuo desde `main`.
- BUILD_ID se lee en `/api/version` para que `VersionChecker.tsx` fuerce reload cuando hay nuevo deploy (evita repartidores con bundle viejo).

### Próximas (mejoras 2026)
- **Pusher Channels** (free tier) para tracking GPS en vivo.
- **Capacitor** para wrapper Android de `/mi-ruta`.
- **Gemini API** (free tier) para módulo de IA comercial. Anonimizar nombres de clientes antes de mandar a Gemini.
- **SUNAT PSE** (proveedor de facturación electrónica autorizado) para emisión de boletas/facturas — el cliente lo contrata por separado.

---

## 11. Patrones técnicos críticos

### 11.1 Optimistic updates + Offline queue (repartidor)

En `mi-ruta-content.tsx`, cuando el repartidor toca un botón de transición (Entregar, Fallar, Iniciar viaje):

1. Cambia estado **localmente primero** (UI inmediata).
2. Intenta llamar a la API.
3. Si está offline → encola en `localStorage` (`transavic_offline_queue`).
4. Cuando vuelve la conexión, `syncQueue()` reintenta (max 3 retries) y maneja conflictos (estado ya cambió en servidor) descartando sin error.

**Cualquier endpoint que el repartidor llame debe ser idempotente.** Si por la naturaleza optimistic se llama dos veces, no debe romper.

### 11.2 Polling para actualizaciones

- `/dashboard/despacho` refresca cada **15s** (auto).
- `/dashboard/mi-ruta` refresca cada **60s** (auto).
- **No hay websockets** (todavía — viene con Pusher para el módulo de tracking en vivo).

### 11.3 GPS bajo demanda

El navegador solo pide ubicación al repartidor cuando el mapa está visible o hay pedido `En_Camino`. Es decisión explícita para ahorrar batería.

### 11.4 VersionChecker

`/api/version` devuelve `BUILD_ID` de Vercel. `VersionChecker.tsx` lo lee cada cierto tiempo y fuerza `window.location.reload()` si cambió — evita repartidores con bundle viejo.

---

## 12. Gotchas (cosas que NO son obvias)

1. **Doble fuente de verdad estado/entregado**: la columna legacy `entregado BOOLEAN` se mantiene **sincronizada con `estado VARCHAR`** en cada PATCH. Si modificas el estado, también sincroniza `entregado`. Ver lógica en `/api/pedidos/[id]/route.ts:80-114`. Eventualmente eliminar `entregado`, `entregado_por`, `entregado_at` cuando ya no haya queries legacy que lo lean. Por ahora **NO eliminar**.
2. **`detalle` (texto del pedido) vs `detalle_final` (peso real entregado)** son campos distintos. El primero es lo que pidió el cliente; el segundo lo registra el repartidor/producción al pesar realmente.
3. **`Maps_SERVER_KEY`** está con mayúscula M y guión bajo bajo. No es typo, así está en `.env`.
4. **`cliente_id`** se inserta en `pedidos` (`api/pedidos/route.ts`) pero **no está en el tipo `Pedido` de TypeScript**. Si lo agregas, también actualiza `fetchFilteredPedidos` en `lib/data.ts` para que lo seleccione.
5. **`direccion_mapa`** es una columna agregada después (ver `migrate-direccion-mapa.mjs`) pero no en todos los lugares se usa. Es texto libre para notas de ubicación.
6. **El sidebar (`DashboardLayout.tsx`) filtra navegación por rol** vía `roles[]` y `adminOnly`. Si agregas una sección nueva, decide en qué roles aparece.
7. **Empresa**: el campo `empresa` en `pedidos` puede ser `"Transavic"` o `"Avícola de Tony"`. La UI muestra logos distintos según valor. **No agregar otras empresas sin coordinar con Antonio.**
8. **`fecha_pedido` es `DATE` (sin hora) y representa la FECHA DE ENTREGA** (así se rotula el campo en `PedidoForm`), NO la fecha de venta — comparaciones por día usan timezone Lima. **`created_at` (`TIMESTAMP WITH TIME ZONE`) es cuándo la asesora REGISTRÓ/vendió el pedido.** Distinción crítica: ~86% de los pedidos se entregan en fecha posterior a la venta. Para medir el desempeño de la asesora (metas, racha, ranking, meta de equipo) se usa **`created_at` (ventas)**, NO `fecha_pedido`+`Entregado` (entregas). Los reportes de facturación/admin (`insights.ts`, analytics, comprobantes) sí usan entregado. Ver §13 "Sistema de Incentivos".
9. **Offline queue usa `localStorage`** (no IndexedDB) — capacidad ~5-10MB, suficiente para una jornada del repartidor pero no para histórico largo.
10. **Precios CON IGV INCLUIDO** (convención crítica): los precios en `productos.precio_venta` y `pedido_items.precio_unitario` se almacenan **CON IGV** (lo que Antonio cobra al cliente). Antes de mandar a SUNAT, dividimos entre 1.18 para obtener el neto en `/api/comprobantes/emitir/route.ts:130-170`. Si esta convención cambia, actualizar también la UI de `/dashboard/precios` y el seed.
11. **Nombres de usuarios con espacios al final**: la DB de producción tiene `"Leslie "` y `"Jhoselyn "` (con espacio al final, data legacy). NO usar `WHERE name='Leslie'` — usar el `id` directamente o trim del nombre. Esto rompió el script de testing y se documenta para evitar repetir el bug.
12. **Gemini Flash Latest + thinking tokens**: el modelo es **`gemini-flash-latest`** (constante `GEMINI_MODEL` en `src/lib/gemini.ts:9`) — usa "thinking tokens" internos que consumen `maxOutputTokens` antes de generar texto. Sin `thinkingConfig: { thinkingBudget: 0 }` (en `gemini.ts:64`), las respuestas se truncan a ~19 chars.
13. **Bug DNS Node 26 con `@neondatabase/serverless`**: scripts `node ./scripts/migrate-X.mjs` fallan con `TypeError: fetch failed`. Workaround: aplicar SQL directamente con `psql -f scripts/migrations-fase-ab.sql`. Next.js dev server NO está afectado (usa su propio runtime). Nota: `npm install` SÍ funciona (verificado mayo 2026).
14. **Cache del Asistente IA por scope**: el endpoint `/api/asistente-ia` cachea por rol/asesor (key `admin-*` o `asesor-{uuid}-*`). Esto preserva privacy boundary entre asesoras. TTL 1h. Si tocas `lib/insights.ts`, considerá si invalidar cache. ⚠️ El caché es **in-memory** (`new Map()` en `lib/insights.ts`) y **NO persiste en Vercel serverless** (cada cold start y cada deploy lo vacían) → bajo carga se topa el límite gratuito de Gemini (429). Ver gotcha #16.
15. **Light-mode forzado (NO re-agregar dark mode)**: `globals.css` fija `color-scheme: light` y ya NO tiene `@media (prefers-color-scheme: dark)`. La app está diseñada SOLO para modo claro (tarjetas blancas, texto oscuro). Con el dark mode del SO activo, `--foreground` pasaba a claro (#ededed) y los textos quedaban casi invisibles sobre fondos blancos. **No volver a agregar el bloque dark.** Si se quiere dark mode real, hay que rediseñar todos los fondos/colores con variantes `dark:` de Tailwind.
16. **⚠️ IA / Gemini 429 bajo carga (mejora pendiente)**: el caché de insights es **in-memory** (`new Map()` en `lib/insights.ts`), y en Vercel serverless la memoria **no sobrevive** entre invocaciones ni a un deploy. Resultado: cada carga de Reportes/Mis Metas dispara hasta 4 llamadas frescas a Gemini → con el plan **gratuito** (límite bajo por minuto/día) salta **429** ("You exceeded your quota"). **No rompe nada**: la app degrada bien (muestra "Datos crudos abajo"). **Fix pendiente (recomendado, $0):** persistir el caché en la DB (tabla o `settings`) para que cada insight se genere ≤1 vez/hora por scope y sobreviva a cold starts; bonus: servir el último insight bueno guardado cuando Gemini falle. (El límite diario también se consume con testing intensivo y se reinicia solo cada día.)
17. **Producción lanzada 30 may 2026 — cómo se migró**: el esquema de producción se llevó al día con `scripts/migrate-produccion-2026-05-29.sql` aplicado por **psql** (`psql "$DATABASE_URL_UNPOOLED" -f …`), NO por los `.mjs` (Node 26 los rompe — gotcha #13). Rollback en `scripts/rollback-produccion-2026-05-29.sql`. Vercel: proyecto `hugoherrerateam/transavic`, plan **Pro**. Para futuros cambios de esquema: probar en `dev-hugo`, y al mergear a `main` aplicar la migración a producción por psql ANTES de que el deploy con el código nuevo quede activo (si no, el código nuevo choca con columnas/tablas que faltan).
18. **El PDF y el correo del comprobante leen los ítems del XML firmado, NO de la DB** (fix 31 may 2026 — `src/lib/sunat/parse-cpe-items.ts`, usado en `GET /api/comprobantes/[id]`). Las facturas/boletas **standalone** (sin pedido) NO guardan sus líneas en ninguna tabla — solo viven en `comprobantes.xml_firmado_base64`. Antes, sin `pedido_id`, el endpoint **fabricaba una línea genérica** (`"Venta a <cliente>"`, cantidad 1, "UNIDAD", sin código, valor=subtotal) → el PDF salía con datos equivocados. Ahora el endpoint **parsea los ítems del XML firmado** (cantidad, unidad `unitCode`, código `SellersItemIdentification`, descripción, valor unitario sin IGV de `cac:Price`), que es **fiel a lo emitido y aceptado por SUNAT**. Orden de fuentes: (1) XML firmado → (2) `pedido_items` (comprobante sin XML) → (3) línea global (último recurso). Funciona para **factura (01), boleta (03) y NC (07)** y **ambas empresas** (la boleta usa `cac:InvoiceLine` igual que la factura; la NC usa `cac:CreditNoteLine` — ambos los maneja el parser; la empresa solo cambia el emisor, no las líneas). **CDR**: `GET /[id]/cdr` ahora sirve el **ZIP crudo de SUNAT** (`Buffer.from(cdr_base64,'base64')`) en vez de extraer el XML con el parser PKZip casero `descomprimirCDR`, que devolvía **vacío (0 bytes)** con el ZIP "data descriptor" de SUNAT. Ambos botones de descarga nombran el archivo `.zip`. **El XML firmado NO se toca** (es el documento legal, ya aceptado).
19. **Reintento robusto + observaciones SUNAT limpiadas (fix 31 may 2026, verificado contra BETA → factura ACEPTADA con `Observaciones: []`)**: (a) **`/[id]/reintentar` ya NO fabrica la línea genérica "Venta a …"** — **reenvía el `xml_firmado_base64` original tal cual** si existe (no reconstruye → imposible alterar ítems; cubre rechazado + error con respuesta), y si no hay XML, **reconstruye desde `comprobantes.items_json`** (columna JSONB nueva que `index.ts` persiste en CADA emisión con los ítems normalizados); si no hay ni XML ni items_json ni pedido, **aborta con 422** (nunca re-emite mal). Migración: `scripts/migrate-comprobante-items.sql` (aplicada en dev-hugo **y producción**). (b) **Observaciones INFO 4095/4260 eliminadas en `xml-builder.ts`**: **4260** → `cbc:InvoiceTypeCode @name` pasó de "Tipo de Documento" a **"Tipo de Operacion"** (apunta al catálogo 51); **4095** → ya NO se emite `cbc:CitySubdivisionName` vacío (se **OMITE** cuando no hay urbanización; configurable con `SUNAT_*_URBANIZACION`). Ambas son observaciones (la factura SIEMPRE fue válida) pero ahora el CDR sale limpio.
20. **"Orden de pedido" (antes "guía de remisión") — crash en prod + rename + opción de precios (31 may 2026)**: (a) **Crash arreglado**: `/pedidos/[id]/guia` tiraba "server-side exception (Digest 3834139025)" en producción porque `siguienteCorrelativo("guia_remision")` lanzaba error — la tabla `correlativos` se creó VACÍA en la migración del 30 may (el seed vivía solo en `migrate-correlativos-guias.mjs`, que nunca corrió por el gotcha #13). Fix doble: se sembró la fila en prod (`INSERT … VALUES ('guia_remision',0) ON CONFLICT DO NOTHING`) **y** `src/lib/correlativos.ts:siguienteCorrelativo` pasó de UPDATE-only a **UPSERT** (`INSERT … ON CONFLICT (tipo) DO UPDATE SET ultimo_numero = correlativos.ultimo_numero+1`) → nunca más falla aunque la tabla nazca sin sembrar. (b) **Rename a "orden de pedido"**: NO es una guía de remisión legal, es una orden interna. Se renombraron solo los TEXTOS VISIBLES (barra + título de compartir en `guia-imprimible-client.tsx`; el cuerpo ya decía "ORDEN DE PEDIDO"; botón en `produccion-client.tsx`; y el flujo "guía firmada"→"orden firmada" en `mi-ruta-content.tsx` + `api/.../guia-firmada`). Los IDENTIFICADORES internos se mantienen (ruta `/guia`, columnas `numero_guia`/`guia_firmada_*`, tipo de notificación `guia_firmada`, correlativo `guia_remision`) — renombrarlos sería churn + riesgo sin beneficio visible. (c) **Toggle "Incluir precios"**: cada cliente maneja precios distintos; el checkbox (default ON) muestra/oculta las columnas P. Unit./Importe + el TOTAL al imprimir. (d) **Formato Ticket (80mm) vs A4 (31 may 2026)**: `guia-imprimible-client.tsx` ahora imprime en DOS formatos con un selector en la barra — **Ticket (térmica/ticketera 80mm) por DEFECTO** y A4 opcional. El `@page size` es dinámico (`80mm auto` ↔ `A4`) según el formato (styled-jsx global con interpolación de estado). El layout Ticket (`TicketLayout`) lleva en el encabezado **solo el logo a color de la empresa** (`/transavic.jpg` o `/avicola.jpg` según `empresa`) y debajo, directo, "ORDEN DE PEDIDO" + N° + fecha — **sin datos del emisor** (Antonio pidió quitar razón social/RUC/dirección; eran innecesarios). **Ojo con el recorte del logo:** los JPG son 600×600; el de Transavic trae ~28% de aire abajo dentro del cuadrado (se veía como un hueco), así que se recorta con un contenedor `aspect-[3/2]` + `object-cover` (recorta arriba/abajo el aire sin cortar el arte); el de Avícola llena el cuadrado → `aspect-[1/1]` (se muestra entero). El resto del ticket es **monocromo** (negro + negritas + separadores punteados), una columna, ancho `80mm`, ítems Cant·Producto·Importe (omite P. Unit. por el ancho) + TOTAL + línea de firma. El logo sale en escala de grises en térmica pero **a color** al "Guardar como PDF"/compartir (`print-color-adjust: exact`). El layout A4 (`A4Layout`) es el documento completo de siempre (logo, tabla, acentos rojos). Ambos respetan "Incluir precios". Si la ticketera fuera de **58mm** (no 80mm), cambiar el `width`/`@page` a 58mm es trivial.
21. **"Resumen del día" (totales por producto para PRODUCCIÓN) vive en `/dashboard/resumen` (31 may 2026)**: el "cuánto preparar de cada producto para tal fecha de entrega" sale de `/api/resumen-diario` (devuelve `totalesPorProducto` = `SUM(cantidad) GROUP BY producto, unidad` por `fecha_pedido`). Históricamente era una página/menú propio; en el rediseño de Reportes se fusionó en la pestaña **Reportes → "Día a día"** (solo-admin) y el cliente "la perdió". **Se RE-EXPUSO** como ítem de menú propio **"Resumen del día"** (grupo Operación, ícono `FiBox`, archivos `src/app/dashboard/resumen/{page,resumen-client}.tsx`), **abierto a `admin` + `produccion`** — y el endpoint `/api/resumen-diario` también pasó de solo-admin a `admin+produccion`. Abre por DEFECTO en **mañana** (lo que se prepara esta noche), con presets Hoy/Mañana + selector. La pestaña "Día a día" de Reportes sigue viva (misma data, enfoque de revisión con KPIs). **Ojo:** un mismo producto con ítems en distintas unidades (kg vs uni) sale como **tarjetas separadas** — es correcto (son preparaciones distintas). Componentes huérfanos detectados de paso (no se usan, candidatos a borrar): `resumen-despacho.tsx`, `print-button.tsx`, y los `@deprecated` `productos-client.tsx`/`precios-client.tsx`.

---

## 13. Estado del proyecto

### 🚀 LANZADO A PRODUCCIÓN — 30 mayo 2026
**Todo el trabajo de las 8 mejoras está DESPLEGADO Y EN VIVO** en `main` → Vercel (`transavic.vercel.app`). Ya NO es "local / dev-hugo": se hizo el merge a producción.
- **DB de producción migrada** (`ep-cool-sound`): se aplicó `scripts/migrate-produccion-2026-05-29.sql` por psql (8 tablas nuevas + 14 columnas + backfill de código de producto). La data real (~6.024 pedidos, 394 clientes, 87 productos) quedó **intacta**; las tablas nuevas nacieron vacías. Respaldo previo completo en `backups/` (gitignored) + restore automático de Neon.
- **24 env vars cargadas en Vercel (Production)**: `SUNAT_*` con credenciales **reales** (`APIFACTU`/`Transavic123`, `SUNAT_ENVIRONMENT=production`, certs `.p12` en base64), `APISPERU_TOKEN`, `BREVO_*`, `GEMINI_API_KEY`, `CRON_SECRET`. Las credenciales reales SOLO viven en Vercel + archivos gitignored (`.env.local`, `CREDENCIALES-PRODUCCION.local.md`) — nunca en el repo.
- **SUNAT en producción**: ambas empresas listas — Transavic (RUC 20 `20612806901`) y Avícola de Tony (RUC 10 `10710548841`, persona natural; APIFACTU creado + régimen confirmado por Antonio: emite boletas **y** facturas). **Pendiente: la 1ª emisión fiscal REAL** (Hugo la hará manualmente para validar end-to-end; los 3 tipos ya están validados en BETA).
- **Vercel**: proyecto `hugoherrerateam/transavic`, plan **Pro** (permite 40 crons; usamos 4). Auto-deploy desde `main`; **rollback instantáneo** disponible si algo sale mal.
- **`.env.local` sigue en `beta`** (testing local contra `dev-hugo`). Lo que está en `production` es Vercel.

> ⚠️ Las secciones de abajo describen CÓMO se construyó cada módulo (siguen vigentes). Donde digan **"TODO LOCAL / producción intacta / falta mergear / falta validar en producción"**, entender que **eso ya se ejecutó el 30 may 2026** (merge + migración + deploy hechos).

### Mejoras post-lanzamiento (31 may 2026 — pedido de Antonio) — ✅ EN PRODUCCIÓN
5 cambios construidos + probados en `dev-hugo` y **desplegados a producción** (2 migraciones por psql + deploy). Verificados en navegador (mapa, incentivos, orden de pedido) y E2E (bono guardar/borrar, historial registra el diff).
1. **Editar pedido + historial de cambios**: la asesora ya podía editar sus pedidos (modal en `/dashboard`); ahora **la asesora puede eliminar SUS pedidos, pero solo si están `Pendiente`** (⚠️ actualizado el 2 jun 2026 — ver subsección "Permisos de asesora" más abajo; antes era solo-admin); el admin elimina cualquiera, el repartidor nunca. Cada corrección de datos se **audita**: el PATCH guarda un diff (antes→después + quién + rol) en la tabla nueva **`pedido_ediciones`** (`scripts/migrate-pedido-ediciones.sql`). Solo se auditan campos de DATOS del pedido (ver `src/lib/pedido-historial.ts:CAMPOS_AUDITABLES`: cliente, dirección, detalle, fecha, etc.), NO el ruido del ciclo de vida (estado, repartidor, ruta, banderas legacy). El admin ve el historial con el botón **"Ver historial"** (menú "⋯" de cada fila) → modal `historial-pedido-modal.tsx` que lee `GET /api/pedidos/[id]/ediciones` (solo admin). El INSERT del historial es **no-bloqueante** (si falla, la edición igual queda aplicada).
2. **"Orden de pedido" (ex "guía de remisión")**: crash en prod arreglado + renombrado + opción de precios al imprimir. Ver **gotcha #20**.
3. **Notificación de entrega a la asesora**: ya estaba implementada (`api/pedidos/[id]/entregar` emite `pedido_entregado` al `asesor_id` al cerrar la entrega, + `pedido_fallido` si falla). Solo se verificó (no requirió cambios).
4. **Bono personalizado + % de meta configurable**: (a) el **% de crecimiento de la meta automática mensual** dejó de estar hardcodeado en 1.15 → ahora es `settings.incentivos_config.metasIndividuales.factorCrecimientoPct` (default 15; editable en la pantalla Incentivos). `lib/metas.ts` lo lee **directo de `settings`** (no importa `incentivos.ts` para no crear dependencia circular, ya que `incentivos.ts` importa de `metas.ts`). (b) **bono personalizado por asesora** al cumplir su meta del mes: columna nueva `metas_asesoras.bono` (`scripts/migrate-meta-bono.sql`; además `monto_meta` pasó a **NULLABLE** para permitir una fila con solo-bono sin override de meta — `calcularMetaDiaria` trata `monto_meta IS NULL` como "sin override" → meta automática). El admin lo fija por asesora en Incentivos (junto a su meta); la asesora lo ve en "Mis Metas" (banner ámbar → verde al cumplir). `POST /api/metas/override` acepta `monto_meta` nullable + `bono`; si ambos quedan vacíos, **borra la fila** (vuelve a automática sin bono).
5. **Filtro de motorizado en el mapa de despacho**: pasó de multi-toggle (había que apagar a los demás uno por uno) a **selección única "Ver ruta de"** en `mapa-despacho.tsx` — un clic en un motorizado aísla SU ruta (oculta a los demás + los "sin asignar"), "Todos los motorizados" para resetear; el mapa hace **zoom automático** a lo visible al cambiar el foco. De paso se arregló un bug latente de color de polyline (se re-indexaba al filtrar; ahora el color es estable por repartidor). Aplicada la skill `/mejora-diseño`. **Iteración (feedback de Antonio):** "Ver ruta de" se movió **arriba** del panel (es la acción principal) y "Estados" quedó **abajo** con **presets de 1 clic** ("Por entregar" / "Todos") — el filtro abre por defecto en **"Por entregar"** (oculta Entregado/Fallido) para que el mapa no nazca saturado de verde cuando hay ~116 entregados; los conteos por estado pasaron a ser **reales** (antes dependían del propio filtro y mostraban 0 al ocultar un estado).

**Migraciones nuevas aplicadas a dev-hugo Y producción (psql)**: `migrate-pedido-ediciones.sql` + `migrate-meta-bono.sql`. La fila `correlativos.guia_remision` se sembró en prod (crash fix, gotcha #20).

### Comprobantes — tipos diferenciados, vínculo NC↔factura, visibilidad total + emisor (2 jun 2026 — ✅ EN PRODUCCIÓN)
Pedido de Antonio/Hugo. Todo en la **lista** `/dashboard/comprobantes` (`comprobantes-client.tsx`); el PDF y el módulo SUNAT NO se tocaron. Se subió por un PR aparte (NO por el branch `respaldo-pre-migracion-2026-05-29`, que arrastra la app repartidor — esa sigue solo en local).
1. **Chip de tipo con color + ícono** (helper `tipoUI`, hermano de `estadoUI`): Factura = índigo + `FiFileText`, Boleta = slate + `FiFile`, N. Crédito = naranja + `FiCornerUpLeft`. Antes la columna "Tipo" era texto plano e indistinguible. Tabla desktop + cards mobile; los chips del filtro "Tipo" llevan swatch del mismo color. Chip `rounded-md` lleno. Hecho con `/mejora-diseño`.
2. **Vínculo NC↔factura**: una NC muestra bajo su número "↩ anula F001-11" (clic → escribe esa serie en el buscador y salta a la factura); una factura/boleta ya acreditada muestra el chip "↩ con N. Crédito".
3. **Visibilidad** — ⚠️ **REVERTIDO el mismo 2 jun (tarde); ver subsección "Permisos de asesora" más abajo.** Por unas horas se abrió a que TODAS las asesoras vieran TODOS los comprobantes, pero Antonio pidió volver al scoping por asesora. **Estado ACTUAL en prod:** cada asesora ve/maneja **solo los suyos** (de sus pedidos o emitidos por ella, vía helper `lib/comprobante-scope.ts`); el admin, todos. La separación por asesora se mantiene también en los insights de IA.
4. **Emisor**: columna "Emitido por" (desktop) / línea "Emitió: X" (mobile) con el nombre de quien emitió. Columna `emitido_por` llenada al emitir (`session.user.name`) en los 3 endpoints (`emitir`, `emitir-manual`, `[id]/nota-credito`); el reintento hace UPDATE (no reinserta) → preserva el emisor original.

**Migraciones (aplicadas a producción por psql ANTES del deploy — gotcha #17):** `scripts/migrate-comprobante-referencia.sql` (columna `referencia_comprobante_id`) y `scripts/migrate-comprobante-emisor.sql` (columna `emitido_por` + backfill best-effort desde la asesora dueña del pedido). Ambas **aditivas e idempotentes**; NO tocan XML/CDR/montos/estados → los comprobantes y NC ya emitidos quedan **intactos**. En comprobantes viejos: sin referencia (no muestran vínculo hasta re-emitir) y `emitido_por` solo para los que tienen pedido (los sueltos viejos quedan "—"). `OpcionesEmision` ganó `referenciaComprobanteId` y `emitidoPor`. Validado en dev-hugo; tsc/eslint limpios.

### Validaciones de emisión — boletas con datos basura + doble NC (2 jun 2026 — ✅ EN PRODUCCIÓN, PR #4)
En producción se detectaron comprobantes "malos" (SUNAT los aceptó con XML+CDR, pero el dato estaba mal): una boleta con **DNI "00000000"** (gloria), una boleta a **nombre suelto sin documento** (keila roja: tipo "0" + razón "keila roja"), y una factura con **DOS notas de crédito** por el total (doble anulación, S/254.80 → S/509.60 acreditado). Causas: el regex de DNI aceptaba 8 ceros; el cliente genérico conservaba el nombre escrito; `emitir/route.ts` inventaba `numDocumento: cliNumDoc || "00000000"`; y `[id]/nota-credito` no chequeaba si ya había una NC.

**Dato clave que definió el enfoque:** 400 de 404 clientes NO tienen DNI/RUC cargado. Por eso NO se exige documento en boletas (frenaría casi todas) — se normaliza a CLIENTES VARIOS.

Fix (helper nuevo `src/lib/sunat/validacion-cliente.ts`: `esDniValido` rechaza 8 dígitos iguales; `esRucValido` exige prefijo 10/15/16/17/20 **+ dígito verificador módulo 11** → rechaza RUC mal tecleado; `esReceptorIdentificado`):
- **Boletas** (`emitir`, `emitir-manual`, form `emitir-client`): un documento ingresado debe ser válido (rechaza 00000000); **sin DNI/RUC válido y < S/700 → "CLIENTES VARIOS"** automático (ya NO inventa DNI ni conserva el nombre suelto). **NO se exige documento** aunque haya nombre — 400/404 clientes no tienen doc, obligarlo frenaría la operación (decisión de Antonio jun 2026: opción "CLIENTES VARIOS"). Boletas ≥ S/700 siguen exigiendo DNI/RUC (ley SUNAT). La razón social del cliente identificado se normaliza a MAYÚSCULAS.
- **Nota de crédito** (`[id]/nota-credito`): **bloquea una segunda NC** si el comprobante ya tiene una NC aceptada/observada que lo acredita — por `referencia_comprobante_id` (NC nuevas) y por las `observaciones` (NC históricas, regex). Evita el doble de hoy.
- **Completar RUC del cliente** (form `emitir-client` + `emitir-manual`): al elegir del buscador un cliente registrado SIN documento válido, aparece un **aviso ámbar** que guía a ingresar el RUC/DNI y tocar Consultar (apisperu trae sus datos). Al emitir, si ese cliente no tenía doc válido, se **guarda el RUC/DNI en su ficha** (`UPDATE clientes` con guard `COALESCE(ruc_dni,'') !~ '^([0-9]{8}|[0-9]{11})$'` para no pisar uno bueno) → la base de 400/404 clientes sin doc se completa con el uso. Decisión de Antonio jun 2026.
- **Confirmación de comprobante duplicado** (`lib/sunat/duplicado.ts` + `emitir`/`emitir-manual` + form): antes de emitir, si ya hay un comprobante igual (misma empresa + tipo + cliente IDENTIFICADO + mismo monto ±0.10, estado válido, últimos 2 días — NO aplica a "CLIENTES VARIOS"), el endpoint responde **409** con `{ duplicado, mensaje }` y el form muestra un **modal**: "Ya existe un comprobante igual (F00x-…) por S/ … a este cliente" con **Cancelar · Ver comprobante · Sí, emitir igual** (reintenta con `confirmarDuplicado:true`). Evita duplicar por doble clic o re-emisión; no bloquea (la venta repetida legítima se confirma). Verificado en local end-to-end (el 409 corta antes de SUNAT). **Ojo:** `onClick={emitir}` se cambió a `onClick={() => emitir()}` (si no, el evento del click llegaba como `confirmarDuplicado` truthy y saltaba la guarda).

Sin migración (solo lógica). Los comprobantes ya emitidos NO se tocan (son fiscales, aceptados; corregirlos es tema del contador). Verificado: el dígito verificador valida los 5 RUCs reales de prod y rechaza los mal tecleados; regex de NC contra el caso real `F002-00000002`; tsc/eslint limpios. **Las facturas estaban OK** (RUC válido + razón formal); el lío era solo en boletas y NC.

### Permisos de asesora + 5 mejoras + hallazgo de metas (2 jun 2026, tarde — ✅ EN PRODUCCIÓN)
Sesión con Hugo. Todo en `main` y desplegado (PRs #6–#9). Verificado en producción (navegador como admin + queries a la BD real `ep-cool-sound`).

**A. Comprobantes — scoping por asesora (REVIERTE la "visibilidad total" de arriba) — PR #8.** Decisión final de Antonio: cada asesora ve/maneja **SOLO sus comprobantes**; el admin, todos. "Suyos" = los de sus pedidos (`pedidos.asesor_id`) **o** los que ella emitió (`comprobantes.emitido_por`, match con TRIM+lower por los nombres con espacio — gotcha #11). Helper nuevo `src/lib/comprobante-scope.ts:asesoraPuedeVerComprobante`, usado en `GET /api/comprobantes` (condición SQL) y en los endpoints por id (`[id]`, `/xml`, `/cdr`, `/enviar`, `/nota-credito`) → 404/403 si no es suyo. La asesora SÍ descarga PDF/XML/CDR y emite NC, pero solo de los suyos. (El OR es necesario: en prod solo 3 de 14 comprobantes tienen `emitido_por`; los 11 legacy se ven por el pedido.) Verificado contra prod: admin 14, Saraí 2, Yali 1, resto 0.

**B. La asesora elimina SUS pedidos, solo si están `Pendiente` — PR #9.** (Reemplaza el "borrar es solo-admin" del 31 may.) Guardas revalidadas en el BACKEND (el frontend solo decide qué botón mostrar): solo sus pedidos (`asesor_id = session.user.id`), solo estado `Pendiente` (si ya avanzó → 409 "pídele al admin"), y nunca si tiene comprobante aceptado/observado (→ 409 "anula con Nota de Crédito"). Admin borra cualquiera; repartidor nunca. Archivos: `src/app/api/pedidos/[id]/route.ts` (DELETE), `table.tsx` (recibe `userId`, calcula `puedeEliminar`, muestra "Eliminar" en el menú "⋯" a la asesora dueña de un Pendiente; `handleDelete` muestra el mensaje real del backend), `dashboard-content.tsx` (pasa `userId`). Sin migración.

**C. 5 mejoras — PR #7.** (1) **M1 Editar pedido con selección de productos**: el modal de edición trae el `ProductSelector`; el PATCH de `/api/pedidos/[id]` acepta `items[]` y **reemplaza `pedido_items`** con snapshot de precio (`DELETE`+`INSERT`) → editar SÍ cuenta en "Resumen del día"/reportes (antes editar solo el texto libre `detalle` no actualizaba `pedido_items`). (2) **M2 Ocultar "Anular" entrega a asesoras**: el botón Entregar/Anular se oculta para `asesor` cuando el pedido ya está Entregado (revertir la entrega es del motorizado/admin). (3) **M4 Cobranzas — revertir pago + método + captura**: `facturas` ganó `metodo_pago`/`pago_detalle`/`pago_img_base64`/`pago_img_mime` (migración `scripts/migrate-cobranza-pago.sql`, aplicada a prod+dev); al marcar pagada se elige método (efectivo/transferencia/yape/plin/otro) y opcionalmente se sube una captura **comprimida a webp ~60-90KB** en el cliente (`browser-image-compression`); la fila muestra el método + "ver captura" (`GET /api/facturas/[id]/pago-imagen`) + botón **Revertir** (`DELETE /api/facturas/[id]/pago` → vuelve a Pendiente/Vencida). (4) **M5 "Resumen del día" ya no redirige al admin**: el guard de `/dashboard/resumen/page.tsx` pasó de allowlist a blocklist (`if rol asesor|repartidor → redirect`), con trim+lower. (M3 = verificación de descarga PDF/XML, ya OK.)

**D. NC + descargas para asesoras — PR #6.** Las asesoras descargan PDF/XML/CDR y emiten Notas de Crédito (luego acotado a "solo los suyos" por el scoping del punto A).

**E. 🔴 HALLAZGO CRÍTICO — las metas automáticas dan S/0 porque NO hay precios cargados.** La meta automática FUNCIONA (`lib/metas.ts:calcularMetaDiaria`: si no hay override en `metas_asesoras` para el mes, meta = `ventas_mes_anterior × factor`; factor configurable, hoy **15%** en prod; se calcula al vuelo cada mes, sin cron). PERO en producción **0 de 88 productos tienen `precio_venta`**, así que aunque las asesoras registraron cientos de pedidos en mayo (Saraí 249, Yali 217, Jhoselyn 190, Yesica 138), TODOS los `pedido_items.subtotal` salen S/0 → la venta del mes anterior se valoriza en ~S/0 → la meta automática daría ~S/0. **Por eso hoy las metas son overrides manuales** (Jhoselyn 67k, Saraí 153k, Yali 85k, Yesica 34k) y NO se deben quitar hasta que se carguen los precios. **Fix de raíz:** cargar `precio_venta` de los productos en Catálogo; desde el mes siguiente las metas se vuelven automáticas (+15% sobre lo realmente vendido) sin overrides. Misma causa raíz del S/0 en reportes (gotcha #8 / banner "sin precio"). **Es la tarea pendiente más importante para que metas/reportes muestren números reales.**

**F. Diagnósticos (sin cambio de código).** (1) **"Sin permiso" del admin en Reportes/Resumen**: era una **sesión vieja** — un JWT emitido antes de un deploy quedó sin `role` (`auth.config.ts:jwt` solo setea `token.role` en el login; no se auto-repara). Se arregla **re-logueándose**; el código siempre permitió admin. Mejora opcional pendiente: auto-reparar el rol leyéndolo de la BD cuando el token no lo trae. (2) **Metas "desaparecidas" a fin de mes**: los overrides de `metas_asesoras` son **por mes** (`mes = 'YYYY-MM-01'`); junio nació sin fila → la pantalla los mostró vacíos. Se restauraron copiando los de mayo (`INSERT … SELECT … '2026-06-01' … ON CONFLICT DO NOTHING`). (Ver punto E: lo correcto a futuro es automático, no overrides.)

**G. Unidad de medida verificada (factura).** El `<select>` de unidad guarda el código SUNAT (`<option value="NIU">Unidad</option>`, `value="KGM">Kg</option>`), `emitir-manual` lo deja pasar (`mapUnidad`), el `xml-builder` lo escribe como `unitCode` y el PDF lo traduce con `getUnidadLabel` ("UNIDAD"/"KILOGRAMO"). **Correcto de punta a punta en XML y PDF.**

**H. App del motorizado (Capacitor, carpeta `android/`)**: sigue **solo en local**, NO está en `main` (track aparte, sin probar en teléfono real). No afecta a la app web.

### Cambiar la asesora encargada de un comprobante (3 jun 2026 — ✅ EN PRODUCCIÓN)
Pedido de Antonio: el admin necesitaba asignar/cambiar quién ve un comprobante (muchos tenían "Emitido por —" → no le aparecían a ninguna asesora, solo al admin). **Decisión de Antonio: se reescribe directamente `comprobantes.emitido_por`** (NO hay campo separado "encargada"). Como el scoping de `/api/comprobantes` ya filtra por `emitido_por` (match por nombre, TRIM+lower — gotcha #11), al poner el nombre de la asesora el comprobante le aparece en SU lista; `asesorId:null` lo deja en "—" (solo admin). Endpoint nuevo **`PATCH /api/comprobantes/[id]/emisor`** (solo admin; body `{ asesorId: uuid|null }`; resuelve el nombre EXACTO desde `users` con `role='asesor'` para que el match del scoping funcione). UI: ítem **"Cambiar asesora"** en el menú "⋯" de cada fila (solo admin) → modal `ModalAsignarAsesora` (dropdown de asesoras + "Sin asignar"); actualiza la fila al instante. **Sin migración** (la columna `emitido_por` ya existía). NO toca XML/CDR/montos — solo la atribución/visibilidad interna (el dato fiscal de quién emitió SÍ se pierde si se reasigna, era la contra aceptada de esta opción). Aplicada `/mejora-diseño` (modal calcado del estilo de los demás, acento índigo). tsc/eslint limpios.

### Unidad de medida (kg/unidad) + UX de emisión + chip Anulados (3 jun 2026 — ✅ EN PRODUCCIÓN)
Reporte de Antonio + auditoría de los flujos de emisión. Cuatro cosas:
1. **🐛 BUG FISCAL — la unidad salía siempre "UNIDAD" al emitir DESDE un pedido.** El form manda `items_override` con la unidad ya como código SUNAT (`KGM`/`NIU`), pero `/api/comprobantes/emitir` la mapeaba con `it.unidad === "kg" ? "KGM" : "NIU"` → como `"KGM" !== "kg"`, degradaba TODO a NIU. (El PDF lee del XML — gotcha #18 — así que mostraba lo mismo: "unidad".) Verificado en prod: las facturas/boletas DESDE pedido (B002, F002-2, F001-2, B001-2) tenían `kg` en `pedido_items` pero `NIU` en el XML firmado. El flujo MANUAL NO estaba afectado (usaba `mapUnidad`, que sí dejaba pasar `KGM`). **Fix:** helper único **`src/lib/sunat/unidades.ts:aUnitCodeSunat`** — idempotente (acepta `kg`/`uni` crudos Y los códigos `KGM`/`NIU`, **nunca degrada KGM→NIU**) — usado en los 4 caminos: `/emitir`, `/emitir-manual`, `/pedidos/[id]/entregar` (auto-emisión) y `unidadSunatDesde` del form. **Los comprobantes ya emitidos NO se tocan** (aceptados por SUNAT; corrige de aquí en adelante). Nota: 53 de 88 productos tienen unidad ambigua (`uni/kg`) → el autocompletado cae a NIU y la asesora elige la unidad real por ítem; ahora esa elección se respeta de punta a punta.
2. **"Consultar" ~obligatorio para factura (datos fieles a SUNAT).** Al elegir un cliente registrado **con RUC**, `handleSelectCliente` (emitir-client) ya NO autocompleta la razón social con el NOMBRE informal ni la dirección de ENTREGA: limpia ambos y deja que la **auto-consulta a SUNAT** (apisperu) traiga la razón social + dirección **FISCAL** oficiales → la factura sale fiel. Para DNI (boleta) sí usa el nombre. Sin documento → no autocompleta (boleta < S/700 → "CLIENTES VARIOS").
3. **Etiqueta del receptor según tipo:** factura → "Razón social"; boleta → "Nombre completo" (antes siempre "Razón social / Nombre completo").
4. **Chip "Anulados" quitado** del filtro de estado de `/comprobantes`: verificado que el estado `anulado` **NUNCA se usa** (los 16 comprobantes de prod están `aceptado`; la Comunicación de Baja está desactivada y la NC **enlaza**, no marca `anulado`). El `estadoUI("anulado")` se mantiene por si algún día se reactiva la baja.

Sin migración; tsc/eslint limpios. **Por qué "CLIENTES VARIOS":** una boleta < S/700 sin DNI/RUC válido se emite a "CLIENTES VARIOS" por decisión de negocio (400/404 clientes no tienen documento) — NO es error, es el fallback. Las NC heredan el cliente del comprobante que anulan.

### Las 8 mejoras (acordadas con Antonio — S/ 4 000, 17 días)
| # | Mejora | Fase | Estado |
|---|---|---|---|
| 1 | Pesos digitales + flujo completo (estados `En_Produccion`, `Listo_Para_Despacho`, rol `produccion`) | A | ✅ En producción |
| 2 | Guía de remisión digital + foto firmada (HTML imprimible, foto base64 en DB) | A | ✅ En producción |
| 4 | Avisos automáticos entre áreas (campanita, polling 30s) | B | ✅ En producción |
| 5 | Dashboard comercial + metas + panel gerencial | B | ✅ En producción |
| 6 | Cobranzas con plazos flexibles + cron diario | B | ✅ En producción |
| 7 | SUNAT con 2 RUCs (XML UBL 2.1 + firma + SOAP + CDR) + emisión standalone + NC + consulta RUC/DNI + correo Brevo. Validado en BETA (factura/boleta/NC ACEPTADAS). | B | ✅ En producción · falta 1ª emisión real |
| 8 | IA comercial Gemini Flash — admin y asesoras (scoped) | C | ✅ En producción ⚠️ (caché 429 — ver gotcha #16) |
| 3 | Seguimiento motorizado en vivo (Capacitor + Pusher) | C | ⏳ Pendiente (no iniciado) |

**Decisiones técnicas tomadas durante implementación:**
- PDF de guía → HTML + `window.print()` (sin `@react-pdf/renderer`). $0 costo.
- Foto firmada → Base64 en columna DB (sin Vercel Blob). $0 costo.
- SUNAT → **módulo real portado** desde `conexipema-eventos/src/lib/sunat/` (mayo 2026). Genera XML UBL 2.1, firma con certificado .p12 (XML-DSig), comprime ZIP, envía SOAP a webservice SUNAT, parsea CDR. **VALIDADO contra SUNAT BETA con el cert real de Transavic (mayo 2026): factura (01), boleta (03) y nota de crédito (07) → todas `ACEPTADA` con CDR.** El código quedó idéntico a conexipema (probado en producción) en xml-builder/xml-signer/soap-client; la firma (RSA-SHA1, digest SHA256, C14N, transform enveloped+C14N, en ExtensionContent) valida sin problema.
- Dependencias: `xmlbuilder2`, `xml-crypto`, `node-forge`, `archiver@7` (¡no @8, cambió de API!). `archiver`, `node-forge` y `xml-crypto` listados en `next.config.ts:serverExternalPackages` para evitar bugs de bundling webpack.
- Gemini Flash Latest → cuenta dedicada `transavicdev@gmail.com`, project 88126347805. Requiere `thinkingConfig: { thinkingBudget: 0 }` en `generationConfig` para evitar que el modelo gaste tokens en thinking interno y trunque respuestas.

### Branch Neon `dev-hugo` (testing aislado)
- Project: `pedidos_transavic` (`fragrant-sun-30707890`), org "Vercel: Hugo Herrera's projects"
- Branch ID: `br-tiny-frost-aduw14pu`
- Endpoint: `ep-super-violet-adyp68ne` (vs producción `ep-cool-sound-adxrsjt5`)
- Conexión guardada en `.env.local` (no en `.env`)
- El merge a producción se hizo el **30 may 2026** (migración por psql + deploy). `dev-hugo` sigue como branch de testing aislado para cambios futuros: probar acá primero, y recién mergear a `main`.

Planes formales: `docs/superpowers/plans/2026-05-13-fase-{a,b}-*.md`.

### Módulo de comprobantes ampliado (mayo 2026 — ✅ EN PRODUCCIÓN desde 30 may 2026)
Construido y probado en `dev-hugo` + `.env.local`, **ya mergeado y desplegado en producción** (30 may 2026). Validado en BETA SUNAT; pendiente solo la 1ª emisión fiscal real (Hugo).

- **Emisión standalone** (factura/boleta SIN pedido): `src/app/dashboard/comprobantes/nuevo/{page,emitir-client}.tsx` + `POST /api/comprobantes/emitir-manual`. Botón "Emitir comprobante" en `/dashboard/comprobantes`.
  - **Rediseño UX (mayo 2026, "No Me Hagas Pensar")**: (1) **Detalle conectado al catálogo** — cada ítem usa un `<datalist id="catalogo-productos">` con los productos de `/api/productos` (que ahora devuelve `precio_venta`); al elegir/escribir el nombre exacto, `onDescripcion()` autocompleta **precio (con IGV) y unidad** (helper `unidadSunatDesde` mapea "uni/kg"/"kg"→KGM, resto→NIU). El usuario solo ajusta cantidad → facturas mucho más rápidas. Sigue permitiendo texto libre para no-catalogados. (2) **Empresa emisora diferenciada de un vistazo**: tarjetas grandes con **logo** (`/transavic.jpg`, `/avicola.jpg`) + razón social + RUC, y un **banner persistente** "Emitiendo como … · RUC …" con **color por empresa** (Transavic=rojo, Avícola=ámbar, vía `EMPRESA_UI`). El `page.tsx` (server) pasa `{ruc, razonSocial}` de ambas empresas vía `getSunatConfig` (datos públicos, sin exponer cert/clave). Verificado en navegador: autollenado (Bistec→S/30) y switch de empresa (banner cambia rojo↔ámbar).
- **Nota de crédito (07)**: `emitirComprobante` (index.ts) extendido con `documentoReferencia` (series FC0x/BC0x); `POST /api/comprobantes/[id]/nota-credito`; botón "N. Crédito" (solo admin, sobre comprobantes aceptados) en `comprobantes-client.tsx`. Sirve para anular facturas Y boletas (la Comunicación de Baja `/anular` solo cubría facturas ≤7 días).
- **Consulta RUC/DNI** (apisperu): `src/lib/apisperu.ts` + `POST /api/consulta-documento`. Botón "Consultar" auto-llena razón social/dirección en el form de clientes y en emisión.
- **Correo vía Brevo**: `src/lib/brevo.ts` (API v3, free 300/día). `lib/email.ts` usa Brevo si `BREVO_API_KEY` está; si no, SMTP/nodemailer. Sender `transavicdev@gmail.com` verificado en Brevo (no requiere dominio propio). Plantilla por defecto editable en el modal de envío.
- **Validaciones inteligentes SUNAT** (`emitir-manual` + form `emitir-client`, mayo 2026, verificadas en BETA):
  - **Factura (01)**: siempre RUC válido (11 díg, prefijo 10/15/16/17/20) + razón social. Si no, error.
  - **Boleta (03) ≥ S/700**: SUNAT exige identificar al cliente con **DNI (8) o RUC**. El form deshabilita el botón y muestra aviso ámbar si falta.
  - **Boleta (03) < S/700**: cliente **OPCIONAL** → si se deja vacío, se emite a **cliente genérico** (`tipoDocumento="0"` sin documento, `numDocumento="0"`, razón "CLIENTES VARIOS"). El form lo permite (botón habilitado sin doc) y avisa "se emite a CLIENTES VARIOS". El schema zod del cliente pasó a opcional (`default("")`); la lógica de identificación vive en el endpoint.
  - **Código interno ESTABLE por producto** (`SellersItemIdentification`, mayo 2026): SUNAT lo deja **opcional** (cardinalidad 0..1, an..30) pero ahora cada producto tiene su código fijo. Migración `scripts/migrate-codigo-producto.sql` agregó la columna `productos.codigo` y la pobló por categoría (POL001/CAR001/HUE001…); el `POST /api/productos` genera el código de los nuevos (prefijo categoría + correlativo); el `GET` lo devuelve. En la emisión: `emitir-manual` usa `it.codigo` que el form (`emitir-client`) envía al elegir del catálogo (o secuencial `P00x` si es texto libre); `emitir` (desde pedido) hace lookup del código por nombre del producto (fallback secuencial). Verificado en BETA: el XML lleva `<cbc:ID>CAR005</cbc:ID>` dentro de `SellersItemIdentification` y SUNAT responde `ACEPTADA`. El **código es visible y editable** en cada ítem del form (`emitir-client`): se autocompleta del catálogo pero el usuario puede cambiarlo.
  - **🐛 FIX factura a CRÉDITO (mayo 2026)**: estaba roto — `index.ts`/`emitir-manual` pasaban `formaPago="Credito"` pero **no la fecha de vencimiento**, así que el XML salía sin cuotas y SUNAT **rechazaba con error 3249** ("Si el tipo de transacción es al Crédito debe existir al menos información de una cuota de pago"). Verificado contra BETA (sin cuotas → RECHAZADA 3249). **Corregido**: `emitirComprobante` calcula `fechaVencimiento = fechaEmisión + plazoDias` (default 7) cuando es crédito y la pasa al xml-builder, que genera `cac:PaymentTerms` con `PaymentMeansID="Credito"` + monto + `Cuota001` con `PaymentDueDate`. Re-probado: crédito 15 días → `ACEPTADA` + CDR. (El `plazoDias` viene del form/endpoint y también define el vencimiento de la cobranza en `/cobranzas`.)
  - **Dirección del cliente (opcional)**: campo nuevo en `emitir-client` (se autocompleta de apisperu al consultar RUC, editable). Viaja a `cac:RegistrationAddress` del XML (el xml-builder ya lo soportaba). SUNAT no la exige pero queda registrada. Verificado en BETA → `ACEPTADA`.
  - **Verificado contra BETA**: los 3 casos (boleta genérica tipo "0" · boleta ≥700 con DNI · factura con RUC) → `ACEPTADA` + CDR, todos con el código interno presente. El cliente genérico (tipo "0") es aceptado por SUNAT.
- **Operaciones SUNAT con UI (cierre de gaps, mayo 2026)**: los endpoints que existían pero no tenían botón ya están en `comprobantes-client.tsx` (solo admin):
  - **Reintentar** (`POST /[id]/reintentar`): botón en comprobantes en estado `error`/`rechazado` (reusa el mismo correlativo).
  - **Comunicación de Baja** (`POST /[id]/anular`): modal `ModalComunicacionBaja` sobre **facturas** aceptadas (≤7 días). Pide motivo, devuelve ticket, y permite consultarlo ahí mismo.
  - **Resumen Diario de boletas** (`POST/GET /comprobantes/resumen-diario`): `ModalResumenDiario` (empresa + fecha, muestra conteo de boletas, envía, consulta ticket). **Acceso (mayo 2026)**: el Resumen Diario **se envía solo por cron** (`/api/cron/resumen-diario-sunat`, 2am Lima, con idempotencia), así que el botón directo en el toolbar se **quitó** (confundía: parecía una acción pendiente del admin). Ahora vive en un **menú "⋯" discreto de admin** en la toolbar de `/comprobantes`, con copy que aclara "se envía solo cada noche; entrá solo si querés revisar o reenviarlo". Es solo un **respaldo** por si el cron falla algún día.
  - **Consulta de ticket** (`POST /comprobantes/consultar-ticket`): envuelve `consultarTicket()` (getStatus); actualiza `resumenes_diarios` o marca el comprobante `anulado` si la baja fue aceptada.
- **Idempotencia del Resumen Diario**: nueva tabla **`resumenes_diarios`** (migración `scripts/migrate-resumenes-diarios.{mjs,sql}`, aplicada en dev-hugo). El helper compartido `src/lib/sunat/resumen-diario.ts` (lo usan el cron y el endpoint manual) NO reenvía un RC si ya hay uno `enviado`/`aceptado`/`enviando`-reciente del mismo día (evita duplicados si el cron se dispara dos veces). `forzar:true` permite resúmenes complementarios.
- **Datos del emisor por env**: `nombreComercial/departamento/provincia/distrito` ahora se overridean con `SUNAT_*_NOMBRE_COMERCIAL/DEPARTAMENTO/PROVINCIA/DISTRITO` (antes hardcodeados a "LA VICTORIA").
- **PDF SIN código QR (decisión deliberada)**: el PDF replica el diseño de las boletas/facturas que la propia SUNAT entrega, que **no llevan QR**, así que NO se agrega. (Aplica al SEE-Del Contribuyente; si en el futuro se exigiera la representación impresa con QR, se agregaría con `qrcode`.)
- **PDF de factura/boleta AL CRÉDITO (mayo 2026)**: antes el PDF mostraba siempre "Forma de pago: Contado" y un "Fecha de Vencimiento" vacío (la forma de pago viajaba en el XML pero **no se persistía**). Ahora: migración `scripts/migrate-comprobante-credito.sql` (aplicada en dev-hugo vía psql — gotcha #13) agrega `comprobantes.forma_pago VARCHAR(10)` + `fecha_vencimiento DATE`; `lib/sunat/index.ts` calcula el vencimiento (emisión + `plazoDias`, def. 7) una sola vez y lo guarda en los 3 INSERT (pendiente/éxito/error); `api/comprobantes/[id]` los devuelve (`formaPago`, `fechaVencimiento`); `comprobantes-client.tsx` los pasa al PDF; `lib/sunat/pdf-comprobante.ts` dibuja **"Forma de pago: AL CRÉDITO"** + bloque **"INFORMACIÓN DEL CRÉDITO"** (helper `drawInformacionCredito`: monto neto pendiente de pago + tabla N° Cuota · Fecha de Vencimiento · Monto) en factura Y boleta. Replica la representación de SUNAT (la NC y la factura/boleta al contado ya tenían diseño; faltaba solo el crédito). Verificado en dev-hugo: render del PDF de muestra OK + round-trip de columnas (INSERT/SELECT/DELETE) OK + tsc/lint limpios. Genera **1 cuota** por el total (caso de pago único; cuotas múltiples no soportadas — no las necesita Antonio).
- **URL del menú SUNAT SOL** (operativo, dato público — NO es credencial): la consulta/emisión por web entra por `https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm`. Para una empresa, las facturas emitidas se ven en **Empresas → Comprobantes de pago → SEE - SOL → Factura Electrónica → "Consultar Factura y Nota"** (página pesada, a veces tarda). Ojo: la "forma de pago" (Contado/Crédito) NO es columna del listado — está dentro de cada comprobante. **Las credenciales SOL (usuario/clave) NUNCA van en archivos del repo**: van solo en `.env.local` (gitignored) y env de Vercel, puestas por Hugo.
- **Clientes — rediseño UX "No Me Hagas Pensar" (mayo 2026)**: `clientes-client.tsx` pasó de cards con forms inline + 5 íconos sueltos → patrón consistente con comprobantes/catálogo. (1) **Crear y Editar cliente ahora son MODALES** (antes el form inline con `MapInput` empujaba toda la lista / reemplazaba la tarjeta). Reusan el mismo `ClienteFormFields` (ya extraído); el modal tiene header sticky + footer sticky + `overflow-y-auto` para que el mapa entre sin romper. El botón "Nuevo Cliente" abre el modal (antes era toggle inline). (2) **Acciones consolidadas**: de 5 íconos ambiguos (Perfil·Pedidos·Transferir·Editar·Eliminar) → **acción primaria "Ver perfil"** (botón con texto, indigo) + **menú "⋯"** con el resto etiquetado (Últimos pedidos · Editar datos · Transferir a otra asesora · divisor · Eliminar cliente). El dropdown usa `absolute` + overlay `fixed inset-0` para cerrarse al click-afuera. (3) **Avatar con inicial de color** por tarjeta (color estable derivado del nombre vía hash) → escaneo visual rápido; el avatar y el nombre linkean al perfil 360°. (4) **WhatsApp clickeable**: el número ahora es un link `wa.me/51…` (verde, con FiMessageCircle) en vez de texto plano — 1 clic para escribirle. Helper `whatsappHref` + `avatarPara`. **No tocado**: lógica de datos (fetch paginado server-side 15/pág, búsqueda debounce, transferencia, consulta RUC apisperu en el form), el panel inline de "Últimos pedidos" (sigue, ahora se dispara desde el menú), el Transfer Modal. tsc/eslint/build limpios.
- **Excel de comprobantes — reporte contable inteligente (mayo 2026, portado de conexipema)**: el export pasó de UNA hoja plana sin fechas → **reporte multi-hoja con período**, modelado sobre `conexipema-eventos/src/lib/sunat/generar-reporte-excel.ts`. Helper nuevo `src/lib/sunat/reporte-excel-comprobantes.ts` (`generarBufferReporteComprobantes(filas, periodo)` → Buffer) construye hasta 5 hojas: **Resumen** (por tipo · por estado · desglose diario) · **Registro de Ventas** (lista cronológica unificada) · **Facturas** · **Boletas** · **Notas de Crédito** (las 3 últimas solo si hay de ese tipo). Reglas contables: las **NC (07) restan** del total neto; los estados inválidos (**rechazado · error · anulado**) NO suman (no son documentos fiscales válidos). Adaptado a Transavic: estados en minúscula, 2 empresas (`transavic`/`avicola`), montos de `comprobantes.monto_subtotal/igv/total`, fechas en zona Lima. El endpoint `GET /api/comprobantes/export-xlsx` ahora acepta **`?desde&hasta`** (YYYY-MM-DD, filtra `(created_at AT TIME ZONE 'America/Lima')::date`) además de tipo/empresa/cliente_doc_num; `ORDER BY created_at ASC`, LIMIT 10000; filename con el rango (`reporte-comprobantes-2026-05-01_al_2026-05-28.xlsx`). UI: el botón "Excel" abre el **`ModalExportarExcel`** (en `comprobantes-client.tsx`) con presets de período — **Este mes** (default) · **Mes anterior** · **Solo hoy** · **Todos (sin filtro de fecha)** · **Rango personalizado** (2 date inputs); valida desde≤hasta; muestra aviso azul si hay filtros de tipo/empresa activos (se respetan). Helpers de fecha en cliente: `primerDiaDelMes`, `ultimoDiaDelMes`, `mesAnteriorISO`, `etiquetaMes`. Sin migración. tsc/eslint/build limpios.
- **Comprobantes — rediseño UX "No Me Hagas Pensar" (mayo 2026, sin tocar módulo SUNAT)**: aplica las leyes de Krug sobre `/dashboard/comprobantes` y `/dashboard/comprobantes/nuevo`. Cambios en `comprobantes-client.tsx`: (1) **4 KPIs arriba** (Total · Aceptados · Con problemas · Pendientes) — la asesora ve al abrir cuánto hay y qué necesita atención; "Con problemas" es clickeable y aplica el filtro de estado=rechazado. (2) **Buscador local** que matchea sin distinguir mayúsculas contra `serie_numero / cliente_razon_social / cliente_doc_num / pedido_cliente` (escribir "F001-23", "Lucy" o el RUC funciona). (3) **Filtros consolidados en una sola card** (Tipo · Empresa · Estado) con etiqueta corta a la izquierda y "swatch" de color para asociar visualmente (verde=aceptado, ámbar=observado, rojo=rechazado, etc.). (4) **Estado con ícono + label legible** (✓ Aceptado / ⚠ Observado / ✗ Rechazado / ⏳ Pendiente / 🚫 Anulado) reemplaza el texto lowercase. (5) **Mensaje SUNAT** pasa de bloque debajo del badge → ícono ℹ️ rojo con `title` (tooltip) — menos ruido, info accesible. (6) **Footer con total del filtro** (`S/ … en pantalla`) — útil para conciliar con contabilidad. (7) **Banner pedido_id** ahora muestra el ID corto (8 chars) en vez de "un pedido específico". (8) **Toolbar separado**: buscador toma protagonismo; Excel/Resumen/Refrescar quedan ahí, "Emitir comprobante" sigue de acción primaria en el header. Helpers nuevos: `estadoUI()` (color + label + ícono), `KpiCard`, `GrupoFiltro`. En `emitir-client.tsx`: (1) **Tipo (Factura/Boleta) movido a la sección 1 junto a Empresa** — antes vivía en la columna derecha pero define las reglas (RUC obligatorio o no), ahora se elige primero con un hint dinámico "RUC del cliente es obligatorio. Para empresas." vs "DNI o RUC del cliente. Para consumidor final." (2) **Pasos numerados 1·2·3·4·5** con `SectionHeader` (círculo negro con número + título) — antes los emojis 🏢👤📋⚙️💰 no daban orden mental. (3) **Separador "O Ingreso Manual / SUNAT"** → "o ingresá los datos manualmente" (el botón Consultar ya dice qué hace). (4) **Botón Emitir**: "Emitiendo en SUNAT…" → "Enviando a SUNAT…" + nota explicativa abajo ("Esperá unos segundos — SUNAT puede tardar hasta 10s. No cierres ni recargues."). Sin migración. Build pasa OK; `npx tsc --noEmit` y `npx eslint` limpios (1 warning preexistente no relacionado, `cargandoDetalle` no usado en ModalEnviarEmail). **NO tocado**: `lib/sunat/*` (BETA-validado), modales (NC, Baja, Resumen), endpoints, ticket digital de resultado, autocomplete clientes/catálogo, lookup RUC apisperu, panel de requisitos dinámico, barra flotante mobile.
- **Comprobantes — rediseño de acciones + robustez SUNAT (mayo 2026)**: (1) **Botones de acción**: de íconos sueltos ambiguos → **acción primaria "PDF" + menú "⋯"** (posición FIJA con `getBoundingClientRect` para escapar del `overflow-x` de la tabla) con el resto etiquetado y agrupado (XML · CDR · Correo · divisor · Nota de crédito); patrón "Don't Make Me Think", mismo en desktop y móvil (`celdaAcciones` en `comprobantes-client.tsx`). (2) **Descarga de CDR**: endpoint nuevo `GET /api/comprobantes/[id]/cdr` que **extrae y sirve el XML** de la constancia (no el ZIP, que trae una carpeta `dummy/` vacía que **la propia SUNAT** incluye — confirmado inspeccionando bytes). (3) **Comunicación de Baja DESHABILITADA en la UI** (`ANULAR_HABILITADO = false`): se usa **siempre Nota de Crédito** (cubre factura y boleta, cualquier momento; la baja es frágil: solo facturas ≤7 días). El endpoint `/anular` queda disponible si se reactiva. (4) **Filtro por "N. Crédito"** (tipo 07) en la lista (el API ya lo soportaba). (5) **Paginación en cliente** (15/pág, Anterior/Siguiente) en `/comprobantes`; pendiente extenderla a pedidos/catálogo/clientes (tarea abierta). (6) **Mensaje amigable de "SUNAT caído"**: `soap-client.ts` distingue SUNAT no-disponible (SOAP fault tipo `SUNAT_SERVIDOR` + errores de red/timeout/HTTP 5xx) de un rechazo de datos y propaga `sunatCaido` (`ResultadoEmision` en `types.ts`) → el form de emisión muestra banner ámbar ("es problema de SUNAT, no del sistema; el comprobante NO se emitió; emitilo manualmente desde el portal SEE-SOL") y el reintento un toast equivalente. (7) Botón **"Descargar PDF"** + auto-descarga en la pantalla de éxito de emisión (`emitir-manual` devuelve el `id`). tsc/lint limpios.
- **Nomenclatura SUNAT — auditoría (mayo 2026)**: **Transavic está correcto** — `contador.ts` genera correlativos atómicos (`UPDATE … +1 RETURNING`) y las series de NC son propias `FC01/BC01`. Reglas confirmadas: serie alfanumérica de 4 (F001/B001), NC/ND con **serie propia** (1er char = tipo afectado), correlativo 1..99999999 secuencial por (tipo, serie), nunca reusar un número ya aceptado. Los rechazos por "nombre/número" que reporta Hugo son del proyecto **conexipema-eventos** (NC reusa serie `F001` en vez de `FC01` → rechazo **2345**; loop de 50 reintentos que detecta "duplicado" por texto y salta correlativos) → derivado a tarea aparte en ese repo.
- **P0 "Cierra el loop del dinero" (mayo 2026 — brainstorming → spec → plan → ejecutado)**: audit completo en `docs/superpowers/specs/2026-05-27-audit-conexiones-roadmap-design.md` + plan task-by-task en `docs/superpowers/plans/2026-05-27-p0-cierra-loop-dinero.md`. Implementado:
  - **Factura Contado → cobranza por default** + checkbox "Ya cobrado" para opt-out (cash de mano). Refleja la realidad Transavic ("contado = paga después" en la mayoría de casos). Boletas NO crean cobranza (consumidor cash). `emit-manual/route.ts` + `emit-client.tsx`.
  - **Cobranza manual conectada**: el modal de `cobranzas-client.tsx` ahora autocompleta clientes desde `/api/clientes?q=` (debounce 300ms) y, si el cliente tiene facturas emitidas, muestra un selector con esas facturas (autopobla el monto). Backend: migración `scripts/migrate-factura-vinculo.sql` (aplicada en dev-hugo) agrega `facturas.cliente_id` + `comprobante_id` (FK ON DELETE SET NULL), `POST /api/facturas` los guarda + deriva `numero_comprobante` del comprobante elegido, `GET /api/comprobantes` acepta `?cliente_doc_num=` para filtrar las facturas de un cliente.
  - **Modal compartir ticket**: card con `max-h-[90vh] overflow-y-auto` + header sticky con la X siempre visible. Antes el contenido se cortaba y el cerrar quedaba off-screen.
  - **Exportar Excel** en `/comprobantes` (admin): nuevo endpoint `GET /api/comprobantes/export-xlsx` (usa `xlsx` lib, respeta los filtros activos `tipo/empresa/cliente_doc_num`, scope por rol, hasta 5000 filas), botón "Excel" en el header. Columnas pensadas para contador (Fecha · Serie-Número · Tipo · Empresa · Cliente · Doc · Subtotal · IGV · Total · Forma de pago · Vencimiento · Estado SUNAT · Mensaje). tsc/lint limpios.

**Estado: ✅ DESPLEGADO EN PRODUCCIÓN (30 may 2026).** Validado en BETA (factura 01, boleta 03, NC 07 → `ACEPTADA` con CDR, cert real) y ya en producción con credenciales reales. Lo que se resolvió para el paso a producción:
1. ✅ **Usuario SOL real**: `APIFACTU`/`Transavic123` (perfil "Emisión Electrónica") creado para AMBAS empresas (Transavic RUC 20 y Avícola RUC 10). En `.env.local` (testing) se sigue usando `MODDATOS`/`moddatos` porque el endpoint beta solo acepta ese usuario.
2. ✅ **`SUNAT_ENVIRONMENT=production`** configurado en Vercel.
3. ✅ **Env vars en Vercel**: `APISPERU_TOKEN`, `BREVO_*`, `GEMINI_API_KEY`, `CRON_SECRET` y todas las `SUNAT_*` reales (cert `.p12` en base64).
4. ⏳ **Único pendiente**: emitir la 1ª factura/boleta REAL de monto bajo (la hace Hugo manualmente) y, si se quiere, anularla con NC.

> ✅ **Corrección de diagnóstico (mayo 2026): la BETA SÍ funciona.** La conclusión previa ("BETA rechaza por esquema viejo, validar solo en producción") era **incorrecta**. El endpoint `ol-ti-itcpfegem-beta` acepta UBL 2.1 sin problema (factura/boleta/NC ACEPTADAS). El error **2335 NO significa "cert no reconocido por CA"** sino **"el documento electrónico ha sido alterado"** (fuente: greenter/xcodes + manual del programador SUNAT) — causado por inconsistencia de encoding o por modificar el XML tras firmar. El bug real era que el código **saltaba la firma en beta** (condición `beta && !certificatePath`, pero siempre se usa `certificateBase64` → nunca firmaba → SUNAT veía un XML sin firma); **corregido** para firmar siempre que haya certificado. La BETA acepta certificados autofirmados (no valida la CA).

### Optimización de UI (mayo 2026 — ✅ EN PRODUCCIÓN desde 30 may 2026)
Refactor de navegación/UX en `dev-hugo`. Plan: `docs/superpowers/plans/2026-05-21-optimizacion-menu-catalogo-ia.md`.
- **Catálogo** (`/dashboard/catalogo`): fusiona Productos + Precios en una página con 2 pestañas que reutilizan `productos-client` y `precios-client`. `/dashboard/productos` y `/dashboard/precios` redirigen a `/catalogo`. **Actualización (mayo 2026, vista única)**: las 2 pestañas se eliminaron. Hoy hay UNA sola tabla en `src/app/dashboard/catalogo/catalogo-unificado.tsx` con columnas Producto · Código · Categoría · Unidad · Compra · Venta · Margen · Acciones. Click sobre la celda Compra/Venta → input inline + Enter guarda (con confirm si cambia la venta — afecta pedidos nuevos). Botón ✏️ → modal completo (nombre, código, categoría, unidad, compra, venta). Filtros: chips por categoría + buscador (matcha nombre Y código) + chip clickeable "Sin precio (N)" que filtra los que no se pueden vender. Banner ámbar al tope cuando hay productos sin `precio_venta`. El modal "Agregar Producto" ahora acepta precio opcional → un producto nuevo nace listo para vender. **Endpoints actualizados (cero migración de DB)**: `GET/POST/PATCH /api/productos` ahora devuelven y aceptan `precio_venta`, `precio_compra` y `codigo` (antes vivía en `/api/precios`); el PATCH además **preserva el histórico** en la tabla `precios_productos` (cierra el vigente, inserta el nuevo) — la auditoría que ya tenía `/api/precios/[id]` sigue funcionando. Los archivos viejos `productos-client.tsx`, `precios-client.tsx` y los endpoints `/api/precios*` quedaron marcados `@deprecated` como red de seguridad (se borran tras unas semanas sin regresiones). El tipo `Producto` en `lib/types.ts` se extendió con `codigo`, `precio_venta`, `precio_compra` opcionales. **Rediseño UX "No Me Hagas Pensar" (mayo 2026)**: (1) **Barra de 4 KPIs** arriba (`KpiCatalogo`): Productos · Listos para vender (con precio) · **Sin precio** (clickeable → filtra, reemplaza al banner ámbar viejo) · **Margen promedio** del catálogo (promedio de `margenPct` de los que tienen compra+venta). (2) **Edición inline descubrible**: las celdas Compra/Venta muestran el número con un **lápiz** que se intensifica en hover + fondo azul de "campo editable" (antes solo un `title` invisible) + una pista textual arriba de la tabla ("Tocá un precio para editarlo"). (3) **"Sin precio" → botón accionable** "+ Poner precio" (ámbar) en la celda Venta, en vez de texto rojo pasivo. (4) **Columna Código eliminada**: el código va **debajo del nombre** (gris mono pequeño) → de 8 a 7 columnas, menos ruido. El emoji de categoría queda como identificador del producto. tsc/eslint limpios. **Pulido con skill `/mejora-diseño` (mayo 2026)**: (a) **animación de UI sutil** — keyframes reutilizables nuevos en `globals.css` (`fadeIn`/`modalIn`/`toastIn` + clases `.anim-fade`/`.anim-modal`/`.anim-toast`, curva ease-out `cubic-bezier(0.25,1,0.5,1)`, `modalIn` entra desde `scale(0.96)` no 0) + bloque global `@media (prefers-reduced-motion: reduce)`. Beneficia a todo el dashboard (de paso revive los `animate-[fadeIn]` que estaban muertos en `emitir-client`). Modales del catálogo entran con `anim-modal` + backdrop `anim-fade`; micro-feedback `active:scale-[0.97/0.98]` en botón Agregar, chips de categoría, paginación y botones de modal. (b) el **mensaje de éxito/error pasó de banner (empujaba el contenido) a toast flotante** (`fixed bottom-6 right-6` + `anim-toast`), mismo patrón que `/comprobantes` y `/cobranzas`. (c) **`tabular-nums`** en Compra/Venta/Margen (tabla y cards) para que las cifras alineen parejo. (d) **radios unificados** (cards/tabla/modales → `rounded-xl`/`2xl`; botones/chips → `rounded-lg`). NO se tintaron los neutros (habría roto consistencia con las pantallas hermanas que usan gris Tailwind — queda como recomendación global). tsc/eslint limpios.
- **Reportes** (`/dashboard/reportes`): originalmente hub con 3 pestañas (Panel Gerencial · Analítica · Resumen). **Rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador con Chrome MCP):** se fusionó a **2 pestañas de propósito claro** porque las 3 se pisaban (KPIs/top productos/ranking repetidos; Panel tenía dinero sin fechas, Analítica fechas sin dinero):
  - **Ventas** (`reportes/ventas-tab.tsx`): reporte de análisis por período. **Selector único de fechas con presets** (Hoy · Esta semana · Este mes · Mes pasado · Personalizado) — antes Analítica tenía DOS selectores. KPIs en **dinero**: hero "Facturado" (protagonista) + ticket promedio + pedidos + % de entrega. Ranking de asesoras (barras por S/ facturado), top productos (S/ + cantidad), ventas por día (barras), por empresa, por distrito. **Exporta Excel + PDF** (lo pidió Hugo). Si hay entregas pero `total_facturado === 0` (faltan precios), muestra **banner ámbar** que explica el S/0 y linkea al Catálogo (Krug: no hacer pensar "¿por qué todo es 0?").
  - **Día a día** (`reportes/dia-tab.tsx`): el viejo Resumen operativo repulido (sin el gradiente del "Tip del día", KPIs unificados). Lista de pedidos de un día puntual (cliente/WhatsApp/dirección/items) + totales por producto, para planear despacho/producción. Sigue usando `/api/resumen-diario`.
  - **Medición = facturación ENTREGADA** (coherente con gotcha #8 / §13: reportes de admin miden entregado, NO `created_at`). Monto = `COALESCE(subtotal_real, subtotal)` de pedidos `Entregado`, por `fecha_pedido`.
  - **Backend nuevo** (DRY): `lib/reportes/datos-ventas.ts` (`obtenerReporteVentas(desde,hasta)` — única fuente de cifras) lo consumen `GET /api/reportes/ventas` (JSON), `GET /api/reportes/ventas/export-xlsx` (vía `lib/reportes/excel-ventas.ts`, 4 hojas: Resumen · Ventas por día · Top productos · Ranking) y el PDF de 1 página `lib/reportes/pdf-ventas.ts` (jsPDF + autotable, generado en cliente, import dinámico). Componentes compartidos en `reportes/ui.tsx` (KpiCard sin gradientes estilo comprobantes, HeroMetric, SelectorPeriodo, GraficoBarrasDia). Estilo alineado al resto (sin degradés, `tabular-nums`, `anim-*`, `active:scale`).
  - **Se borraron** los huérfanos: `panel-gerencial-client.tsx`, `analytics-client.tsx`, `resumen-client.tsx` y los endpoints `/api/analytics` + `/api/panel-gerencial` (ya nadie los importaba; git los preserva). Los redirects `/panel-gerencial`, `/analytics`, `/resumen` → `/reportes` se mantienen. tsc/eslint limpios; Excel verificado (200, XLSX válido) y PDF sin errores de consola.
- **Menú lateral agrupado** (`DashboardLayout.tsx`): `GROUP_BY_HREF` + `GROUP_ORDER` agrupan en Operación / Comercial / Reportes / Configuración (de 15 ítems planos a ~9 agrupados). El `<Link>` se extrajo en `mobileLink`/`desktopLink` (DRY); el header de grupo en desktop solo aparece on-hover (sidebar colapsado).
- **IA fuera del menú**: ya no hay ítem "Asistente IA". Acceso por **botón flotante** (`FloatingAssistant.tsx`, todas las páginas, roles admin/asesor) + **insights embebidos** (`InsightCard.tsx`) en Reportes (admin) y Mis Metas (asesora). `InsightCard` llama a `/api/asistente-ia` (scoped por rol). La página `/dashboard/asistente-ia` sigue existiendo (destino del botón flotante). **Rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar `/api/asistente-ia` ni `insights.ts`):** era la única pantalla con "look de IA" — gradiente violeta/índigo en cada texto de IA + header y botón violetas + arcoíris de 8 colores de cabecera. Se alineó al sistema: (1) **fuera el violeta y los gradientes**, acento = rojo de marca (header `FiZap` rojo, botón "Refrescar" rojo); (2) el texto de la IA es el **protagonista** de cada card, marcado con un chip rojo "SUGERENCIA DE LA IA" (`FiZap`), y los datos crudos pasan a **apoyo** debajo de un divisor `border-t`; (3) **color solo con significado** en el ícono de cabecera (verde tendencias · rojo riesgo · ámbar ranking · azul día · teal cartera), sin bloques de color rellenos; (4) las cajitas de datos (resumen del día, performance) pasaron de fondos multicolor a `bg-gray-50` uniforme con el valor en color semántico; (5) fuera los emojis sueltos (📦/✨/🔒 → texto sobrio + `FiLock`); `tabular-nums`, `rounded-2xl`, `active:scale`, `.trim()` en nombres. tsc/eslint limpios.
- **Usuarios** (`/dashboard/users`: `page.tsx` + `users-client.tsx` + `user-modal.tsx`) — **rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar `/api/users`):** era la pantalla más vieja (de abril, acento **azul**, `alert()`/`confirm()` nativos, rol como texto crudo en minúscula, doble título + botón "Regresar al Dashboard"). Ahora: (1) acento **rojo de marca**, estilos del sistema; (2) **rol como badge** legible con ícono y color (Administrador gris+`FiShield` · Asesora azul+`FiBriefcase` · Repartidor verde+`FiTruck` · Producción ámbar+`FiPackage`); (3) **avatar con inicial** coloreado por rol + **panorama de chips** con el conteo por rol arriba; (4) acciones por fila = botón "Editar" con texto + ícono de borrar sutil (hover rojo); (5) **`confirm()` → modal de confirmación** de borrado y **`alert()` → toast**; (6) header limpio (un título "Usuarios", sin "Regresar al Dashboard"); el modal crear/editar reestilizado (`anim-modal`, inputs `focus:ring-red-200`, select de rol con descripción de cada rol). tsc/eslint limpios.
- **Pendiente:** verificación visual en navegador (quedó bloqueada por selección multi-browser durante la sesión). El botón flotante es un link; se puede mejorar a panel slide-over después.

### Conectividad entre áreas — Facturación↔Cobranzas (mayo 2026 — local)
Auditoría: las áreas se conectan vía `pedido_id` + `pedidos.estado` (cadena Pedido→Producción→Despacho→Entrega→Cobranza+Factura). Decisión de negocio sobre independencia: necesaria solo para **Facturación** (venta de mostrador) y **Cobranzas** (registro manual); **Producción/Despacho son order-driven** por naturaleza (no necesitan modo standalone).
- **Lazo cerrado**: una venta facturada standalone (`/api/comprobantes/emitir-manual`) marcada **a Crédito** crea su cobranza automáticamente (`crearFacturaStandalone` en `lib/cobranzas.ts`), pero SOLO si el comprobante salió OK (estado ACEPTADA/ACEPTADA_CON_OBSERVACIONES/PENDIENTE — no rechazado/error, para no registrar deuda inválida ni duplicar al reintentar). UI: toggle Contado/Crédito + plazo en `emitir-client.tsx`.
- **Cobranza manual**: botón "Registrar cobranza manual" en `/dashboard/cobranzas` + `POST /api/facturas` (deudas sin pedido). `facturas.pedido_id` es nullable → no requirió migración.

### Roadmap "Mejor flujo para usuarios" — P0–P3 ejecutado (mayo 2026 — local, build OK)
Audit completo y plan en `docs/superpowers/specs/2026-05-27-audit-conexiones-roadmap-design.md` + `docs/superpowers/plans/2026-05-27-p0-cierra-loop-dinero.md`. Lo ejecutado (construido en `dev-hugo`, **ya en producción desde 30 may 2026**):

**P0 — Cierra el loop del dinero (~14h):**
- **P0.1 — Contado → cobranza por default** (`/api/comprobantes/emitir-manual` + `emitir-client.tsx`): toda factura (tipo 01) crea cobranza automáticamente, sea Contado o Crédito. Toggle "El cliente ya pagó al instante" cuando es Contado-cash. Boletas (03) NO crean cobranza.
- **P0.2 — Cobranza manual conectada** (`/api/facturas` + `cobranzas-client.tsx`): el modal "Registrar cobranza manual" ahora tiene autocomplete contra `/api/clientes` (debounce 300 ms, `<datalist>`) + selector de facturas ya emitidas del cliente (filtra por `cliente_doc_num`). Migración `scripts/migrate-factura-vinculo.sql` agrega `facturas.comprobante_id` (NULLABLE, FK). Fallback texto libre intacto.
- **P0.3 — Modal compartir ticket** (`ticket-share-modal.tsx`): `max-h-[90vh] overflow-y-auto` + header sticky con X siempre visible.
- **P0.4 — Excel de comprobantes** (`/api/comprobantes/export-xlsx` + botón en header `comprobantes-client.tsx`): admin descarga `.xlsx` respetando filtros activos (tipo, empresa, doc cliente). Columnas para contador: Fecha · Serie-Número · Tipo · Empresa · Cliente · RUC/DNI · Subtotal · IGV · Total · Estado · Mensaje SUNAT. Usa `xlsx` (SheetJS).

**P1 — Conexiones que faltan (~14h):**
- **P1.5 — Perfil 360° del cliente** (`/api/clientes/[id]/perfil` + `/dashboard/clientes/[id]`): pantalla con identidad, KPIs (facturado / cobrado / pendiente / vencido), 4 tabs (Pedidos · Comprobantes · Cobranzas · Top productos), acciones rápidas (WhatsApp, Nuevo pedido, Emitir comprobante). Botón "Ver perfil 360°" (FiUser indigo) en cada fila de `/clientes`.
- **P1.6 — "Cobrado" 1-clic + undo 5s** (`/api/facturas/[id]/pago` DELETE + `cobranzas-client.tsx`): se reemplazó el modal de confirmación por **optimistic update + toast "Deshacer" 5 s** (patrón Gmail). El endpoint DELETE revierte el pago al estado anterior (Pendiente / Vencida según fecha).
- **P1.7 — Duplicar pedido** (botón FiCopy en `table.tsx`): copia cliente + ítems al sessionStorage y navega a `/nuevo-pedido`. El form (`PedidoForm.tsx`) lee la key y precarga.
- **P1.8 — Link cruzado Comprobante ↔ Pedido**: badge "Facturado" en `table.tsx` ahora linkea a `/comprobantes?pedido_id=X` (filtro server-side ya soportado por el endpoint). Banner "Filtrando por pedido N" con "Quitar filtro" en `comprobantes-client.tsx`.

**P2 — UX que ahorra clics (~13h):**
- **P2.9 — Búsqueda global Cmd+K** (`/api/buscar` + `components/CmdKModal.tsx` + `DashboardLayout.tsx`): atajo ⌘K/Ctrl+K abre un command palette con TOP-5 de clientes/pedidos/comprobantes (scoping por rol). Navegación con ↑↓/Enter/Esc. Búsqueda debounce 250 ms.
- **P2.10 — Notificación de comprobante rechazado** (`lib/notificaciones.ts` helper `notificarComprobanteConProblema` + hooks en los 4 endpoints emit): cuando SUNAT rechaza (RECHAZADA) o hay error de infra (ERROR), se notifica al admin + asesora dueña (si aplica). Nuevos tipos `comprobante_rechazado` / `comprobante_error`. Hookeado en `/emitir`, `/emitir-manual`, `/[id]/reintentar`, `/[id]/nota-credito`. Sin tocar `lib/sunat/*` (módulo BETA-validado, protegido).
- **P2.11 — Aviso post-emisión al editar pedido** (`edit-modal.tsx`): cuando el pedido ya tiene comprobante "vivo" (no RECHAZADA/ERROR/ANULADO), aparece banner ámbar al abrir el modal: "Este pedido ya tiene Factura F001-X. Los cambios no se reflejarán en el comprobante. Para corregir, emitir Nota de Crédito." Con link directo al comprobante.

**P3 — Vista de jefe (~12h):**
- **P3.12 — "Mi Día" de la asesora** (`/api/mi-dia` + `/dashboard/mi-dia`): panel unificado con saludo según hora Lima, métricas del día (pedidos registrados + monto vendido — coherente con `created_at` del sistema de incentivos), pedidos para entregar hoy con estado/hora, cobranzas vencidas + venciendo hoy, **clientes dormidos** (sin pedido hace ≥20 días) con botón WhatsApp directo. Nuevo ítem "Mi Día" en sidebar (icono FiSun, roles asesor+admin, grupo Operación).
- **P3.13 — Aging de cobranzas** (`/api/cobranzas/aging` + panel colapsable en `cobranzas-client.tsx`): 5 buckets (Por vencer · 0–30 · 31–60 · 61–90 · +90) con monto + count + color escalado. Top-5 morosos por monto de deuda vencida. Asesor solo ve los suyos. Lazy fetch al expandir.
- **P3.14 — Daily digest a Antonio** (`/api/cron/daily-digest-admin` + entrada en `vercel.json` a las 13:30 UTC = 8:30 Lima): cron que junta cobranzas vencidas + que vencen hoy + comprobantes en error/rechazado (últimos 7 días) + pedidos pendientes sin asignar, y manda **una sola notificación consolidada** al admin con link al área más relevante. Si no hay señales (todo en cero), no spamea. **Además, este cron purga las notificaciones YA LEÍDAS de más de 30 días** (helper `limpiarNotificacionesAntiguas(30)` en `lib/notificaciones.ts`): corre al inicio, antes del posible return temprano, así limpia todos los días aunque no haya digest. Las **no leídas se respetan siempre** (son pendientes reales). Se enganchó acá —y no en un 5º cron— por el límite de crons de Vercel. La campanita (`NotificationBell.tsx`) importa `TipoNotificacion` directo del backend (`import type`) para no quedar desfasada cuando se agregan tipos nuevos.

**Lo que NO se tocó** (en respeto al spec): el módulo SUNAT real (`lib/sunat/xml-builder.ts`, `xml-signer.ts`, `soap-client.ts`, `index.ts`) — BETA-validado, se evitó cualquier riesgo de regresión en la firma/envío.

**Estado**: ✅ en producción (30 may 2026). `tsc`/`eslint` limpios, build OK. La migración `migrate-factura-vinculo.sql` quedó incluida en `migrate-produccion-2026-05-29.sql` (ya aplicada en producción).

### Mejoras UX/flujo (mayo 2026 — local, tras pruebas en navegador)
Plan: `docs/superpowers/plans/2026-05-22-mejoras-ux-flujo.md`. 11 mejoras de las pruebas E2E:
- **Menú lateral** (`DashboardLayout.tsx`): "Mis Metas" para `asesor` (su panel diario) y `admin` (vista previa con banner — ver §"Sistema de Incentivos"; inicialmente se ocultó del admin por mostrar S/0, luego se reactivó como vista previa porque el ranking y la meta de equipo sí traen datos reales); spacing más compacto (links `py-2`, grupos `pt-2`, headers `pt-1 pb-0.5`, nav `py-4 space-y-1 min-h-0`) + footer de sesión en 1 línea → entran los 4 grupos sin scroll en pantallas ≥900px.
- **Botón flotante IA** (`FloatingAssistant.tsx`): compacto (círculo solo-ícono, rótulo on-hover, `z-40` bajo modales) + `pb-24` en el `<main>` → ya no tapa acciones del fondo.
- **Comprobantes** (`comprobantes-client.tsx`): fila de filtro por **ESTADO** (client-side sobre lo ya traído por tipo/empresa) + muestra `mensaje_sunat` (motivo) en filas error/rechazado/observado.
- **Lista de Pedidos** (`table.tsx`): `detalle` con `line-clamp-3` + `title` (texto largo ya no rompe la fila).
- **Catálogo › Precios** (`precios-client.tsx`): banner ámbar con conteo de productos sin `precio_venta` (no suman a ventas/metas/reportes — explica los S/0 en reportes con data de prueba).
- **Resúmenes enviados**: `GET /api/comprobantes/resumenes` + lista con "Consultar" en `ModalResumenDiario` (consultar tickets de RC- de días previos, ej. los del cron).
- **Notificaciones** (`lib/notificaciones.ts`): se conectaron 4 tipos que estaban declarados pero nunca se emitían — `pedido_asignado` (despacho/asignar → repartidor), `pedido_en_camino` (iniciar-viaje → asesora), `guia_firmada` (guia-firmada → asesora), y **`meta_diaria_alcanzada`** (en `pedidos/[id]/entregar`, al cerrar una entrega: si `ventasHoy(asesor) >= metaDiaria` se avisa a la asesora **una sola vez al día** — guard por `notificaciones` del día; reusa `ventasHoy`/`calcularMetaDiaria` de `lib/metas.ts`, mismo cálculo que `/api/metas`, no bloqueante). **Pendiente a propósito**: `pesos_listos` (redundante con `listo_para_despacho`, que ya se emite cuando producción marca el pedido listo).
- **Ya existía** (solo verificado): emitir comprobante desde un pedido entregado (`table.tsx`, badge "Facturado" si ya tiene).

### Sistema de Incentivos (mayo 2026 — local, verificado en navegador)
Plan: `docs/superpowers/plans/2026-05-22-sistema-incentivos.md`. Motiva a las asesoras con metas día/semana/mes + racha, una meta de equipo semanal con premio, y un ranking mensual con premios — **todo configurable por el admin desde una sola pantalla**. **Sin migración**: la config vive en `settings.incentivos_config` (JSONB); las metas individuales reusan la tabla `metas_asesoras` ya existente.

- **Config en `settings` (key `incentivos_config`)** — forma:
  ```json
  {
    "metaEquipoSemanal": { "activo": true, "criterio": "monto|pedidos", "monto": 5000, "premio": "texto libre" },
    "rankingMensual": { "activo": true, "criterio": "monto|pedidos",
      "premios": [ { "puesto": 1, "premio": "S/200…" }, { "puesto": 2, "premio": "…" } ] },
    "rachaSemanal": { "activo": true, "diaFin": 6, "criterio": "monto|pedidos", "minimoDiario": 300, "premio": "texto libre" },
    "metasIndividuales": { "activo": true }
  }
  ```
  `rachaSemanal.diaFin`: 1=lunes … 6=sábado (hasta qué día cuenta la semana; default sábado). `rachaSemanal.minimoDiario`: el mínimo del día (S/ si criterio=monto, o N° de pedidos si criterio=pedidos); con `minimoDiario:0` ningún día cuenta. `metaEquipoSemanal.monto` es el objetivo (S/ o N° de pedidos según su criterio).
  **`criterio` (flexible en equipo, racha y ranking)**: `monto` (facturación S/) · `pedidos` (N° entregados). _(Se quitó "% de cumplimiento de su meta" por decisión de negocio.)_ Premios = **texto libre** y **flexibles**. `metasIndividuales.activo` controla si la asesora ve sus tarjetas de progreso (Hoy/Semana/Mes). Helpers en `src/lib/incentivos.ts`: `getIncentivosConfig()` (merge con `DEFAULT_INCENTIVOS` + normaliza criterios), `saveIncentivosConfig()` (upsert `ON CONFLICT (key)`), `getVendidoEquipoSemana(criterio)` (S/ o conteo de pedidos del equipo), `getRankingMensual(criterio)`.
- **🔑 Medición por VENTAS, no por entregas (decisión de negocio, mayo 2026)**: TODAS las métricas del desempeño de la asesora (metas día/semana/mes, racha, meta de equipo, ranking) cuentan el pedido por el **día en que la asesora lo REGISTRÓ** (`created_at`, zona Lima), **no** por la fecha de entrega (`fecha_pedido`, que en el form se llama "Fecha de Entrega"). Razón: la asesora vende, el repartidor entrega días después (~86% de los pedidos se entregan en fecha posterior); medir por entrega mezclaría su esfuerzo con el del motorizado y lo mandaría a fechas futuras. El **monto** usa `pi.subtotal` (precio estimado al vender), **no** `subtotal_real` (peso real al entregar). **No se filtra por estado** (un pedido que luego sale Fallido igual fue una venta del día). _Esto aplica solo a metas/incentivos de la asesora; los reportes de admin (`lib/insights.ts`, analytics, comprobantes) siguen midiendo facturación ENTREGADA, que es lo correcto para ese contexto._
- **Cálculos de meta** (`src/lib/metas.ts`, extendido): helper interno `sumarVentasCreadas` (por `created_at`); `calcularMetaDiaria`/`ventasMesActual`/`ventasHoy`/`ventasSemana(asesorId)` (lunes→hoy), `rachaDiaria(asesorId)` (legado, ya no se muestra) y **`getRachaSemanal(asesorId, diaFin=6, criterio="monto", minimoDiario=0)`** → `RachaSemanal { dias: DiaRacha[], diasCumplidos, totalDias, diasTranscurridos, semanaPerfecta, criterio, minimoDiario }`: por cada día (lun→`diaFin`) trae monto Y conteo de pedidos vendidos; `cumplido = minimoDiario>0 && valor(criterio)>=minimoDiario`. Reinicia cada semana. `meta_semanal = metaDiaria × 6`.
- **Endpoints**:
  - `GET /api/incentivos` (admin+asesor) → `{ config, criterio, equipo, ranking, racha, metasIndividuales }`; marca `esTu:true` en la fila del asesor; `equipo` usa su `criterio` (S/ o pedidos); `racha` = `getRachaSemanal(user.id, diaFin, criterio, minimoDiario)`. `POST` (solo admin) valida con zod (`ConfigSchema`: equipo+racha con `criterio`, racha con `minimoDiario`, `metasIndividuales`).
  - `GET /api/metas/asesoras` (solo admin) → metas individuales de todas las asesoras (para la pantalla de config).
  - `GET /api/metas` extendido: agrega `metaSemanal`, `ventasSemana`, `racha`, `porcentajeAvanceSemanal`.
  - `POST /api/metas/override` (ya existía) → meta individual mensual a `metas_asesoras` (mes `YYYY-MM-01`).
- **Pantalla admin** `src/app/dashboard/incentivos/{page,incentivos-client}.tsx` (guard admin → `redirect(homeForRole)`). 4 secciones, **cada una con su interruptor on/off**: (1) **Racha semanal de consistencia** (Activa + "se mide por…" monto/pedidos + mínimo por día + "cuenta de lunes hasta…" Vie/Sáb + premio — va primero, lo más destacado), (2) **Meta de equipo** (Activa + "se mide por…" monto/pedidos + objetivo + premio), (3) **Ranking mensual** (Activo + criterio + premios por puesto editables), (4) **Meta mensual de cada asesora** (Activa = la asesora ve sus tarjetas de progreso; + override por asesora → `/api/metas/override`). Botón "Guardar configuración de incentivos" (`POST /api/incentivos`, guarda los 4 toggles + criterios). Ítem de menú **Incentivos** (`FiAward`, adminOnly) en Configuración. **Rediseño UX con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar endpoints ni cálculo):** la pantalla es de interruptores, así que el foco fue hacer visible el estado on/off y limpiar el caos de guardado. (1) **Interruptor (toggle switch) grande** por bono en vez del checkbox chico; la tarjeta **se atenúa y colapsa sus campos cuando está apagada** (`BonoCard` muestra solo "Apagado · la asesora no lo ve") → se ve el estado de un vistazo y se va el ruido de configurar bonos apagados. (2) **Franja-panorama arriba**: "N de 4 bonos activos" + 4 chips (`EstadoChip`) con el activo en rojo y el resto gris. (3) **Fin del caos de 6 botones rojos "Guardar"**: las metas por asesora ya no tienen botón fijo — aparece un botón secundario **"Fijar"** (gris, no rojo) **solo cuando editás esa fila** (estado `dirty` comparando con el valor cargado), con nota de que se guardan aparte al instante; la fila muestra "Meta fija S/X" o "Meta automática (mes anterior +15%)". El botón rojo grande **"Guardar configuración de bonos"** queda como única acción primaria. (4) **Consistencia**: toast flotante (`anim-toast`) en vez de banner que empujaba; inputs `border-gray-200`/`focus:ring-red-200`; `active:scale`; se quitó la numeración "1·2·3·4" (no son pasos). tsc/eslint limpios.
- **Panel asesora** `src/app/dashboard/mis-metas/mis-metas-client.tsx`: cada bloque aparece **solo si su incentivo está activo** (flexibilidad total). Tarjetas **Hoy / Esta semana / Este mes** + indicador de ritmo (solo si `metasIndividuales.activo`); bloque **🔥 Racha de consistencia** (si `rachaSemanal.activo`) = cuadros por día (lun→diaFin) verde ✓/rojo ✗/gris · futuro, hoy con ring, con texto "cada día cuenta si vendes S/X / entregas N pedidos" según criterio; bloque **🏆 Meta del equipo** (si `activo`, progreso en S/ o pedidos según criterio); bloque **🥇 Ranking del mes** (si `activo`, medallas + premios); + `InsightCard` IA. La ven `asesor` y `admin`: para la asesora es su panel; el **admin la abre como VISTA PREVIA** (banner azul + `esVistaPrevia` desde `page.tsx`). **Rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar `/api/metas` ni `/api/incentivos`):** (1) **jerarquía** — antes 3 barras (Hoy/Semana/Mes) del mismo peso; ahora **"Hoy" es el hero** (% en `text-5xl`, barra gruesa, fondo de semáforo) y **Semana + Mes son 2 tarjetas compactas** de apoyo lado a lado; (2) el hero dice **cuánto falta** ("Te faltan S/ X para tu meta") y maneja el caso `metaDiaria<=0` ("Aún no tienes meta para hoy") en vez de un falso "¡cumplida!"; (3) **coherencia de color** — equipo pasó de **índigo** a la paleta del sistema (barra de semáforo + ícono `FiUsers` azul), racha perdió el **gradiente naranja** (semana perfecta = verde sólido), premios de índigo → **ámbar con `FiGift`**, amarillo → ámbar; (4) emojis de cabecera → íconos Feather (`FiZap` racha · `FiUsers` equipo · `FiAward` ranking; medallas 🥇 se quedan); quité el 🎉 del indicador de ritmo; (5) el `InsightCard` bajó del tope a después del progreso (no compite con "Hoy"); `tabular-nums`, `bg-gray-50` de fondo, `active:scale`. tsc/eslint limpios.
- **Verificado (dev-hugo)**: tsc/lint limpios; lógica de criterios confirmada por SQL (racha por **pedidos** mín. 1 → L✓ M✗ X✓ J✓ V✓ S✗ = 4 días, donde el Jueves de S/80 que con criterio *monto* fallaba ahora con *pedidos* cuenta; equipo por pedidos = `COUNT(DISTINCT pedidos)`). El round-trip POST/GET del endpoint con on/off por bono se probó en navegador (cada bono aparece/desaparece del panel según su `activo`). **Medición por ventas (created_at) confirmada por SQL**: ranking mensual por pedidos = Jhoselyn 115, Leslie 106, Yali 104, Yesica 73 (datos reales preexistentes en dev-hugo); el monto sale S/0 porque los items de prueba no tienen `precio_venta` (lo explica el banner ámbar del catálogo). Los **datos de prueba ya se borraron** (pedidos `__DEMO_RACHA__`, overrides de meta de Antonio/AsesoraTest y la `incentivos_config` demo) → dev-hugo limpio; `getIncentivosConfig` devuelve `DEFAULT_INCENTIVOS` (todo inactivo) hasta que el admin configure. **Pendiente:** spot-check visual de los selectores de criterio tras re-login en el navegador (la sesión del tab se cerró sola).

### Próximas fases (no cotizadas aún)
- CRM con WhatsApp Business API (Antonio lo postpuso explícitamente).
- App iOS del repartidor (solo Android por ahora — todos los motorizados usan Android).

---

## 14. Para el próximo agente (tú, IA futura)

Antes de empezar cualquier tarea:

0. **Lee primero [`docs/arquitectura/README.md`](./docs/arquitectura/README.md)** — tiene un mapa "si vas a tocar X, lee Y" que te ahorra tiempo. Los 5 documentos temáticos tienen verificación contra código real.
1. **Si vas a modificar el flujo de estados del pedido**, lee `§8` de este archivo + `docs/arquitectura/04-flujos-de-negocio.md` § 3 (máquina de estados completa con diagrama Mermaid).
2. **Si vas a agregar una nueva tabla o columna**, crea un nuevo `scripts/migrate-<feature>.mjs` siguiendo el patrón. NO modifiques migraciones existentes ni el `seed.mjs`.
3. **Si vas a agregar una nueva API**, valida con zod, chequea sesión, scopea por rol, devuelve errores con status correcto. Usa `lib/data.ts:fetchFilteredPedidos` como referencia de cómo se filtra por rol.
4. **Si vas a tocar la pantalla del repartidor (`mi-ruta-content.tsx`)**, recuerda que toda acción debe pasar por `offline-queue` para que funcione sin internet. No llames `fetch` directo desde un botón.
5. **Si vas a integrar un servicio externo nuevo**, usa env vars (no hardcodes), y prefiere planes gratuitos para no generar costos a Antonio (ver propuesta: "se mantienen costos al mínimo").
6. **Cuando completes algo**, ofrece actualizar este CLAUDE.md con cualquier decisión nueva o gotcha que haya surgido. Mantenerlo vivo es lo que lo hace útil.

**Idioma**: responde en español al usuario, escribe código y comentarios en español. El dueño Antonio NO es técnico — si necesitas explicarle algo, usa lenguaje sencillo y enfoque en beneficios (no detalles técnicos).

---

## 15. Contactos y propiedad

- **Desarrollador:** Hugo Herrera (`eventonegocioslegendarios@gmail.com`)
- **Cliente / dueño del negocio:** Antonio Resurrección
- **Repo:** local en `/Users/hugoherrera/Programación/proyectos/transavic`
- **Deploy:** Vercel (cuenta `hugoherreracoach@gmail.com`)
- **DB:** Neon — cuenta donde está el proyecto Transavic: la vinculada a Vercel `hugoherreracoach@gmail.com` (org "Vercel: Hugo Herrera's projects", project `pedidos_transavic` / `fragrant-sun-30707890`)
- **Google Cloud (Maps API):** cuenta `hugoherreradeveloper@gmail.com`
- **Google Cloud (Gemini API):** cuenta dedicada `transavicdev@gmail.com` (project 88126347805)

---

## 16. Mapa de archivos del Asistente IA y SUNAT

### Asistente IA (Mejora 8) — funciona para admin + asesoras
| Archivo | Líneas | Función |
|---|---|---|
| `src/lib/gemini.ts` | ~110 | Helper `callGemini()` + clase `ClienteAnonymizer` (anonimato pre-prompt) |
| `src/lib/insights.ts` | ~560 | 8 insights (4 admin + 4 asesora scoped) + cache 1h |
| `src/app/api/asistente-ia/route.ts` | ~70 | Endpoint admin+asesor, detecta rol, scope cache |
| `src/app/dashboard/asistente-ia/page.tsx` | ~13 | Server component, valida rol |
| `src/app/dashboard/asistente-ia/asistente-ia-client.tsx` | ~430 | UI con `VistaAdmin` + `VistaAsesora` |

**Reglas críticas para tocar IA:**
- Las queries de asesora SIEMPRE filtran por `WHERE asesor_id = ${session.user.id}` — esto es el privacy boundary
- Antes de mandar nombres de clientes a Gemini, usar `ClienteAnonymizer` (genera "Cliente A", "Cliente B"...)
- En el prompt pedirle explícitamente a Gemini que NO repita los códigos "Cliente A" — referirse a ellos como "el cliente más importante", etc.
- Cache key debe incluir el scope (`admin-` o `asesor-{id}-`) para no mezclar

### SUNAT (Mejora 7) — FLUJO REAL (no stub, mayo 2026)
| Archivo | Líneas | Estado |
|---|---|---|
| `src/lib/sunat/types.ts` | 250+ | ✅ Enums completos (catálogos SUNAT 01/05/06/07/09/10/51/59) + interfaces |
| `src/lib/sunat/config-transavic.ts` | 310 | ✅ Multi-empresa, getSunatConfig(), endpoints BETA/prod, números a texto |
| `src/lib/sunat/contador.ts` | 34 | ✅ Correlativos atómicos en DB |
| `src/lib/sunat/xml-builder.ts` | 677 | ✅ Genera XML UBL 2.1 (factura/boleta/nota crédito) |
| `src/lib/sunat/xml-signer.ts` | 168 | ✅ Firma con cert .p12 + xml-crypto |
| `src/lib/sunat/soap-client.ts` | 582 | ✅ POST a SUNAT + parsea CDR (descomprime PKZip) |
| `src/lib/sunat/index.ts` | 240 | ✅ Orquesta XML → firma → SOAP → DB |
| `src/lib/sunat/resumen-diario.ts` | ~250 | ✅ Helper compartido Resumen Diario (RC-) con idempotencia (cron + manual) |
| `src/lib/sunat/pdf-comprobante.ts` | 885 | ✅ PDF formato SUNAT (jsPDF + jspdf-autotable) — sin QR (decisión, ver §13) |
| `src/lib/sunat/parse-cpe-items.ts` | ~120 | ✅ Parsea las líneas de ítem del XML UBL firmado (factura/boleta/NC) para el PDF/correo — fuente fiel con código. Ver gotcha #18 |
| `src/lib/email.ts` | 110 | ✅ Helper nodemailer (SMTP genérico) / Brevo |
| `src/app/api/comprobantes/route.ts` | 60 | ✅ Lista comprobantes |
| `src/app/api/comprobantes/[id]/route.ts` | 175 | ✅ Detalle + items + emisor (para PDF) |
| `src/app/api/comprobantes/[id]/xml/route.ts` | 56 | ✅ Descarga XML firmado |
| `src/app/api/comprobantes/[id]/enviar/route.ts` | 165 | ✅ Envía PDF + XML por email |
| `src/app/api/comprobantes/[id]/reintentar/route.ts` | 250 | ✅ Reintenta envío (error/rechazado) + botón UI |
| `src/app/api/comprobantes/[id]/anular/route.ts` | 189 | ✅ Comunicación de Baja (RA-) + botón UI |
| `src/app/api/comprobantes/resumen-diario/route.ts` | ~80 | ✅ Resumen Diario (GET lista boletas, POST envía) → usa helper |
| `src/app/api/comprobantes/consultar-ticket/route.ts` | ~110 | ✅ getStatus de ticket (baja/resumen) + persiste resultado |
| `src/app/api/comprobantes/emitir/route.ts` | 164 | ✅ Emite comprobante real |
| `src/app/dashboard/comprobantes/...` | — | ✅ UI: PDF ⬇, XML ⟨/⟩, Email ✉, N. Crédito, Baja, Reintentar + Resumen diario (header) |

**Estado de testing (BETA, validado mayo 2026 con cert REAL):**
- ✅ XML UBL 2.1 generado correctamente (namespaces + totales OK)
- ✅ Firma digital con el cert real `.p12` (XML-DSig) — válida
- ✅ Comprimido en ZIP + enviado al webservice SUNAT BETA
- ✅ Factura (01), boleta (03) y nota de crédito (07) → **`ACEPTADA` con CDR** en BETA. (El viejo error 2335 era porque el código saltaba la firma en beta — corregido; ver §13.)

**Paso a producción — ✅ HECHO (30 may 2026), salvo la 1ª emisión real:**
1. ✅ Certificado digital tributario `.p12` descargado (Transavic `20612806901` y Avícola/RUC 10 `10710548841`), vigentes hasta 2029.
2. ✅ Usuario SOL secundario `APIFACTU` (perfil "Emisión Electrónica") creado para ambas empresas.
3. ✅ Cert convertido a base64 y cargado.
4. ✅ Env vars reales configuradas **en Vercel** (no en `.env`): `SUNAT_TRA_*` y `SUNAT_AVI_*` (RUC, razón social, dirección, ubigeo, SOL user/pass `APIFACTU`/`Transavic123`, cert b64/pass).
5. ✅ `SUNAT_ENVIRONMENT=production` en Vercel.
6. ⏳ **Emitir la primera factura/boleta real** (la hace Hugo manualmente) — único pendiente.

**Dependencias instaladas (mayo 2026):**
- `xmlbuilder2@4` — XML UBL 2.1
- `xml-crypto@6` — firma XML-DSig
- `node-forge@1` — leer cert .p12
- `archiver@7` — **NO archiver@8** (la v8 es ESM-only y cambió la API)
- `archiver`, `node-forge`, `xml-crypto` listados en `next.config.ts:serverExternalPackages` para evitar bugs de bundling webpack.

**Funcionalidades adicionales de comprobantes (mayo 2026):**
- ✅ **Descargar PDF** — diseño oficial SUNAT (jsPDF, generado en cliente). Botón ⬇ rojo en `/dashboard/comprobantes`
- ✅ **Descargar XML firmado** — endpoint `GET /api/comprobantes/[id]/xml` devuelve XML como attachment. Botón ⟨/⟩ azul
- ✅ **Enviar por correo** — `POST /api/comprobantes/[id]/enviar` con nodemailer. Modal con campos Para, CC, mensaje, checkbox "Incluir XML". Requiere `SMTP_*` env vars. Botón ✉ verde
- **PDF lee datos reales del emisor** desde env vars vía `getSunatConfig()` (no usa placeholders de DATOS_EMISOR_MAP)

**Ya implementado (mayo 2026 — backend + UI, ver §13 "Operaciones SUNAT con UI"):**
- ✅ Resumen diario de boletas (RC-) — cron automático + botón manual + idempotencia (`resumenes_diarios`)
- ✅ Comunicación de baja (RA-) de facturas — modal con motivo + ticket
- ✅ Consulta de ticket SUNAT (getStatus) — para confirmar baja/resumen
- ✅ Reintento de envío para comprobantes en error/rechazado

**Decisión sobre QR (NO se implementa):** el PDF replica el diseño de las boletas/facturas que entrega la propia SUNAT, que **no incluyen QR**. Por eso no se agrega. (Si a futuro se exige la representación impresa con QR, se añadiría con `qrcode`.)

# CLAUDE.md — Transavic

Contexto del proyecto para agentes de IA. Léeme **antes** de tocar código.

> **📚 Para profundizar en cualquier área:** ver `docs/arquitectura/` (25 documentos temáticos verificados contra código). Empezar por [`docs/arquitectura/README.md`](./docs/arquitectura/README.md) que tiene un mapa "si vas a tocar X, lee Y". Las **crónicas completas** de cada cambio (PRs, data-ops, diagnósticos) viven en [`docs/historial-cambios-2026.md`](./docs/historial-cambios-2026.md).
> **📐 Regla:** este archivo guarda SOLO reglas operativas breves con punteros — el detalle SIEMPRE va a `docs/` (ver §14.6).

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
# scripts/migrate-rider-gps-enforcement.sql — GPS obligatorio (gotcha #40); aplicar por psql
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
| `GROQ_API_KEY`, `GROQ_MODEL` | **Respaldo de IA** cuando Gemini falla (429 u otro). `callIA()` (`lib/gemini.ts`) reintenta con Groq (free tier, API OpenAI-compatible) si `GROQ_API_KEY` está; sin ella, no hay respaldo (todo igual que antes). `GROQ_MODEL` opcional, default `llama-3.3-70b-versatile`. Crear key en console.groq.com. **Configurar también en Vercel.** Groq recibe los mismos prompts ya anonimizados que Gemini. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP para enviar comprobantes por correo (Gmail con app password, SendGrid, Mailgun, etc.) |
| `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Override de remitente del correo (default name="Transavic", email=SMTP_USER) |
| `APISPERU_TOKEN` | Token de apisperu.com (cuenta `transavicdev@gmail.com`) para consultar RUC/DNI y auto-llenar datos del cliente (form de clientes, módulo emitir comprobante). Solo server-side vía `/api/consulta-documento`. **Configurar también en Vercel.** |
| `META_VERIFY_TOKEN`, `META_APP_SECRET` | Webhook de WhatsApp Cloud API del CRM (expansión ERP, aún NO en producción). `META_VERIFY_TOKEN` es OBLIGATORIA (sin ella `/api/webhooks/meta` responde 503 — no hay fallback en código); `META_APP_SECRET` verifica la firma de los POST (sin ella se aceptan sin verificar, solo para pruebas locales). Checklist pre-activación: [doc 15 §5](./docs/arquitectura/15-asistente-ia.md). |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Brevo (correos transaccionales, free 300/día). Si `BREVO_API_KEY` está, `lib/email.ts` usa la API de Brevo (preferida); si no, cae a SMTP/nodemailer. El sender debe estar verificado en Brevo (hoy `transavicdev@gmail.com`, activo). **Configurar también en Vercel.** |
| `CRON_SECRET` | Secreto que protege los **5 cron jobs** de Vercel (`/api/cron/facturas-vencidas`, `/recordatorios-asesoras`, `/resumen-diario-sunat`, `/daily-digest-admin`, `/repartidores-oscuros`). Sin él, esos endpoints devuelven **503**. Vercel lo manda como `Authorization: Bearer <CRON_SECRET>`. **Obligatorio en Vercel** para que los crons corran. **Ojo con el límite de Vercel: Hobby permite solo 2 crons (1×/día); Pro permite 40.** Por eso las tareas de mantenimiento (ej. purga de notificaciones viejas) se enganchan a un cron existente en vez de crear uno nuevo. (`repartidores-oscuros` SÍ es dedicado: corre cada 10 min, una frecuencia que ningún cron diario podía hostear — gotcha #40.) |
| `AUTO_EMITIR_COMPROBANTE` | Flag opcional (`"true"`) para emitir el comprobante automáticamente al cerrar un pedido. Si no está o es falso, la emisión es manual desde `/dashboard/comprobantes`. |
| `SUNAT_TRA_NOMBRE_COMERCIAL`, `SUNAT_TRA_DEPARTAMENTO`, `SUNAT_TRA_PROVINCIA`, `SUNAT_TRA_DISTRITO` (idem `SUNAT_AVI_*`) | Override del domicilio fiscal del emisor en el XML. El default del `DATOS_EMISOR_MAP` es placeholder ("LA VICTORIA"); en producción **conviene** setear el distrito/provincia/departamento reales. La dirección y el `UBIGEO` (lo legalmente crítico) ya se overridean con `SUNAT_*_DIRECCION` / `SUNAT_*_UBIGEO`. Además **`SUNAT_*_URBANIZACION`** → `cbc:CitySubdivisionName`: **vacío por defecto = se OMITE** del XML (un valor vacío dispara la observación SUNAT 4095); setealo solo si la ficha RUC tiene urbanización. |

`ADMIN_USER`/`ADMIN_PASSWORD` están en `.env` pero **no se usan en código activo** (legacy del scaffolding inicial). La auth real lee de la tabla `users`.

**`.env.local` (NO comiteado, override de `.env`)** apunta a la branch Neon `dev-hugo` para testing aislado de producción. Next.js lo carga con prioridad sobre `.env`. Para pruebas en local contra SUNAT Beta usando firmas reales: fijar `SUNAT_ENVIRONMENT="beta"`, dejar `SUNAT_TRA_SOL_USER=""` y `SUNAT_AVI_SOL_USER=""` (para usar la credencial `"MODDATOS"/"moddatos"` de prueba de la SUNAT), y mantener los certificados y contraseñas reales en `SUNAT_*_CERT_B64` y `SUNAT_*_CERT_PASS`. Para regresar a producción, volver a configurar `SUNAT_ENVIRONMENT="production"` y restaurar los usuarios SOL reales (ej. `"APIFACTU"`).

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
| `asesor` | Vendedoras (Leslie, Yoshelin, Sarai, Yesica) | Solo sus pedidos y sus clientes (+ **Despacho en solo lectura**) | Crear pedidos y clientes; ver lista propia. Scoping en SQL por `asesor_id = userId`. **Despacho** (`/dashboard/despacho`, mapa + lista): SOLO LECTURA, alcance TOTAL (ve todos los motorizados/entregas en vivo, NO solo los suyos — decisión de Antonio), sin gestionar. Ver §13 "Despacho para asesoras" |
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
14. **Cache del Asistente IA por scope**: el endpoint `/api/asistente-ia` cachea por rol/asesor (key `admin-*` o `asesor-{uuid}-*`). Esto preserva privacy boundary entre asesoras. TTL 1h. Si tocas `lib/insights.ts`, considerá si invalidar cache. **El caché es PERSISTENTE en Postgres** (tabla `ia_insights_cache`, `cached()`/`clearInsightsCacheFor()` en `lib/insights.ts`) — sobrevive a cold starts y deploys (resuelto el 4 jun 2026; antes era `new Map()` in-memory que disparaba el 429). Ver gotcha #16.
15. **Light-mode forzado (NO re-agregar dark mode)**: `globals.css` fija `color-scheme: light` y ya NO tiene `@media (prefers-color-scheme: dark)`. La app está diseñada SOLO para modo claro (tarjetas blancas, texto oscuro). Con el dark mode del SO activo, `--foreground` pasaba a claro (#ededed) y los textos quedaban casi invisibles sobre fondos blancos. **No volver a agregar el bloque dark.** Si se quiere dark mode real, hay que rediseñar todos los fondos/colores con variantes `dark:` de Tailwind.
16. **✅ IA / Gemini 429 bajo carga (RESUELTO 4 jun 2026)**: el caché de insights era **in-memory** (`new Map()`) y en Vercel serverless no sobrevivía a cold starts ni deploys → cada carga de Reportes/Mis Metas disparaba hasta 4 llamadas frescas a Gemini y topaba la cuota gratuita → **429**. **Fix (dos frentes, $0):** (a) **caché PERSISTENTE en Postgres** — tabla `ia_insights_cache` (migración `scripts/migrate-ia-insights-cache.sql`); `cached()` en `lib/insights.ts` ahora lee/escribe en DB (TTL 1h por scope, upsert por `cache_key`, sin cron de purga porque las claves son acotadas) → cada insight se genera ≤1 vez/hora y sobrevive a deploys; **bonus:** si un insight nuevo sale degradado pero hay uno bueno guardado, se sirve el bueno (`esInsightDegradado`). (b) **respaldo Groq** — `callIA()` en `lib/gemini.ts` intenta Gemini y, si falla (429 u otro), reintenta con **Groq** (`callGroq`, API OpenAI-compatible, Llama 3.3 70B, free tier) cuando hay `GROQ_API_KEY`; sin esa key se comporta igual que antes. Groq recibe los **mismos prompts ya anonimizados** (misma privacidad). Verificado E2E: cache miss 7s → hit 151ms (0 llamadas a Gemini). Vars nuevas: `GROQ_API_KEY` (opcional) + `GROQ_MODEL` (default `llama-3.3-70b-versatile`).
17. **Producción lanzada 30 may 2026 — cómo se migró**: el esquema de producción se llevó al día con `scripts/migrate-produccion-2026-05-29.sql` aplicado por **psql** (`psql "$DATABASE_URL_UNPOOLED" -f …`), NO por los `.mjs` (Node 26 los rompe — gotcha #13). Rollback en `scripts/rollback-produccion-2026-05-29.sql`. Vercel: proyecto `hugoherrerateam/transavic`, plan **Pro**. Para futuros cambios de esquema: probar en `dev-hugo`, y al mergear a `main` aplicar la migración a producción por psql ANTES de que el deploy con el código nuevo quede activo (si no, el código nuevo choca con columnas/tablas que faltan).
18. **El PDF/correo del comprobante leen los ítems del XML firmado, NO de la DB** (los standalone no guardan líneas en tablas). Orden de fuentes: XML firmado → `pedido_items` → línea global. El CDR se descarga como ZIP crudo de SUNAT. Parser: `src/lib/sunat/parse-cpe-items.ts`. Detalle: [historial](./docs/historial-cambios-2026.md).
19. **Reintento de comprobantes** (`/[id]/reintentar`): reenvía el `xml_firmado_base64` original o reconstruye desde `comprobantes.items_json` (persistido en CADA emisión); si no hay fuente fiel, aborta 422 — nunca fabrica líneas. Pueden reintentar **admin y la asesora dueña** (scope `comprobante-scope.ts`; abierto 12 jun, caso F002-83). `mensaje_sunat` SIEMPRE persiste la causa (`descripcion ?? error` — los fallos de conexión viajan en `.error`); la UI tiene fallback amigable si quedara NULL (`mensajeEstadoSinDetalle`). Emisión/reintento llevan `maxDuration=60`. Observaciones SUNAT 4095/4260 ya eliminadas del xml-builder.
20. **"Orden de pedido"** (interna, ex "guía de remisión", ruta `/pedidos/[id]/guia`): NO es documento legal. Identificadores internos se mantienen (`numero_guia`, `guia_firmada_*`); su correlativo es `correlativos.orden_pedido` (ver #29). Imprime Ticket 80mm (default, solo logo + sin datos del emisor) o A4; toggle "Incluir precios"; `siguienteCorrelativo` es UPSERT (no falla con tabla sin sembrar).
21. **"Resumen del día"** (totales por producto para producción): `/dashboard/resumen`, roles admin+produccion, abre en MAÑANA; usa `/api/resumen-diario`. Un producto con kg Y uni sale como tarjetas separadas (correcto).
22. **App Repartidor (Capacitor)**: en producción desde el 4 jun 2026 (carpeta `android/` en `main`, app en Google Play). En esta Mac: `compileSdk 36` + `android.suppressUnsupportedCompileSdk=36`; el plugin GPS se registra con `registerPlugin("BackgroundGeolocation")`; el módulo nativo se importa con `next/dynamic({ssr:false})`. Subir `versionCode` en cada release. Guía: `docs/app-repartidor-guia-prueba-y-build.md`.
23. **Impresión en tiquetera térmica**: los HUECOS entre pedidos = `break-inside:avoid` + `grid` (en formato Ticket el contenido fluye en bloque, sin break-inside); el SOBRANTE al final = falta de `@page` → `src/lib/impresion.ts` mide el alto real e inyecta `@page { size: 80mm <alto>mm }`. ⚠️ `size: 80mm auto` es CSS INVÁLIDO (Chrome lo ignora). El CSS de impresión solo se valida imprimiendo (Chrome headless + CDP). Detalle: [historial](./docs/historial-cambios-2026.md).
24. **`facturas.estado = 'Anulada'` se EXCLUYE de toda query de deuda**: usar `estado IN ('Pendiente','Vencida')`, NUNCA `<> 'Pagada'`. La NC auto-anula su cobranza por `comprobante_id` / `pedido_id`+número — JAMÁS por `numero_comprobante` solo (las 2 empresas comparten series F001/B001).
25. **Orden de pedido desde celular + ticketera Bluetooth**: usar el botón **Bluetooth** (RawBT, ticket de texto monoespaciado 42 col) en Android; "Imprimir" (que mide el alto e inyecta `@page`) solo para PC/PDF/impresora normal.
26. **DOS documentos de impresión distintos**: (A) el REPORTE de todos los pedidos del día (`VistaImpresion.tsx` + `src/lib/impresion.ts`, botón "Imprimir" del dashboard, bajo `DashboardLayout`) y (B) la orden de pedido individual (`/pedidos/[id]/guia`, layout raíz). Regla: todo elemento `position:fixed` bajo `DashboardLayout` lleva `print:hidden` (el botón flotante de IA salía impreso y dejaba papel en blanco al final).
27. **`clientes.rubro` (giro: Restaurante/Chifa/…) ≠ `clientes.tipo_cliente` (Frecuente/Nuevo)**: `rubro` es SOLO del directorio (lista fija `RUBROS` en `clientes-client.tsx`, chips "POR RUBRO", NULL = "Sin clasificar"); `tipo_cliente` se denormaliza a pedidos y sale en el ticket. No mezclar.
28. **GRE — reglas vigentes** (detalle: [docs/arquitectura/12](./docs/arquitectura/12-guias-remision.md)): banner de entorno dinámico (`GET /api/sunat/entorno`); con **M1/L** placa y TODOS los datos del chofer son opcionales (ocultos por defecto); la auto-búsqueda por RUC autocompleta razón social + dirección + DISTRITO — la regla de qué pisar vive en `decidirAutollenadoDestino` de **`src/lib/guia-form-shared.ts`** (módulo compartido por los DOS modales: cambios de reglas SIEMPRE ahí), tipear el doc REEMPLAZA, consultas automáticas solo llenan vacíos; distritos entrantes se normalizan (`matchDistritoLima` + `detectarDistritoEnDireccion`). **Emitir GRE DESDE una factura usa la dirección de la FACTURA** (12 jun 2026, pedido de Hugo: los clientes piden que coincidan): la fuente es el **XML firmado** (`data.cliente.direccion` del detalle, vía `parseCpeClienteDireccion`) — NO apisperu, que es intermitente y no devuelve dirección para muchos RUC 10 (persona natural). En el modal, `cargarItems` aplica esa dirección al punto de llegada y deriva el distrito con `detectarDistritoEnDireccion` del TEXTO (el XML no trae distrito estructurado; `cliente.distrito` del endpoint es el del PEDIDO → no usarlo); desde factura NO se consulta apisperu ni se auto-simplifica (la asesora ve/edita). En el server (`api/guias/emitir`), el distrito de una fuente (pedido/ficha) solo se hereda si la DIRECCIÓN vino de esa misma fuente; si la dirección la mandó el frontend (XML), el distrito se deriva del texto — nunca dirección-del-XML + distrito-del-pedido. `decidirAutollenadoDestino` en modo forzar es ATÓMICO dirección↔distrito. Emisión/reintento ABORTAN si falta el distrito (antes caían al ubigeo fallback 150101 Cercado de Lima en silencio). Matiz: emitir GRE **desde el pedido** (no desde la factura) usa la dirección de ENTREGA del pedido — asimetría deliberada (entrega real ≠ domicilio fiscal). El orden de elementos del XML se valida contra el XSD oficial con xmllint (NUNCA contra beta — su mock enmascaró un rechazo real). Mock de beta apagado salvo `SUNAT_GRE_MOCK_BETA=1`.
29. **Numeración GRE legal SEPARADA de la orden interna** (10 jun 2026): la GRE usa contador POR SERIE en `comprobantes_contador` (T001/T002) con reserva CTE atómica en `api/guias/emitir`; la orden interna usa `correlativos.orden_pedido`; `guia_remision` quedó CONGELADO; la GRE ya NO escribe `pedidos.numero_guia`; el badge GRE de despacho usa `EXISTS(comprobantes_guias …)`. Si tocas la emisión: la reserva va por el contador POR SERIE, no `siguienteCorrelativo`.
30. **GRE atascada en "emitiendo" + rechazo 2329 nocturno (10 jun 2026 — RESUELTO, T002-10 ACEPTADA)**: 3 causas raíz — (a) `comprobantes_guias` no tenía `updated_at` y el UPDATE post-SUNAT + el catch fallaban (migración `migrate-guias-reintento-2026-06-10.sql` la agrega y persiste dirección/distrito/M1L/chofer/items_json en la reserva); (b) el polling REST supera los ~15s default de Vercel → `maxDuration = 60`; (c) la fecha de emisión iba en UTC → desde las ~19:00 Lima SUNAT rechaza 2329 → usar SIEMPRE `src/lib/sunat/fechas.ts` (`fechaHoyLima`), NUNCA `toISOString()` para fechas SUNAT (ojo: Neon devuelve DATE como objeto `Date`). Recuperación: `POST /api/guias/[id]/reintentar` reusa el MISMO número (estados error/pendiente/rechazado/emitiendo>15min — un rechazo NO registra el documento); saneo lazy en `GET /api/comprobantes`. Peso bruto de la guía = suma EXACTA solo si TODOS los ítems son KGM (ítems desde la factura vinculada; jamás estimar). Detalle: [docs/arquitectura/12](./docs/arquitectura/12-guias-remision.md).
31. **Un pedido NUNCA debe quedar sin `pedido_items`** (11 jun 2026 — sin ítems, Producción no puede pesar y el pedido no cuenta en Resumen/reportes; "Duplicar pedido" copiaba solo texto y los duplicados nacían vacíos — caso Manuel lince/Nikuya). Garantías: Duplicar copia los ítems (table.tsx fetch detalle → `PedidoForm` los siembra vía `initialItems` del ProductSelector); el POST deriva ítems del TEXTO del detalle si no vienen (`src/lib/parse-detalle-pedido.ts`: parser "N uni|kg - Nombre…" + matching de catálogo por prefijo); el PATCH ya NO vacía `pedido_items` con `items: []`; y `GET /api/produccion/pedidos` hace backfill lazy de pedidos del día con 0 ítems. Si tocas la creación/edición de pedidos, conserva estas garantías. Crónica: [historial](./docs/historial-cambios-2026.md).
32. **Precios y cartera de clientes (11 jun 2026)**: (a) el **catálogo** lo ven admin (gestión) y **asesoras en SOLO LECTURA sin `precio_compra` ni margen** — el control real está en `GET /api/productos` (exige sesión; `precio_compra: null` para no-admin); (a2) la **autorización de precio bajo** se resuelve en el SERVER (`lib/autorizaciones-precio.ts`, 12 jun): usa la enviada si CUBRE los ítems (nombre+precio+cantidad×1.1, misma empresa/tipo) o AUTO-MATCHEA una aprobada sin usar de la asesora (prioriza mismo cliente) — la asesora ya no depende del link de la notificación; solo se consume (`usada_at`, guard atómico) la autorización que la emisión realmente necesitó; `/dashboard/autorizaciones` es admin (gestiona) + asesora (ve las suyas y usa "Emitir con esta autorización"); (b) **historial de precios** admin-only en `GET /api/precios/historial` + modal en el catálogo (une `precios_productos` con LAG + `autorizaciones_precio` aprobadas — sin tabla nueva); (c) **anti-duplicados de clientes**: `GET /api/clientes/verificar` es el ÚNICO endpoint de clientes SIN scoping (global a propósito, respuesta mínima: existe + asesora responsable; jamás datos del cliente ajeno); la regla vive en **`lib/clientes-duplicados.ts`** y la aplican el POST **y el PATCH** (solo si el RUC/WhatsApp CAMBIA — el PATCH era un bypass): 409 duro si es de otra asesora (el match ajeno SIEMPRE gana por ORDER BY), blando con `permitir_duplicado: true` si es propio, y el **admin ya NO está exento** (409 blando `puede_forzar` + confirm — antes creaba duplicados sin enterarse, caso ECO AMIGABLE); el **PEDIDO nunca se bloquea** por cliente de cartera ajena (ratificado por Hugo 11 jun: una venta bloqueada es peor que el conflicto — NO agregar avisos/bloqueos al pedido salvo pedido explícito); ese mismo `verificar` (global) alimenta la **detección en vivo** en 3 lugares: el form de crear cliente, "guardar como frecuente" del PedidoForm, la consulta al crear pedido (`/dashboard/nuevo-pedido`), y el **buscador de `/dashboard/clientes`** (13 jun: al escribir un término numérico ≥6 dígitos la asesora ve "registrado · ejecutiva responsable: X" si es de otra, sin datos del cliente ajeno); (d) **cobranzas**: el asesor se asigna en cascada `pedido.asesor_id` → emisora asesora → `clientes.asesor_id` (antes: admin emitía → cobranza sin asesor). Crónica: [historial](./docs/historial-cambios-2026.md).
33. **Fecha de emisión seleccionable en boletas/facturas (16 jun 2026)**: la emisión acepta `fechaEmision` (YYYY-MM-DD) — hoy o **retroactiva**; las **futuras NO** (SUNAT rechaza 2329). Límite por tipo en **`src/lib/sunat/fechas.ts`** (`LIMITE_DIAS_ATRAS={"01":3,"03":7}`, `validarFechaEmision`) — única fuente, la usan los DOS endpoints (`emitir`, `emitir-manual`, validan en SERVER) y la UI (`emitir-client.tsx`, selector con min/max por tipo + clamp; desde un pedido precarga la fecha del pedido recortada). La fecha REAL se persiste en **`comprobantes.fecha_emision`** (migración `migrate-fecha-emision-comprobante.sql`; el motor la mete en los 3 INSERT y la escribe en `cbc:IssueDate`); el PDF, el reporte Excel, la cobranza (`facturas.fecha_emision`/vencimiento) y el **resumen diario** (agrupa boletas por `COALESCE(fecha_emision, created_at_lima)` — una boleta retroactiva va en el RC de SU día) la leen con fallback a `created_at`. NC/RA/GRE NO cambian (su fecha es la del día). Validado E2E en beta (boleta retroactiva ACEPTADA, IssueDate=fecha elegida). Detalle: [historial](./docs/historial-cambios-2026.md).
34. **GRE: cantidades por línea SIEMPRE del XML firmado de la factura vinculada (16 jun 2026)**: la GRE NUNCA debe usar `pedido_items.cantidad` (estimada) cuando hay una factura/boleta vinculada — debe tomar descripción/cantidad/unidad del XML firmado de esa factura (fuente fiel a lo emitido). En `api/guias/emitir/route.ts` el bloque que vincula la factura se guarda con `!itemsDesdeComprobanteXml && finalPedidoId` (no `!finalComprobanteId`) y usa el `comprobante_id` EXPLÍCITO si vino (el modal de Comprobantes manda pedido_id + comprobante_id juntos → antes ganaba el camino pedido_id con estimadas y se saltaba el reemplazo → bug T002-22: líneas 30/30/15 pero peso 75.93). Además el **peso bruto es autoritativo** cuando todos los ítems son KGM (= suma de las líneas, ignora el `pesoBrutoTotal` del request) para que `GrossWeightMeasure == Σ DeliveredQuantity`. Las guías ya emitidas NO se corrigen (XML firmado); el reintento reusa el XML original. **Ampliación (16 jun):** el modal de GRE ahora MUESTRA los productos (cantidad + unidad) editables y los MANDA en `items`; el backend los respeta como última palabra (`if (parsed.data.items?.length) itemsRows = items…`, tras toda la resolución y antes del anti-doble-emisión) → "lo mostrado == lo emitido". Sin `items`, queda el fallback fiel del XML de la factura. Peso bruto = suma de las líneas cuando todo es KGM (front y back), editable solo en mixtas. Detalle: [historial](./docs/historial-cambios-2026.md).
35. **Clasificación del estado SUNAT: NUNCA asumir ACEPTADA por defecto (17 jun 2026)**: el CDR de SUNAT es un ZIP "data descriptor" que el parser casero NO descomprimía → `ResponseCode` vacío → `parseInt("")`=NaN caía al `else`→ACEPTADA → **5 NC rechazadas (3286) quedaron "aceptado"**. Fix: `descomprimirCDR` (`soap-client.ts`) reescrita con **`fflate.unzipSync`** y contrato `{ xml, ok }` (nunca devuelve crudo); la clasificación (soap `enviarComprobante`/`consultarTicket` + `rest-client`) es **fail-safe**: CDR ilegible o código no-entero → **`ERROR`, jamás ACEPTADA**; `100-3999`→RECHAZADA. `mensaje_sunat` se persiste también en aceptados ("0: …") como señal de salud (un aceptado con mensaje vacío es sospechoso). **Notas de crédito**: deben usar las **líneas reales del XML de la factura** (`parseCpeItems`), NO consolidar en 1 línea (recalcular el IGV daba NC > factura por 1 céntimo → 3286). Remediación de datos: `scripts/remediar-cdr-falsos-aceptados.mjs` (dry-run/--apply, psql+fflate) re-clasifica decodificando el `cdr_base64` guardado y corrige observaciones; NO toca cobranzas. Detalle: [historial](./docs/historial-cambios-2026.md).
36. **El total del comprobante: UNA sola fuente = el XML (18 jun 2026)**: el motor tenía DOS cálculos del total — el XML (`xml-builder.ts:calcularTotales`) redondea **por línea** y suma; el motor (`index.ts`) sumaba **sin redondear** y redondeaba al final → `r2(Σx)≠Σr2(x)` divergía 1‑2 céntimos en el **34% (161/479)** de los comprobantes. La DB/PDF/lista mostraban ese total descuadrado → al validar con el monto del PDF en la **Consulta de Validez del CPE**, SUNAT respondía "no existe" (compara exacto al céntimo contra el `cbc:PayableAmount`, sin tolerancia). El XML firmado es la **única fuente de verdad legal** (RS 318‑2017). Fix: (a) `emitirComprobante` ahora usa `calcularTotales` (exportada) y le pasa ese mismo `totales` al builder → `monto_total/subtotal/igv` (DB) == XML por construcción; (b) el detalle (`comprobantes/[id]/route.ts`) lee los totales del XML firmado vía **`parseCpeTotales`** (nuevo en `parse-cpe-items.ts`) → el PDF SIEMPRE iguala a SUNAT; (c) backfill `scripts/backfill-monto-total-desde-xml.mjs` (dry-run/--apply, respaldo CSV) alineó los 194 comprobantes (incluye subtotal/igv) y **54 cobranzas no pagadas** (`facturas.monto`, solo `Pendiente`/`Vencida`, emparejadas por `comprobante_id` o `numero_comprobante+pedido_id` con guarda ≤0.02 — gotcha #24). Verificado: NUEVO==PayableAmount 60/60; post-backfill 0 descuadres. **Regla:** nunca recalcular el total de un comprobante ya emitido en paralelo — derivarlo del XML. **Diagnóstico/recuperación:** `scripts/diagnostico-totales-comprobantes.mjs` (chequeo read-only) + `scripts/backfill-monto-total-desde-xml.mjs` (corrige) — runbook completo (incluye la receta para validar un total en SUNAT beta) en el [historial](./docs/historial-cambios-2026.md). Detalle: [historial](./docs/historial-cambios-2026.md).
37. **El total del comprobante se ANCLA al precio CON IGV tecleado (18 jun 2026)**: los precios se ingresan CON IGV (ej. S/100). El método ingenuo (neto=100/1.18=84.7458; IGV=`r2(84.75×0.18)`=15.26) daba **total 100.01** — el cliente tecleaba 100 y el comprobante salía 100.01 (pasaba en el **39%**). Fix en `xml-builder.ts:calcularTotales`: por línea `bruto=r2(precioConIgv×cant)`, `valorVenta=r2(bruto/1.18)`, **`IGV=bruto−valorVenta`** (no `r2(base×0.18)`) → total == bruto EXACTO (100.00). El IGV resultante difiere ≤0.005 de base×18%, **dentro de la tolerancia que SUNAT aplica al IGV por línea — CONFIRMADO en beta** (boleta S/100 → ACEPTADA con IGV 15.25, PayableAmount 100.00; beta y prod usan las mismas validaciones). Conexipema NO ancla (emite 100.01); este es el comportamiento elegido por Hugo. SUNAT permite hasta 10 decimales en el valor unitario (`cac:Price`, usamos 4) y exige 2 en los montos. **Notas de crédito:** `calcularTotales` **respeta los importes de línea ya fijados** (`item.valorVenta`+`item.montoIGV`): la ruta de NC los copia EXACTO del XML de la factura (`parseCpeItems`) → NC == factura al céntimo y NUNCA la supera (sin re-anclar, evita 3286 en facturas viejas que quedaron 1 céntimo abajo; verificado 425/425). La **cobranza** usa `resultado.total` (== PayableAmount), no el bruto crudo. El preview del frontend ya calculaba el bruto, así que pantalla/XML/cobranza cuadran. Detalle: [historial](./docs/historial-cambios-2026.md).
38. **Bloqueo de Ruta y Estabilidad de Secuencia (21 jun 2026)**: El admin puede bloquear columnas de motorizados para impedir reordenamientos (drag-and-drop o IA) o asignaciones accidentales (deshabilitadas en select quickAssign). Se persiste en `settings` key `'despacho_rutas_bloqueadas'` bajo `{ fecha, bloqueados: [] }` y se limpia al cambiar de día. Para evitar saltos y desorganización al iniciar un reparto, los pedidos activos se ordenan estrictamente por `orden_ruta ASC` (mandando `Entregado` y `Fallido` al fondo), independientemente de que pasen a `En_Camino`.
39. **Observación libre en comprobantes y GRE (21 jun 2026)**: la columna `observacion_comprobante` en `comprobantes` y `comprobantes_guias` guarda la nota del usuario por separado de la columna de auditoría/CDR `observaciones`. El XML de facturas/boletas lo emite como `cbc:Note` sin `languageLocaleID` (SUNAT Beta lo rechaza con 3027 si se incluye el atributo localizador). En el XML de GRE se emite como `DespatchAdvice/cbc:Note` en una posición exacta del esquema antes de `cac:Signature`.
40. **GPS obligatorio para repartidores con pedidos activos (21 jun 2026)**: el motorizado YA NO puede apagar/pausar su ubicación durante la jornada — se quitó el botón "Pausar" de `seguimiento-nativo.tsx` y el GPS (nativo y web) se ata a **tener pedidos activos hoy** (`Asignado`/`En_Camino`) DENTRO de la **ventana operativa** (`src/lib/ventana-operativa.ts`, default 04:30–22:00 Lima, env `NEXT_PUBLIC_GPS_VENTANA_*`); fuera de eso NO rastrea (privacidad). La regla de jornada vive en `src/lib/repartidor-jornada.ts` (la comparten cliente, endpoint y cron). **Detección/alerta** de "repartidor oscuro": (a) el cliente manda un **beacon** (`POST /api/repartidor/beacon`) al revocar el permiso → aviso inmediato al admin; (b) el endpoint de ubicación **rechaza GPS falso (mock)** marcando `gps_status='mock'` pero **devuelve 200** (NO 4xx: un 4xx envenenaría la cola offline y silenciaría las notificaciones de ETA a la asesora); (c) el cron `repartidores-oscuros` (cada 10 min, solo en ventana) detecta a quien tiene pedidos activos pero dejó de transmitir. Aviso al admin con **debounce** en `settings.gps_oscuros_alertados` (cubre riders sin fila en `rider_locations`), tipo de notificación `repartidor_oscuro`. El mapa de Despacho pinta **rojo** = apagado deliberado (`permiso_revocado`/`mock`), **ámbar** = "sin señal" (ambiguo, ≥10 min). Columnas nuevas en `rider_locations`: `simulated`, `gps_status`, `gps_status_changed_at` (migración `migrate-rider-gps-enforcement.sql`, aplicar por psql ANTES del deploy o el endpoint de ubicación 500ea). **Límite honesto**: revocar permiso/force-stop/ahorro de batería NO se pueden IMPEDIR sin MDM/kiosk — es disuasor + auditoría, no candado. **No requiere rebuild del AAB** (el `simulated` ya lo expone el plugin v1.2.26; validar en dispositivo real). Detalle: [historial](./docs/historial-cambios-2026.md).
41. **Módulo "Clientes Avícola" = venta en campo del GG, con cartera operativamente INDEPENDIENTE (7 jul 2026)**: tablas propias (`clientes_avicola`, `ventas_avicola(+items)`, `abonos_avicola`) — NO reutiliza `pedidos` (un `origen` nuevo contaminaría las metas de asesoras) ni `clientes`/`facturas`. Reglas de oro: saldo NUNCA persistido (única fuente `src/lib/avicola/saldos.ts`); anulación soft con motivo, jamás DELETE; **una venta SÍ se puede EDITAR** (peso/precio/fecha) vía PATCH `/api/avicola/ventas/[id]` con auditoría `modificada_por`/`modificada_at` — se BLOQUEA si está anulada (pedido de Antonio 9 jul: en la tarde el GG ajusta el peso/precio reales al cobrar); PK de venta/abono la genera el FRONTEND (idempotencia doble-tap — no quitar); solo rol `admin`; la "guía de venta" es documento INTERNO (correlativo `guia_avicola`), no SUNAT; **la fecha de la venta es seleccionable (retroactiva, no futura)**; v1 no toca inventario ni caja. Detalle: [doc 21](./docs/arquitectura/21-clientes-avicola.md).
42. **Las 3 operaciones de venta están SEPARADAS (8 jul 2026)**: 🛵 **Ejecutivas** (`clientes`/`pedidos`/`facturas`/despacho — el sistema original), 🏪 **Campo** (`clientes_avicola`/`ventas_avicola`/`abonos_avicola` — gotcha #41), 🏭 **Planta/POS** (`clientes_planta`/`cobranzas_planta`/`abonos_planta`). Cada una: su propia base de clientes, sus cobranzas y su cierre. **El POS SIGUE escribiendo la venta en `pedidos`** (conserva orden imprimible + comprobante SUNAT); solo su cliente y su cobranza a crédito son propios: el crédito va a `cobranzas_planta` (NO a `facturas`), con `pedidos.cliente_id=NULL` + `razon_social`/`ruc_dni` denormalizados desde `clientes_planta`, e idempotencia por `pedido_id` client-side. **INVARIANTE CRÍTICO (bug cazado en el deploy del 8 jul):** emitir un comprobante SUNAT desde un pedido POS **NO** debe crear cobranza en `facturas` — el guard es `esPos = pedido.origen==='pos_planta'` en `emitir/route.ts:423` (`debeCrearCobranza = … && !esPos`). Sin él, la deuda del POS a crédito se DUPLICA (planta + ejecutivas) y el contado genera una factura fantasma. Cualquier camino nuevo que cree cobranza para un pedido debe respetar esto. NO reconstruir el POS como subsistema propio (bifurcaría el motor SUNAT — gotchas #18-35). **Caja**: solo PLANTA tiene caja formal con arqueo (`caja_diaria`, la de mostrador). **Campo NO tiene caja** (decisión de Antonio 8 jul: su cierre es el REPORTE de liquidación del día, no un arqueo de efectivo). Ejecutivas tampoco (cobran por transferencia/Yape). El esquema `caja_diaria.operacion` ('planta'|'campo') y los índices por operación (`ux_caja_diaria_fecha_operacion` + `ux_caja_diaria_unica_abierta_op`) YA soportan una caja de campo si algún día se activa — la API acepta `?operacion=`; solo hay que reponer el selector Planta/Campo en `caja-diaria-client.tsx` (hoy fijo en 'planta'). Menú en 3 bloques (`DashboardLayout.tsx` GROUP_ORDER/GROUP_BY_HREF). Detalle: [historial](./docs/historial-cambios-2026.md).
43. **NUNCA pongas `crossOrigin` en un `<img>` cuyo `src` es un `data:` URL (9 jul 2026)**: los tickets/guías se comparten como JPEG generado con `html-to-image`, y el logo se inyecta como **dataURL** (mismo origen). El atributo `crossOrigin="anonymous"` fuerza una petición en modo CORS que **falla para `data:` URLs en WebKit/iOS** → la imagen no carga → **la guía/ticket sale SIN logo en iPhone** (en Chrome de escritorio sí se ve, por eso es fácil no cazarlo). Es además inútil: un `data:` URL no necesita CORS ni "destiñe" el canvas. Estaba en `ticket-guia-avicola.tsx` y `TicketPedido.tsx`; se quitó. **Regla adicional:** antes de `toJpeg`, esperar `await img.decode()` de las imágenes del ticket (no basta precargar en un `new Image()` off-screen — `html-to-image` en iOS omite imágenes no decodificadas). Detalle: [historial](./docs/historial-cambios-2026.md).
44. **Compras: 3 clases de fila y deuda manual (9-10 jul 2026, pedidos de Nelita)**: cada fila de una guía de compra es `ingreso` (default), `devolucion` (RESTA deuda e inventario — kardex `devolucion_compra`, subtotal negativo pero pesos SIEMPRE positivos: el signo vive en `compra_items.tipo`) o **línea SIN peso** (cantidad × precio, suma a la deuda pero JAMÁS toca stock/kardex/`precio_compra`). La regla de "sin peso" vive en **`src/lib/compras-lineas.ts:esLineaSinPeso`** (fuente ÚNICA compartida front+back, antes duplicada como `esCategoriaServicio`): la categoría matchea **`/servicio|insumo|adicional/i`** — cubre Servicios (Pelada/ENVIO), **Insumos** (arcos/oferta/mandil — 11 jul 2026) y el genérico "producto adicional". El total de la guía nunca queda < 0 (400) y con total 0 no se crea cuenta por pagar. **Nuevo producto sin salir de Compras**: botón "➕ Nuevo producto" (solo admin) en `compras-client.tsx` → `POST /api/productos` (admin-only) → append + auto-selección; categoría "Insumos" → prefijo de código `INS`. **Saldo anterior de proveedor** = fila de `cuentas_por_pagar` con `compra_id NULL` + `concepto` (botón "Deuda anterior" en CxP, admin-only); se paga con el flujo normal; DELETE/PATCH solo para manuales sin pagos. Migración `migrate-compras-mejoras-2026-07-09.sql` + seed `seed-insumos-compras-2026-07-11.sql`. Detalle: [doc 09 §3.1b-3.2b](./docs/arquitectura/09-compras-inventario-mermas.md).
45. **Flexibilización v1 (10 jul 2026)** — 3 reglas nuevas: (a) **usuarios se DESACTIVAN, jamás DELETE** (`users.activo`; login bloqueado en `auth.ts:authorize`; auto-desactivación 400; `GET /api/users?incluir_inactivos=1` solo admin); (b) **parámetros de negocio viven en `settings.parametros_negocio`** editables en `/dashboard/configuracion` — fuente única **`src/lib/parametros-negocio.ts`** con DEFAULTS = los valores históricos hardcodeados (sin la clave, todo igual que antes); al agregar un umbral/lista nuevos, cablearlos AHÍ, no hardcodear; (c) **nunca CASE/comparación sobre PARÁMETROS en SQL de Neon** — el driver HTTP infiere mal los tipos (rompió `POST /api/transacciones` y antes el batch de compras): decidir el signo/condición en JS y mandar un solo parámetro (`::numeric` si hace falta). Además: proveedores/cuentas bancarias desactivables (las cuentas "Caja Efectivo Planta/Campo" NI se renombran NI se desactivan — 409), plazo de pago POR proveedor (`plazo_pago_dias`), correcciones con guard no-anulado (abonos avícola/planta, deuda manual CxP) y préstamos se corrigen por CONTRA-ASIENTO (kardex inmutable). Migración `migrate-flexibilizacion-2026-07-10.sql`. Detalle: [historial](./docs/historial-cambios-2026.md).
46. **El saldo de la GUÍA de campo se ancla por `created_at`, NO por `fecha` (11 jul 2026 — caso Vicki)**: `estadoCuentaParaGuia` (`src/lib/avicola/saldos.ts`) parte los abonos en `saldo_previo` (`created_at < venta`) y **`abonos_aplicados`** (posteriores a la venta y anteriores a la SIGUIENTE venta no anulada del cliente). El filtro viejo `fecha = v.fecha` dejaba invisible en la guía un abono hecho un día POSTERIOR a la venta (ni previo ni "del día") → la guía de la última venta mostraba saldo desactualizado tras un abono de otra fecha. El saldo REAL del cliente (`estadoCuentaCliente`/`listaClientesConSaldo`, sin filtro de fecha) SIEMPRE estuvo bien; solo la guía impresa fallaba. Regla: cualquier "estado de cuenta anclado a un movimiento" se corta por `created_at`, nunca por `fecha`. El saldo NO se persiste (se calcula al vuelo): el fix corrige todas las guías al re-render, sin migración. Detalle: [historial](./docs/historial-cambios-2026.md).
47. **Facturar la VENTA EN CAMPO reutiliza el motor de las ejecutivas (12 jul 2026 — pedido de Antonio, que es quien hace la venta en campo)**: la venta de campo (`ventas_avicola`) ahora puede emitir factura/boleta (y sobre ellas GRE/NC) SIN duplicar código. Vista nueva `/dashboard/clientes-avicola/ventas` (lista por fecha + botón **Facturar**) → abre el MISMO form `emitir-client.tsx` (prop `ventaAvicolaIdProp`, precarga peso→cantidad KGM / precio_kg CON IGV) → emite por **`/api/comprobantes/emitir-manual`** con `ventaAvicolaId`. El motor persiste `comprobantes.venta_avicola_id` y con `esCampo` **NO crea cobranza en `facturas`**. Campo y NC adquieren claims antes de consumir correlativo; luego reservan una fila `emitiendo` antes del SOAP. Claims+índices impiden una segunda factura/boleta de Campo o NC activa aun con doble pestaña, y bloquean editar/anular durante la emisión. Los errores firmados se reintentan con el MISMO correlativo; un rechazado conserva XML/CDR y se corrige con un CPE NUEVO enlazado por `reemplaza_comprobante_id`; `emitiendo` atascado >15 min pasa a error. La vista `ventas_facturadas` excluye Campo y sus NC. **Anti-deuda-fantasma:** si el `UPDATE` que anula la venta tras una NC total aceptada fallara transitoriamente, un saneo lazy idempotente en `GET /api/avicola/ventas` reconcilia la venta (NC 07 aceptada sobre su CPE ⇒ `anulada=TRUE`; en V1 toda NC es total, códigos 01/02/06). RUC: `clientes_avicola.ruc_dni`; la razón social/dirección fiscal se revalida server-side. **Estado de cuenta:** varios abonos del mismo cliente en un día se conservan separados en pantalla/PDF (hora, medio, monto, nota, saldo posterior). **Colores por operación** (`src/lib/operaciones-venta.ts`): 🛵 azul / 🏪 ámbar / 🏭 violeta. Vistas separadas: `/dashboard/clientes-avicola/comprobantes` (Campo), `/dashboard/comprobantes/ejecutivas` (Ejecutivas) y `/dashboard/comprobantes` (todos). Migraciones, en orden: `migrate-facturacion-campo-2026-07-12.sql`, `migrate-reemision-cpe-campo-rechazado-2026-07-12.sql` y `migrate-nc-error-reintento-unico-2026-07-12.sql` (psql ANTES del deploy — #17). Detalle: [doc 21 §7](./docs/arquitectura/21-clientes-avicola.md).

---

## 13. Estado del proyecto (resumen — crónicas completas en [docs/historial-cambios-2026.md](./docs/historial-cambios-2026.md))

### 🚀 EN PRODUCCIÓN desde el 30 may 2026
- `main` → Vercel (**dominio de producción: `app.transavic.com`** desde el 6 jul 2026; `transavic.vercel.app` sigue vivo durante la transición y luego REDIRIGE — la raíz `transavic.com` queda RESERVADA para futura web pública, no conectarla al ERP; proyecto `hugoherrerateam/transavic`, plan **Pro**). Auth multi-dominio: `trustHost:true` en `src/auth.ts` y **AUTH_URL ya NO se define en Vercel** (no re-crearla — fijaría un solo dominio y rompería al otro). DB prod Neon `ep-cool-sound`. Las migraciones se aplican por **psql ANTES del deploy** (gotcha #13/#17); probar primero en la branch `dev-hugo` (`.env.local`, SUNAT beta).
- **SUNAT real operando**: facturas/boletas/NC (ambas empresas) emitiéndose a diario; **GRE validada end-to-end contra SUNAT real** (T002-00000010 ACEPTADA el 10 jun 2026; funciona de día y de noche).
- **App repartidor** (Capacitor) publicada en Google Play (prueba interna); GPS en vivo por polling (`rider_locations` → mapa de despacho). Sin Pusher.
- Las 24 env vars reales viven SOLO en Vercel + archivos gitignored (`.env.local`, `CREDENCIALES-PRODUCCION.local.md`).

### Las 8 mejoras (S/ 4 000) — TODAS ✅ en producción
1 Pesos digitales/producción · 2 Orden de pedido + foto firmada · 3 App motorizado GPS · 4 Notificaciones · 5 Dashboard comercial/metas · 6 Cobranzas · 7 SUNAT 2 RUCs (CPE + GRE) · 8 IA comercial (Gemini + respaldo Groq).

### Reglas de negocio VIGENTES (decisiones de Antonio, may–jun 2026)
- **Metas/incentivos de asesoras se miden por PEDIDOS** (regla NUEVA ratificada por Hugo el 5 jul 2026; reemplaza la medición por comprobantes/`ventas_facturadas`): monto = `pedido_items.cantidad × precio_unitario`, atribuido a la fecha de REGISTRO del pedido (zona Lima), excluyendo el POS de planta. Fuente ÚNICA: **`src/lib/ventas-metricas.ts`** (variantes "entregadas" para metas/ranking y "vigentes" para rachas/meta de equipo) — la usan `lib/metas.ts` y `lib/incentivos.ts`; NUNCA dupliques esa query. La vista `ventas_facturadas` queda solo para facturación/reportes. Detalle: [doc 14](./docs/arquitectura/14-metas-incentivos.md).
- **Comprobantes scoped por asesora**: cada una ve SOLO los suyos (`lib/comprobante-scope.ts`: sus pedidos o emitidos por ella); admin todo. "Cambiar asesora" (admin) reescribe `emitido_por` y PREGUNTA si mueve también la cobranza vinculada; en Cobranzas el admin reasigna la asesora de una cobranza (`PATCH /api/facturas/[id]/asesor`, con sugerencia automática pedido→cartera para huérfanas y opción de mover el comprobante). "Vincular a pedido" liga standalone ↔ pedido.
- **Toda venta de Ejecutivas crea cobranza** en `facturas` (factura o boleta, contado o crédito); si ya pagó, se marca "pagada". **Un pedido de Ejecutivas = una cobranza** y la crea solo el CPE. Campo calcula `ventas_avicola - abonos_avicola`; Planta usa `cobranzas_planta`: ninguno crea `facturas`. Anular cobranza = soft; la NC total afecta la cartera de su propia operación.
- **Boletas**: < S/700 sin doc válido → a NOMBRE del cliente si lo escribió (si no, "CLIENTES VARIOS"); ≥ S/700 exigen DNI/RUC. Se rechazan DNI de 8 dígitos iguales y RUC sin dígito verificador; anti-duplicado (409 + confirmación) y anti doble-NC. El RUC/DNI consultado se guarda en la ficha del cliente.
- **Asesora puede**: crear/editar sus pedidos (PATCH audita diff en `pedido_ediciones`; editar ítems SÍ actualiza `pedido_items`), ELIMINAR solo los suyos en `Pendiente`, emitir NC y GRE de sus comprobantes, ver Despacho completo en SOLO LECTURA (decisión: alcance total, sin acciones).
- **Unidades kg/uni**: la ambigüedad `uni/kg` del catálogo es intencional; la asesora elige por venta y `aUnitCodeSunat` (idempotente, nunca degrada KGM→NIU) la respeta de punta a punta.
- **Incentivos** configurables en `settings.incentivos_config` (racha semanal, meta de equipo, ranking, metas individuales — cada uno con on/off); overrides mensuales + bono en `metas_asesoras`.
- **IA**: caché PERSISTENTE en Postgres (`ia_insights_cache`, TTL 1h por scope) + respaldo Groq en `callIA()` — 429 de Gemini resuelto.

### 🚀 Expansión ERP 2026 — EN PRODUCCIÓN (fase BETA) desde el 5 jul 2026
- **2º lote a producción — 8 jul 2026** (commit `5eb7398`, buildId `ePiVPwx-J1RWAF2uZL31c`): **Clientes Avícola** (venta en campo, gotcha #41), **separación real de las 3 operaciones** (`clientes_planta`/`cobranzas_planta`/`abonos_planta`; el crédito del POS ya NO va a `facturas`; gotcha #42), **caja por operación**, **proveedores** (RUC opcional + principal/secundario), y el **rediseño del POS** (celular: barra de cobro + hoja; desktop: ítems con subtotal prominente + footer anclado). Migraciones aplicadas a prod por psql ANTES del deploy: `migrate-clientes-avicola-2026-07-07`, `migrate-proveedores-tipo-ruc-opcional-2026-07-07`, `migrate-planta-clientes-cobranzas-2026-07-08`, `migrate-caja-operacion-2026-07-08`. Incluyó un **fix bloqueante** (emitir desde POS duplicaba la deuda — invariante en gotcha #42). Runbook completo + pendientes de validar en vivo: [historial](./docs/historial-cambios-2026.md) (§ "Despliegue a PRODUCCIÓN — 8 jul 2026").
- **Módulos nuevos DESPLEGADOS** (marcados con chip índigo "Beta" en el sidebar + guía de pasos removible `GuiaModulo`/`src/lib/guias-modulos.ts` en cada vista): compras/proveedores, cuentas por pagar, gastos, caja diaria, cuentas bancarias, transacciones, inventario flexible con kardex, mermas, préstamos, POS planta (con panel post-venta: imprimir orden / emitir comprobante, 7 jul), rentabilidad, consolidado, CRM leads + chatbot, y **Clientes Avícola** (venta en campo del GG, 7 jul 2026 — gotcha #41, [doc 21](./docs/arquitectura/21-clientes-avicola.md); las 3 operaciones de venta de Antonio: campo=este módulo, ejecutivas=CRM+pedidos, planta=POS; "cotizaciones" del CRM NO existen — confirmar con Antonio antes de construir). En prueba con Ariana (producción del negocio, perfil admin); feedback por WhatsApp. Roadmap y estado real: [doc 18](./docs/arquitectura/18-plan-implementacion-maestro.md).
- **DB producción migrada el 5 jul 2026** (7 SQL por psql, en orden: fase-2-3-consolidado → crm → crm-extensions → crm-rotacion → caja-unica-abierta → inventario-movimientos → seed-inventario-cero; esquema verificado 23/23 contra manifiesto). El índigo/azul en las vistas = marcador deliberado de fase beta; al aprobar un módulo se quita su guía de `guias-modulos.ts` y su `isBeta` del sidebar. **WhatsApp del CRM AÚN NO conectado**: el webhook responde 503 hasta configurar `META_VERIFY_TOKEN`/`META_APP_SECRET` en Vercel (checklist doc 15 §5) e implementar el envío saliente real (hoy mock).
- **Patrones nuevos obligatorios**: escrituras multi-tabla de POS/compras/caja van en `sql.transaction([...])` (batch atómico del driver Neon; los ids se generan con `crypto.randomUUID()` porque el batch no encadena RETURNING); una sola caja abierta la garantiza el índice único parcial `ux_caja_diaria_unica_abierta` (el POST devuelve 409 en conflicto).
- **Política de inventario (5 jul 2026)**: el stock lo mueven compras (+), POS (−), ajustes con motivo OBLIGATORIO (±) y los pedidos normales al pasar a **Entregado** (− cantidades reales; se repone al revertir). Todo queda en el kardex `inventario_movimientos`. La lógica vive en **`src/lib/inventario.ts`** con guard de idempotencia `pedidos.inventario_descontado` (la offline-queue repite el POST /entregar — NUNCA quitar el guard) y es no-bloqueante (la entrega jamás falla por inventario). Las mermas NO descuentan stock (informativas, pendiente decidir con Antonio). Los cobros de cobranzas NO pasan por caja (van por transferencia/Yape — decisión de Hugo). Detalle: [doc 09](./docs/arquitectura/09-compras-inventario-mermas.md) y [doc 10](./docs/arquitectura/10-pos-caja-tesoreria.md).
- **Antes de conectar el número real de WhatsApp**: checklist de seguridad en [doc 15 §5](./docs/arquitectura/15-asistente-ia.md) (`META_VERIFY_TOKEN` obligatoria — sin ella el webhook responde 503; `META_APP_SECRET` para verificar firma; el envío saliente hoy es MOCK).

### Dónde está el detalle
- **Mapa "si tocas X lee Y"**: [docs/arquitectura/README.md](./docs/arquitectura/README.md) (01-08 core · 11-16 SUNAT/cobranzas/metas/IA · 17-20 expansión ERP).
- **Crónicas completas** de cada cambio/PR/data-op/diagnóstico: [docs/historial-cambios-2026.md](./docs/historial-cambios-2026.md).
- Branch Neon de pruebas: `dev-hugo` (`br-tiny-frost-aduw14pu`, endpoint `ep-super-violet-adyp68ne`); prod = `ep-cool-sound-adxrsjt5`.

### Próximas fases (no cotizadas)
- App iOS del repartidor (todos usan Android). El CRM con WhatsApp Business API dejó de estar postpuesto: está en desarrollo dentro de la expansión ERP (ver arriba).


## 14. Para el próximo agente (tú, IA futura)

Antes de empezar cualquier tarea:

0. **Lee primero [`docs/arquitectura/README.md`](./docs/arquitectura/README.md)** — tiene un mapa "si vas a tocar X, lee Y" que te ahorra tiempo. Los 25 documentos temáticos tienen verificación contra código real.
1. **Si vas a modificar el flujo de estados del pedido**, lee `§8` de este archivo + `docs/arquitectura/04-maquina-estados.md` (máquina de estados completa con diagrama Mermaid).
2. **Si vas a agregar una nueva tabla o columna**, crea un nuevo `scripts/migrate-<feature>.mjs` siguiendo el patrón. NO modifiques migraciones existentes ni el `seed.mjs`.
3. **Si vas a agregar una nueva API**, valida con zod, chequea sesión, scopea por rol, devuelve errores con status correcto. Usa `lib/data.ts:fetchFilteredPedidos` como referencia de cómo se filtra por rol.
4. **Si vas a tocar la pantalla del repartidor (`mi-ruta-content.tsx`)**, recuerda que toda acción debe pasar por `offline-queue` para que funcione sin internet. No llames `fetch` directo desde un botón.
5. **Si vas a integrar un servicio externo nuevo**, usa env vars (no hardcodes), y prefiere planes gratuitos para no generar costos a Antonio (ver propuesta: "se mantienen costos al mínimo").
6. **📐 REGLA DE DOCUMENTACIÓN (11 jun 2026 — respétala SIEMPRE):** este CLAUDE.md se carga COMPLETO en cada sesión, su tamaño cuesta contexto. Al completar un cambio, el detalle va a los `.md` de **`docs/`**: el doc temático de `docs/arquitectura/` que corresponda (mapa en su README) y/o la crónica en **`docs/historial-cambios-2026.md`**. Aquí deja SOLO la regla operativa esencial (1-4 líneas) con un puntero al doc — nunca crónicas, diagnósticos largos ni historias de PRs. Si un gotcha crece más de ~5 líneas, su versión larga se muda a docs/ y aquí queda el resumen. (El 11 jun se hizo esta limpieza: 185KB → 45KB; todo el texto movido vive ÍNTEGRO en `docs/historial-cambios-2026.md`.)
7. **Si vas a trabajar con la emisión de Guías de Remisión Electrónicas (GRE 2.0 REST)**, lee primero `docs/arquitectura/12-guias-remision.md` para entender el flujo, los errores comunes de SUNAT ya resueltos y los pendientes de integración.

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
| `src/app/api/comprobantes/[id]/reintentar/route.ts` | 250 | ✅ Reintenta CPE solo en error + botón UI |
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

**Paso a producción — ✅ HECHO (30 may 2026; operación real vigente):**
1. ✅ Certificado digital tributario `.p12` descargado (Transavic `20612806901` y Avícola/RUC 10 `10710548841`), vigentes hasta 2029.
2. ✅ Usuario SOL secundario `APIFACTU` (perfil "Emisión Electrónica") creado para ambas empresas.
3. ✅ Cert convertido a base64 y cargado.
4. ✅ Env vars reales configuradas **en Vercel** (no en `.env`): `SUNAT_TRA_*` y `SUNAT_AVI_*` (RUC, razón social, dirección, ubigeo, SOL user/pass `APIFACTU`/`Transavic123`, cert b64/pass).
5. ✅ `SUNAT_ENVIRONMENT=production` en Vercel.
6. ✅ Facturas, boletas y notas de crédito reales operan para ambas empresas; la GRE también fue validada end-to-end en SUNAT real.

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
- ✅ Reintento de CPE en error; los rechazados se corrigen con un CPE nuevo

**Decisión sobre QR (NO se implementa):** el PDF replica el diseño de las boletas/facturas que entrega la propia SUNAT, que **no incluyen QR**. Por eso no se agrega. (Si a futuro se exige la representación impresa con QR, se añadiría con `qrcode`.)

---

## 14. Reglas de Soporte y Comunicación (WhatsApp)

Cuando el cliente (Antonio u otros asesores) reporte errores de la SUNAT (ej. caídas de servidor o demoras en responder):
- **Estructura "No me hagas pensar"**: Usa negritas, listas con viñetas cortas, títulos claros y emojis para que el mensaje sea escaneable al instante.
- **Responsabilidad clara**: Explicar de manera directa y sencilla que es una falla externa de la SUNAT (puede durar horas o días a nivel nacional) y que nuestro sistema está funcionando bien.
- **Alternativa urgente**: Sugerir que si la emisión es crítica y no se puede esperar, lo realicen directamente ingresando al **Portal Web de la SUNAT**.

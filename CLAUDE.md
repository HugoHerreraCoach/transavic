# CLAUDE.md — Transavic

Contexto del proyecto para agentes de IA. Léeme **antes** de tocar código.

> **📚 Para profundizar en cualquier área:** ver `docs/arquitectura/` (6 documentos temáticos verificados contra código). Empezar por [`docs/arquitectura/README.md`](./docs/arquitectura/README.md) que tiene un mapa "si vas a tocar X, lee Y". Las **crónicas completas** de cada cambio (PRs, data-ops, diagnósticos) viven en [`docs/historial-cambios-2026.md`](./docs/historial-cambios-2026.md).
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
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Brevo (correos transaccionales, free 300/día). Si `BREVO_API_KEY` está, `lib/email.ts` usa la API de Brevo (preferida); si no, cae a SMTP/nodemailer. El sender debe estar verificado en Brevo (hoy `transavicdev@gmail.com`, activo). **Configurar también en Vercel.** |
| `CRON_SECRET` | Secreto que protege los **4 cron jobs** de Vercel (`/api/cron/facturas-vencidas`, `/recordatorios-asesoras`, `/resumen-diario-sunat`, `/daily-digest-admin`). Sin él, esos endpoints devuelven **503**. Vercel lo manda como `Authorization: Bearer <CRON_SECRET>`. **Obligatorio en Vercel** para que los crons corran. **Ojo con el límite de Vercel: Hobby permite solo 2 crons (1×/día); Pro permite 40.** Por eso las tareas de mantenimiento (ej. purga de notificaciones viejas) se enganchan a un cron existente en vez de crear uno nuevo. |
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
19. **Reintento de comprobantes** (`/[id]/reintentar`): reenvía el `xml_firmado_base64` original o reconstruye desde `comprobantes.items_json` (persistido en CADA emisión); si no hay fuente fiel, aborta 422 — nunca fabrica líneas. Observaciones SUNAT 4095/4260 ya eliminadas del xml-builder.
20. **"Orden de pedido"** (interna, ex "guía de remisión", ruta `/pedidos/[id]/guia`): NO es documento legal. Identificadores internos se mantienen (`numero_guia`, `guia_firmada_*`); su correlativo es `correlativos.orden_pedido` (ver #29). Imprime Ticket 80mm (default, solo logo + sin datos del emisor) o A4; toggle "Incluir precios"; `siguienteCorrelativo` es UPSERT (no falla con tabla sin sembrar).
21. **"Resumen del día"** (totales por producto para producción): `/dashboard/resumen`, roles admin+produccion, abre en MAÑANA; usa `/api/resumen-diario`. Un producto con kg Y uni sale como tarjetas separadas (correcto).
22. **App Repartidor (Capacitor)**: en producción desde el 4 jun 2026 (carpeta `android/` en `main`, app en Google Play). En esta Mac: `compileSdk 36` + `android.suppressUnsupportedCompileSdk=36`; el plugin GPS se registra con `registerPlugin("BackgroundGeolocation")`; el módulo nativo se importa con `next/dynamic({ssr:false})`. Subir `versionCode` en cada release. Guía: `docs/app-repartidor-guia-prueba-y-build.md`.
23. **Impresión en tiquetera térmica**: los HUECOS entre pedidos = `break-inside:avoid` + `grid` (en formato Ticket el contenido fluye en bloque, sin break-inside); el SOBRANTE al final = falta de `@page` → `src/lib/impresion.ts` mide el alto real e inyecta `@page { size: 80mm <alto>mm }`. ⚠️ `size: 80mm auto` es CSS INVÁLIDO (Chrome lo ignora). El CSS de impresión solo se valida imprimiendo (Chrome headless + CDP). Detalle: [historial](./docs/historial-cambios-2026.md).
24. **`facturas.estado = 'Anulada'` se EXCLUYE de toda query de deuda**: usar `estado IN ('Pendiente','Vencida')`, NUNCA `<> 'Pagada'`. La NC auto-anula su cobranza por `comprobante_id` / `pedido_id`+número — JAMÁS por `numero_comprobante` solo (las 2 empresas comparten series F001/B001).
25. **Orden de pedido desde celular + ticketera Bluetooth**: usar el botón **Bluetooth** (RawBT, ticket de texto monoespaciado 42 col) en Android; "Imprimir" (que mide el alto e inyecta `@page`) solo para PC/PDF/impresora normal.
26. **DOS documentos de impresión distintos**: (A) el REPORTE de todos los pedidos del día (`VistaImpresion.tsx` + `src/lib/impresion.ts`, botón "Imprimir" del dashboard, bajo `DashboardLayout`) y (B) la orden de pedido individual (`/pedidos/[id]/guia`, layout raíz). Regla: todo elemento `position:fixed` bajo `DashboardLayout` lleva `print:hidden` (el botón flotante de IA salía impreso y dejaba papel en blanco al final).
27. **`clientes.rubro` (giro: Restaurante/Chifa/…) ≠ `clientes.tipo_cliente` (Frecuente/Nuevo)**: `rubro` es SOLO del directorio (lista fija `RUBROS` en `clientes-client.tsx`, chips "POR RUBRO", NULL = "Sin clasificar"); `tipo_cliente` se denormaliza a pedidos y sale en el ticket. No mezclar.
28. **GRE — reglas vigentes** (detalle: [docs/arquitectura/06](./docs/arquitectura/06-guias-remision-rest.md)): banner de entorno dinámico (`GET /api/sunat/entorno`); con **M1/L** placa y TODOS los datos del chofer son opcionales (ocultos por defecto); la auto-búsqueda por RUC autocompleta razón social + dirección + DISTRITO — la regla de qué pisar vive en `decidirAutollenadoDestino` de **`src/lib/guia-form-shared.ts`** (módulo compartido por los DOS modales: cambios de reglas SIEMPRE ahí), tipear el doc REEMPLAZA, consultas automáticas solo llenan vacíos; distritos entrantes se normalizan (`matchDistritoLima` + `detectarDistritoEnDireccion`). El orden de elementos del XML se valida contra el XSD oficial con xmllint (NUNCA contra beta — su mock enmascaró un rechazo real). Mock de beta apagado salvo `SUNAT_GRE_MOCK_BETA=1`.
29. **Numeración GRE legal SEPARADA de la orden interna** (10 jun 2026): la GRE usa contador POR SERIE en `comprobantes_contador` (T001/T002) con reserva CTE atómica en `api/guias/emitir`; la orden interna usa `correlativos.orden_pedido`; `guia_remision` quedó CONGELADO; la GRE ya NO escribe `pedidos.numero_guia`; el badge GRE de despacho usa `EXISTS(comprobantes_guias …)`. Si tocas la emisión: la reserva va por el contador POR SERIE, no `siguienteCorrelativo`.
30. **GRE atascada en "emitiendo" + rechazo 2329 nocturno (10 jun 2026 — RESUELTO, T002-10 ACEPTADA)**: 3 causas raíz — (a) `comprobantes_guias` no tenía `updated_at` y el UPDATE post-SUNAT + el catch fallaban (migración `migrate-guias-reintento-2026-06-10.sql` la agrega y persiste dirección/distrito/M1L/chofer/items_json en la reserva); (b) el polling REST supera los ~15s default de Vercel → `maxDuration = 60`; (c) la fecha de emisión iba en UTC → desde las ~19:00 Lima SUNAT rechaza 2329 → usar SIEMPRE `src/lib/sunat/fechas.ts` (`fechaHoyLima`), NUNCA `toISOString()` para fechas SUNAT (ojo: Neon devuelve DATE como objeto `Date`). Recuperación: `POST /api/guias/[id]/reintentar` reusa el MISMO número (estados error/pendiente/rechazado/emitiendo>15min — un rechazo NO registra el documento); saneo lazy en `GET /api/comprobantes`. Peso bruto de la guía = suma EXACTA solo si TODOS los ítems son KGM (ítems desde la factura vinculada; jamás estimar). Detalle: [docs/arquitectura/06](./docs/arquitectura/06-guias-remision-rest.md).
31. **Un pedido NUNCA debe quedar sin `pedido_items`** (11 jun 2026 — sin ítems, Producción no puede pesar y el pedido no cuenta en Resumen/reportes; "Duplicar pedido" copiaba solo texto y los duplicados nacían vacíos — caso Manuel lince/Nikuya). Garantías: Duplicar copia los ítems (table.tsx fetch detalle → `PedidoForm` los siembra vía `initialItems` del ProductSelector); el POST deriva ítems del TEXTO del detalle si no vienen (`src/lib/parse-detalle-pedido.ts`: parser "N uni|kg - Nombre…" + matching de catálogo por prefijo); el PATCH ya NO vacía `pedido_items` con `items: []`; y `GET /api/produccion/pedidos` hace backfill lazy de pedidos del día con 0 ítems. Si tocas la creación/edición de pedidos, conserva estas garantías. Crónica: [historial](./docs/historial-cambios-2026.md).
32. **Precios y cartera de clientes (11 jun 2026)**: (a) el **catálogo** lo ven admin (gestión) y **asesoras en SOLO LECTURA sin `precio_compra` ni margen** — el control real está en `GET /api/productos` (exige sesión; `precio_compra: null` para no-admin); (b) **historial de precios** admin-only en `GET /api/precios/historial` + modal en el catálogo (une `precios_productos` con LAG + `autorizaciones_precio` aprobadas — sin tabla nueva); (c) **anti-duplicados de clientes**: `GET /api/clientes/verificar` es el ÚNICO endpoint de clientes SIN scoping (global a propósito, respuesta mínima: existe + asesora responsable; jamás datos del cliente ajeno); la regla vive en **`lib/clientes-duplicados.ts`** y la aplican el POST **y el PATCH** (solo si el RUC/WhatsApp CAMBIA — el PATCH era un bypass): 409 duro si es de otra asesora (el match ajeno SIEMPRE gana por ORDER BY), blando con `permitir_duplicado: true` si es propio, y el **admin ya NO está exento** (409 blando `puede_forzar` + confirm — antes creaba duplicados sin enterarse, caso ECO AMIGABLE); (d) **cobranzas**: el asesor se asigna en cascada `pedido.asesor_id` → emisora asesora → `clientes.asesor_id` (antes: admin emitía → cobranza sin asesor). Crónica: [historial](./docs/historial-cambios-2026.md).

---

## 13. Estado del proyecto (resumen — crónicas completas en [docs/historial-cambios-2026.md](./docs/historial-cambios-2026.md))

### 🚀 EN PRODUCCIÓN desde el 30 may 2026
- `main` → Vercel (`transavic.vercel.app`, proyecto `hugoherrerateam/transavic`, plan **Pro**). DB prod Neon `ep-cool-sound`. Las migraciones se aplican por **psql ANTES del deploy** (gotcha #13/#17); probar primero en la branch `dev-hugo` (`.env.local`, SUNAT beta).
- **SUNAT real operando**: facturas/boletas/NC (ambas empresas) emitiéndose a diario; **GRE validada end-to-end contra SUNAT real** (T002-00000010 ACEPTADA el 10 jun 2026; funciona de día y de noche).
- **App repartidor** (Capacitor) publicada en Google Play (prueba interna); GPS en vivo por polling (`rider_locations` → mapa de despacho). Sin Pusher.
- Las 24 env vars reales viven SOLO en Vercel + archivos gitignored (`.env.local`, `CREDENCIALES-PRODUCCION.local.md`).

### Las 8 mejoras (S/ 4 000) — TODAS ✅ en producción
1 Pesos digitales/producción · 2 Orden de pedido + foto firmada · 3 App motorizado GPS · 4 Notificaciones · 5 Dashboard comercial/metas · 6 Cobranzas · 7 SUNAT 2 RUCs (CPE + GRE) · 8 IA comercial (Gemini + respaldo Groq).

### Reglas de negocio VIGENTES (decisiones de Antonio, may–jun 2026)
- **Metas/incentivos de asesoras se miden por COMPROBANTES emitidos** — vista SQL `ventas_facturadas` (01+03 aceptado/observado; la NC 07 RESTA en su período; atribución `emitido_por`→`pedido.asesor_id`). Los reportes de admin miden pedidos ENTREGADOS. Catálogo: **74/90 productos ya tienen `precio_venta`** en prod (11 jun 2026; antes 0 — los overrides de `metas_asesoras` siguen disponibles).
- **Comprobantes scoped por asesora**: cada una ve SOLO los suyos (`lib/comprobante-scope.ts`: sus pedidos o emitidos por ella); admin todo. "Cambiar asesora" (admin) reescribe `emitido_por` y PREGUNTA si mueve también la cobranza vinculada; en Cobranzas el admin reasigna la asesora de una cobranza (`PATCH /api/facturas/[id]/asesor`, con sugerencia automática pedido→cartera para huérfanas y opción de mover el comprobante). "Vincular a pedido" liga standalone ↔ pedido.
- **TODA venta crea cobranza** (factura o boleta, contado o crédito, sin excepción ni opt-out); si ya pagó, se marca "pagada" a mano. **Un pedido = una cobranza**: la crea SOLO la emisión del comprobante (entregar NO crea). Anular cobranza = soft (`Anulada`, auditada), no exige NC; la NC auto-anula su cobranza.
- **Boletas**: < S/700 sin doc válido → a NOMBRE del cliente si lo escribió (si no, "CLIENTES VARIOS"); ≥ S/700 exigen DNI/RUC. Se rechazan DNI de 8 dígitos iguales y RUC sin dígito verificador; anti-duplicado (409 + confirmación) y anti doble-NC. El RUC/DNI consultado se guarda en la ficha del cliente.
- **Asesora puede**: crear/editar sus pedidos (PATCH audita diff en `pedido_ediciones`; editar ítems SÍ actualiza `pedido_items`), ELIMINAR solo los suyos en `Pendiente`, emitir NC y GRE de sus comprobantes, ver Despacho completo en SOLO LECTURA (decisión: alcance total, sin acciones).
- **Unidades kg/uni**: la ambigüedad `uni/kg` del catálogo es intencional; la asesora elige por venta y `aUnitCodeSunat` (idempotente, nunca degrada KGM→NIU) la respeta de punta a punta.
- **Incentivos** configurables en `settings.incentivos_config` (racha semanal, meta de equipo, ranking, metas individuales — cada uno con on/off); overrides mensuales + bono en `metas_asesoras`.
- **IA**: caché PERSISTENTE en Postgres (`ia_insights_cache`, TTL 1h por scope) + respaldo Groq en `callIA()` — 429 de Gemini resuelto.

### Dónde está el detalle
- **Mapa "si tocas X lee Y"**: [docs/arquitectura/README.md](./docs/arquitectura/README.md) (01 visión · 02 datos · 03 roles · 04 flujos · 05 APIs · 06 GRE).
- **Crónicas completas** de cada cambio/PR/data-op/diagnóstico: [docs/historial-cambios-2026.md](./docs/historial-cambios-2026.md).
- Branch Neon de pruebas: `dev-hugo` (`br-tiny-frost-aduw14pu`, endpoint `ep-super-violet-adyp68ne`); prod = `ep-cool-sound-adxrsjt5`.

### Próximas fases (no cotizadas)
- CRM con WhatsApp Business API (postpuesto por Antonio) · App iOS del repartidor (todos usan Android).


## 14. Para el próximo agente (tú, IA futura)

Antes de empezar cualquier tarea:

0. **Lee primero [`docs/arquitectura/README.md`](./docs/arquitectura/README.md)** — tiene un mapa "si vas a tocar X, lee Y" que te ahorra tiempo. Los 6 documentos temáticos tienen verificación contra código real.
1. **Si vas a modificar el flujo de estados del pedido**, lee `§8` de este archivo + `docs/arquitectura/04-flujos-de-negocio.md` § 3 (máquina de estados completa con diagrama Mermaid).
2. **Si vas a agregar una nueva tabla o columna**, crea un nuevo `scripts/migrate-<feature>.mjs` siguiendo el patrón. NO modifiques migraciones existentes ni el `seed.mjs`.
3. **Si vas a agregar una nueva API**, valida con zod, chequea sesión, scopea por rol, devuelve errores con status correcto. Usa `lib/data.ts:fetchFilteredPedidos` como referencia de cómo se filtra por rol.
4. **Si vas a tocar la pantalla del repartidor (`mi-ruta-content.tsx`)**, recuerda que toda acción debe pasar por `offline-queue` para que funcione sin internet. No llames `fetch` directo desde un botón.
5. **Si vas a integrar un servicio externo nuevo**, usa env vars (no hardcodes), y prefiere planes gratuitos para no generar costos a Antonio (ver propuesta: "se mantienen costos al mínimo").
6. **📐 REGLA DE DOCUMENTACIÓN (11 jun 2026 — respétala SIEMPRE):** este CLAUDE.md se carga COMPLETO en cada sesión, su tamaño cuesta contexto. Al completar un cambio, el detalle va a los `.md` de **`docs/`**: el doc temático de `docs/arquitectura/` que corresponda (mapa en su README) y/o la crónica en **`docs/historial-cambios-2026.md`**. Aquí deja SOLO la regla operativa esencial (1-4 líneas) con un puntero al doc — nunca crónicas, diagnósticos largos ni historias de PRs. Si un gotcha crece más de ~5 líneas, su versión larga se muda a docs/ y aquí queda el resumen. (El 11 jun se hizo esta limpieza: 185KB → 45KB; todo el texto movido vive ÍNTEGRO en `docs/historial-cambios-2026.md`.)
7. **Si vas a trabajar con la emisión de Guías de Remisión Electrónicas (GRE 2.0 REST)**, lee primero `docs/arquitectura/06-guias-remision-rest.md` para entender el flujo, los errores comunes de SUNAT ya resueltos y los pendientes de integración.

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

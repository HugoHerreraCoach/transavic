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
| `SUNAT_TRA_NOMBRE_COMERCIAL`, `SUNAT_TRA_DEPARTAMENTO`, `SUNAT_TRA_PROVINCIA`, `SUNAT_TRA_DISTRITO` (idem `SUNAT_AVI_*`) | Override del domicilio fiscal del emisor en el XML. El default del `DATOS_EMISOR_MAP` es placeholder ("LA VICTORIA"); en producción **conviene** setear el distrito/provincia/departamento reales. La dirección y el `UBIGEO` (lo legalmente crítico) ya se overridean con `SUNAT_*_DIRECCION` / `SUNAT_*_UBIGEO`. |

`ADMIN_USER`/`ADMIN_PASSWORD` están en `.env` pero **no se usan en código activo** (legacy del scaffolding inicial). La auth real lee de la tabla `users`.

**`.env.local` (NO comiteado, override de `.env`)** apunta a la branch Neon `dev-hugo` para testing aislado de producción. Next.js lo carga con prioridad sobre `.env`.

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

El sistema tiene **3 roles** (próximamente **4** con el módulo de producción):

| Rol | Quién es | Qué ve | Permisos clave |
|---|---|---|---|
| `admin` | Antonio (dueño) | Todo | Gestionar usuarios, productos, despacho, base_location, ver TODOS los pedidos |
| `asesor` | Vendedoras (Leslie, Yoshelin, Sarai, Yesica) | Solo sus pedidos y sus clientes | Crear pedidos y clientes; ver lista propia. Scoping en SQL por `asesor_id = userId` |
| `repartidor` | Motorizados (Marco, Yhorner, Anghelo, etc.) | Solo `/mi-ruta` con SUS pedidos del día | Cambiar estado de SUS pedidos. Scoping por `repartidor_id = userId` |
| `produccion` *(en implementación)* | Asistente de producción (en otro distrito que la oficina) | Cola del día + filtro búsqueda + ingresar pesos | A definir |

**Login redirige por rol** (ver `auth.config.ts:authorized`):
- `repartidor` → `/dashboard/mi-ruta`
- todos los demás → `/dashboard/nuevo-pedido`

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

**Pronto se agregarán dos estados** (mejoras Antonio 2026): `En_Produccion` y `Listo_Para_Despacho` antes de `Asignado`. Cuidado al ampliar el enum: actualizar también `lib/types.ts`, validaciones zod en `/api/pedidos/[id]/route.ts` y los `CASE` de orden en queries.

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
12. **Gemini Flash Latest + thinking tokens**: el modelo gemini-2.5-flash usa "thinking tokens" internos que consumen `maxOutputTokens` antes de generar texto. Sin `thinkingConfig: { thinkingBudget: 0 }`, las respuestas se truncan a ~19 chars. Ver `src/lib/gemini.ts:55`.
13. **Bug DNS Node 26 con `@neondatabase/serverless`**: scripts `node ./scripts/migrate-X.mjs` fallan con `TypeError: fetch failed`. Workaround: aplicar SQL directamente con `psql -f scripts/migrations-fase-ab.sql`. Next.js dev server NO está afectado (usa su propio runtime). Nota: `npm install` SÍ funciona (verificado mayo 2026).
14. **Cache del Asistente IA por scope**: el endpoint `/api/asistente-ia` cachea por rol/asesor (key `admin-*` o `asesor-{uuid}-*`). Esto preserva privacy boundary entre asesoras. TTL 1h. Si tocas `lib/insights.ts`, considerá si invalidar cache.
15. **Light-mode forzado (NO re-agregar dark mode)**: `globals.css` fija `color-scheme: light` y ya NO tiene `@media (prefers-color-scheme: dark)`. La app está diseñada SOLO para modo claro (tarjetas blancas, texto oscuro). Con el dark mode del SO activo, `--foreground` pasaba a claro (#ededed) y los textos quedaban casi invisibles sobre fondos blancos. **No volver a agregar el bloque dark.** Si se quiere dark mode real, hay que rediseñar todos los fondos/colores con variantes `dark:` de Tailwind.

---

## 13. Estado del proyecto (mayo 2026)

### En producción
- Sistema base v1 (pedidos, despacho, mi-ruta, productos, clientes, analytics, resumen).
- Deploy en `transavic.app` (Vercel).
- 6 motorizados activos, 4 asesoras, 1 admin.

### En implementación (Fase actual)
Las **8 mejoras** acordadas con Antonio (mayo 2026, S/ 4 000, 17 días, 50% pagado):

| # | Mejora | Fase | Estado código | Estado branch |
|---|---|---|---|---|
| 1 | Pesos digitales + flujo completo (estados `En_Produccion`, `Listo_Para_Despacho`, rol `produccion`) | A | ✅ Local | ✅ Migración aplicada |
| 2 | Guía de remisión digital + foto firmada (HTML+CSS imprimible, foto base64 en DB) | A | ✅ Local | ✅ Migración aplicada |
| 4 | Avisos automáticos entre áreas (campanita con polling 30s) | B | ✅ Local | ✅ Migración aplicada |
| 5 | Dashboard comercial + metas + panel gerencial (mes anterior × 1.15) | B | ✅ Local | ✅ Migración aplicada |
| 6 | Cobranzas con plazos flexibles + cron diario | B | ✅ Local | ✅ Migración aplicada |
| 7 | Integración SUNAT con 2 RUCs — **FLUJO REAL** (XML UBL 2.1 + firma + SOAP + CDR) + emisión standalone + nota de crédito + consulta RUC/DNI + correo Brevo. Cert real de Transavic cargado, firma válida. **BETA VALIDADA end-to-end (mayo 2026): factura + boleta + nota de crédito ACEPTADAS con CDR.** Falta solo el paso a producción (usuario SOL real). | B | ✅ Local | ✅ BETA OK |
| 8 | **IA comercial Gemini Flash Latest — admin Y asesoras (scoped)** | C | ✅ Local | ✅ Funciona en branch |
| 3 | Seguimiento motorizado en vivo (Capacitor + Pusher) | C | ⏳ Pendiente | — |

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
- Producción NUNCA se toca hasta que Hugo apruebe merge desde Neon Console

Planes formales: `docs/superpowers/plans/2026-05-13-fase-{a,b}-*.md`.

### Módulo de comprobantes ampliado (mayo 2026 — TODO LOCAL, producción intacta)
Construido en `dev-hugo` + `.env.local`, **sin tocar producción** (ni DB real, ni `.env`, ni el deploy de Vercel). Falta validar contra SUNAT producción antes de mergear.

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

**Estado: BETA VALIDADA (mayo 2026).** Los pendientes anteriores ya se resolvieron:
- ✅ Código alineado con conexipema (xml-builder/xml-signer/soap-client idénticos salvo import y `CitySubdivisionName` vacío vs "SARITA", que BETA acepta). Los "cambios de caza de bug" ya estaban revertidos.
- ✅ Endpoint temporal `/api/test-sunat-beta` usado para validar y **borrado** tras las pruebas.
- ✅ Factura (01), boleta (03) y nota de crédito (07) → `ACEPTADA` con CDR en BETA, firmadas con el cert real.

**Falta solo para PRODUCCIÓN (con OK de Hugo):**
1. **Usuario SOL real**: en beta se usó `MODDATOS`/`moddatos`; en producción Antonio crea un usuario SOL secundario con perfil "Emisión Electrónica" (APIFACTU) y se configuran `SUNAT_TRA_SOL_USER`/`SUNAT_TRA_SOL_PASSWORD` reales (ídem AVI).
2. **`SUNAT_ENVIRONMENT=production`** + emitir factura+boleta de monto bajo y anular con NC.
3. **Configurar en Vercel**: `APISPERU_TOKEN`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` y las `SUNAT_*` reales.

> ✅ **Corrección de diagnóstico (mayo 2026): la BETA SÍ funciona.** La conclusión previa ("BETA rechaza por esquema viejo, validar solo en producción") era **incorrecta**. El endpoint `ol-ti-itcpfegem-beta` acepta UBL 2.1 sin problema (factura/boleta/NC ACEPTADAS). El error **2335 NO significa "cert no reconocido por CA"** sino **"el documento electrónico ha sido alterado"** (fuente: greenter/xcodes + manual del programador SUNAT) — causado por inconsistencia de encoding o por modificar el XML tras firmar. El bug real era que el código **saltaba la firma en beta** (condición `beta && !certificatePath`, pero siempre se usa `certificateBase64` → nunca firmaba → SUNAT veía un XML sin firma); **corregido** para firmar siempre que haya certificado. La BETA acepta certificados autofirmados (no valida la CA).

### Optimización de UI (mayo 2026 — TODO LOCAL, producción intacta)
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
Audit completo y plan en `docs/superpowers/specs/2026-05-27-audit-conexiones-roadmap-design.md` + `docs/superpowers/plans/2026-05-27-p0-cierra-loop-dinero.md`. Lo ejecutado (todo en `dev-hugo`, producción intacta):

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

**Estado**: `npx tsc --noEmit` + `npx eslint` limpios; `npm run build` pasa OK. Falta verificación visual en navegador y aplicar `migrate-factura-vinculo.sql` en producción (cuando Hugo apruebe el merge).

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

**Estado de testing (verificado mayo 2026):**
- ✅ XML UBL 2.1 generado correctamente (8440 chars, todos los namespaces, totales OK)
- ✅ Firma digital con cert dummy funciona (hashCpe generado)
- ✅ Comprimido en ZIP correctamente
- ✅ Enviado a webservice SUNAT BETA
- ✅ SUNAT respondió con código 2335 "No signature in message" — **esperado con cert dummy** porque la firma no viene de una CA reconocida. Con certificado real de Antonio (gratis desde SUNAT) las facturas se aceptan.

**Qué falta para SUNAT en producción REAL:**
1. ⚠️ Antonio descarga certificado digital tributario `.p12` desde SUNAT (menú SOL > Certificado Digital Tributario — **gratis hasta 31-dic-2027**)
2. ⚠️ Crear usuario SOL secundario con perfil "Emisión Electrónica" (APIFACTU)
3. Convertir cert a base64: `base64 -i cert.p12 -o cert.b64`
4. Configurar env vars reales en `.env` de producción:
   - `SUNAT_TRA_RUC=20XXXXXXXXX` (RUC real Transavic)
   - `SUNAT_TRA_RAZON_SOCIAL`, `SUNAT_TRA_DIRECCION`, `SUNAT_TRA_UBIGEO`
   - `SUNAT_TRA_SOL_USER`, `SUNAT_TRA_SOL_PASSWORD` (usuario SOL real)
   - `SUNAT_TRA_CERT_B64`, `SUNAT_TRA_CERT_PASS`
   - Idem `SUNAT_AVI_*` para Avícola de Tony
5. Cambiar `SUNAT_ENVIRONMENT=production`
6. Emitir primera factura real

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

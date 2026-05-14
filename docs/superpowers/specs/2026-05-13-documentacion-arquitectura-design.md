# Spec: Documentación de Arquitectura del Sistema Transavic

**Fecha:** 2026-05-13
**Autor:** Hugo Herrera (con asistencia IA)
**Estado:** Aprobado — pendiente de implementación

---

## 1. Contexto y problema

El proyecto Transavic (ERP interno de pedidos para distribuidora avícola en Lima) tiene actualmente:

- ~10,000 líneas de código TypeScript/SQL distribuidas en componentes complejos (`mi-ruta-content.tsx` con 1,450 LOC, `despacho-content.tsx` con 1,506 LOC).
- 7+ migraciones SQL manuales acumuladas que reflejan decisiones de schema importantes.
- 4 integraciones distintas con Google Maps Platform.
- Una máquina de estados con 5 estados + reversos + saltos especiales.
- Múltiples decisiones arquitectónicas no obvias (denormalización deliberada, doble fuente de verdad estado/entregado, GPS bajo demanda, optimistic updates con offline queue).

El `CLAUDE.md` ya existente cubre **overview y gotchas**, pero no profundiza en:
- Cómo se relacionan las piezas entre sí
- Por qué se tomaron las decisiones arquitectónicas
- Flujos paso a paso de los procesos críticos

**Problema:** Cada vez que se abre una nueva sesión de desarrollo o un agente IA entra al proyecto, hay que re-explorar el código para entender cómo funciona. Esto consume tiempo y aumenta la probabilidad de errores por suposiciones incorrectas.

**Objetivo:** Crear documentación técnica de arquitectura que sirva como **referencia de verdad** verificada contra el código real, y permita comprender el sistema en profundidad sin re-leer 8,000 líneas de implementación.

---

## 2. Audiencia y propósito

**Audiencia única:** El desarrollador principal (Hugo) + agentes IA futuros que trabajen en el proyecto.

**No** está dirigido a:
- Cliente final (Antonio) — para él existe la propuesta comercial separada.
- Devs junior contratados — si en el futuro se contrata uno, se reescribe en lenguaje más explicativo.

**Implicaciones del enfoque:**
- Lenguaje técnico denso y directo.
- Asume conocimiento de Next.js 15, TypeScript estricto, SQL, NextAuth v5.
- Foco en **decisiones + por qué**, no en describir literalmente cada línea de código (eso lo lee el agente del archivo).
- Cero "value pitch" o lenguaje de venta.

---

## 3. Estructura de archivos

**Ubicación:** `docs/arquitectura/` en la raíz del repo (al lado del `CLAUDE.md` existente).

```
docs/
└── arquitectura/
    ├── README.md                       (índice navegable, ~1 pantalla)
    ├── 01-vision-general.md            (~300-500 líneas)
    ├── 02-modelo-de-datos.md           (~400-600 líneas)
    ├── 03-autenticacion-y-roles.md     (~250-400 líneas)
    ├── 04-flujos-de-negocio.md         (~500-700 líneas)
    └── 05-apis-e-integraciones.md      (~500-700 líneas)
```

**Total estimado:** ~2,000-3,000 líneas de documentación técnica verificada.

**Justificación del orden numérico:** lectura natural de lo general (visión + datos) a lo específico (flujos + APIs). Un agente IA puede leer solo el documento relevante a su tarea.

---

## 4. Outline detallado por documento

### 4.1 `README.md` (índice)

**Propósito:** Permitir navegación rápida sin abrir todos los documentos.

Contenido:
- Tabla con los 5 documentos: nombre, qué cubre, cuándo leerlo.
- Sección "Si vas a tocar X, lee Y" — guía de qué leer según la tarea.
- Estado de actualización (última fecha verificada contra código).

### 4.2 `01-vision-general.md`

**Propósito:** Mapa mental del sistema para entender de qué se trata todo antes de meterse en detalles.

Secciones:
1. **El producto en una página** — qué hace Transavic, quién lo usa, qué problemas resuelve.
2. **Diagrama de capas (Mermaid)** — UI ↔ APIs ↔ Data Layer ↔ Postgres ↔ Servicios externos.
3. **Stack técnico** — Next.js 15 (App Router), NextAuth v5, Neon, TailwindCSS v4, Tailwind plugins, librerías clave.
4. **Estructura de carpetas explicada** — qué vive en cada lugar y por qué.
5. **Cómo correr en local** — comandos, env vars críticas, primer setup.
6. **Deployment** — Vercel, BUILD_ID, VersionChecker (con explicación de por qué existe).
7. **Decisiones arquitectónicas clave** (formato tabla decisión / motivo / archivo donde se aplica):
   - No usar ORM
   - PWA + futuro Capacitor (no PWA pura)
   - Pedidos denormalizados
   - Doble fuente de verdad estado/entregado
   - Polling en lugar de websockets (por ahora)
   - GPS bajo demanda
8. **Cómo verificar que el documento sigue vigente** — checklist con `grep`s específicos.

### 4.3 `02-modelo-de-datos.md`

**Propósito:** Entender todas las tablas, sus relaciones y las decisiones detrás del schema actual.

Secciones:
1. **Diagrama ER (Mermaid)** — todas las tablas y sus FKs.
2. **Por cada tabla** (`users`, `clientes`, `pedidos`, `pedido_items`, `productos`, `settings`):
   - Schema completo (columnas con tipo, defaults, NULL/NOT NULL, índices).
   - Para qué sirve.
   - Cómo se popula (qué endpoint la escribe, qué endpoint la lee).
   - Anti-patrones a evitar.
3. **Decisiones de schema explicadas:**
   - Denormalización en `pedidos` (¿por qué `cliente`, `whatsapp`, `direccion` están copiados?)
   - Doble fuente de verdad `estado` (varchar) vs `entregado` (boolean) — legacy
   - `distancia_km` se congela al asignar, NO al optimizar ruta
   - `detalle` (texto del pedido) vs `detalle_final` (peso real entregado)
   - `settings` como key/value JSONB extensible
4. **Migraciones:**
   - Listado histórico en orden cronológico
   - Cómo crear una nueva (patrón con `ADD COLUMN IF NOT EXISTS`, etc.)
   - Sistema manual (no automatizado) — implicaciones operativas
5. **Tipos TypeScript correspondientes** — mapping entre tablas y tipos en `src/lib/types.ts`. Gotchas (ej. `cliente_id` está en DB pero no en el tipo).
6. **Convenciones SQL:**
   - `snake_case` en columnas
   - UUIDs con `uuid_generate_v4()`
   - Timezone Lima explícito: `(NOW() AT TIME ZONE 'America/Lima')::date`
   - `NUMERIC(6,2)` para distancias, `DECIMAL(10,2)` para cantidades, `DECIMAL(10,8)`/`DECIMAL(11,8)` para coords
7. **Cómo verificar que sigue vigente.**

### 4.4 `03-autenticacion-y-roles.md`

**Propósito:** Entender quién puede hacer qué y cómo se aplica el control de acceso.

Secciones:
1. **Diagrama de flujo de login (Mermaid)** — usuario ingresa credenciales → bcrypt compara → JWT firmado → cookie → middleware → redirect por rol.
2. **NextAuth v5 setup:**
   - Credentials provider con `bcrypt.compare`
   - Por qué Credentials y no OAuth (decisión de negocio: usuarios internos sin email corporativo).
   - JWT structure (`id`, `role`, `name`)
   - Callbacks `jwt` y `session` en `auth.config.ts`
3. **Middleware (`src/middleware.ts`):**
   - Qué protege (matcher exclude api, _next, png)
   - Cómo decide si dejar pasar
4. **Redirects por rol después del login** (`authorized` callback):
   - `repartidor` → `/dashboard/mi-ruta`
   - Otros → `/dashboard/nuevo-pedido`
5. **Los 4 roles del sistema:**
   - admin, asesor, repartidor, producción (en implementación)
   - Tabla con: quién es, qué ve, qué puede hacer, dónde se aplica scoping
6. **Scoping de queries por rol** (patrón clave):
   - En APIs: ejemplo de `lib/data.ts:fetchFilteredPedidos` con `WHERE asesor_id = userId` cuando role = asesor
   - En UI: `DashboardLayout.tsx` filtra navegación por `roles[]` array
   - Por qué NO está en middleware (decisión deliberada)
7. **Cómo agregar un rol nuevo** — checklist:
   - Agregar al enum / validation en `users` table
   - Definir scoping en queries relevantes
   - Agregar entrada en `navItems` del sidebar
   - Agregar redirect en `authorized` callback si aplica
   - Crear migración si hace falta
8. **Cómo verificar que sigue vigente.**

### 4.5 `04-flujos-de-negocio.md`

**Propósito:** Entender cómo fluye un pedido por el sistema desde que se crea hasta que se entrega, y cómo cada actor del negocio participa.

Secciones:
1. **Diagrama de actores (Mermaid)** — admin, asesoras, asistente producción (próximamente), repartidores, cliente final. Quién se comunica con quién y por qué medio.
2. **Vida completa de un pedido (paso a paso):**
   - **Paso 1: Asesora crea pedido** — `ClienteAutocomplete` → `MapInput` (si nuevo) → `ProductSelector` → `PesoModal` no se usa aquí → preview ticket → POST `/api/pedidos` → INSERT a `pedidos` + `pedido_items`.
   - **Paso 2: Admin asigna a repartidor** — `/despacho` carga (GET `/api/despacho`) → drag-and-drop con `@hello-pangea/dnd` → POST `/api/despacho/asignar` → calcula distancia Google Directions → fallback Haversine si falla.
   - **Paso 3: Optimización de ruta** (opcional) — admin click "🧭 Optimizar" → POST `/api/despacho/optimizar-ruta` → Google Directions con `waypoints=optimize:true` (TSP heurístico) → persiste `orden_ruta` y `duracion_estimada_min`.
   - **Paso 4: Repartidor inicia viaje** — toca "Ir al cliente" en `/mi-ruta` → POST `/api/pedidos/[id]/iniciar-viaje` con GPS opcional → calcula ETA con Google Directions (cascada de orígenes) → abre Google Maps externo.
   - **Paso 5: Repartidor entrega** — toca "✅ Entregado" o "❌ No Entregado" → POST `/api/pedidos/[id]/entregar` → si offline, encola en `localStorage` → al volver online, `syncQueue()` reintenta.
3. **Máquina de estados completa (diagrama Mermaid):**
   - Estados: Pendiente, Asignado, En_Camino, Entregado, Fallido
   - Transiciones permitidas con flechas etiquetadas
   - Saltos especiales (Asignado → Entregado/Fallido sin pasar por En_Camino)
   - Reversos (PATCH /entregar → Asignado)
   - Cancelación (En_Camino → Asignado)
4. **Casos especiales:**
   - **Delivery externo**: cuando admin asigna a "Delivery externo" en lugar de un repartidor del sistema (POST `/api/despacho/asignar-externo`).
   - **Pedido fallido**: requiere `razon_fallo` (≥5 chars) — patrón en `entregar/route.ts`.
   - **Revertir entrega**: PATCH `/api/pedidos/[id]/entregar` limpia timestamps.
   - **Cancelar viaje**: POST `/api/pedidos/[id]/cancelar-viaje` revierte de En_Camino a Asignado.
5. **Patrones de UI por rol:**
   - **`/mi-ruta` (repartidor):**
     - Offline-first con `localStorage` queue
     - Sticky header con sync indicator
     - Hero card para pedido En_Camino con animación
     - Polling cada 60s
     - GPS bajo demanda (solo si mapa visible o pedido En_Camino activo)
     - Auto-redirect a `/mi-ruta` desde `/dashboard` si role=repartidor
   - **`/despacho` (admin):**
     - Kanban con drag-and-drop entre columnas (pendientes ↔ repartidores)
     - Mapa lateral con polylines coloreadas por repartidor
     - Filtros por distrito en pendientes
     - Polling cada 15s
     - Modal de "ubicación base" editable
   - **`/nuevo-pedido` (asesor):**
     - Autocomplete cliente con debounce 300ms
     - MapInput para coords obligatorias (click / drag / Places autocomplete)
     - Preview de ticket → JPEG con `html-to-image` → share por WhatsApp
6. **Cómo verificar que sigue vigente.**

### 4.6 `05-apis-e-integraciones.md`

**Propósito:** Referencia completa de endpoints internos y servicios externos.

Secciones:
1. **Convenciones de API** — patrón común:
   - `export const dynamic = "force-dynamic"` cuando aplica
   - Auth check con `const session = await auth()`
   - Validación con zod (`Schema.safeParse(body)`)
   - Status codes: 400 input, 401 no auth, 403 sin permisos, 404 no encontrado, 409 conflicto, 500 servidor
   - Errores: `console.error("Mensaje:", error)` + `NextResponse.json({ error })`
   - Scoping por rol en queries SQL
2. **Endpoints internos agrupados:**
   - **`/api/pedidos/*`**: POST crear, PATCH update genérico, DELETE, transiciones (iniciar-viaje, entregar, cancelar-viaje), print
   - **`/api/despacho/*`**: GET (vista admin), asignar, asignar-externo, optimizar-ruta, reordenar
   - **`/api/repartidor/mi-ruta`**: GET (vista repartidor con stats + ruta optimizada)
   - **`/api/clientes/*`**: GET (autocomplete + lista paginada con scoping por asesor), POST, PATCH, DELETE, GET pedidos del cliente
   - **`/api/productos/*`**: GET, POST (admin), PATCH (admin)
   - **`/api/users/*`**: GET (admin o filtrado por rol), POST (admin), PATCH (admin)
   - **`/api/analytics`**: GET con rango de fechas, KPIs, ranking asesoras, top productos
   - **`/api/resumen-diario`**: GET para vista de resumen del día (con items agrupados)
   - **`/api/settings`**: GET, POST (admin) — guardar base_location
   - **`/api/version`**: GET (BUILD_ID para VersionChecker)
   - **`/api/auth/logout`**: GET (server action `authSignOut`)
   - **`/api/dashboard/pedidos`**: GET (wrapper de `fetchFilteredPedidos`)
   - Por cada endpoint: método, path, body schema, query params, response, scoping, side effects, file:line de referencia.
3. **Google Maps Platform — usos en el sistema:**
   - **Directions simple (server)** — al asignar pedido y al iniciar viaje. Calcula distancia + duración base→destino o GPS→destino. Fallback a Haversine si falla.
   - **Directions con `waypoints=optimize:true` (server)** — TSP heurístico. Límite 25 waypoints. Maneja overflow secuencialmente.
   - **Maps JS + Places Autocomplete (cliente)** — en `MapInput` y modal de `base_location`.
   - **Reverse Geocoding (cliente)** — en `MapInput` para convertir lat/lng → dirección al hacer click/drag en mapa.
   - Variables: `Maps_SERVER_KEY` (server), `NEXT_PUBLIC_MAPS_API_KEY` (cliente).
   - **Pendiente de verificación al escribir el doc:** confirmar si hay un 5to uso (geocoding server-side al crear pedido). Si no existe, mantener solo los 4 usos listados.
4. **Neon Postgres:**
   - HTTP serverless driver (`@neondatabase/serverless`)
   - No es pool — reinstanciar `neon(connectionString)` por handler
   - `DATABASE_URL` (pooled) vs `DATABASE_URL_UNPOOLED` (para transacciones largas / migraciones)
   - Patrón de query: tagged template literals + `sql.query(query, params)` para queries dinámicas
5. **Vercel:**
   - Deploy continuo desde main
   - Build genera `BUILD_ID` único por deploy
   - `/api/version` lo expone para `VersionChecker.tsx`
   - Por qué importa: evita que repartidores trabajen con bundle viejo
6. **Offline queue (`src/lib/offline-queue.ts`):**
   - Diagrama de flujo: acción → check online → fetch o enqueue → sync al reconectar → manejar 200/400-409/otros
   - Storage: `localStorage` clave `transavic_offline_queue`
   - Acciones soportadas: `entregar`, `fallido`, `iniciar-viaje`
   - Retry max 3 veces
   - Conflict resolution: si servidor retorna 400/409, descarta sin error (estado ya cambió)
7. **Próximas integraciones (sección viva):**
   - Pusher Channels (tiempo real GPS, free tier 200K msg/día)
   - Capacitor (wrapper Android de `/mi-ruta`)
   - Gemini API (free tier, módulo IA comercial, anonimizar datos antes de enviar)
   - SUNAT PSE (facturación electrónica, cliente contrata por separado)
8. **Cómo verificar que sigue vigente.**

---

## 5. Convenciones de redacción

### Idioma
**Español** en todo el contenido (consistente con el código y con `CLAUDE.md`).

### Diagramas

| Tipo de diagrama | Herramienta |
|---|---|
| Capas, ER, máquina de estados, flujos de proceso | **Mermaid** (renderiza directo en GitHub/VS Code/Cursor) |
| Flujos lineales simples 3-5 cajas | ASCII art (`──▶`, `┌──┐`) |
| Comparativas, listados, decisiones, gotchas | Tablas markdown |

### Code blocks
- TypeScript, SQL y JSON **reales del proyecto**, no inventados.
- Si se simplifica un fragmento, indicar con `// ... (lógica de validación) ...`
- Sintaxis highlighting con \`\`\`typescript, \`\`\`sql, \`\`\`json, \`\`\`bash.

### Referencias a archivos
- Formato `src/lib/data.ts:53-66` (path:línea-final)
- Esto permite a editores modernos (VS Code, Cursor) hacer click directo al archivo.
- En tablas usar **negrita** en el path.

### Header de cada documento
Todos los documentos empiezan con:
```markdown
# <Título del documento>

> **Última verificación contra código:** YYYY-MM-DD
> **Commit del proyecto:** <hash corto del último commit verificado>
> **Archivos clave:** lista de archivos referenciados
```

El `README.md` también lleva header pero sin "Archivos clave" (porque es índice).

### Sección final estándar
**Todos los documentos excepto el README** terminan con:
```markdown
## Cómo verificar que este documento sigue vigente

Comandos de verificación específicos:
- `grep -rn "..." src/`
- `psql $DATABASE_URL -c "\d <tabla>"` para verificar schema
- ...
```

El `README.md` no lleva esta sección — su rol es solo de índice.

---

## 6. Proceso de creación y verificación

### Orden estricto
1. README.md
2. 01-vision-general.md
3. 02-modelo-de-datos.md
4. 03-autenticacion-y-roles.md
5. 04-flujos-de-negocio.md
6. 05-apis-e-integraciones.md

### Por cada documento, antes de escribirlo:
1. **Re-leer** los archivos de código relevantes (no fiarse del análisis previo de la conversación).
2. Para archivos grandes (>500 LOC), delegar lectura profunda a sub-agente `Explore` para preservar contexto.
3. Listar afirmaciones técnicas a hacer en el documento.

### Mientras se escribe:
1. Cada afirmación técnica debe referirse a un `archivo:línea` real verificable.
2. Code blocks copiados/parafraseados del proyecto, **no inventados**.
3. Si hay una afirmación que no se puede verificar inmediatamente → marcar con `> ⚠️ Sin verificar — confirmar antes de finalizar` y dejarla pendiente.

### Después de escribir cada documento:
1. **Re-leer** el documento completo verificando que no hay invenciones.
2. **Resolver** todos los `⚠️ Sin verificar` (o eliminarlos del documento si no se pueden confirmar).
3. **Verificar links** a archivos y líneas (que sigan siendo válidos).
4. **Commit individual** con mensaje descriptivo: `docs(arquitectura): agregar 02-modelo-de-datos`.

### Después de los 5 documentos:
1. Actualizar `CLAUDE.md` agregando referencia a `docs/arquitectura/`.
2. Commit final: `docs(arquitectura): completar documentación inicial`.

---

## 7. Criterios de éxito

El proyecto se considera completo cuando:

- [ ] Los 5 documentos están escritos en `docs/arquitectura/` siguiendo la estructura definida.
- [ ] El `README.md` permite navegar a cualquier documento en 1 click.
- [ ] Cada afirmación técnica está verificada contra código real (no hay invenciones).
- [ ] Todos los diagramas Mermaid renderizan correctamente.
- [ ] Cada documento tiene su sección "Cómo verificar que sigue vigente".
- [ ] `CLAUDE.md` está actualizado con referencia a esta documentación.
- [ ] Los 5+1 documentos están commiteados con mensajes descriptivos.
- [ ] Una sesión nueva de IA, leyendo solo `CLAUDE.md` + `docs/arquitectura/`, puede empezar a implementar las 8 mejoras pendientes sin necesidad de leer código de exploración.

---

## 8. Out of scope (explícito)

**No** incluido en este spec:

- Documentación de las 8 mejoras pendientes (Antonio 2026) — eso es otro documento separado (`docs/PLAN-MEJORAS-2026.md`) que se creará después.
- Documentación para Antonio o devs externos — esa audiencia se atiende con la propuesta comercial y el sistema en sí mismo.
- Tutoriales o guías "cómo hago X" — esto es **referencia** de arquitectura, no manual de uso.
- Documentación de testing — no hay tests automáticos hoy.
- API reference auto-generada — no es necesaria con el nivel de complejidad actual.

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| El código cambia rápido y la doc se desactualiza | Alta | Cada doc termina con sección "Cómo verificar que sigue vigente" + header con fecha. CLAUDE.md instruye a futuros agentes a actualizarla. |
| Documentar afirmaciones sin verificar | Media | Proceso obligatorio de "re-leer antes de escribir" + marcado `⚠️ Sin verificar`. |
| Documentación queda muy larga e inmanejable | Baja | Estructura de 5 docs balanceados, no monolito. README index permite saltar al relevante. |
| Diagramas Mermaid no renderizan en algún visor | Baja | Mermaid es estándar en GitHub + VS Code + Cursor. Para casos extremos, generar SVG estático. |
| Tiempo de creación se extiende | Media | Hacer documento por documento con commits intermedios. Cada doc independiente, no hay que hacer todo de una. |

---

## 10. Próximos pasos después de este spec

1. Invocar la skill `writing-plans` para crear el plan de implementación detallado (con TodoWrite paso a paso).
2. Ejecutar el plan documento por documento.
3. Al terminar, actualizar `CLAUDE.md`.
4. Considerar crear `docs/PLAN-MEJORAS-2026.md` (documento separado, otro spec) para el roadmap de las 8 mejoras de Antonio.

# 05 — APIs e Integraciones Externas

> **Última verificación contra código:** 2026-05-13
> **Commit del proyecto:** `d2a49cd`
> **Archivos clave:** todos los `src/app/api/**/route.ts`, `src/lib/data.ts`, `src/lib/offline-queue.ts`

---

## 1. Convenciones comunes en route handlers

### 1.1 Estructura típica de un handler

Patrón observado en ~90% de las APIs:

```typescript
// src/app/api/<feature>/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";   // Si lee sesión o DB en tiempo real

const RequestSchema = z.object({ /* ... */ });

export async function POST(request: Request) {
  try {
    // 1. Auth check
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // 2. (Opcional) Role check
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    // 3. Validar input con zod
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // 4. Instanciar cliente Neon
    const sql = neon(process.env.DATABASE_URL!);

    // 5. Ejecutar query
    const result = await sql`...`;

    // 6. Retornar
    return NextResponse.json({ data: result, message: "OK" }, { status: 200 });
  } catch (error) {
    console.error("Error en X:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
```

### 1.2 Status codes utilizados

| Código | Cuándo |
|---|---|
| **200** | OK genérico, query exitosa |
| **201** | Recurso creado (POST exitoso) |
| **204** | OK sin contenido (DELETE) |
| **400** | Input inválido (zod safeParse falló) |
| **401** | No autenticado |
| **403** | Autenticado pero sin permisos (rol incorrecto o ownership ajeno) |
| **404** | Recurso no encontrado |
| **409** | Conflicto (estado del recurso no permite la acción, o usuario duplicado) |
| **500** | Error interno (catch genérico) |
| **502** | Error de upstream (Google Directions falló) |

### 1.3 Cuándo usar `export const dynamic = "force-dynamic"`

Necesario en handlers que **leen sesión** o **dependen de datos cambiantes**. Sin él, Next.js puede cachear la respuesta a nivel CDN/edge y devolver datos viejos.

**Handlers con `dynamic = "force-dynamic"` (verificado):**
- `api/pedidos/[id]/route.ts`
- `api/pedidos/print/route.ts`
- `api/pedidos/[id]/iniciar-viaje/route.ts`
- `api/pedidos/[id]/entregar/route.ts`
- `api/pedidos/[id]/cancelar-viaje/route.ts`
- `api/despacho/route.ts`
- `api/despacho/asignar-externo/route.ts`
- `api/despacho/optimizar-ruta/route.ts`
- `api/clientes/route.ts`
- `api/clientes/[id]/route.ts`
- `api/users/route.ts`
- `api/users/[id]/route.ts`
- `api/settings/route.ts`
- `api/auth/logout/route.ts`
- `api/dashboard/pedidos/route.ts`

**Handlers SIN `dynamic = "force-dynamic"`** (auditoría pendiente):
- `api/pedidos/route.ts` (POST) — debería tenerlo
- `api/clientes/[id]/pedidos/route.ts` — debería tenerlo
- `api/productos/route.ts`
- `api/productos/[id]/route.ts`
- `api/analytics/route.ts`
- `api/resumen-diario/route.ts`
- `api/version/route.ts` — usa headers `Cache-Control: no-store` en su lugar, intencional

---

## 2. Tabla maestra de endpoints

Resumen de los **23 endpoints** del sistema agrupados por feature:

### 2.1 `/api/pedidos/*` — CRUD y transiciones

| Path | Método | Auth | Rol | Body | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/pedidos` | POST | ✅ | Cualquier auth | `PedidoSchema` (cliente, asesorId, items, ...) | INSERT pedidos + N×INSERT pedido_items | - |
| `/api/pedidos/[id]` | PATCH | ✅ | Admin (cualquiera) / Asesor (suyos) / Repartidor (asignados) | `UpdateSchema` (parcial) | UPDATE pedidos dinámico, sync estado↔entregado | - |
| `/api/pedidos/[id]` | DELETE | ✅ | Admin (cualquiera) / Asesor (suyos). Repartidor: ❌ | - | DELETE FROM pedidos (CASCADE elimina items) | - |
| `/api/pedidos/print` | GET | ✅ | Asesor (sus pedidos) / Admin | - | SELECT con filtros | - |
| `/api/pedidos/[id]/iniciar-viaje` | POST | ✅ | Repartidor asignado / Admin | `{driverLat?, driverLng?}` | UPDATE estado='En_Camino', timestamps, ETA | Google Directions (1×) |
| `/api/pedidos/[id]/entregar` | POST | ✅ | Repartidor asignado / Admin | `{resultado, razon_fallo?}` | UPDATE estado, entregado, entregado_por, entregado_at | - |
| `/api/pedidos/[id]/entregar` | PATCH | ✅ | Repartidor asignado / Admin | - | UPDATE estado='Asignado', limpia timestamps (revertir) | - |
| `/api/pedidos/[id]/cancelar-viaje` | POST | ✅ | Repartidor asignado / Admin | - | UPDATE estado='Asignado', limpia ETA | - |

**✅ Resuelto (2026-05-13):** `PATCH /api/pedidos/[id]` y `DELETE /api/pedidos/[id]` ahora tienen `await auth()` + verificación de ownership al inicio. Asesor solo puede modificar/borrar sus propios pedidos (`asesor_id === userId`), repartidor solo los que tiene asignados (`repartidor_id === userId`), admin pasa siempre. Repartidor explícitamente NO puede borrar pedidos (consistente con `table.tsx:172`).

### 2.2 `/api/despacho/*` — Vista admin

| Path | Método | Auth | Rol | Body | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/despacho` | GET | ✅ | Admin only | - | SELECT (pendientes + asignados + externos + repartidores) | - |
| `/api/despacho/asignar` | POST | ✅ | Admin only | `{pedido_ids[], repartidor_id}` | UPDATE pedidos (repartidor_id, estado, orden_ruta, distancia_km, duracion_estimada_min) | Google Directions (1× por pedido, fallback Haversine) |
| `/api/despacho/asignar-externo` | POST | ✅ | Admin only | `{pedido_id, nombre_delivery}` | UPDATE pedido (es_delivery_externo, delivery_externo_nombre, estado, repartidor_id=NULL) | - |
| `/api/despacho/asignar-externo` | PATCH | ✅ | Admin only | `{pedido_id, estado, razon_fallo?}` | UPDATE pedido (estado, entregado, entregado_at, razon_fallo) | - |
| `/api/despacho/asignar-externo` | DELETE | ✅ | Admin only | `{pedido_id}` | UPDATE pedido (es_delivery_externo=false, estado='Pendiente', repartidor_id=NULL) | - |
| `/api/despacho/optimizar-ruta` | POST | ✅ | Admin / Repartidor (de su ruta) | `{repartidor_id}` | UPDATE pedidos (orden_ruta, duracion_estimada_min) — NO toca distancia_km | Google Directions con waypoints=optimize:true (1×) |
| `/api/despacho/reordenar` | PATCH | ✅ | Admin only | `{repartidor_id, orden:[{pedido_id, orden_ruta}]}` | UPDATE pedidos (orden_ruta) | - |

### 2.3 `/api/repartidor/*`

| Path | Método | Auth | Rol | Body | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/repartidor/mi-ruta` | GET | ✅ | Cualquier auth (devuelve solo sus pedidos) | - | SELECT pedidos WHERE repartidor_id=userId AND fecha_pedido=hoy | - |

### 2.4 `/api/clientes/*`

| Path | Método | Auth | Rol | Body / Query | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/clientes` | GET | ✅ | Asesor (suyos) / Admin (todos) | `?q=` o `?page=&limit=&search=&asesor_id=` | SELECT clientes (filtra por asesor_id) | - |
| `/api/clientes` | POST | ✅ | Cualquier auth (asesor_id viene del session si no es admin) | `CreateSchema` | INSERT clientes | - |
| `/api/clientes/[id]` | GET | ✅ | Asesor (suyos) / Admin | - | SELECT cliente (verifica ownership) | - |
| `/api/clientes/[id]` | PATCH | ✅ | Asesor (suyos) / Admin (puede transferir) | Schema parcial | UPDATE cliente (validar destino si transfiere asesor_id) | - |
| `/api/clientes/[id]` | DELETE | ✅ | Asesor (suyos) / Admin | - | DELETE FROM clientes | - |
| `/api/clientes/[id]/pedidos` | GET | ⚠️ (sin verificación de ownership) | - | - | SELECT pedidos WHERE cliente_id=$1 OR cliente=$nombre | - |

**⚠️ Hallazgo:** `GET /api/clientes/[id]/pedidos` **no verifica que el cliente pertenezca al asesor que pregunta**. Una asesora puede ver el historial de pedidos de un cliente de otra asesora si conoce el UUID. **DEUDA DE SEGURIDAD MEDIA.**

### 2.5 `/api/productos/*`

| Path | Método | Auth | Rol | Body | Side effects DB |
|---|---|---|---|---|---|
| `/api/productos` | GET | ❌ (público) | - | - | SELECT productos WHERE activo=TRUE |
| `/api/productos` | POST | ✅ | Admin only | `{nombre, categoria, unidad}` | INSERT productos |
| `/api/productos/[id]` | PATCH | ✅ | Admin only | `{nombre?, categoria?, unidad?, activo?}` | UPDATE productos |
| `/api/productos/[id]` | DELETE | ✅ | Admin only | - | UPDATE productos SET activo=FALSE (soft delete) |

**Soft delete deliberado** para preservar referencias históricas en `pedido_items`.

### 2.6 `/api/users/*`

| Path | Método | Auth | Rol | Body / Query | Side effects DB |
|---|---|---|---|---|---|
| `/api/users` | GET | ✅ | Admin (todos) / Otro auth (`?role=X` para selects, sin campo `role` en respuesta) | `?role=` | SELECT users |
| `/api/users` | POST | ✅ | Admin only | `{name, password, role}` | INSERT users (bcrypt hash) |
| `/api/users/[id]` | PATCH | ✅ | Admin only | `{name?, password?, role?}` | UPDATE users (hashea password si presente) |
| `/api/users/[id]` | DELETE | ✅ | Admin only | - | Pre-check `pedidos.asesor_id=$1` → 409 si tiene; DELETE FROM users |

### 2.7 Analytics, settings, version, dashboard

| Path | Método | Auth | Body / Query | Side effects |
|---|---|---|---|---|
| `/api/analytics` | GET | ✅ | `?desde=&hasta=` | SELECT múltiples JOINs (KPIs, top productos, ventas por día, ranking asesoras) |
| `/api/resumen-diario` | GET | ✅ | `?fecha=` | SELECT pedidos + items del día |
| `/api/settings` | GET | ✅ | - | SELECT settings |
| `/api/settings` | POST | ✅ | Admin only | UPSERT settings (zod valida `BaseLocationSchema`) |
| `/api/version` | GET | ❌ (público) | - | Lee `.next/BUILD_ID` |
| `/api/dashboard/pedidos` | GET | ✅ | `?query=&fecha=&page=` | Wrapper de `fetchFilteredPedidos` (scoping por rol) |
| `/api/auth/logout` | GET | - | - | NextAuth signOut + redirect a `/` |

**⚠️ Hallazgo:** `GET /api/analytics` y `GET /api/resumen-diario` están abiertos a cualquier usuario autenticado, sin filtro por rol. Si una asesora accede directamente, ve KPIs globales (incluyendo ranking de otras asesoras). **DEUDA DE SEGURIDAD BAJA** (no es info de clientes, pero sí de performance interno).

---

## 3. Reference detallado por endpoint

Para cada endpoint con lógica no trivial, expandimos:

### 3.1 `POST /api/pedidos` — crear pedido

**Archivo:** `src/app/api/pedidos/route.ts:63-130`

**Schema** (líneas 7-39):

```typescript
const PedidoSchema = z.object({
  cliente: z.string().min(1, { message: "El cliente es requerido." }),
  clienteId: z.string().uuid().nullable().optional(),
  whatsapp: z.string().optional(),
  direccion: z.string().optional(),
  direccionMapa: z.string().optional(),
  distrito: z.string(),
  tipoCliente: z.string(),
  detalle: z.string().min(1, { message: "El detalle es requerido." }),
  horaEntrega: z.string().optional(),
  razonSocial: z.string().optional(),
  rucDni: z.string().optional(),
  notas: z.string().optional(),
  empresa: z.string(),
  fecha: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  asesorId: z.string().uuid({ message: "El ID del asesor no es válido." }),
  items: z.array(z.object({
    productoId: z.string().uuid(),
    nombre: z.string(),
    cantidad: z.number().positive(),
    unidad: z.string(),
  })).optional(),
});
```

**Lógica:**
1. Auth check (línea 65-71).
2. `safeParse` del body.
3. INSERT a `pedidos` con columnas literales (líneas 106-108):
   ```
   cliente, cliente_id, whatsapp, direccion, direccion_mapa, distrito,
   tipo_cliente, detalle, hora_entrega, razon_social, ruc_dni, notas,
   empresa, fecha_pedido, latitude, longitude, asesor_id
   ```
4. `RETURNING id` para obtener el UUID generado.
5. Si `items` no está vacío, loop INSERT en `pedido_items` (líneas 118-123).

**⚠️ No es transaccional** — si falla el 3er item de 5, los primeros 2 quedan persistidos.

### 3.2 `PATCH /api/pedidos/[id]` — update genérico

**Archivo:** `src/app/api/pedidos/[id]/route.ts:38-128`

**Schema** dinámico — todas las columnas opcionales:

```typescript
const UpdateSchema = z.object({
  cliente: z.string().min(1).optional(),
  whatsapp: z.string().optional().nullable(),
  // ... ~25 campos ...
  estado: z.enum(["Pendiente", "Asignado", "En_Camino", "Entregado", "Fallido"]).optional(),
  repartidor_id: z.string().uuid().nullable().optional(),
  // ...
});
```

**Sincronización estado ↔ entregado** (líneas 80-114):

```typescript
if (dataToUpdate.estado) {
  dataToUpdate.entregado = dataToUpdate.estado === "Entregado";

  if (dataToUpdate.estado === "Entregado" || dataToUpdate.estado === "Fallido") {
    if (!dataToUpdate.entregado_por) {
      const session = await auth();
      dataToUpdate.entregado_por = session?.user?.name || "Desconocido";
    }
    dataToUpdate.entregado_at = new Date().toISOString();
  }

  if (dataToUpdate.estado === "Pendiente") {
    dataToUpdate.entregado_por = null;
    dataToUpdate.entregado_at = null;
    dataToUpdate.razon_fallo = null;
    dataToUpdate.repartidor_id = null;
    dataToUpdate.orden_ruta = null;
  }

  if (dataToUpdate.estado === "Fallido" && !dataToUpdate.razon_fallo) {
    return NextResponse.json(
      { error: "Se requiere una razón para marcar como 'Fallido'." },
      { status: 400 }
    );
  }
}
```

**Construcción dinámica del UPDATE** (líneas 117-128):

```typescript
const updateEntries = Object.entries(dataToUpdate).filter(
  (entry) => entry[1] !== undefined
);

const setClauses = updateEntries
  .map(([key], index) => `${key} = $${index + 1}`)
  .join(", ");

const params = updateEntries.map((entry) => entry[1]);
const query = `UPDATE pedidos SET ${setClauses} WHERE id = $${params.length + 1}`;
params.push(id);
await sql.query(query, params);
```

**Vulnerabilidad potencial**: `key` viene de `Object.entries(parsedData.data)` — está limitado por las keys del schema zod, así que no hay SQL injection.

### 3.3 `POST /api/pedidos/[id]/iniciar-viaje` — calcular ETA

**Archivo:** `src/app/api/pedidos/[id]/iniciar-viaje/route.ts:9-148`

**Cascada para elegir origen del ETA** (líneas 57-90):

```typescript
let origenLat: string | null = driverLat;
let origenLng: string | null = driverLng;

if (!origenLat || !origenLng) {
  // 1. Último pedido entregado del día por este repartidor
  const pedidoAnterior = await sql`
    SELECT latitude, longitude FROM pedidos
    WHERE repartidor_id = ${session.user.id}
      AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      AND estado = 'Entregado'
      AND latitude IS NOT NULL
    ORDER BY entregado_at DESC
    LIMIT 1
  `;
  if (pedidoAnterior.length > 0) {
    origenLat = pedidoAnterior[0].latitude;
    origenLng = pedidoAnterior[0].longitude;
  }
}

if (!origenLat || !origenLng) {
  // 2. Env vars BASE_LATITUDE/BASE_LONGITUDE
  origenLat = process.env.BASE_LATITUDE || "-12.0553";
  origenLng = process.env.BASE_LONGITUDE || "-77.0451";
}
```

**Cascada:** GPS real → último pedido entregado hoy → env vars base → hardcoded Lima.

**Llamada a Google Directions** (líneas 94-104):

```typescript
const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origenLat},${origenLng}&destination=${pedido.latitude},${pedido.longitude}&key=${googleMapsServerKey}&language=es&region=pe&mode=driving`;

const directionsRes = await fetch(directionsUrl);
const directionsData = await directionsRes.json();

if (directionsData.status === "OK" && directionsData.routes.length > 0) {
  const durationSeconds = directionsData.routes[0].legs[0].duration.value;
  const etaDate = new Date(Date.now() + durationSeconds * 1000);
  horaLlegadaEstimada = etaDate.toISOString();
}
```

**Si Google falla**, no hay fallback — `horaLlegadaEstimada` queda `null` y el repartidor verá "ETA no disponible".

**Retorna URLs de navegación externa** (líneas 137-142):

```typescript
const navUrls = lat && lng ? {
  googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
} : null;
```

### 3.4 `POST /api/despacho/asignar` — asignar pedidos con cálculo de distancia

**Archivo:** `src/app/api/despacho/asignar/route.ts:33-141`

**Pre-procesamiento** (líneas 44-78):
1. Obtener `baseLocation` desde `settings.base_location` (con fallback env vars y luego centro de Lima).
2. Calcular `currentOrden = MAX(orden_ruta) + 1` para el repartidor hoy.
3. Cargar coords de TODOS los pedidos a asignar en un solo SELECT.

**Loop por cada pedido** (líneas 80-128):

```typescript
for (const pedidoId of pedido_ids) {
  currentOrden++;
  const coords = coordsMap.get(pedidoId);

  let distanciaKm: number | null = null;
  let duracionMin: number | null = null;

  if (coords && googleKey) {
    try {
      const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${baseLocation.lat},${baseLocation.lng}&destination=${coords.lat},${coords.lng}&key=${googleKey}&language=es&region=pe&mode=driving`;
      const directionsRes = await fetch(directionsUrl);
      const directionsData = await directionsRes.json();

      if (directionsData.status === "OK" && directionsData.routes.length > 0) {
        const leg = directionsData.routes[0].legs[0];
        distanciaKm = Math.round((leg.distance.value / 1000) * 100) / 100;
        duracionMin = Math.round(leg.duration.value / 60);
      }
    } catch {
      // Fallback Haversine
      if (coords) {
        distanciaKm = haversineKm(baseLocation.lat, baseLocation.lng, coords.lat, coords.lng);
        duracionMin = Math.round((distanciaKm / 30) * 60);  // ~30 km/h promedio Lima
      }
    }
  } else if (coords) {
    distanciaKm = haversineKm(baseLocation.lat, baseLocation.lng, coords.lat, coords.lng);
    duracionMin = Math.round((distanciaKm / 30) * 60);
  }

  await sql`
    UPDATE pedidos
    SET repartidor_id = ${repartidor_id},
        estado = 'Asignado',
        orden_ruta = ${currentOrden},
        distancia_km = ${distanciaKm},
        duracion_estimada_min = ${duracionMin}
    WHERE id = ${pedidoId}
      AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
  `;
}
```

**Fórmula Haversine** (líneas 144-156):

```typescript
function haversineKm(lat1, lng1, lat2, lng2): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}
```

**⚠️ Duplicación:** Haversine está solo acá, no en `optimizar-ruta`. Centralizar en `lib/utils.ts`.

### 3.5 `POST /api/despacho/optimizar-ruta` — TSP heurístico de Google

**Archivo:** `src/app/api/despacho/optimizar-ruta/route.ts:31-238`

**Lógica:**

1. Obtener pedidos activos del repartidor (NOT IN Entregado/Fallido, con coords).
2. Si solo 1 pedido → calcular distancia directa y retornar.
3. Si ≥2 pedidos → llamar a Google Directions con waypoints:

```typescript
const maxWaypoints = 23;  // Google permite max 25 (origin + destination + 23 intermediate)
const pedidosToOptimize = pedidos.slice(0, maxWaypoints + 2);

const origin = `${baseLocation.lat},${baseLocation.lng}`;
const waypointCoords = pedidosToOptimize.map(p => `${p.latitude},${p.longitude}`);
const destination = waypointCoords[waypointCoords.length - 1];
const intermediateWaypoints = waypointCoords.slice(0, -1);

const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=optimize:true|${intermediateWaypoints.join("|")}&key=${googleKey}&language=es&region=pe&mode=driving`;

const directionsRes = await fetch(directionsUrl);
const route = directionsData.routes[0];
const waypointOrder = route.waypoint_order;  // Array de índices reordenados por Google
const legs = route.legs;
```

4. Reconstruir el orden óptimo mapeando `waypointOrder` de vuelta a `pedidoId`.
5. Calcular `duracion_estimada_min` **acumulada** (no por tramo) — para que el repartidor vea "este cliente está a 23 min total de la base".
6. UPDATE solo `orden_ruta` y `duracion_estimada_min`. **NO toca `distancia_km`** (preserva la métrica original "distancia desde la base").

```typescript
for (const item of orderedPedidos) {
  await sql`
    UPDATE pedidos
    SET orden_ruta = ${item.orden_ruta},
        duracion_estimada_min = ${item.duracion_min}
    WHERE id = ${item.pedido_id}
      AND repartidor_id = ${repartidor_id}
  `;
}
```

7. Si hay >25 pedidos, los excedentes se asignan secuencialmente sin optimización (líneas 213-222).

**Retorna:**
```json
{
  "message": "Ruta optimizada: 8 pedidos reordenados.",
  "orden_optimizado": [
    { "pedido_id": "...", "orden_ruta": 1, "distancia_km": 2.4, "duracion_min": 8, "cliente": "..." },
    ...
  ],
  "distancia_total_km": 23.7,
  "duracion_total_min": 95
}
```

### 3.6 `POST /api/pedidos/[id]/entregar` y PATCH (revert)

**Archivo:** `src/app/api/pedidos/[id]/entregar/route.ts`

**Schema con refine condicional** (líneas 9-15):

```typescript
const EntregarSchema = z.object({
  resultado: z.enum(["Entregado", "Fallido"]),
  razon_fallo: z.string().min(5, "La razón debe tener al menos 5 caracteres.").optional(),
}).refine(
  (data) => data.resultado !== "Fallido" || (data.razon_fallo && data.razon_fallo.length >= 5),
  { message: "Debes indicar la razón por la que no se entregó.", path: ["razon_fallo"] }
);
```

**POST** (líneas 32-105):
- Verifica `pedido.estado` ∈ `["Asignado", "En_Camino", "Pendiente"]`.
- Si `'Entregado'`: UPDATE `estado, entregado=TRUE, entregado_por, entregado_at, razon_fallo=NULL`.
- Si `'Fallido'`: UPDATE `estado, entregado=FALSE, razon_fallo, entregado_por, entregado_at`.

**PATCH (revert)** (líneas 107-156):
- Verifica `pedido.estado` ∈ `["Entregado", "Fallido"]`.
- UPDATE: `estado='Asignado'`, limpia `entregado*`, `razon_fallo`, `inicio_viaje_at`, `hora_llegada_estimada`.

### 3.7 `POST /api/pedidos/[id]/cancelar-viaje`

**Archivo:** `src/app/api/pedidos/[id]/cancelar-viaje/route.ts`

**Restricción estricta:** solo permite origen `En_Camino` (líneas 41-46).

UPDATE: `estado='Asignado', inicio_viaje_at=NULL, hora_llegada_estimada=NULL`.

### 3.8 `/api/despacho/asignar-externo` — 3 métodos en un archivo

**POST** (líneas 8-37): asignar.
**PATCH** (líneas 40-79): actualizar estado (Entregado/Fallido).
**DELETE** (líneas 82-110): desasignar (volver a Pendiente).

**Crítico:** `repartidor_id` queda `NULL` en pedidos externos.

### 3.9 `/api/settings` — UPSERT pattern

**Schema** (líneas 31-39):

```typescript
const BaseLocationSchema = z.object({
  key: z.literal("base_location"),
  value: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1),
    name: z.string().min(1),
  }),
});
```

**UPSERT** (líneas 64-69):

```typescript
await sql`
  INSERT INTO settings (key, value, updated_at)
  VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
  ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}::jsonb, updated_at = NOW()
`;
```

### 3.10 `/api/analytics` — múltiples KPIs en un endpoint

**Archivo:** `src/app/api/analytics/route.ts`

Ejecuta **8+ queries en paralelo** (no estrictamente, las hace secuencialmente pero podría):

1. KPIs generales (`total_pedidos, entregados, pendientes, fallidos`).
2. Top productos (TOP 15).
3. Ventas por día.
4. Por empresa.
5. Por distrito.
6. Entregas por persona (hoy / semana / mes).
7. Ranking de asesoras.
8. Top productos por asesora.
9. Tendencia diaria por asesora.

**Performance:** sin índices específicos, podría ser lento si la tabla crece. Hoy con ~30 pedidos/día está bien, pero a 500+ pedidos/día va a haber que agregar índices o materializar vistas.

### 3.11 `/api/resumen-diario`

**Archivo:** `src/app/api/resumen-diario/route.ts`

Default fecha: **ayer** (no hoy). Reporta:
- Pedidos del día con sus items.
- KPIs (total, entregados, pendientes).
- **Totales por producto** del día (la "lista de compras" del día siguiente).

### 3.12 `/api/dashboard/pedidos`

Wrapper trivial de `lib/data.ts:fetchFilteredPedidos`. Existe porque el componente cliente del dashboard hace `fetch('/api/dashboard/pedidos?...')` para refrescar la lista sin recargar la página.

---

## 4. Integraciones externas detalladas

### 4.1 Google Maps Platform

**4 usos confirmados:**

#### A. Geocoding inverso (cliente, MapInput)

- **Cuándo:** click o drag en el mapa → convertir lat/lng → dirección legible.
- **Cómo:** `new google.maps.Geocoder().geocode({ location })` (Maps JS API).
- **Key:** `NEXT_PUBLIC_MAPS_API_KEY`.
- **Costo:** parte del cargo de Maps JS (no se factura por geocoding cliente).

#### B. Places Autocomplete (cliente)

- **Cuándo:** input de dirección en `MapInput.tsx` y en `BaseLocationModal`.
- **Cómo:** `useJsApiLoader({ libraries: ['places'] })` + `<Autocomplete>` component.
- **Key:** `NEXT_PUBLIC_MAPS_API_KEY`.

#### C. Directions API simple (server)

- **Cuándo:**
  - Al asignar pedido (`POST /api/despacho/asignar`) — origin = baseLocation, destination = pedido.
  - Al iniciar viaje (`POST /api/pedidos/[id]/iniciar-viaje`) — origin = cascada (GPS → último entregado → base), destination = pedido.
- **Cómo:** `fetch('https://maps.googleapis.com/maps/api/directions/json?...')`.
- **Key:** `Maps_SERVER_KEY` (server-side, **nota el naming inusual** con M mayúscula y guion bajo).
- **Costo:** $5 USD por 1,000 requests (Maps Platform Pricing 2026).

#### D. Directions API con waypoint optimization (server)

- **Cuándo:** `POST /api/despacho/optimizar-ruta`.
- **Cómo:** mismo endpoint Directions pero con `waypoints=optimize:true|<coords>`.
- **Límite:** 25 stops totales (origin + destination + 23 intermediate). El código maneja overflow asignando secuencialmente.
- **Costo:** $10 USD por 1,000 requests (Advanced rate por waypoint optimization).

### 4.2 Variables de entorno de Google Maps

```bash
# Cliente
NEXT_PUBLIC_MAPS_API_KEY=AIzaSy...     # Permisos: Maps JS, Places, Geocoding (todos client-side)

# Server
Maps_SERVER_KEY=AIzaSy...              # Permisos: Directions API
# ⚠️ Naming inusual: M mayúscula + guion bajo. NO es MAPS_SERVER_KEY ni GOOGLE_MAPS_API_KEY.
```

**Recomendación:** crear 2 keys distintas con permisos restringidos (cliente solo lo necesario para evitar abuse, server solo Directions).

### 4.3 Neon Postgres

- **Driver:** `@neondatabase/serverless` v1.0.1 — HTTP (no Postgres binary protocol).
- **No es un pool** — instanciar `neon(connectionString)` por handler es barato y seguro.
- **Pooled vs Unpooled:**
  - `DATABASE_URL` (pooled): para la mayoría de handlers. Limita conexiones simultáneas pero comparte con PgBouncer.
  - `DATABASE_URL_UNPOOLED`: conexión directa, útil para transacciones largas o migraciones masivas. Hoy **no se usa** en el código activo.

### 4.4 Vercel

- **Deploy continuo** desde push a `main`.
- **`BUILD_ID`** se genera por cada deploy en `.next/BUILD_ID`.
- **`/api/version`** lee este archivo y lo expone — `VersionChecker.tsx` lo polea cada 60s.
- **Env vars** configuradas en Vercel Dashboard (las del `.env` local).

### 4.5 Próximas integraciones (mejoras 2026)

Estas todavía **no están implementadas** pero son parte del roadmap acordado con Antonio:

| Servicio | Para qué | Cuándo |
|---|---|---|
| **Pusher Channels** | Tracking GPS en vivo del repartidor (free tier 200K msg/día, suficiente para 6 motorizados) | Etapa 2 de mejoras |
| **Capacitor** | Wrapper Android de `/mi-ruta` para GPS en background (iOS bloquea PWAs) | Etapa 2 de mejoras |
| **Gemini API** (Google) | Asistente IA para asesoras (free tier 250-1000 req/día). Anonimizar datos antes de mandar. | Etapa 3 de mejoras |
| **SUNAT PSE** (proveedor de facturación electrónica autorizado) | Emitir boletas/facturas con los 2 RUCs (Transavic + Avícola de Tony). Costo por comprobante lo asume el cliente. | Etapa 3 de mejoras |

Cuando se implementen, agregar acá la sección correspondiente con cómo se conectan.

---

## 5. Offline queue — referencia técnica

### 5.1 Estructura del archivo

`src/lib/offline-queue.ts` exporta:

| Función | Para qué |
|---|---|
| `isOnline()` | `navigator.onLine` con fallback `true`. |
| `enqueueAction(type, pedidoId, expectedEstado, payload)` | Agrega acción a la queue en localStorage. |
| `getQueueCount()` | Número de acciones pendientes. |
| `getQueue()` | Retorna el array completo (para UI). |
| `syncQueue()` | Itera la queue y reintenta. Retorna `{synced, failed, conflicts}`. |
| `removeAction(id)` | Elimina una acción por su UUID. |
| `subscribeToQueueChanges(cb)` | Pub-sub para que la UI reaccione a cambios. |

### 5.2 Constantes

```typescript
const STORAGE_KEY = "transavic_offline_queue";
const MAX_RETRIES = 3;
```

### 5.3 Tipos de acciones soportadas

```typescript
type QueuedActionType = "entregar" | "fallido" | "iniciar-viaje";
```

**No están soportadas** (acciones que se hacen solo online):
- `cancelar-viaje`
- `revertir` (PATCH /entregar)
- creación o edición de cliente
- asignación de pedidos
- cualquier otra mutación

### 5.4 Flujo de sync — pseudocódigo

```
syncQueue():
  if !isOnline(): return { synced: 0, failed: 0, conflicts: [] }
  queue = JSON.parse(localStorage[STORAGE_KEY] || '[]')
  result = { synced: 0, failed: 0, conflicts: [] }

  for action in queue:
    { url, body } = buildRequest(action)

    try:
      res = await fetch(url, { method: 'POST', body })

      if res.ok:
        removeAction(action.id)
        result.synced++

      elif res.status in [400, 409]:
        removeAction(action.id)              # estado cambió en servidor, descartar
        result.conflicts.push({ action, reason: await res.text() })

      else:                                  # 5xx
        action.retries++
        if action.retries >= MAX_RETRIES:
          removeAction(action.id)
          result.failed++
        else:
          updateAction(action)

    except (network error):
      action.retries++
      if action.retries >= MAX_RETRIES:
        removeAction(action.id)
        result.failed++
      else:
        updateAction(action)

  return result
```

### 5.5 Conflict resolution

Caso 1: el admin revirtió el pedido a `Asignado` (de `Entregado`). Cuando vuelve la señal, la acción encolada `entregar` con `expectedEstado='Asignado'` se envía → servidor responde 200 OK → todo bien.

Caso 2: el admin asignó el pedido a otro repartidor. Cuando vuelve la señal, la acción `entregar` se envía → servidor verifica `repartidor_id !== session.user.id` → responde 403 (verbo distinto a 400/409 pero el código actual lo trata como network error y reintenta → max retries → discard). **Pendiente:** mejorar el código para tratar 403 como conflict, no como network error.

---

## 6. Patrones de duplicación detectados

Áreas con duplicación que justifican refactor:

| Patrón duplicado | Apariciones | Sugerencia |
|---|---|---|
| Lectura de `settings.base_location` con fallback | `api/despacho/route.ts`, `api/despacho/asignar/route.ts`, `api/despacho/optimizar-ruta/route.ts`, `api/repartidor/mi-ruta/route.ts` | `lib/api.ts:getBaseLocation()` |
| Auth check + role check | ~20 endpoints | `lib/api.ts:requireAuth(session, roles?)` o middleware factory |
| Construcción de Google Directions URL + parsing | `api/despacho/asignar/route.ts`, `api/despacho/optimizar-ruta/route.ts`, `api/pedidos/[id]/iniciar-viaje/route.ts` | `lib/google-directions.ts:fetchDirections(origin, destination, options?)` |
| Fórmula Haversine | `api/despacho/asignar/route.ts` (solo) | Mover a `lib/utils.ts:haversineKm()` y reusarla en `optimizar-ruta` como fallback |
| Reinstanciación de `neon()` | Cada handler | Aceptable (es barato), pero podría centralizarse en `lib/db.ts:getSql()` |
| `parseFloat()` para lat/lng | Múltiples lugares | `lib/utils.ts:parseCoords(row)` |

---

## 7. Cómo verificar que este documento sigue vigente

```bash
# 1. Listar todos los endpoints actuales
find src/app/api -name "route.ts" | sort

# 2. ¿Hay APIs nuevas no documentadas en este doc?
find src/app/api -name "route.ts" -newer docs/arquitectura/05-apis-e-integraciones.md

# 3. ¿Sigue el patrón de force-dynamic en endpoints críticos?
grep -L "force-dynamic" src/app/api/pedidos/**/route.ts src/app/api/despacho/**/route.ts

# 4. ¿Hay APIs sin await auth() (excepto las explícitamente públicas)?
grep -L "await auth()" src/app/api/**/*.ts

# 5. ¿Sigue Google Directions con waypoints=optimize:true?
grep "optimize:true" src/app/api/despacho/

# 6. ¿Sigue el fallback Haversine en asignar?
grep -A 5 "haversineKm" src/app/api/despacho/asignar/route.ts

# 7. ¿Aparecen nuevos status codes raros?
grep -oP 'status: \d+' src/app/api/**/*.ts | sort -u

# 8. ¿Los schemas zod siguen iguales?
grep -A 30 "const.*Schema = z.object" src/app/api/pedidos/route.ts

# 9. ¿Hay endpoints nuevos que llaman Google Maps?
grep -rln "maps.googleapis.com" src/app/api/

# 10. ¿La offline queue sigue con MAX_RETRIES=3?
grep "MAX_RETRIES" src/lib/offline-queue.ts
```

Si encuentras drift, actualizá las secciones afectadas y bumpeá la fecha del header.

---

## 8. Hallazgos de auditoría (deudas a tratar)

| # | Hallazgo | Severidad | Archivo |
|---|---|---|---|
| 1 | ✅ ~~`PATCH /api/pedidos/[id]` y `DELETE /api/pedidos/[id]` sin `await auth()`~~ — **Resuelto 2026-05-13**: agregado auth + ownership check | ✅ Resuelto | `api/pedidos/[id]/route.ts` |
| 2 | `GET /api/clientes/[id]/pedidos` sin verificación de ownership | 🟡 Media | `api/clientes/[id]/pedidos/route.ts` |
| 3 | `GET /api/analytics` y `/api/resumen-diario` abiertos a cualquier auth | 🟢 Baja | `api/analytics/route.ts`, `api/resumen-diario/route.ts` |
| 4 | `POST /api/pedidos` no es transaccional (puede dejar pedidos sin items completos) | 🟡 Media | `api/pedidos/route.ts:105-123` |
| 5 | Logout en dos rutas con destinos distintos | 🟢 Baja (UX) | `api/auth/logout/route.ts` vs `lib/actions.ts` |
| 6 | Roles dispersos en zod schemas (no centralizados) | 🟢 Baja (DX) | Múltiples |
| 7 | Tipo `Pedido` declara campos sin migración documentada (`razon_social`, etc.) | 🟢 Baja (deuda doc) | `lib/types.ts` |
| 8 | `Pedido` TS no incluye `cliente_id` ni `direccion_mapa` que SÍ se insertan en DB | 🟢 Baja | `lib/types.ts` |
| 9 | Tabla `clientes` sin migración de creación documentada | 🟡 Media (reproducibilidad) | `/scripts/` |
| 10 | DELETE de usuario solo checkea `asesor_id`, no `repartidor_id` | 🟡 Media | `api/users/[id]/route.ts` |
| 11 | offline-queue trata 403 como network error, no como conflict | 🟢 Baja | `lib/offline-queue.ts` |
| 12 | Haversine y getBaseLocation duplicados en múltiples handlers | 🟢 Baja (DX) | Múltiples |

---

## Final de la documentación de arquitectura

Estos 5 documentos cubren:

- **01-vision-general.md** — stack, deployment, decisiones macro.
- **02-modelo-de-datos.md** — tablas, schema, decisiones de schema, migraciones.
- **03-autenticacion-y-roles.md** — NextAuth, JWT, scoping, roles.
- **04-flujos-de-negocio.md** — vida del pedido, máquina de estados, UX por rol.
- **05-apis-e-integraciones.md** — referencia de endpoints + Google Maps + offline queue (este documento).

Para overview de los 5 → `README.md` del mismo directorio.
Para gotchas operativos del día a día → `CLAUDE.md` en la raíz.

# 07 — Panel de Despacho y Optimización de Rutas

> **Última verificación contra código:** 2026-06-28
> **Commit del proyecto:** `9f29f5a`
> **Archivos clave:** `src/app/dashboard/despacho/despacho-content.tsx`, `src/app/dashboard/despacho/mapa-despacho.tsx`, `src/app/api/despacho/route.ts`, `src/app/api/despacho/asignar/route.ts`, `src/app/api/despacho/optimizar-ruta/route.ts`

Este documento describe el panel de logística y control de despachos, la integración de drag-and-drop para asignación de motorizados, el algoritmo de optimización de rutas y el mapa interactivo de monitoreo.

---

## 1. El Panel de Despacho (`despacho-content.tsx`)

El administrador (Antonio) gestiona el reparto del día en `/dashboard/despacho`. La vista se actualiza automáticamente por **polling de 15 segundos** (el cual se pausa si la pestaña del navegador está oculta para ahorrar cómputo gratuito de Neon).

### 1.1 Columnas del Kanban
El panel se organiza visualmente en 4 secciones basadas en `@hello-pangea/dnd`:
1. **Pedidos Pendientes:** Órdenes del día en estado `Listo_Para_Despacho` o `Pendiente` sin repartidor asignado. Permite filtrar por distrito de Lima.
2. **Repartidores Propios:** Una columna independiente por cada motorizado activo (`role = 'repartidor'`). Muestra el estado del reparto (entregados / total), distancia total acumulada, tiempo de viaje estimado y los pedidos ordenados de arriba hacia abajo.
3. **Delivery Externo:** Pedidos tercerizados (Rappi, Glovo, independientes).
4. **Completados del Día:** Lista colapsable con los pedidos en estado `Entregado` y `Fallido`.

---

## 2. Asignación y Reordenamiento

- **Drag-and-Drop:** Al arrastrar una tarjeta de pedido de la columna de Pendientes a un motorizado, se dispara un `POST /api/despacho/asignar` con `{ pedido_ids: [id], repartidor_id }`.
- **Asignación Rápida (`quickAssign`):** Un selector desplegable en la tarjeta del pedido permite asignarlo con un clic sin necesidad de arrastrar.
- **Cálculo del Correlativo de Ruta (`orden_ruta`):** Al asignar un pedido a un motorizado, el backend calcula el orden consecutivo:
  ```sql
  -- Calcula el máximo orden_ruta actual del motorizado y le suma 1
  SELECT COALESCE(MAX(orden_ruta), 0) + 1 FROM pedidos WHERE repartidor_id = $1 AND fecha_pedido = $2
  ```
  Esto ubica el nuevo pedido al final de la ruta del repartidor.

---

## 3. Bloqueo de Rutas (🔒/🔓)

Para evitar reordenamientos accidentales o alteraciones por optimizadores mientras los motorizados ya cargan sus vehículos:
- **Persistencia:** El admin puede bloquear columnas de motorizados. El estado se persiste en `settings` bajo la clave `'despacho_rutas_bloqueadas'` con la estructura `{ fecha: "YYYY-MM-DD", bloqueados: ["uuid_1", "uuid_2"] }`.
- **Efectos:** Deshabilita el drag-and-drop para esa columna, oculta el botón de optimización con IA y marca al motorizado con un candado `🔒` deshabilitando su selección en la asignación rápida.

---

## 4. Optimización de Rutas (Google Directions)

Al presionar **"🧭 Optimizar Ruta"** en la columna de un motorizado (requiere $\ge$ 2 pedidos activos), el sistema llama a `POST /api/despacho/optimizar-ruta`:

1. **Consulta Waypoints:** Envía una solicitud al endpoint de Google Directions en el servidor usando `Maps_SERVER_KEY` (camelCase con M mayúscula y guión bajo).
2. **TSP Solver:** Llama a Directions con la bandera `waypoints=optimize:true`, pasando como origen la ubicación del almacén (tabla `settings.base_location` o fallback), y como waypoints los pedidos activos del motorizado.
3. **Persistencia:** Google resuelve el problema del viajante (TSP) y devuelve la secuencia optimizada de paradas. El backend reescribe el campo `orden_ruta` de los pedidos activos en la base de datos y actualiza `duracion_estimada_min`.
4. **Idempotencia:** La optimización **no** sobreescribe la distancia lineal original del pedido (`distancia_km`), la cual se congela en la primera asignación.

---

## 5. El Mapa de Monitoreo (`mapa-despacho.tsx`)

Ubicado al lado derecho del panel, proporciona visibilidad espacial del reparto:
- **Polylines de Ruta:** Dibuja líneas que conectan los pedidos asignados a cada motorizado en orden correlativo (`orden_ruta ASC`), utilizando un color distintivo único por motorizado.
- **Markers de Repartidores en Vivo:** Lee la tabla `rider_locations` y dibuja un ícono de motocicleta para cada motorizado que está transmitiendo. La flecha del marker rota en función del campo `heading` (rumbo) del GPS. El marcador cambia de color según el estado (`rojo` = mock/permiso revocado, `ámbar` = sin señal $\ge$ 10 min, `verde` = transmitiendo normalmente).

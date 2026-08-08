# 06 — Flujo de Producción y Pesaje

> **Última verificación contra código:** 2026-08-07
> **Estado del proyecto:** en producción, incluida la consulta de otras fechas y la reimpresión de guías (§6)
> **Archivos clave:** `src/app/dashboard/produccion/produccion-client.tsx`, `src/app/api/produccion/pedidos/route.ts`, `src/app/api/pedidos/[id]/reprogramar/route.ts`, `src/lib/parse-detalle-pedido.ts`

Este documento describe el módulo de producción y pesaje real, la lógica del pesaje en balanza física y el proceso de conversión de unidades y desagrupación de líneas de venta.

---

## 1. El Rol y la Vista de Producción (`produccion-client.tsx`)

El asistente de producción opera desde el panel `/dashboard/produccion`. Por defecto ve las órdenes programadas para entrega **hoy** que se encuentran en los estados:
- **`Pendiente`**: Listos para entrar a balanza.
- **`En_Produccion`**: Siendo pesados actualmente.
- **`Listo_Para_Despacho`**: Pesaje completado, en cola de asignación de transporte.

Desde el 7 ago 2026 puede además **consultar otras fechas** y **ver los pedidos ya despachados**, pero solo para reimprimir — ver §6.

---

## 2. Captura de Pesos Reales

Puesto que las piezas de pollo y carnes frescas no son idénticas, la preventa trabaja con estimaciones y la venta real se calcula con el pesaje exacto.

- **Importes finales:** Cuando el operario abre el modal de pesaje, ingresa para cada ítem:
  - `cantidad_real` $\rightarrow$ peso exacto de la balanza en kilogramos, o número de unidades despachadas.
  - `subtotal_real` $\rightarrow$ calculado automáticamente como `cantidad_real` $\times$ `precio_unitario`.
- **Auditoría:** Al guardar los pesos reales, la cabecera del pedido se actualiza registrando `pesado_por` con el nombre del operario logueado y la marca de tiempo `pesado_at`.

---

## 3. Conversión de Unidades (Preventa vs Venta)

El catálogo permite productos con unidades mixtas (`uni` o `kg`).
- **El reto de pesaje:** Un cliente pide "6 pollos enteros" (`uni`), pero el cobro final se hace por peso total (ej: `13.52 kg`).
- **El campo `unidad_pedido`:** Al crear el pedido, se guarda la unidad original de la preventa en `pedido_items.unidad_pedido` (ej: `"uni"`).
- **El campo `unidad`:** Al pesar, el operario puede cambiar el selector a `"kg"`. La columna de venta real `pedido_items.unidad` se actualiza a `"kg"`.
- **Efectos:**
  - El "Resumen diario" de producción y la sección de "Pedido original" en la UI siguen leyendo `unidad_pedido` para saber qué pidió el cliente.
  - El proceso de facturación a SUNAT (boletas, facturas) y las Guías de Remisión leen `unidad` (la unidad real despachada) para cumplir con el XML oficial.

---

## 4. Desagrupación de Líneas por Detalle

Para pedidos que contienen el mismo producto pero preparados de diferente forma (ej. un cliente pide `"2 pollos enteros"` en el texto de `detalle` y especifica: `"1 en octavos y 1 trozado para caldo"`):

- **El problema de unificación:** Al sincronizar el catálogo, se unificarían en una sola línea de 2 unidades del producto "Pollo Entero". Esto impediría a Producción pesar los dos pollos por separado e ingresar sus pesos independientes en la balanza.
- **La solución (`lib/parse-detalle-pedido.ts`):** La lógica de parsing del detalle detecta las descripciones individuales y, si están especificadas por separado, **crea múltiples líneas en `pedido_items` para el mismo `producto_id`**.
- **Separación visual en Producción:** En `/api/produccion/pedidos/route.ts`, si existen ítems repetidos con el mismo `producto_id`, se desglosan en tarjetas separadas con su respectiva nota aclaratoria (ej. "octavos", "trozado"), permitiendo al operario pesar cada formato de forma aislada.
- **Transición final:** Al confirmar el peso de todos los ítems, el pedido cambia automáticamente de estado a `Listo_Para_Despacho`.

## 5. Reprogramar para mañana

> **Estado de esta sección:** probado en desarrollo; requiere desplegar la rama para
> quedar disponible en producción. No necesita migración de esquema.

El modal de pesos ofrece una acción secundaria naranja. Antes de ejecutarla:

1. compara pesos, unidades y precios locales con los guardados;
2. si hay cambios, exige guardarlos primero;
3. muestra cliente, fecha de mañana Lima y motivo opcional;
4. llama `POST /api/pedidos/[id]/reprogramar`.

El servidor limita al rol `produccion` a mañana y a los tres estados productivos.
Conserva el avance, retira el pedido de la cola de hoy y lo hace aparecer en la cola
del nuevo día. La ejecutiva responsable recibe una notificación persistente y popup.
Cambiar esta función obliga a revisar docs 04, 16, 23 y 24.

---

## 6. Consultar otras fechas y reimprimir guías (7 ago 2026)

**El problema que resolvía.** Cuando un pedido pasaba a `Asignado`, desaparecía de Producción.
Para reimprimir su guía había que **devolverlo a producción, imprimir y volver a asignarlo** — doble
trabajo, reportado por Ariana en video.

**El bloqueo nunca estuvo en el documento.** `/pedidos/[id]/guia` (`OrdenImprimible`) **no lee
`p.estado`**: sirve cualquier pedido, de cualquier fecha y en cualquier estado; solo exige sesión.
Lo que lo escondía eran tres capas de navegación:

1. la query filtraba `estado IN ('Pendiente','En_Produccion','Listo_Para_Despacho')`;
2. el único enlace a la orden vivía **dentro del modal de pesos**, y encima gateado por `todoCompleto`;
3. en toda la app existían solo **dos** enlaces a esa página (este y el panel post-venta del POS).

Y el endpoint **ya aceptaba `?fecha=YYYY-MM-DD`** desde su primera versión; ningún cliente se la mandaba.

### Qué ofrece la pantalla ahora

| Control | Efecto |
|---|---|
| `<input type="date">` (`max` = hoy) + "Volver a hoy" | manda `?fecha=`; el subtítulo pasa a *"Otro día — solo para consultar y reimprimir"* |
| Toggle **"Incluir ya despachados"** | manda `?incluir_despachados=1` → suma `Asignado`, `En_Camino`, `Entregado` |
| Botón **Imprimir orden** en cada tarjeta | enlaza `/pedidos/{id}/guia`, **fuera** del modal |

**El default NO cambia:** al abrir se sigue viendo la cola de trabajo del día. Los despachados solo
entran si se piden, y su tarjeta **no abre el modal de pesos** — `/pesos`, `/listo` y `/reabrir`
devuelven 400 fuera de los tres estados productivos, así que ofrecerlo sería mentir.

### ⚠️ Tres trampas al ampliar el filtro de estados

Las tres habrían roto algo; quedan documentadas porque cualquier cambio futuro del filtro las revive:

1. **Las ventas del POS de planta nacen en `Entregado`** → con el toggle se habrían colado en la cola
   de Producción. El WHERE lleva `COALESCE(p.origen,'asesor') <> 'pos_planta'` (mismo criterio que
   `lib/data.ts`). No son pedidos de asesora: se preparan y cobran en el mostrador.
2. **`estadoBadge` no tenía `default`** y solo cubría los 3 estados productivos → devolvía `undefined`
   y la tarjeta reventaba al leer `badge.color`. Ahora cubre los 7 y nunca devuelve undefined.
3. **El backfill lazy de ítems escribe en la base durante un `GET`** (§4, gotcha #31). Al listar
   fechas pasadas habría empezado a escribir sobre cientos de pedidos ya cerrados, así que se acotó a
   los 3 estados productivos: un pedido despachado no se va a pesar y reconciliarlo no aporta nada.

Detalles menores del mismo cambio: el `CASE` del `ORDER BY` lleva `ELSE 3` (los despachados al fondo,
explícito en vez de depender del `NULLS LAST` implícito), y `usePollingVisible` pasa a
`immediate: false` porque la carga inicial la hace el efecto que reacciona al cambio de fecha — si no,
cada cambio dispararía dos peticiones.

Sin migración. Crónica: [historial](../historial-cambios-2026.md).

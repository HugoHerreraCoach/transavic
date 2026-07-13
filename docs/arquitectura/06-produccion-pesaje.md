# 06 — Flujo de Producción y Pesaje

> **Última verificación contra código:** 2026-07-12
> **Estado del proyecto:** core en producción
> **Archivos clave:** `src/app/dashboard/produccion/produccion-client.tsx`, `src/app/api/produccion/pedidos/route.ts`, `src/lib/parse-detalle-pedido.ts`

Este documento describe el módulo de producción y pesaje real, la lógica del pesaje en balanza física y el proceso de conversión de unidades y desagrupación de líneas de venta.

---

## 1. El Rol y la Vista de Producción (`produccion-client.tsx`)

El asistente de producción opera desde el panel `/dashboard/produccion`. Este rol solo visualiza las órdenes programadas para entrega el día de hoy que se encuentran en los estados:
- **`Pendiente`**: Listos para entrar a balanza.
- **`En_Produccion`**: Siendo pesados actualmente.
- **`Listo_Para_Despacho`**: Pesaje completado, en cola de asignación de transporte.

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

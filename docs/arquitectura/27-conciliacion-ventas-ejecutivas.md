# 27 — Conciliación de Ventas de Ejecutivas

> **Creado y verificado contra código:** 2026-07-13
> **Estado:** implementado en `codex/cambios-operativos-julio`; requiere despliegue para quedar activo en producción
> **Fuentes de verdad:** `src/lib/ventas-generales.ts`, `src/app/api/ventas-generales/route.ts`, `src/app/dashboard/ventas-generales/ventas-generales-client.tsx`, `src/app/api/pedidos/route.ts`

Este documento fija qué significa **Ventas de Ejecutivas**, cómo se concilia su
tarjeta con el detalle y qué componentes revisar si cambia el cálculo. Complementa
los docs [05](./05-ventas-clientes.md), [14](./14-metas-incentivos.md) y
[22](./22-operaciones-ventas-facturacion.md).

## 1. Resultado de la auditoría del 13 de julio

La consulta anterior no sumaba facturas, CPE ni estados históricos. Partía de
`pedidos` y preagrupaba `pedido_items`, por lo que esas fuentes no duplicaban ventas.

La diferencia provenía del **importe**, no del conteo: utilizaba
`cantidad * precio_unitario` aunque Producción hubiera convertido un pedido expresado
en unidades a peso real en kilogramos. Por ejemplo, 80 unidades podían terminar como
13.3 kg, pero el indicador seguía multiplicando 80 por el precio por kg.

También existía una inconsistencia de navegación: la tarjeta filtraba por
`pedidos.created_at` (registro de la venta) y su enlace abría la lista filtrada por
`fecha_pedido` (entrega). Por eso el usuario no podía reproducir el total.

No se encontraron, para las fechas auditadas:

- pedidos repetidos por cambiar de estado;
- suma adicional por factura o comprobante;
- `numero_guia` duplicados (tiene restricción `UNIQUE`);
- duplicados exactos de cabecera o líneas de pedido.

## 2. Contrato canónico

Una venta de Ejecutivas es un `pedido` que cumple simultáneamente:

```sql
COALESCE(origen, 'asesor') = 'asesor'
AND (created_at AT TIME ZONE 'America/Lima')::date = :fecha
AND estado <> 'Fallido'
AND NOT COALESCE(anulada, FALSE)
```

Reglas:

1. **Entidad de conteo:** `pedidos.id`; cada pedido aporta como máximo una venta.
2. **Fecha comercial:** `created_at` en Lima. `fecha_pedido` sigue siendo entrega.
3. **Canal:** solo `asesor` y `NULL` legado. Campo y `pos_planta` quedan fuera.
4. **Importe confirmado:** suma de `pedido_items.subtotal_real` exclusivamente
   cuando todos los ítems del pedido tienen ese valor.
5. **Pendiente:** si falta un `subtotal_real`, el pedido cuenta como registrado pero
   no aporta un importe parcial ni estimado.
6. **Facturación:** `facturas` y `comprobantes` no participan del indicador.

La interfaz `ResumenOperacionVenta` expone:

```ts
interface ResumenOperacionVenta {
  total: number;
  ventas: number;
  ventasValorizadas: number;
  ventasPorValorizar: number;
}
```

`total` significa **total confirmado**, no proyección. Campo y Planta siempre
devuelven todas sus ventas como valorizadas porque sus importes nacen definitivos.

## 3. Consulta, API y pantalla

`resumenVentasGeneralesPorFecha()` es la única consulta para:

- `GET /api/ventas-generales`;
- `GET /api/consolidado`;
- Rentabilidad Hoy/Ayer.

Primero agrupa `pedido_items` por `pedido_id`, luego clasifica el canal y finalmente
construye los resúmenes. El detalle `detalleEjecutivas` sale del mismo CTE. La API
incluye `id` como identificador técnico; la pantalla muestra la fila por cliente y
sus datos conciliables:

```text
cliente, ejecutiva, hora de registro, fecha de entrega, estado,
número de orden, monto confirmado o "Por pesar" e ítems pendientes
```

En `/dashboard/ventas-generales`, “Conciliar ventas” despliega esas filas dentro de
la misma vista. La suma de importes visibles debe ser igual, al céntimo, a la tarjeta.
El total general suma importes confirmados de Ejecutivas, Campo y Planta, y muestra
aparte cuántas ventas de Ejecutivas aún están por pesar.

## 4. Permisos

La página `/dashboard/ventas-generales` y `GET /api/ventas-generales` son exclusivas
del rol `admin`. Consolidado y Rentabilidad conservan sus propios guards de admin.
El detalle no debe exponerse a una asesora mediante solo ocultar el enlace: API y
página validan la sesión.

## 5. Prevención de duplicados

`PedidoForm` genera un UUID al iniciar la confirmación y lo conserva si hay timeout
o reintento. `POST /api/pedidos` usa ese UUID como `pedidos.id` y guarda en una sola
transacción:

```text
pedido -> pedido_items -> notificación de Producción
```

Repetir el mismo UUID y payload devuelve HTTP 200 con `idempotente: true`; no crea
otros ítems ni avisos. Reutilizar el UUID con datos distintos devuelve 409. El UUID
se renueva únicamente cuando la venta anterior terminó correctamente o se inicia una
venta nueva. Coordenadas y cantidades se canonizan antes del primer `INSERT` con la
misma precisión de PostgreSQL (8 y 2 decimales respectivamente); así el redondeo de
`NUMERIC` no convierte un replay genuino en un conflicto falso.

El script de diagnóstico de duplicados reporta candidatos por huella (cliente,
ejecutiva, detalle, fecha de entrega y registro dentro de diez minutos), pero
**nunca elimina automáticamente**:
dos pedidos similares pueden ser ventas legítimas.

## 6. Fechas de aceptación

| Corte | Resultado anterior reproducido | Resultado confirmado esperado |
|---|---|---|
| 12/07/2026 | 27 ventas, S/15,160.70 | 23 valorizadas, 4 por pesar, S/9,662.39 |
| 13/07/2026, captura | 36 ventas, S/29,211.77 | 10 valorizadas, 26 por pesar, S/3,237.08 |

La captura del 13 se tomó antes de un primer pedido adicional registrado a las
17:58:50. La validación final de solo lectura, realizada más tarde ese mismo día,
encontró **46 registradas, 10 valorizadas, 36 por pesar y S/3,237.08**: después
del corte entraron diez pedidos, todos todavía pendientes de peso, por lo que el
total confirmado no cambió. El valor 36/10/26 se conserva como corte exacto de la
captura, no como cierre del día.

## 7. Impacto de cambios

| Si cambia… | Revisar también… |
|---|---|
| origen/canales de `pedidos` | Ventas Generales, CPE por operación, Consolidado, Rentabilidad, docs 22/23 |
| `cantidad_real` o `subtotal_real` | Producción, edición de pedidos, inventario, detalle conciliable |
| fecha comercial | filtros de API/UI, timezone Lima, cortes históricos |
| exclusión de estados | despacho, anulación POS, reversos y reportes gerenciales |
| idempotencia del POST | formulario, notificación, inserción de ítems y offline/reintentos |

## 8. Límite deliberado: metas e incentivos

`src/lib/ventas-metricas.ts`, Metas, Mi Día e Incentivos no se recalculan
retroactivamente con esta corrección. Cambiarlos puede modificar remuneraciones ya
comunicadas; requiere una decisión explícita de Antonio y una migración de reglas de
negocio separada. No deben apuntarse silenciosamente al total confirmado gerencial.

## 9. Pruebas obligatorias

- pedido multiítem contado una sola vez;
- CPE/factura o transición de estado sin cambio del conteo;
- exclusión de Campo, Planta, anulados y fallidos;
- pedido sin pesar y parcialmente pesado sin importe;
- pedido completamente pesado con suma exacta de `subtotal_real`;
- tarjeta igual a detalle en centavos;
- corte de medianoche en `America/Lima`;
- replay del UUID con una sola cabecera, conjunto de ítems y notificación;
- ejecución del diagnóstico para 12 y 13 de julio.

No requiere migración de esquema. Después del despliegue se debe ejecutar primero
la consulta de diagnóstico y luego comparar pantalla, API y detalle para ambas fechas.

# 14 — Sistema de Metas e Incentivos Comerciales

> **Última verificación contra código:** 2026-07-13
> **Estado del proyecto:** vigente en `main`; no se recalcula por la corrección gerencial de Ventas de Ejecutivas (ver doc 27)
> **Archivos clave:** `src/lib/ventas-metricas.ts` (módulo unificado de la métrica), `src/lib/metas.ts`, `src/lib/incentivos.ts`, `src/app/dashboard/mis-metas/mis-metas-client.tsx`

Este documento describe el funcionamiento de los reportes comerciales para las asesoras, los algoritmos de cálculo de metas, rachas de consistencia, metas grupales y el ranking de ventas.

---

## 1. El Panel Comercial (`mis-metas-client.tsx`)

Ubicado en `/dashboard/mis-metas`, es el panel motivacional de las asesoras. Presenta tres tarjetas de progreso (Hoy, Semana y Mes) y detalla los bonos activos y la racha del equipo.

---

## 2. La Métrica de Venta Real (pedidos registrados)

> [!IMPORTANT]
> **Definición de Venta para Metas (regla vigente, ratificada por Hugo el 5 jul 2026):** las cifras comerciales de las asesoras (metas individuales, rachas, ranking y meta de equipo) se miden por **PEDIDOS**, no por comprobantes:
> - **Monto:** `SUM(pedido_items.cantidad × precio_unitario)` de los ítems del pedido.
> - **Atribución temporal:** la fecha en que la asesora **REGISTRÓ** el pedido (`pedidos.created_at`, zona horaria Lima), no la fecha de entrega ni la de emisión del comprobante.
> - **Exclusión por operación:** las ventas del POS de Planta (`pedidos.origen = 'pos_planta'`) y las ventas de Campo (`ventas_avicola`) NUNCA suman a metas, rachas ni bonos de las asesoras.

La regla tiene **dos variantes** según el horizonte temporal:

| Variante | Filtro de estado | Se usa en | Por qué |
|---|---|---|---|
| **Cifras confirmadas** | `estado = 'Entregado'` | Metas mensuales, ranking | Solo cuenta lo que realmente se entregó al cliente. |
| **Indicadores en curso** | `estado != 'Fallido'` | Rachas, meta de equipo de la semana/día actual | ~86% de los pedidos se entregan días después de la venta; exigir `Entregado` dejaría la semana en curso siempre en cero. |

El cálculo se está unificando en el módulo **`src/lib/ventas-metricas.ts`** (nuevo), consumido por `lib/metas.ts` y `lib/incentivos.ts`, para que todas las pantallas comerciales usen exactamente la misma query.

### Historial de la métrica

Hasta junio de 2026 las metas se midieron por **comprobantes electrónicos** mediante la vista SQL `ventas_facturadas` (boletas y facturas aceptadas u observadas por SUNAT, restando las Notas de Crédito del periodo, con atribución `emitido_por` → `pedido.asesor_id`). Esa regla nació cuando el catálogo aún no tenía precios cargados (los pedidos nacían con S/0) y la facturación era el único monto confiable. Con los precios ya cargados en el catálogo, se volvió a medir **lo realmente vendido y entregado por la asesora**: los pedidos reflejan mejor su esfuerzo comercial y no dependen de quién ni cuándo emite el comprobante. La vista `ventas_facturadas` **sigue existiendo** como fuente **histórica y de facturación** (reportes de admin y análisis), pero ya no alimenta los incentivos. Campo y sus NC se excluyen explícitamente de esa vista.

### 2.1 No confundir metas con Ventas Generales

`src/lib/ventas-metricas.ts` y `src/lib/ventas-generales.ts` responden preguntas distintas:

| Helper | Pregunta | Operaciones | Estado principal |
|---|---|---|---|
| `ventas-metricas.ts` | ¿Cuánto esfuerzo/venta atribuible hizo cada asesora? | solo Ejecutivas | confirmado `Entregado` o en curso `!= Fallido` según indicador |
| `ventas-generales.ts` | ¿Cuánto registró el negocio en una fecha? | Ejecutivas + Campo + Planta | pedidos `!= Fallido`; Campo no anulada |

Consolidado y el comparativo Hoy/Ayer usan `ventas-generales.ts`; metas, rachas y ranking usan
`ventas-metricas.ts`. No intentes hacer coincidir ambas cifras cambiando filtros aislados.

---

## 3. Algoritmo de Metas Individuales

### 3.1 Meta Mensual
Se calcula mediante dos caminos:
1. **Automática:** Toma las ventas del mes anterior de la asesora (pedidos `Entregado` según la métrica del §2) y las multiplica por un factor de crecimiento (por defecto $+15\%$, configurable por admin en `settings.incentivos_config` bajo `factorCrecimientoPct`).
2. **Override Manual:** El administrador puede ingresar un monto fijo personalizado y asociar un bono específico (ej: `"Bono S/ 200 Vale de Compras"`) en la tabla `metas_asesoras`. Esto pisa la meta automática.

### 3.2 Meta Diaria
- **Fórmula:** `meta_diaria = meta_mensual / dias_habiles_del_mes`.
- **Días hábiles:** Se calculan de forma dinámica excluyendo únicamente los domingos (los sábados sí cuentan en el negocio avícola de Lima).

---

## 4. Incentivos Adicionales

La configuración de incentivos se almacena en `settings.key = 'incentivos_config'`.

### 4.1 Racha Semanal de Consistencia
- **Regla:** Un día cuenta como exitoso si la asesora alcanza un `minimoDiario` de venta (S/) o un número mínimo de pedidos registrados. Se mide sobre los pedidos registrados ese día (`created_at` Lima, `estado != 'Fallido'`, excluyendo POS — variante "en curso" del §2).
- **Premio:** Cumplir la racha diaria de lunes a sábado (`diaFin = 6`) le otorga un premio configurado en formato de texto libre.

### 4.2 Meta de Equipo Semanal
Suma de las ventas consolidadas de todas las asesoras durante la semana actual (pedidos registrados en la semana, `estado != 'Fallido'`, excluyendo POS) comparado contra un objetivo grupal fijado por el admin.

### 4.3 Ranking Mensual
Tabla de posiciones interactiva que ordena a las asesoras de mayor a menor ventas del mes actual (pedidos `Entregado` registrados en el mes — variante "confirmada" del §2), mostrando los premios asociados al primer, segundo y tercer puesto.

## 5. Separación respecto del indicador gerencial confirmado

La corrección de Ventas Generales del [doc 27](./27-conciliacion-ventas-ejecutivas.md)
no modifica automáticamente metas, rachas, ranking, Mi Día ni comisiones. Esos módulos
conservan `src/lib/ventas-metricas.ts` hasta que Antonio apruebe una regla de
remuneración y su efecto histórico. Reutilizar el nuevo total confirmado sin esa
decisión sería un cambio de pago al personal, no un refactor técnico.

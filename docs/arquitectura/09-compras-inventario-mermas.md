# 09 — Compras, Inventario y Mermas (Expansión ERP 2026)

> **Última verificación contra código:** 2026-07-13
> **Estado del proyecto:** core en producción desde el 5 jul; consumo automático de anticipos de proveedor implementado en `codex/cambios-operativos-julio`, aún sin desplegar
> **Archivos clave:** `src/app/api/compras/route.ts`, `src/lib/proveedores/pagos.ts`, `src/lib/inventario.ts`, `src/app/api/inventario/route.ts`, `src/app/api/mermas/route.ts`, `src/app/api/prestamos/saldos/route.ts`, `src/app/api/prestamos/transacciones/route.ts`, `scripts/migrate-produccion-fase-2-3-consolidado.sql`, `scripts/migrate-inventario-movimientos.sql`

Este documento describe el ciclo de abastecimiento de la madrugada (compras a granjas, pesaje bruto/tara, mermas de procesamiento) y la **política de inventario** decidida el 5 jul 2026: qué movimientos tocan el stock, cómo se garantiza la idempotencia frente a la cola offline del repartidor, y por qué la merma es (por ahora) solo informativa.

---

## 1. El flujo de la madrugada (contexto de negocio)

Transavic trabaja con **pollo beneficiado** (ya sacrificado), NO pollo vivo. La secuencia operativa diaria es:

1. **Madrugada:** llegan las cargas de los proveedores (granjas/distribuidores). Cada carga viene en **jabas**; se pesa el **bruto** y se descuenta la **tara** (el peso de las jabas) para obtener el **neto** que realmente se paga.
2. **Registro de la compra** (`/dashboard/compras`): quien recibe (rol `admin` o `produccion`) registra proveedor, documento, y por cada producto: jabas, peso bruto, tara y costo unitario. El sistema calcula neto y subtotales, alimenta el inventario y genera la deuda con el proveedor.
3. **Procesamiento / merma** (`/dashboard/produccion/mermas`): el pollo pierde peso por frío (agua/sangre) y trozado. Se registra bruto → limpio + menudencia, y el sistema calcula la merma y su porcentaje. La merma puede vincularse a la carga (`compra_id`) para medir el rendimiento **por lote/proveedor**.
4. **Producción pesa pedidos** (doc [06](./06-produccion-pesaje.md)) y durante el día ocurren ventas de mostrador (POS, doc [10](./10-pos-caja-tesoreria.md)) y entregas de pedidos normales — ambas descuentan inventario.

> **Regla de negocio (doc 18, regla 8):** el inventario es **flexible, NO bloqueante**. El local es compartido y a veces se compra mercadería sobre la marcha: `inventario_lotes.cantidad` **puede quedar negativa** y se regulariza después (compra tardía, préstamo, ajuste).

---

## 2. Tablas del módulo

Todas se crean en `scripts/migrate-produccion-fase-2-3-consolidado.sql` (idempotente, se aplica por psql — gotcha #13), salvo el kardex y sus extensiones, que llegan con `scripts/migrate-inventario-movimientos.sql`. El detalle columna a columna vive en [02-modelo-datos.md §5](./02-modelo-datos.md).

| Tabla | Qué guarda | Claves / restricciones relevantes |
|---|---|---|
| `proveedores` | Directorio de granjas/proveedores (RUC, razón social, dirección, teléfono) | `ruc VARCHAR(11) UNIQUE` |
| `compras` | Cabecera de la carga: proveedor, fecha, tipo/nro de doc, subtotal/IGV/total, `created_by` | FK `proveedor_id` ON DELETE RESTRICT |
| `compra_items` | Detalle del pesaje: jabas, `peso_bruto`, `peso_tara`, `peso_neto`, `costo_unitario`, subtotal | FK `compra_id` CASCADE, `producto_id` RESTRICT |
| `cuentas_por_pagar` | Deuda generada por cada compra: `monto_deuda` vs `monto_pagado`, estado `Pendiente`/`Parcial`/`Pagado`, vencimiento | FK a proveedor y compra; el pago se documenta en el doc [10 §6](./10-pos-caja-tesoreria.md) |
| `inventario_lotes` | **Stock actual por producto** (una fila por producto, upsert) | `UNIQUE(producto_id)`; cantidad `DECIMAL(12,2)` puede ser negativa |
| `inventario_movimientos` | **Kardex**: CADA movimiento de stock con tipo, usuario y referencia | Tipos: `compra` (+), `venta_pos` (−), `entrega` (−), `reversion` (+), `ajuste` (±). Índices por `(producto_id, created_at DESC)` y `referencia_id` |
| `mermas_diarias` | Registro diario de merma: bruto, limpio, menudencia, merma, %; ahora con **`compra_id`** opcional (merma por lote) | FK `usuario_id` RESTRICT; `compra_id` agregado por `migrate-inventario-movimientos.sql` |
| `prestamos_saldos` | Saldo NETO de mercadería prestada por proveedor+producto (jabas y kg) | `UNIQUE(proveedor_id, producto_id)`; **positivo = el proveedor nos debe, negativo = nosotros debemos** |
| `prestamos_transacciones` | Historial de préstamos/devoluciones en especie | `tipo_movimiento` con 4 valores (ver §7) |

`migrate-inventario-movimientos.sql` también agrega el guard de idempotencia a pedidos:

```sql
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS inventario_descontado BOOLEAN DEFAULT FALSE;

ALTER TABLE public.mermas_diarias
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES public.compras(id);
```

> **Nota histórica:** `scripts/migrate-fase1-compras-caja.mjs` y `scripts/migrate-prestamos.mjs` fueron los scripts originales por fase, pero por el bug DNS de Node 26 (gotcha #13) la fuente autoritativa para aplicar el esquema es el SQL consolidado por psql.

---

## 3. Registro de compras — `POST /api/compras`

**Roles:** `GET` exige sesión (cualquier rol logueado); `POST` solo `admin` o `produccion` (403 si no).

### 3.1 Validación (zod)

```ts
const CompraItemSchema = z.object({
  producto_id: z.string().uuid(),
  jabas: z.number().int().nonnegative(),
  peso_bruto: z.number().positive(),
  peso_tara: z.number().nonnegative(),
  costo_unitario: z.number().nonnegative(),
  tipo: z.enum(["ingreso", "devolucion"]).default("ingreso"), // 9 jul 2026 (Nelita)
});
```

La cabecera exige `proveedor_id` (uuid), `fecha`, `tipo_doc`, `nro_doc` (mín. 1 carácter) y al menos 1 ítem. El servidor **recalcula todo**: `peso_neto = bruto − tara` (2 decimales), `subtotal ítem = neto × costo`, y el IGV se extrae del total con la convención de precios CON IGV incluido (`igv = total − total/1.18`, gotcha #10).

### 3.1b Tipos de fila: ingreso, devolución y servicio (9 jul 2026, pedidos de Nelita)

Cada fila de la guía puede ser de **3 clases**, y las 3 conviven en la misma guía:

| Clase | Cómo se detecta | Total | Inventario | `precio_compra` |
|---|---|---|---|---|
| **Ingreso** (default) | `tipo='ingreso'` | suma `neto × costo` | `+neto` + kardex `'compra'` | se actualiza (si costo > 0) |
| **Devolución** | `tipo='devolucion'` (toggle por fila en la UI, fila tinteada roja) | **resta** `neto × costo` (subtotal se guarda NEGATIVO) | `−neto` + kardex **`'devolucion_compra'`** | NO se toca |
| **Servicio** (Pelada de pollo, ENVIO…) | la **categoría** del producto matchea `/servicio/i` — server-side autoritativo (consulta las categorías de los `producto_id`) | suma `cantidad × precio` (el campo bruto actúa como CANTIDAD; jabas/tara deshabilitados = 0) | **NO toca stock ni kardex** | NO se toca |

Los **pesos se guardan siempre POSITIVOS** en `compra_items`; el signo vive en la columna `tipo`
(migración `migrate-compras-mejoras-2026-07-09.sql`, CHECK `ingreso|devolucion`). Decisiones de negocio
(Hugo, 9 jul): la devolución **resta deuda + inventario**; la pelada es un **servicio que cobra el
proveedor** (suma a la deuda, jamás al stock).

**Guardas del total**: si `total < 0` (devoluciones > ingresos) → **400** con mensaje claro (una
devolución "pura" contra deuda vieja se registra junto con la próxima guía de ingreso — fuera de v1);
si `total == 0` → la compra se registra pero **NO se crea** cuenta por pagar.

### 3.2 Transacción atómica batch (5 efectos en un solo commit)

El `POST` ejecuta **una sola transacción batch** del driver HTTP de Neon (`sql.transaction([...])`). Como el batch no permite encadenar el `RETURNING` de una query en las siguientes, el id se genera en el servidor con `crypto.randomUUID()`:

```ts
const compraId = crypto.randomUUID();
await sql.transaction([
  sql`INSERT INTO compras (id, proveedor_id, fecha, ... ) VALUES (${compraId}, ...)`,
  ...itemsProcesados.flatMap((item) => [
    sql`INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, ...) VALUES (...)`,
    sql`INSERT INTO inventario_lotes (producto_id, cantidad) VALUES (${item.producto_id}, ${item.peso_neto})
        ON CONFLICT (producto_id) DO UPDATE SET cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad, ...`,
    sql`INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
        VALUES (${item.producto_id}, ${item.peso_neto}, 'compra', ${session.user.id}, ${compraId})`,
    sql`UPDATE productos SET precio_compra = ${item.costo_unitario}
        WHERE id = ${item.producto_id} AND ${item.costo_unitario} > 0`,
  ]),
  sql`INSERT INTO cuentas_por_pagar (proveedor_id, compra_id, monto_deuda, monto_pagado, estado, fecha_vencimiento)
      VALUES (${proveedor_id}, ${compraId}, ${totalAcumulado}, 0, 'Pendiente', ${fechaVencimientoStr}::date)`,
]);
```

Los 5 efectos, en orden:

1. **Cabecera** en `compras` (estado `'Completado'`).
2. **Ítems** en `compra_items` con el pesaje completo **+ su `tipo`** (ingreso/devolución).
3. **Inventario y kardex** — condicionales por clase de fila (§3.1b): ingreso `+neto` (`'compra'`),
   devolución `−neto` (`'devolucion_compra'`), servicio NADA.
4. **Costo del catálogo actualizado:** `productos.precio_compra` toma el costo real de la última compra
   (solo filas de INGRESO de mercadería con costo > 0) — la rentabilidad deja de depender de un
   `precio_compra` desactualizado.
5. **Cuenta por pagar** por el total NETO de devoluciones (solo si quedó > 0), con vencimiento a
   **30 días** de la fecha de compra.

Si cualquier query falla, no queda una compra a medias (ítems sin stock, compra sin pasivo, etc.).

### 3.2b Deuda manual / "Saldo anterior" del proveedor (9 jul 2026)

Lo que ya se le debía al proveedor **antes de usar el sistema** se registra desde **Cuentas por Pagar**
(botón "＋ Deuda anterior", admin-only): `POST /api/cuentas-por-pagar/deuda` crea una fila de
`cuentas_por_pagar` con **`compra_id = NULL`** y **`concepto`** (columna nueva, default "Saldo anterior").
Se paga con el flujo normal de pagos (parciales incluidos) sin tocar nada más. La lista la muestra con un
badge índigo con su concepto, y `DELETE /api/cuentas-por-pagar/[id]` borra SOLO deudas manuales sin
ningún pago (409 en cualquier otro caso) — para errores de tipeo. Mismo espíritu que
`clientes_avicola.saldo_anterior`, pero encajado en el modelo por-documento de CxP.

### 3.3 Precarga de últimos costos — `GET /api/compras?ultimos_costos=<proveedorId>`

Para registrar la carga de la madrugada en segundos, la UI (`compras-client.tsx`) precarga el **último costo pagado por producto a ESE proveedor**:

```sql
SELECT DISTINCT ON (ci.producto_id) ci.producto_id, ci.costo_unitario
FROM compra_items ci
JOIN compras c ON ci.compra_id = c.id
WHERE c.proveedor_id = ${proveedorCostos}
ORDER BY ci.producto_id, c.fecha DESC, c.created_at DESC
```

El `GET` sin parámetros devuelve las últimas 100 compras con sus ítems ya mapeados (join en memoria por `compra_id`).

### 3.4 Anulación de compras — `POST /api/compras/[id]/anular` (26 jul 2026)

Para corregir errores de registro (como asignar un proveedor equivocado o montos erróneos), un administrador o usuario autorizado puede anular la compra. Este proceso se ejecuta como una **transacción atómica** para evitar descuadres en el inventario o la caja:

1. **Validación Financiera**: Verifica si la cuenta por pagar vinculada a la compra tiene `monto_pagado > 0`. Si ya tiene pagos, se bloquea la anulación y exige revertir primero los abonos en la Ficha del Proveedor.
2. **Reversión de Inventario**: Por cada ítem de la compra que no sea un servicio, se calcula el cambio opuesto:
   * Si la fila fue de ingreso de mercadería, se **resta** la cantidad del stock en `inventario_lotes`.
   * Si fue una devolución al proveedor, se **suma** la cantidad devuelta de vuelta al stock.
3. **Registro en Kardex**: Se inserta un movimiento en `inventario_movimientos` con el tipo `'anulacion_compra'` especificando el **motivo de la anulación** ingresado por el usuario, el ID del operador y la referencia a la compra.
4. **Baja Financiera**: Se elimina físicamente la deuda de `cuentas_por_pagar`.
5. **Estado de la Compra**: Se actualiza la cabecera en `compras` a `estado = 'Anulado'`.

### 3.5 Edición flexible de compras — `PUT /api/compras/[id]` (26 jul 2026)

Permite actualizar los costos unitarios, pesos, tara, jabas y datos informativos del comprobante. Para garantizar la consistencia física y contable, se implementa la siguiente lógica atómica:

1. **Restricción de Pagos**:
   * Si `cuentas_por_pagar.monto_pagado > 0.009` (tiene abonos aplicados), se bloquea cualquier cambio físico en los ítems (productos, pesos, precios). Únicamente se permite modificar datos documentarios (tipo, número de documento y fecha).
2. **Ajuste Neto de Stock**:
   * Si el documento no registra pagos, se permite la edición completa de los ítems de compra. El backend calcula la diferencia neta de kilos: `diferencia = peso_nuevo - peso_viejo` (respetando signos de devolución).
   * Si `diferencia != 0`, se actualiza el stock en `inventario_lotes` y se añade un registro al Kardex (`inventario_movimientos`) con el tipo `'ajuste_compra'`.
3. **Re-escritura y Recálculo**:
   * Se eliminan físicamente y se re-insertan los ítems en `compra_items`.
   * Se recalculan los totales de la cabecera `compras` y el monto total en `cuentas_por_pagar.monto_deuda`. Si el total de la compra resulta `0`, se borra la cuenta por pagar.
   * Si cambia la fecha del documento, la `fecha_vencimiento` de la deuda se actualiza sumando 30 días automáticamente.

---

## 4. POLÍTICA DE INVENTARIO (decisión de Hugo, 5 jul 2026)

El stock (`inventario_lotes`) lo mueven **exactamente seis** flujos, y cada movimiento deja fila en el kardex `inventario_movimientos`:

| Flujo | Signo | Tipo de kardex | Dónde vive |
|---|---|---|---|
| Compra de mercadería | **+** peso neto | `compra` | `POST /api/compras` (§3) |
| Anulación de compra | **−** peso neto (o **+** si fue devolución) | `anulacion_compra` | `POST /api/compras/[id]/anular` (§3.4) |
| Edición de compra | **+ / −** diferencia de kilos | `ajuste_compra` | `PUT /api/compras/[id]` (§3.5) |
| Venta de mostrador (POS) | **−** cantidad | `venta_pos` | `POST /api/pos` (doc [10 §2](./10-pos-caja-tesoreria.md)) |
| Pedido normal al pasar a **ENTREGADO** | **−** `COALESCE(cantidad_real, cantidad)` | `entrega` | `POST /api/pedidos/[id]/entregar` → `descontarInventarioPedido()` |
| Reversión de una entrega | **+** lo descontado | `reversion` | `PATCH /api/pedidos/[id]/entregar` → `reponerInventarioPedido()` |
| Ajuste manual (± con motivo OBLIGATORIO) | ± | `ajuste` | `POST /api/inventario` (§6) |

Reglas transversales:

- **Se descuenta el peso REAL pesado por Producción** cuando existe (`cantidad_real`), y la estimación de preventa (`cantidad`) como fallback — coherente con que el negocio cobra por balanza.
- **La merma NO descuenta inventario** (es informativa — ver §7).
- **Los préstamos de mercadería NO tocan `inventario_lotes`** (llevan su propio saldo en especie — ver §7 y nota al final de esa sección).
- El modelo es **flexible**: los descuentos pueden dejar el saldo negativo; nada bloquea una venta por falta de stock (regla 8 del doc 18).

---

## 5. Descuento al ENTREGAR — `src/lib/inventario.ts`

El helper `descontarInventarioPedido(sql, pedidoId, usuarioId)` se llama desde `POST /api/pedidos/[id]/entregar` (línea ~111) cuando `resultado === "Entregado"`, y `reponerInventarioPedido` desde el `PATCH` del mismo endpoint (reversión a `Asignado`, línea ~334). Tiene tres propiedades de diseño:

### 5.1 Idempotencia (guard `pedidos.inventario_descontado`)

La **offline-queue del repartidor puede repetir el `POST /entregar`** (reintentos hasta 3 veces, patrón §11.1 de CLAUDE.md). El guard es un UPDATE condicional: solo el llamado que "gana" el flip del booleano ejecuta el descuento; los repetidos retornan sin hacer nada.

```ts
const guard = await sql`
  UPDATE pedidos SET inventario_descontado = TRUE
  WHERE id = ${pedidoId} AND inventario_descontado = FALSE
  RETURNING id
`;
if (guard.length === 0) return; // ya descontado (reintento offline-queue)
```

La reversión usa el mismo guard en sentido contrario (`TRUE → FALSE`): si nunca se descontó (o ya se repuso), no repone.

### 5.2 No-bloqueante (la entrega JAMÁS falla por inventario)

Todo el cuerpo está envuelto en `try/catch` que solo hace `console.error`. Si el descuento en sí falla (la transacción interna), se **libera el guard** para que el próximo reintento lo complete:

```ts
} catch (e) {
  // Falló el descuento: liberar el guard para que el próximo reintento lo haga.
  await sql`UPDATE pedidos SET inventario_descontado = FALSE WHERE id = ${pedidoId}`;
  throw e; // capturado por el catch externo → console.error, sin romper la entrega
}
```

### 5.3 Qué descuenta (cantidad real, atómico, con kardex)

```sql
SELECT producto_id, COALESCE(cantidad_real, cantidad)::numeric AS cantidad
FROM pedido_items
WHERE pedido_id = ${pedidoId}
  AND producto_id IS NOT NULL
  AND COALESCE(cantidad_real, cantidad) > 0
```

Por cada ítem, en UNA transacción batch: upsert de `inventario_lotes` (resta) + `INSERT` en `inventario_movimientos` con `tipo='entrega'` y `referencia_id = pedidoId`. La reposición es simétrica con `tipo='reversion'`.

> **Matiz conocido (documentado a propósito):** el PATCH genérico `/api/pedidos/[id]` también acepta `estado: "Entregado"` (lo usa el modal de edición del admin) y **NO** llama a `descontarInventarioPedido` — el descuento vive SOLO en el flujo real de entrega (`/entregar`, que es el que usan mi-ruta y despacho). Si en el futuro el cambio de estado por edición debe mover stock, hay que invocar los helpers también ahí (el guard ya garantiza que no habría doble descuento).

---

## 6. Ajustes manuales — `POST /api/inventario`

**Roles:** `GET` con sesión; `POST` solo `admin` o `produccion`. Regla de oro: **nunca se mueve stock a mano sin explicación**.

El motivo es una **lista cerrada** y, si es "Otro", el detalle es obligatorio (mínimo 3 caracteres) vía `refine`:

```ts
const MOTIVOS_AJUSTE = [
  "Merma no registrada",
  "Error de conteo",
  "Robo / faltante",
  "Ajuste por cierre",
  "Otro",
] as const;

const AjusteSchema = z.object({
  producto_id: z.string().uuid(),
  cantidad_cambio: z.number().refine((n) => n !== 0, "El cambio no puede ser 0"),
  motivo: z.enum(MOTIVOS_AJUSTE),
  detalle: z.string().trim().optional().nullable(),
}).refine(
  (d) => d.motivo !== "Otro" || (d.detalle && d.detalle.length >= 3),
  { message: "Si el motivo es 'Otro', describe el detalle.", path: ["detalle"] }
);
```

El ajuste es atómico (upsert del saldo + kardex `tipo='ajuste'` en `sql.transaction`), y el motivo se persiste concatenado (`"Motivo: detalle"`) en `inventario_movimientos.motivo`.

**Mini-kardex:** `GET /api/inventario?movimientos=<productoId>` devuelve los últimos 20 movimientos del producto (cambio, tipo, motivo, usuario, fecha) — es lo que abre la vista de historial en `/dashboard/inventario`. El `GET` sin parámetros lista el stock actual por producto ordenado por categoría.

---

## 7. Mermas — Cuadre de Pollo (`/dashboard/cuadre-pollo`)

> **⚠️ La "Calculadora de Mermas" (`/dashboard/produccion/mermas`, `POST /api/mermas`) fue RETIRADA el 30 jul 2026.** Nunca se usó: `mermas_diarias` tenía **0 filas** en producción. La reemplaza el **Cuadre de Pollo** (§7bis), que es el cuadre que Marianela llevaba a mano en Excel. La tabla `mermas_diarias` se conserva y ahora la alimenta el módulo nuevo, porque `/api/rentabilidad` la lee.

### 7.1 Fórmula heredada de `mermas_diarias`

```
merma_kg   = peso_bruto − (peso_limpio + peso_menudencia)
porcentaje = merma_kg / peso_bruto × 100
```

El Cuadre de Pollo escribe esa tabla con `peso_bruto` = kilos que entraron, `peso_limpio` = kilos que salieron y `peso_menudencia` = 0, de modo que `merma` sigue siendo la merma real del día y Rentabilidad no cambia de contrato.

### 7.2 Merma por lote (`compra_id`)

`compra_id` sigue existiendo en `mermas_diarias` como vínculo **opcional** a una carga concreta. El Cuadre de Pollo escribe con `compra_id = NULL` (cuadra el día completo, no un lote), y por eso su upsert borra solo las filas del día con `compra_id IS NULL`.

### 7.3 La merma es INFORMATIVA (decisión pendiente de rediseño)

El registro de merma **no toca `inventario_lotes` ni escribe kardex**. Es deliberado: la merma es un KPI de rendimiento (alimenta `/api/rentabilidad`), no un movimiento de stock. El rediseño está **pendiente de conversación con Antonio**, con dos opciones sobre la mesa:

- **Opción A — merma como transformación de inventario:** registrar la merma descontaría el producto "entero" (kg brutos) y acreditaría los productos resultantes (limpio, menudencia) con un tipo de kardex nuevo (`merma`/`transformacion`). Es el modelo contablemente correcto, pero exige mapear la merma a productos concretos del catálogo (hoy la merma se registra en kg globales, sin `producto_id`).
- **Opción B — mantenerla informativa y regularizar por ajuste:** el stock se cuadra periódicamente con ajustes manuales — el motivo **"Merma no registrada" ya existe** en la lista cerrada de §6 precisamente como válvula para esto. Más simple, pero el stock del día flota hasta el ajuste.

Hasta que Antonio decida, **no agregar descuentos de inventario a las mermas** — se duplicaría contra los ajustes que la operación ya hace.

---

## 7bis. Cuadre de Pollo (30 jul 2026 — pedido de Marianela)

**Ruta:** `/dashboard/cuadre-pollo` · **API:** `GET`/`POST /api/cuadre-pollo` · **Fórmula:** `src/lib/cuadre-pollo.ts` (fuente ÚNICA) · **Roles:** `admin` + `produccion`.

### 7bis.1 Por qué existe

El cuadre por producto (§10.2) **no puede cuadrar el pollo**: se compra pollo vivo contra 1-2 productos (`Pollo entero con/sin menudencia`) y se vende en ~20 cortes. Cada corte mostraba una merma falsa de −(todo lo vendido). Marianela lo cuadraba a mano en Excel, **globalmente**, y eso es lo que replica este módulo.

### 7bis.2 La fórmula (verificada contra sus 32 hojas de marzo 2026)

```
Neto ingresado = Σ compras del día (peso_neto) de productos 'vivo' y 'desposte',
                 con las devoluciones en negativo
Total salida   = Venta Campo + Venta Planta + lo que SALIÓ a picar para delivery
Merma real     = Neto ingresado − Total salida
Merma esperada = total de aves × merma_estandar_ave_kg   (0.32 kg, configurable)
DIFERENCIA     = Merma esperada − Merma real
```

`0.32 kg/ave` está verificado: en las 32 hojas el cociente `merma esperada / aves` da 0.32 exacto. Los "macho 0.35 / hembra 0.30" que ella anota al costado son referencia, **no entran en su cálculo** — no reproducirlos como fórmula.

**Tolerancia:** la diferencia se considera cuadrada si `|diferencia| ≤ 1% del neto ingresado`. Pesar ~2 000 kg en balanza de planta tiene ruido de varios kilos; sin esa banda, un −3.50 kg (que su Excel daba por bueno) salía como alerta roja.

### 7bis.3 REGLA CRÍTICA — no duplicar el peso del delivery

El cuadre usa la **salida física a corte** (los 3 campos manuales: corte, corte especial, pollo entero), **NO** lo que las asesoras facturaron. Son dos medidas del MISMO flujo; sumarlas duplicaría el 30-45 % del peso del día. Lo facturado se muestra aparte, en el **Control de delivery**, que es justo lo que ella pidió por audio: *"cómo yo podría ver si todo lo que están incluyendo en delivery es la misma suma de lo que ellos están sacando a la hora de picar"*.

Si no se digitó la salida a corte, el cuadre cae a lo facturado por asesoras y lo advierte en pantalla (`usoFacturadoComoSalida`).

### 7bis.4 `productos.origen_fisico` — la pieza que faltaba

Columna nueva (migración `migrate-cuadre-pollo-2026-07-30.sql`), CHECK `('vivo','desposte','reventa')`, default `'reventa'`:

| Valor | Qué es | Dónde se cuadra |
|---|---|---|
| `vivo` | pollo vivo que entra a beneficio | ENTRADA del Cuadre de Pollo |
| `desposte` | corte que SALE del beneficio (y a veces se compra a terceros) | en bloque, dentro del Cuadre de Pollo |
| `reventa` | entra y sale igual (gallinas, carnes de res/cerdo) | por producto, en Reportes (§10.2) |

**No sirve `productos.rendimiento_porcentaje`**: está en `100.00` en los 84 productos, nadie lo configuró nunca.

### 7bis.5 Aves

Se leen del desglose `jabas_macho`/`jabas_hembra`/`sueltos_*` de `compra_items` (7 machos o 9 hembras por jaba). **En producción esos campos están en 0 en el 100 % de las filas** — nadie los llena —, así que cuando vienen vacíos la usuaria digita machos y hembras en el propio cuadre (`cuadre_pollo_dia.aves_macho/aves_hembra`). Si la compra SÍ trae el desglose, manda la compra y los inputs quedan deshabilitados.

### 7bis.6 Persistencia

`cuadre_pollo_dia` con **PK `fecha`** (un cuadre por día; guardar dos veces corrige la misma fila, no duplica). Al guardar se escribe además el espejo en `mermas_diarias` para que Rentabilidad tenga rendimiento real. Si ese espejo falla, se loguea y el cuadre igual queda guardado.

---

## 8. Préstamos de mercadería (en especie, nunca dinero)

Entre avícolas es normal prestarse mercadería (jabas o kg de pollo) cuando a uno le falta y al otro le sobra. La regla del negocio (doc 18, Fase 5) es estricta: **el control y el pago son en especie** — jamás cruzan caja ni tesorería.

**Endpoints** (ambos `admin` + `produccion`):
- `GET /api/prestamos/saldos` — saldo neto por proveedor+producto (join con nombres).
- `GET /api/prestamos/transacciones[?proveedorId=...]` — historial completo o kardex por proveedor.
- `POST /api/prestamos/transacciones` — registra el movimiento Y recalcula el saldo.
- `PUT /api/prestamos/transacciones/[id]` — edita un movimiento existente (peso, jabas, fecha, tipo, notas) Y recalcula automáticamente el saldo.
- `DELETE /api/prestamos/transacciones/[id]` — elimina un movimiento Y recalcula el saldo.

### 8.1 Semántica del signo y recálculo de saldos

`prestamos_saldos.jabas` / `peso_kg` es un **neto con signo**: **positivo = el proveedor nos debe; negativo = nosotros le debemos**. El factor lo determina el tipo de movimiento:

| `tipo_movimiento` | Significado | Factor sobre el saldo |
|---|---|---|
| `PRESTAMO_OTORGADO` | Nosotros le prestamos mercadería → él nos debe | **+1** |
| `DEVOLUCION_OTORGADA` | Nosotros le devolvemos lo que debíamos → nuestra deuda baja | **+1** |
| `PRESTAMO_RECIBIDO` | Él nos presta mercadería → nosotros debemos | **−1** |
| `DEVOLUCION_RECIBIDA` | Él nos devuelve lo que nos debía → su deuda baja | **−1** |

Regla mnemotécnica verificada en el código: **todo lo "OTORGADO" (mercadería que SALE de nuestras manos) suma; todo lo "RECIBIDO" (mercadería que ENTRA) resta.**

### 8.2 Recálculo centralizado de saldos (`recalcularSaldo`)

Para evitar inconsistencias o desfasajes por ediciones o eliminaciones, la función `recalcularSaldo(proveedorId, productoId)` ejecuta una sumatoria agregada sobre `prestamos_transacciones`:

```sql
SELECT 
  COALESCE(SUM(
    CASE 
      WHEN tipo_movimiento IN ('PRESTAMO_OTORGADO', 'DEVOLUCION_OTORGADA') THEN jabas 
      WHEN tipo_movimiento IN ('PRESTAMO_RECIBIDO', 'DEVOLUCION_RECIBIDA') THEN -jabas 
      ELSE 0 
    END
  ), 0)::int AS total_jabas,
  COALESCE(SUM(
    CASE 
      WHEN tipo_movimiento IN ('PRESTAMO_OTORGADO', 'DEVOLUCION_OTORGADA') THEN peso_kg 
      WHEN tipo_movimiento IN ('PRESTAMO_RECIBIDO', 'DEVOLUCION_RECIBIDA') THEN -peso_kg 
      ELSE 0 
    END
  ), 0)::numeric AS total_peso
FROM prestamos_transacciones
WHERE proveedor_id = $1 AND producto_id = $2;
```

E inserta/actualiza (`ON CONFLICT (proveedor_id, producto_id) DO UPDATE`) en `prestamos_saldos`. Se ejecuta tras cualquier `POST`, `PUT` o `DELETE`.

### 8.3 Capacidades del Frontend (`/dashboard/prestamos`)
- **Edición y Eliminación en Kardex**: Botones directos ✏️ Editar y 🗑️ Eliminar en el historial.
- **Ajuste Directo de Saldo**: Botón ⚙️ Ajustar en la tabla principal para fijar el saldo final deseado en kilos/jabas sin cálculos manuales.
- **KPIs y Filtros**: Tarjetas resumen de totales en kilos (*Nos Deben*, *Debemos*, *Saldos Activos*), buscador global y filtros por estado.

> **Matiz honesto:** los préstamos hoy NO mueven `inventario_lotes` ni el kardex del §4. Si la mercadería prestada distorsiona el stock visible, la válvula actual es un ajuste manual (§6). Integrarlos como tipo de kardex propio es una decisión futura (misma conversación que el rediseño de mermas, §7.3).

---

## 9. Mapa rápido de endpoints del ciclo de abastecimiento

| Endpoint | Método | Roles | Efecto |
|---|---|---|---|
| `/api/proveedores` | GET / POST | sesión / admin+produccion | Directorio de proveedores (RUC de 11 dígitos validado por zod) |
| `/api/compras` | GET | sesión | Últimas 100 compras con ítems; `?ultimos_costos=<provId>` precarga costos |
| `/api/compras` | POST | admin+produccion | Transacción atómica: compra + ítems + inventario + kardex + `precio_compra` + CxP a 30 días |
| `/api/inventario` | GET | sesión | Stock por producto; `?movimientos=<prodId>` mini-kardex (20 últimos) |
| `/api/inventario` | POST | admin+produccion | Ajuste ± con motivo de lista cerrada (detalle obligatorio si "Otro") |
| `/api/mermas` | GET / POST | sesión / admin+produccion | Registro de merma (informativa), vínculo opcional `compra_id` |
| `/api/prestamos/saldos` | GET | admin+produccion | Saldos netos en especie por proveedor+producto |
| `/api/prestamos/transacciones` | GET / POST | admin+produccion | Historial / registrar movimiento Y recalcular saldo |
| `/api/prestamos/transacciones/[id]` | PUT / DELETE | admin+produccion | Editar/eliminar movimiento Y recalcular saldo |
| `/api/cuentas-por-pagar` | GET / POST | admin | Deudas con proveedores y su pago (detalle en doc [10 §6](./10-pos-caja-tesoreria.md)) |

## Adenda 13 jul 2026 — compra, deuda y anticipos

La transacción de compra crea la CxP y, bajo un bloqueo por proveedor, consume
automáticamente los anticipos disponibles más antiguos. Esto no crea otro egreso:
solo crea aplicaciones `anticipo_posterior` y actualiza el caché
`cuentas_por_pagar.monto_pagado`. La fuente canónica del dinero y sus aplicaciones
está en el [doc 26](./26-proveedores-cuentas-por-pagar.md).

---

## 10. Reportes de Operación de Carnes e Inventario (Marianela - Julio 2026)

Implementados en el Hub de Reportes (`/dashboard/reportes` -> pestañas **"Salida de Productos"** y **"Cuadre por Producto"**).

### 10.1 Reporte Diario de Salida de Carnes (Kilos por Canal)
* **API:** `GET /api/reportes/salida-carnes?fecha_inicio&fecha_fin`
* **Lógica:** Consolida y agrupa los kilogramos reales despachados para:
  1. **Ejecutivas (Asesoras):** Pedidos con `fecha_pedido` en el rango, no fallidos ni anulados, de origen `'asesor'`. Suma `cantidad_real` (o `cantidad` como fallback), solo ítems en `kg`/`KGM`.
  2. **Planta (POS):** Pedidos con `fecha_pedido` en el rango, no fallidos ni anulados, de origen `'pos_planta'`. Suma `cantidad`, solo `kg`/`KGM`.
  3. **Campo:** Ventas de campo (`ventas_avicola`) no anuladas del día. Suma `peso_kg`.

> **Fecha (corregido 30 jul 2026):** antes usaba `created_at` (cuándo la asesora registró la venta). Ahora usa **`fecha_pedido` = fecha de ENTREGA** (gotcha #8), porque el reporte mide SALIDA FÍSICA de mercadería. Debe coincidir con `cuadre-fisico` o los dos reportes se contradicen. Como ~86 % de los pedidos se entrega en fecha distinta a la de registro, los números históricos de ambos reportes se movieron.

### 10.2 Cuadre por Producto — reventa (`GET /api/reportes/cuadre-fisico`)
* **Universo (corregido 30 jul 2026):** SOLO productos con **`origen_fisico = 'reventa'`** (gallinas, carnes de res y cerdo) — los que entran y salen iguales. El pollo vivo y sus cortes salieron de aquí: se cuadran en el **Cuadre de Pollo** (§7bis). Antes cada corte mostraba una merma falsa de −(todo lo vendido).
* **Lógica:**
  $$\text{Diferencia (Merma)} = \text{Kilos Comprados} - \text{Kilos Vendidos} + \text{Ajuste manual}$$
* **Fuentes de Datos:**
  * **Kilos Comprados:** Sumatoria de `peso_neto` en las compras completadas del día (`c.fecha = :fecha`, `c.estado <> 'Anulado'`, `ci.tipo = 'ingreso'`).
  * **Kilos Vendidos:** Sumatoria de las salidas en los 3 canales (Ejecutivas, Campo y Planta), **solo ítems en `kg`/`KGM`** (antes sumaba unidades como si fueran kilos, y por eso este reporte y "Salida de Productos" daban totales distintos).
  * **Significado de la Diferencia:**
    * **Valor Positivo (> 0):** Merma física de producción (pérdida de humedad, pluma, víscera, etc.).
    * **Valor Negativo (< 0):** Descuadre de inventario físico (se vendió más peso del registrado en las compras del día).
* **Ajuste manual** (`ajustes_cuadre_fisico`, único por `(fecha, producto_id)`): **0 filas en producción**, nunca se usó.


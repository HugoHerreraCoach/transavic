# 09 — Compras, Inventario y Mermas (Expansión ERP 2026)

> **Última verificación contra código:** 2026-07-12
> **Estado del proyecto:** Beta en producción desde el 5 jul 2026
> **Archivos clave:** `src/app/api/compras/route.ts`, `src/lib/inventario.ts`, `src/app/api/inventario/route.ts`, `src/app/api/mermas/route.ts`, `src/app/api/prestamos/saldos/route.ts`, `src/app/api/prestamos/transacciones/route.ts`, `scripts/migrate-produccion-fase-2-3-consolidado.sql`, `scripts/migrate-inventario-movimientos.sql`, `scripts/migrate-prestamos.mjs`

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

---

## 4. POLÍTICA DE INVENTARIO (decisión de Hugo, 5 jul 2026)

El stock (`inventario_lotes`) lo mueven **exactamente cuatro** flujos, y cada movimiento deja fila en el kardex `inventario_movimientos`:

| Flujo | Signo | Tipo de kardex | Dónde vive |
|---|---|---|---|
| Compra de mercadería | **+** peso neto | `compra` | `POST /api/compras` (§3) |
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

## 7. Mermas — `POST /api/mermas`

**Roles:** `GET` con sesión; `POST` solo `admin` o `produccion`. UI: `/dashboard/produccion/mermas` (`mermas-client.tsx`).

### 7.1 Fórmula y validación

```
merma_kg   = peso_bruto − (peso_limpio + peso_menudencia)
porcentaje = merma_kg / peso_bruto × 100
```

El zod `refine` **rechaza físicamente lo imposible**: `peso_limpio + peso_menudencia ≤ peso_bruto` (no puede salir más carne de la que entró). La fecha es opcional (`YYYY-MM-DD`) con default el día de HOY en Lima.

### 7.2 Merma por lote (`compra_id`)

`compra_id` es un vínculo **opcional** a la carga del día: la UI carga las compras registradas HOY y deja elegir a cuál corresponde el procesamiento. Con eso, el reporte de rentabilidad puede responder "¿qué rendimiento dio la carga de tal proveedor?" en lugar de solo el agregado del día. Si no se elige, la merma queda global (comportamiento anterior, `compra_id = NULL`).

### 7.3 La merma es INFORMATIVA (decisión pendiente de rediseño)

El `POST` **solo inserta en `mermas_diarias`** — no toca `inventario_lotes` ni escribe kardex. Es deliberado: hoy la merma es un KPI de rendimiento (alimenta `/api/rentabilidad`), no un movimiento de stock. El rediseño está **pendiente de conversación con Antonio**, con dos opciones sobre la mesa:

- **Opción A — merma como transformación de inventario:** registrar la merma descontaría el producto "entero" (kg brutos) y acreditaría los productos resultantes (limpio, menudencia) con un tipo de kardex nuevo (`merma`/`transformacion`). Es el modelo contablemente correcto, pero exige mapear la merma a productos concretos del catálogo (hoy la merma se registra en kg globales, sin `producto_id`).
- **Opción B — mantenerla informativa y regularizar por ajuste:** el stock se cuadra periódicamente con ajustes manuales — el motivo **"Merma no registrada" ya existe** en la lista cerrada de §6 precisamente como válvula para esto. Más simple, pero el stock del día flota hasta el ajuste.

Hasta que Antonio decida, **no agregar descuentos de inventario a las mermas** — se duplicaría contra los ajustes que la operación ya hace.

---

## 8. Préstamos de mercadería (en especie, nunca dinero)

Entre avícolas es normal prestarse mercadería (jabas o kg de pollo) cuando a uno le falta y al otro le sobra. La regla del negocio (doc 18, Fase 5) es estricta: **el control y el pago son en especie** — jamás cruzan caja ni tesorería.

**Endpoints** (ambos `admin` + `produccion`):
- `GET /api/prestamos/saldos` — saldo neto por proveedor+producto (join con nombres).
- `GET /api/prestamos/transacciones[?proveedorId=...]` — historial completo o kardex por proveedor.
- `POST /api/prestamos/transacciones` — registra el movimiento Y actualiza el saldo (upsert).

### 8.1 Semántica del signo del saldo

`prestamos_saldos.jabas` / `peso_kg` es un **neto con signo**: **positivo = el proveedor nos debe; negativo = nosotros le debemos**. El factor lo determina el tipo de movimiento:

| `tipo_movimiento` | Significado | Factor sobre el saldo |
|---|---|---|
| `PRESTAMO_OTORGADO` | Nosotros le prestamos mercadería → él nos debe | **+1** |
| `DEVOLUCION_OTORGADA` | Nosotros le devolvemos lo que debíamos → nuestra deuda baja | **+1** |
| `PRESTAMO_RECIBIDO` | Él nos presta mercadería → nosotros debemos | **−1** |
| `DEVOLUCION_RECIBIDA` | Él nos devuelve lo que nos debía → su deuda baja | **−1** |

Regla mnemotécnica verificada en el código: **todo lo "OTORGADO" (mercadería que SALE de nuestras manos) suma; todo lo "RECIBIDO" (mercadería que ENTRA) resta.**

```ts
if (data.tipoMovimiento === 'PRESTAMO_OTORGADO' || data.tipoMovimiento === 'DEVOLUCION_OTORGADA') {
  factor = 1;
} else if (data.tipoMovimiento === 'PRESTAMO_RECIBIDO' || data.tipoMovimiento === 'DEVOLUCION_RECIBIDA') {
  factor = -1;
}
```

El `POST` inserta la transacción y hace upsert del saldo (`ON CONFLICT (proveedor_id, producto_id) DO UPDATE` sumando jabas y kg con el factor aplicado).

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
| `/api/prestamos/transacciones` | GET / POST | admin+produccion | Historial / registrar movimiento + upsert de saldo |
| `/api/cuentas-por-pagar` | GET / POST | admin | Deudas con proveedores y su pago (detalle en doc [10 §6](./10-pos-caja-tesoreria.md)) |

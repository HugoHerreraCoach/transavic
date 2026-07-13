# 10 — POS de Planta, Caja Diaria y Tesorería (Expansión ERP 2026)

> **Última verificación contra código:** 2026-07-12
> **Estado del proyecto:** Beta en producción; fixes transversales del 12 jul pendientes de subir a `main`
> **Archivos clave:** `src/app/api/pos/route.ts`, `src/app/api/caja-diaria/route.ts`, `src/app/api/cuentas/route.ts`, `src/app/api/transacciones/route.ts`, `src/app/api/gastos/route.ts`, `src/app/api/cuentas-por-pagar/route.ts`, `src/app/dashboard/pos-planta/pos-client.tsx`, `scripts/migrate-caja-unica-abierta.sql`

Este documento describe la venta de mostrador en planta (POS), el ciclo de la caja física del día (apertura → movimientos → cierre con arqueo) y la tesorería simple de cuentas (`cuentas_bancarias` + `transacciones`). Cierra con la tabla de **qué dinero registra el sistema y cuál queda deliberadamente fuera**.

---

## 1. El POS de planta (`/dashboard/pos-planta`)

Durante el día, en la planta se vende al paso: menudencia, hígado, molleja, patas, pollos enteros, saldos. Son ventas que **no pasan por asesora, ruta ni repartidor** — regla de negocio: registrarlas en menos de 20 segundos (doc [18](./18-plan-implementacion-maestro.md), Fase 3).

- **Roles:** solo `admin` y `produccion`. El guard está en dos capas: `page.tsx` redirige a `/dashboard` si el rol no corresponde, y `POST /api/pos` devuelve 403.
- **Catálogo precargado:** el server component consulta los `productos` activos y los pasa como `productosInit` al cliente (filtros por categoría y búsqueda en memoria).
- **Offline:** la venta usa la **misma cola offline del repartidor** (`transavic_offline_queue`, regla 11 del doc 18). `pos-client.tsx` encola acciones tipo `"pos-venta"` con `enqueueAction()` cuando no hay conexión (o cuando el POST falla por red), y `offline-queue.ts` las sincroniza contra `/api/pos` al volver el internet.
- **Aislamiento comercial:** el pedido nace con `origen = 'pos_planta'`, lo que lo **excluye del ranking y los bonos de las asesoras** (regla 7 del doc 18; la métrica de ventas filtra por origen).
- **Catálogo "Principales" (13 jul 2026, pedido de Ariana):** el catálogo abre en la pestaña **"Principales"** (pollo entero/brasa, carcasa, espinazo, molleja, patas de pollo, menudencia mixta, alas) para no verse cargado de carnes que no se venden de madrugada; el resto queda en las otras categorías o en la **búsqueda, que ahora MANDA sobre la categoría** (busca en todo el catálogo, así "el resto se busca si se necesita"). Lista FIJA en `PRINCIPALES_PATRONES` de `pos-client.tsx` — matcher por nombre acotado (`/patas? de pollo/`, `/menudencia mixta/`, `/^alas\b/`…) para NO capturar res/cerdo; se ajusta ahí si cambia.
- **Panel "Ventas de hoy" (13 jul 2026):** barra colapsable arriba del POS (`GET /api/pos/resumen-dia`) con el **total del día**, **DÓNDE CAYÓ EL DINERO** (desglose por cuenta/caja del contado + "por cobrar" del crédito) y las **últimas ventas** (hora, cuenta, monto). Se refresca tras cada venta. Responde el "no veo dónde se acumula el dinero": el contado suma a la cuenta elegida en "Cobrar en" (§2.2); el panel lo muestra por cuenta. ⚠️ **El desglose filtra por la fecha del PEDIDO** (`p.created_at`), NO por la de la `transaccion` — cerca de medianoche caían en días distintos (total 0 pese a la venta visible en el historial).

---

## 2. `POST /api/pos` — la venta de mostrador es UNA transacción

### 2.1 Validación (zod con `refine` cruzado)

```ts
const PosSaleSchema = z.object({
  empresa: z.enum(["Transavic", "Avícola de Tony"]),
  items: z.array(PosItemSchema).min(1),
  tipo_pago: z.enum(["Contado", "Credito"]),
  cuenta_id: z.string().uuid().optional().nullable(),
  cliente_planta_id: z.string().uuid().optional().nullable(),
  notas_generales: z.string().optional().nullable(),
}).refine((data) => {
  if (data.tipo_pago === "Contado" && !data.cuenta_id) return false;
  if (data.tipo_pago === "Credito" && !data.cliente_planta_id) return false;
  return true;
}, { message: "Debe seleccionar una cuenta bancaria/caja para pagos al Contado, o un cliente registrado para ventas al Crédito.", path: ["cuenta_id"] });
```

La regla cruzada: **contado exige `cuenta_id`** (a qué caja/cuenta entra el dinero) y **crédito exige `cliente_planta_id`** (a quién se le fía — no se fía a desconocidos). El cliente pertenece a `clientes_planta`, no al directorio de Ejecutivas.

### 2.2 La transacción atómica

Todos los efectos van en un solo `sql.transaction([...])`; el `pedido_id` se genera con `crypto.randomUUID()` porque el batch del driver HTTP de Neon no permite encadenar `RETURNING`. Un fallo a mitad no puede dejar un pedido sin stock descontado ni una venta sin cobro/cobranza.

1. **Pedido:** `INSERT INTO pedidos` con `origen='pos_planta'`, **estado `'Entregado'` directo** (no pasa por la máquina de estados de reparto), `fecha_pedido` = hoy Lima, `detalle`/`detalle_final` derivados del carrito (`"2 kg Molleja (limpia), ..."`), `entregado_por` = nombre del usuario POS, `lat/lng` NULL (no hay ruta).
2. **Cliente denormalizado:** si se selecciona `clientes_planta`, el pedido copia nombre, razón social y RUC/DNI para poder facturar. `pedidos.cliente_id` queda `NULL` porque esa FK apunta al directorio de Ejecutivas; `asesor_id` identifica al usuario POS, no a una asesora comercial.
3. **Ítems + inventario + kardex** por cada línea: `INSERT pedido_items` (con `subtotal_real` ya igual al subtotal — la venta de mostrador se pesa en el momento), `UPDATE inventario_lotes SET cantidad = cantidad - X` (resta directa, **puede quedar negativo** — modelo flexible, regla 8) e `INSERT inventario_movimientos` con `tipo='venta_pos'` y `referencia_id = pedido_id`.
4. **Cobro (Contado):** CTE atómico que suma el saldo de la cuenta elegida y registra la transacción de tesorería en el mismo statement:

```sql
WITH update_cuenta AS (
  UPDATE cuentas_bancarias
  SET saldo = saldo + ${total_venta}, updated_at = (NOW() AT TIME ZONE 'America/Lima')
  WHERE id = ${cuenta_id}
  RETURNING id
)
INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
SELECT id, ${usuario_id}, 'ingreso', ${total_venta}, 'Venta POS - Pedido ' || ${pedido_id}, ${pedido_id}
FROM update_cuenta
```

5. **Deuda (Crédito):** en lugar de tocar tesorería, inserta la deuda en `cobranzas_planta`, enlazada por `pedido_id` y `cliente_planta_id`, con vencimiento = hoy + `clientes_planta.plazo_pago_dias`.

> La deuda de Planta nace con la venta POS a crédito, aunque el comprobante SUNAT se emita después. El CPE y sus reintentos deben enlazar esta cartera; nunca deben duplicarla en `facturas`.

> **Nota sobre el descuento de inventario del POS:** a diferencia de compras/ajustes (upsert `ON CONFLICT`), el POS hace `UPDATE` directo — asume que la fila de `inventario_lotes` existe (la migración consolidada siembra todas en 0). El kardex sí se inserta siempre.

### 2.3 Relación con CPE y reportes generales

- El CPE se clasifica como **Planta** por `pedidos.origen='pos_planta'`, aunque use el motor SUNAT compartido.
- Emitir o reintentar no crea `facturas`; enlaza la deuda propia de Planta cuando existe.
- Una NC total aceptada anula deuda activa de `cobranzas_planta`; una deuda ya pagada requiere devolución manual.
- Ventas Generales, Consolidado y Hoy/Ayer leen la venta POS desde `pedidos.created_at` Lima y `pedido_items`; las metas de asesoras la excluyen.
- La vista general de comprobantes permite `?operacion=planta`. No hay todavía una página fija exclusiva de comprobantes de Planta.

Ver [22](./22-operaciones-ventas-facturacion.md) para la comparación de las tres operaciones y [25](./25-clientes-cobranzas-planta.md) para la cartera de Planta.

### 2.4 Ventas de Planta: ver y ANULAR una venta (13 jul 2026)

Pedido de Ariana/Antonio: el POS no daba visibilidad de las ventas ni permitía eliminarlas. Dos piezas:

- **Vista `/dashboard/pos-planta/ventas` (`ventas-planta-client.tsx`, admin+produccion)** — lista las ventas del POS (`GET /api/pos/ventas?desde=&hasta=`, espejo de `GET /api/avicola/ventas`) por **Hoy / Ayer / Esta semana / fecha**, con total, a qué caja/cuenta cayó, estado de comprobante y badge **Anulada**. Chip violeta 🏭. Entrada en el sidebar bajo 🏭 Venta en Planta. Las anuladas se excluyen del resumen (Vendido/Ventas) y siguen visibles como "· ANULADA".

- **Anular = eliminar reversando dinero + stock (`POST /api/pos/ventas/[id]/anular`)** — reversión **ATÓMICA en UNA sola `sql.transaction`**: el "claim" (marcar `pedidos.anulada=TRUE`) es la **primera sentencia de la misma transacción**, y si se pierde por una carrera (doble-tap) `SELECT 1/(SELECT COUNT(*) FROM claim)` fuerza `division_by_zero` → **ROLLBACK total**. No existe la ventana "anulada pero sin reversar" (no hay claim-fuera + release manual). Efectos, todos en esa transacción:
  - **Inventario:** por ítem, `inventario_lotes += cantidad` + movimiento `anulacion_venta_pos` (+cantidad) → devuelve el stock.
  - **Contado:** por cada `ingreso` de la venta, `cuentas_bancarias.saldo -= monto` + **EGRESO compensatorio** ("Anulación Venta Rápida - Pedido X") en la MISMA cuenta del ingreso original (ingreso + egreso = 0, sin borrar historia). Reversa el monto REAL del ingreso, no un recálculo de ítems.
  - **Crédito:** anula la `cobranzas_planta` del pedido (`anulada=TRUE, estado='Anulada'`).
  - **Guardas (antes de tocar nada):** existe + `origen='pos_planta'` + NO anulada; **sin comprobante SUNAT vivo** (aceptado/observado/pendiente/emitiendo → 409, "emite una Nota de Crédito"); **la caja de planta de ese día NO cerrada** si el cobro cayó en su cuenta (409 `caja_cerrada` → ajuste manual, no reventar un arqueo); y **la cobranza a crédito sin abonos** sin anular (409 `cobranza_con_abonos` → gestionar la devolución primero).
  - `Editar` en la UI = **anular y rehacer** en el POS (v1; edición en sitio queda para v2 por seguridad del dinero).

Las anuladas se **excluyen de todos los totales**: `resumenVentasGeneralesPorFecha` (Ventas Generales + Consolidado), `resumen-dia` ("Ventas de hoy" del POS) y `rentabilidad` (que filtra por `estado='Entregado'` — ahora también `AND NOT anulada`). Migración: `scripts/migrate-pos-anular-2026-07-13.sql` (campos `anulada/anulada_at/anulacion_motivo/anulada_por` en `pedidos`, aditiva/idempotente, aplicada a prod por psql ANTES del deploy). Endurecido tras revisión adversarial multi-agente; verificado E2E en beta (reversión cuadra: dinero neto 0, stock restaurado, excluida de todos los totales).

---

## 3. Caja diaria — `/dashboard/caja-diaria` + `/api/caja-diaria`

La caja es el **efectivo físico de la planta**. Su ciclo diario tiene 3 verbos (GET estado, POST apertura, PUT cierre), todos sobre la cuenta de tesorería **"Caja Efectivo Planta"** (`cuentas_bancarias.tipo='efectivo'`, sembrada por la migración; el POST la crea si faltara). Roles: `GET` con sesión; `POST`/`PUT` solo `admin`/`produccion`.

> **Actualización (QA 5 jul 2026):** desde `migrate-caja-cuenta-id.sql`, la caja **fija `caja_diaria.cuenta_id` al abrirse** y el GET/PUT operan sobre ESA cuenta (fallback al nombre `'Caja Efectivo Planta'` solo para cajas pre-migración). Renombrar la cuenta ya no rompe el arqueo. Reglas operativas: (1) la apertura SINCRONIZA el saldo de la cuenta al conteo físico — la UI avisa si había saldo previo ≠ 0 y la guía instruye abrir la caja ANTES de la primera venta; (2) el arqueo cuenta SOLO el efectivo de la cuenta de la caja — los cobros por Yape/Plin/banco no entran al conteo de billetes.

### 3.1 Apertura atómica + garantía de UNA sola caja abierta

La apertura ejecuta 3 queries en un `sql.transaction`: `INSERT` en `caja_diaria` (estado `'Abierta'`, fecha hoy Lima) + fija el saldo de la cuenta efectivo **al monto de apertura** (`SET saldo = X`, no suma) + registra la transacción `'Apertura de Caja'`.

La unicidad NO depende del `SELECT` previo (dos requests simultáneos lo pasarían ambos): la garantía dura es el **índice único parcial** de `scripts/migrate-caja-unica-abierta.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_caja_diaria_unica_abierta
  ON caja_diaria ((estado))
  WHERE estado = 'Abierta';
```

Si dos aperturas chocan, el segundo `INSERT` falla con el código Postgres `23505` y el endpoint lo traduce a **409 "Ya existe una caja abierta"**. Además `caja_diaria.fecha` es `UNIQUE` (una caja por día calendario).

### 3.2 Estado en vivo (`GET`)

Mientras la caja está abierta, los ingresos/egresos NO se leen de columnas acumuladas: se **calculan en vivo** desde `transacciones` de la cuenta efectivo con `created_at >= abierta_at`, excluyendo el concepto `'Apertura de Caja'` de los ingresos (la apertura no es venta). El `GET` también devuelve el desglose de transacciones **de todas las cuentas** desde la apertura (para ver Yape/BCP del día junto al efectivo) y el historial de las últimas 15 cajas cerradas.

`monto_estimado = monto_apertura + ingresos − egresos` — es lo que "debería" haber en el cajón.

### 3.3 Cierre con arqueo (`PUT`)

Quien cierra cuenta el efectivo físico y digita `monto_cierre_real`. El servidor recalcula ingresos/egresos, obtiene `monto_cierre_calculado = apertura + ingresos − egresos`, persiste ambos (más `cerrada_por`/`cerrada_at`) y responde con la **diferencia** (faltante/sobrante del arqueo). Después **sincroniza el saldo de la cuenta efectivo al monto REAL contado** — la realidad física manda sobre el cálculo.

> **Matiz:** el cierre son 2 UPDATE secuenciales (caja y luego cuenta), no un batch atómico como la apertura. Riesgo bajo (si fallara el segundo, el saldo se corrige en la próxima apertura, que fija `saldo = monto_apertura`), pero es una asimetría conocida.

---

## 4. Cuentas bancarias y transacciones (tesorería simple)

- **`GET /api/cuentas`** (sesión): lista todas las cuentas con saldo. **`POST`** (solo `admin`): crea cuentas dinámicamente (regla 9 del doc 18 — Efectivo, BCP, Yape, etc.), siempre con saldo 0. **`PATCH`** (solo `admin`, 10 jul 2026): renombrar y activar/desactivar (`activa`) — con **guards de nombres reservados**: `"Caja Efectivo Planta"` y `"Caja Efectivo Campo"` son get-or-create POR NOMBRE de la caja diaria, así que NI se renombran, NI se renombra otra cuenta HACIA esos nombres, NI se desactivan (409).
- **`POST /api/transacciones`** (solo `admin` desde el 10 jul 2026 — alimenta el modal **"Ajustar saldo"** de `/dashboard/cuentas`): movimiento manual de dinero (ingreso/egreso) sobre una cuenta. Es **atómico por CTE**: el `UPDATE` del saldo y el `INSERT` del ledger van en un solo statement — si la cuenta no existe, el CTE no devuelve filas y no se inserta nada (404). ⚠️ El signo se decide **en JS** (`delta = tipo === 'ingreso' ? monto : -monto`), NUNCA con `CASE WHEN` sobre parámetros: el driver HTTP de Neon manda los parámetros sin tipo y el CASE rompía la inferencia → el endpoint devolvía 500 SIEMPRE (gotcha #45, cazado por E2E el 10 jul).

```sql
WITH update_cuenta AS (
  UPDATE cuentas_bancarias
  SET saldo = saldo + ${delta}::numeric, ...   -- delta calculado en JS
  WHERE id = ${cuenta_id}
  RETURNING id
)
INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
SELECT id, ${usuario_id}, ${tipo}, ${monto}, ${concepto}, ${referencia_id || null}
FROM update_cuenta
RETURNING *;
```

- `transacciones` tiene columna **`fecha DATE`** (migración `migrate-flexibilizacion-2026-07-10.sql`, default hoy Lima): el pago a proveedor con fecha retroactiva (`fechaPago` del modal de CxP) se persiste ahí (§6).

**Pendientes menores detectados (válidos, anotados a propósito):**
1. ~~`POST /api/transacciones` sin check de rol~~ — **resuelto el 10 jul 2026** (admin-only).
2. ~~El zod de `POST /api/cuentas` no aceptaba `'billetera'`~~ — **resuelto** (enum banco/efectivo/billetera).

---

## 5. Gastos — `POST /api/gastos`

Roles: `GET` y `POST` solo `admin`/`produccion` (los gastos son información sensible del negocio). El registro hace 3 pasos: inserta el gasto (guardando en `metodo_pago` el **nombre** de la cuenta usada), descuenta el saldo de la cuenta y registra el egreso en `transacciones` con `referencia_id = gasto_id`. Así el gasto aparece tanto en su listado propio como en el desglose del día de la caja (§3.2).

> **Matiz:** son 3 statements secuenciales (no batch) — si fallara a mitad podría quedar un gasto sin transacción. Misma observación de asimetría que el cierre de caja.

---

## 6. Cuentas por pagar — pago a proveedores (`POST /api/cuentas-por-pagar`)

La deuda nace automáticamente con cada compra (doc [09 §3](./09-compras-inventario-mermas.md): total de la carga; el vencimiento usa el **`plazo_pago_dias` del proveedor** — editable en su ficha, default 30, desde el 10 jul 2026). El pago es **admin-only**, acepta **`fechaPago` retroactiva** (se persiste en `transacciones.fecha`) y valida ANTES de mover dinero:

- Que la deuda exista y tenga saldo restante (`monto_deuda − monto_pagado > 0`); tolerancia de S/ 0.01 para flotantes.
- Que el pago no supere el restante.
- Que la cuenta de origen exista, esté activa y tenga **fondos suficientes** (`saldo >= montoPago`).

El movimiento en sí es un **CTE triple atómico**: actualiza la deuda (estado `'Pagado'` si quedó cubierta, `'Parcial'` si no), descuenta el saldo de la cuenta bancaria y registra el egreso en `transacciones` con concepto `"Pago a Proveedor: <razón social> (Doc: <nro>) - <notas>"` — los tres efectos en un solo statement.

---

## 7. DECISIÓN DE NEGOCIO: las cobranzas NO pasan por la caja (Hugo, 5 jul 2026)

Los cobros de las carteras (Ejecutivas en `facturas` y Planta en `cobranzas_planta`) llegan casi siempre por **transferencia bancaria o Yape directo a las cuentas de Antonio**, no en efectivo por la planta. Por eso, registrar el pago de una cobranza NO crea automáticamente una transacción de tesorería.

**Es deliberado, no es un bug.** Duplicar esos cobros en la caja física inflaría el arqueo con dinero que nunca pasó por el cajón. La conciliación de las cuentas bancarias reales se hace fuera del sistema (extracto del banco/Yape).

Consecuencia conocida: el efectivo que un repartidor cobra en ruta tampoco entra al sistema hoy — la **"liquidación de ruta" (rendición del motorizado al volver) quedó como diseño futuro** en el backlog del doc [18](./18-plan-implementacion-maestro.md), y de hecho está descartada por ahora porque el repartidor casi no cobra efectivo.

---

## 8. Qué dinero registra el sistema (y qué queda fuera)

| Movimiento | ¿Toca tesorería (`transacciones` + saldo)? | Dónde |
|---|---|---|
| Venta POS al **contado** | ✅ Ingreso a la cuenta elegida (CTE atómico) | `POST /api/pos` |
| Venta POS a **crédito** | ❌ Crea deuda propia en `cobranzas_planta`; el dinero entra cuando se pague y ese pago no toca caja automáticamente | `POST /api/pos` |
| Apertura de caja | ✅ Fija el saldo de "Caja Efectivo Planta" + ingreso `'Apertura de Caja'` | `POST /api/caja-diaria` |
| Cierre de caja | ✅ Sincroniza el saldo al efectivo REAL contado (arqueo) | `PUT /api/caja-diaria` |
| Gasto operativo | ✅ Egreso de la cuenta elegida | `POST /api/gastos` |
| Pago a proveedor (CxP) | ✅ Egreso con validación de fondos | `POST /api/cuentas-por-pagar` |
| Movimiento manual | ✅ Ingreso/egreso libre con concepto | `POST /api/transacciones` |
| **Cobro de una cobranza** de Ejecutivas/Planta | ❌ **DELIBERADO** — va por transferencia/Yape fuera de la caja física (§7) | APIs de pago de cada cartera |
| Venta de pedido normal (asesora + reparto) | ❌ El dinero entra vía cobranza (fila anterior) | — |
| Efectivo cobrado por el repartidor en ruta | ❌ Fuera del sistema — liquidación de ruta = diseño futuro (doc 18) | — |
| Préstamos de mercadería | ❌ NUNCA dinero — en especie (doc [09 §8](./09-compras-inventario-mermas.md)) | `prestamos_*` |

---

## 9. Mapa rápido de endpoints de dinero

| Endpoint | Método | Roles | Efecto |
|---|---|---|---|
| `/api/pos` | POST | admin+produccion | Venta de mostrador atómica (pedido + stock + kardex + cobro/deuda) |
| `/api/caja-diaria` | GET / POST / PUT | sesión / admin+produccion | Estado en vivo / apertura atómica (409 si ya hay abierta) / cierre con arqueo |
| `/api/cuentas` | GET / POST | sesión / admin | Listar / crear cuentas de tesorería |
| `/api/transacciones` | POST | admin | Movimiento manual atómico por CTE |
| `/api/gastos` | GET / POST | admin+produccion | Gastos con egreso en la cuenta de origen |
| `/api/cuentas-por-pagar` | GET / POST | admin | Deudas con proveedores / pago con CTE triple y validación de fondos |

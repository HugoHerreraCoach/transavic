# 10 — POS de Planta, Caja Diaria y Tesorería (Expansión ERP 2026)

> **Última verificación contra código:** 2026-07-05
> **Commit del proyecto:** `9f29f5a` (los módulos de este documento viven como código local aún sin commit a `main`; operan contra la rama Neon `dev-hugo` — ver [20-migracion-produccion.md](./20-migracion-produccion.md) para el despliegue)
> **Archivos clave:** `src/app/api/pos/route.ts`, `src/app/api/caja-diaria/route.ts`, `src/app/api/cuentas/route.ts`, `src/app/api/transacciones/route.ts`, `src/app/api/gastos/route.ts`, `src/app/api/cuentas-por-pagar/route.ts`, `src/app/dashboard/pos-planta/pos-client.tsx`, `scripts/migrate-caja-unica-abierta.sql`

Este documento describe la venta de mostrador en planta (POS), el ciclo de la caja física del día (apertura → movimientos → cierre con arqueo) y la tesorería simple de cuentas (`cuentas_bancarias` + `transacciones`). Cierra con la tabla de **qué dinero registra el sistema y cuál queda deliberadamente fuera**.

---

## 1. El POS de planta (`/dashboard/pos-planta`)

Durante el día, en la planta se vende al paso: menudencia, hígado, molleja, patas, pollos enteros, saldos. Son ventas que **no pasan por asesora, ruta ni repartidor** — regla de negocio: registrarlas en menos de 20 segundos (doc [18](./18-plan-implementacion-maestro.md), Fase 3).

- **Roles:** solo `admin` y `produccion`. El guard está en dos capas: `page.tsx` redirige a `/dashboard` si el rol no corresponde, y `POST /api/pos` devuelve 403.
- **Catálogo precargado:** el server component consulta los `productos` activos y los pasa como `productosInit` al cliente (filtros por categoría y búsqueda en memoria).
- **Offline:** la venta usa la **misma cola offline del repartidor** (`transavic_offline_queue`, regla 11 del doc 18). `pos-client.tsx` encola acciones tipo `"pos-venta"` con `enqueueAction()` cuando no hay conexión (o cuando el POST falla por red), y `offline-queue.ts` las sincroniza contra `/api/pos` al volver el internet.
- **Aislamiento comercial:** el pedido nace con `origen = 'pos_planta'`, lo que lo **excluye del ranking y los bonos de las asesoras** (regla 7 del doc 18; la métrica de ventas filtra por origen).

---

## 2. `POST /api/pos` — la venta de mostrador es UNA transacción

### 2.1 Validación (zod con `refine` cruzado)

```ts
const PosSaleSchema = z.object({
  empresa: z.enum(["Transavic", "Avícola de Tony"]),
  items: z.array(PosItemSchema).min(1),
  tipo_pago: z.enum(["Contado", "Credito"]),
  cuenta_id: z.string().uuid().optional().nullable(),
  cliente_id: z.string().uuid().optional().nullable(),
  notas_generales: z.string().optional().nullable(),
}).refine((data) => {
  if (data.tipo_pago === "Contado" && !data.cuenta_id) return false;
  if (data.tipo_pago === "Credito" && !data.cliente_id) return false;
  return true;
}, { message: "Debe seleccionar una cuenta bancaria/caja para pagos al Contado, o un cliente registrado para ventas al Crédito.", path: ["cuenta_id"] });
```

La regla cruzada: **contado exige `cuenta_id`** (a qué caja/cuenta entra el dinero) y **crédito exige `cliente_id`** (a quién se le fía — no se fía a desconocidos).

### 2.2 La transacción atómica

Todos los efectos van en un solo `sql.transaction([...])`; el `pedido_id` se genera con `crypto.randomUUID()` porque el batch del driver HTTP de Neon no permite encadenar `RETURNING`. Un fallo a mitad no puede dejar un pedido sin stock descontado ni una venta sin cobro/cobranza.

1. **Pedido:** `INSERT INTO pedidos` con `origen='pos_planta'`, **estado `'Entregado'` directo** (no pasa por la máquina de estados de reparto), `fecha_pedido` = hoy Lima, `detalle`/`detalle_final` derivados del carrito (`"2 kg Molleja (limpia), ..."`), `entregado_por` = nombre del usuario POS, `lat/lng` NULL (no hay ruta).
2. **Asesor en cascada:** si la venta es a un cliente del directorio, `asesor_id` toma `clientes.asesor_id` (la cartera se respeta); si no, el usuario del POS.
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

5. **Deuda (Crédito):** en lugar de tocar tesorería, inserta la cobranza en `facturas` con `numero_comprobante = 'POS-CREDITO'`, estado `Pendiente` y vencimiento = hoy + `clientes.plazo_pago_dias`.

> **Matiz vs. la regla "la cobranza la crea SOLO la emisión del comprobante"** (decisión de Antonio, jun 2026 — doc [13](./13-cobranzas-facturas.md)): esa regla gobierna el flujo de pedidos normales. La venta POS **a crédito** crea su cobranza interna directamente (`POS-CREDITO`) porque no hay comprobante SUNAT de por medio; es deuda de mostrador que igual hay que cobrar.

> **Nota sobre el descuento de inventario del POS:** a diferencia de compras/ajustes (upsert `ON CONFLICT`), el POS hace `UPDATE` directo — asume que la fila de `inventario_lotes` existe (la migración consolidada siembra todas en 0). El kardex sí se inserta siempre.

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

- **`GET /api/cuentas`** (sesión): lista todas las cuentas con saldo. **`POST`** (solo `admin`): crea cuentas dinámicamente (regla 9 del doc 18 — Efectivo, BCP, Yape, etc.), siempre con saldo 0.
- **`POST /api/transacciones`**: movimiento manual de dinero (ingreso/egreso) sobre una cuenta. Es **atómico por CTE**: el `UPDATE` del saldo y el `INSERT` del ledger van en un solo statement — si la cuenta no existe, el CTE no devuelve filas y no se inserta nada (404).

```sql
WITH update_cuenta AS (
  UPDATE cuentas_bancarias
  SET saldo = saldo + CASE WHEN ${tipo} = 'ingreso' THEN ${monto} ELSE -${monto} END, ...
  WHERE id = ${cuenta_id}
  RETURNING id
)
INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
SELECT id, ${usuario_id}, ${tipo}, ${monto}, ${concepto}, ${referencia_id || null}
FROM update_cuenta
RETURNING *;
```

**Pendientes menores detectados (válidos, anotados a propósito):**
1. `POST /api/transacciones` hoy solo exige **sesión** (401), sin check de rol — el resto de endpoints de dinero scopea `admin`/`produccion`. Alinear cuando se toque el módulo.
2. El zod de `POST /api/cuentas` solo acepta `tipo: "banco" | "efectivo"`, pero el seed de la migración crea cuentas tipo `'billetera'` (Yape). Crear una billetera nueva desde la UI hoy obliga a marcarla como banco.

---

## 5. Gastos — `POST /api/gastos`

Roles: `GET` y `POST` solo `admin`/`produccion` (los gastos son información sensible del negocio). El registro hace 3 pasos: inserta el gasto (guardando en `metodo_pago` el **nombre** de la cuenta usada), descuenta el saldo de la cuenta y registra el egreso en `transacciones` con `referencia_id = gasto_id`. Así el gasto aparece tanto en su listado propio como en el desglose del día de la caja (§3.2).

> **Matiz:** son 3 statements secuenciales (no batch) — si fallara a mitad podría quedar un gasto sin transacción. Misma observación de asimetría que el cierre de caja.

---

## 6. Cuentas por pagar — pago a proveedores (`POST /api/cuentas-por-pagar`)

La deuda nace automáticamente con cada compra (doc [09 §3](./09-compras-inventario-mermas.md): total de la carga, vencimiento a 30 días). El pago es **admin-only** y valida ANTES de mover dinero:

- Que la deuda exista y tenga saldo restante (`monto_deuda − monto_pagado > 0`); tolerancia de S/ 0.01 para flotantes.
- Que el pago no supere el restante.
- Que la cuenta de origen exista, esté activa y tenga **fondos suficientes** (`saldo >= montoPago`).

El movimiento en sí es un **CTE triple atómico**: actualiza la deuda (estado `'Pagado'` si quedó cubierta, `'Parcial'` si no), descuenta el saldo de la cuenta bancaria y registra el egreso en `transacciones` con concepto `"Pago a Proveedor: <razón social> (Doc: <nro>) - <notas>"` — los tres efectos en un solo statement.

---

## 7. DECISIÓN DE NEGOCIO: las cobranzas NO pasan por la caja (Hugo, 5 jul 2026)

Los cobros de las cobranzas (tabla `facturas`, doc [13](./13-cobranzas-facturas.md)) llegan casi siempre por **transferencia bancaria o Yape directo a las cuentas de Antonio**, no en efectivo por la planta. Por eso, **marcar una factura como pagada (`POST /api/facturas/[id]/pago`) NO crea ninguna transacción en la tesorería** — verificado en código: ese endpoint registra fecha, método (`efectivo/transferencia/yape/plin/otro`), notas y vouchers, pero no toca `transacciones` ni `cuentas_bancarias`.

**Es deliberado, no es un bug.** Duplicar esos cobros en la caja física inflaría el arqueo con dinero que nunca pasó por el cajón. La conciliación de las cuentas bancarias reales se hace fuera del sistema (extracto del banco/Yape).

Consecuencia conocida: el efectivo que un repartidor cobra en ruta tampoco entra al sistema hoy — la **"liquidación de ruta" (rendición del motorizado al volver) quedó como diseño futuro** en el backlog del doc [18](./18-plan-implementacion-maestro.md), y de hecho está descartada por ahora porque el repartidor casi no cobra efectivo.

---

## 8. Qué dinero registra el sistema (y qué queda fuera)

| Movimiento | ¿Toca tesorería (`transacciones` + saldo)? | Dónde |
|---|---|---|
| Venta POS al **contado** | ✅ Ingreso a la cuenta elegida (CTE atómico) | `POST /api/pos` |
| Venta POS a **crédito** | ❌ Crea cobranza `facturas` (`POS-CREDITO`); el dinero entra cuando se pague — y ese pago tampoco toca caja (fila de abajo) | `POST /api/pos` |
| Apertura de caja | ✅ Fija el saldo de "Caja Efectivo Planta" + ingreso `'Apertura de Caja'` | `POST /api/caja-diaria` |
| Cierre de caja | ✅ Sincroniza el saldo al efectivo REAL contado (arqueo) | `PUT /api/caja-diaria` |
| Gasto operativo | ✅ Egreso de la cuenta elegida | `POST /api/gastos` |
| Pago a proveedor (CxP) | ✅ Egreso con validación de fondos | `POST /api/cuentas-por-pagar` |
| Movimiento manual | ✅ Ingreso/egreso libre con concepto | `POST /api/transacciones` |
| **Cobro de una cobranza** (factura marcada pagada) | ❌ **DELIBERADO** — va por transferencia/Yape fuera de la caja física (§7) | `POST /api/facturas/[id]/pago` |
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
| `/api/transacciones` | POST | sesión (pendiente scopear) | Movimiento manual atómico por CTE |
| `/api/gastos` | GET / POST | admin+produccion | Gastos con egreso en la cuenta de origen |
| `/api/cuentas-por-pagar` | GET / POST | admin | Deudas con proveedores / pago con CTE triple y validación de fondos |

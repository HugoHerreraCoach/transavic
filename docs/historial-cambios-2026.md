# Historial de cambios 2026 — Transavic

> **Qué es este archivo:** el texto ÍNTEGRO que antes vivía en `CLAUDE.md` (gotchas detallados
> 18–31 y todas las crónicas del "Estado del proyecto"). Se movió aquí el 11 jun 2026 para que
> `CLAUDE.md` quede compacto (reglas operativas + punteros). **Nada se borró: esto es la fuente
> de verdad histórica** de cómo y por qué se construyó cada cambio (PRs, data-ops, diagnósticos).
> Para reglas vigentes y mapa del sistema: `CLAUDE.md` y `docs/arquitectura/`.

---

## 21 ago 2026 — La compra que no se dejaba anular: cuando la guarda mira un caché y la FK mira la tabla

**Cómo empezó.** Marianela quiso anular una compra del proveedor NATHALY y le apareció
en pantalla, tal cual, el texto del motor de base de datos en inglés:
`update or delete on table "cuentas_por_pagar" violates foreign key constraint
"pagos_proveedores_aplicaciones_deuda_fk"`. La anulación de compras existía desde el
26 jul; lo que falló fue un caso que no contemplaba.

### La causa

Al **anular un pago** a proveedor, `anularPagoProveedor` marca el pago como `anulado`,
hace el contraasiento en caja y recalcula el caché `cuentas_por_pagar.monto_pagado`
filtrando `p.estado='registrado'` → vuelve a **0**. Pero **no tocaba ni una fila** de
`pagos_proveedores_aplicaciones`: era diseño explícito (doc 26, gotcha #50, "un
movimiento financiero no se edita ni se elimina"). Esas filas conservaban su `deuda_id`
y su FK es `ON DELETE RESTRICT`.

Entonces la anulación de compra: su guarda preguntaba por el **caché** (`monto_pagado >
0.009`, ya en 0 → dejaba pasar, y el botón hasta aparecía habilitado), y el
`DELETE FROM cuentas_por_pagar` chocaba con la **tabla real**. **La guarda y la
restricción de la base no medían lo mismo.** El `catch` devolvía `error.message` crudo
con status 500 y el cliente lo pintaba tal cual.

Había un **segundo bloqueador** que se dispara aunque el pago nunca se haya aplicado a
esa deuda: `pagos_proveedores.deuda_prioritaria_id`, con la misma FK RESTRICT, tampoco
se limpiaba nunca.

Y no había **ninguna** salida desde la aplicación: anular, re-anular el pago, editar la
compra, borrar la deuda — los seis caminos terminaban bloqueados. Solo SQL manual.

### El arreglo (commit de hoy)

- **La causa raíz**, en `lib/proveedores/pagos.ts`: al anular un pago se borran sus
  aplicaciones y se limpia `deuda_prioritaria_id`. Va **después** del contraasiento (que
  usa ese puntero como referencia del movimiento) y **antes** del recálculo del caché.
  Seguro: ningún cálculo lee esas filas — los ~12 lugares que las suman filtran por
  `estado='registrado'`.
- **La guarda pasa a medir la tabla, no el caché**: `compras/[id]/anular` pregunta por
  `EXISTS` de aplicaciones de pagos **vivos** y responde 409 con el mensaje que ya
  existía. Además limpia el rastro de pagos anulados antes del DELETE, para no depender
  del script de arrastre.
- **`src/lib/errores-sql.ts`** (puro, 10 tests): traduce el error de Postgres a español
  accionable, reconociendo el constraint incluso cuando el driver de Neon solo trae el
  texto. Se usa en los **cuatro** caminos del módulo. Regla nueva: *el `error.message`
  del motor jamás viaja al cliente* — hoy pasaba en los 4.
- **La ficha** ya no lista el desglose de un pago anulado ni lo suma en `total_aplicado`
  (mostraba montos vivos dentro de una tarjeta rotulada "Anulado" — justo las filas que
  bloqueaban).
- Arrastre histórico: `scripts/limpiar-aplicaciones-pagos-anulados-2026-08-21.sql`,
  idempotente, con diagnóstico antes y verificación después.

### Verificación

Se **reprodujo el error exacto** en `dev-hugo` simulando el estado viejo (pago anulado a
mano sin borrar aplicaciones): Postgres devolvió palabra por palabra el mensaje que vio
Marianela. Con la limpieza del fix aplicada, el `DELETE` de la deuda pasa y el pago
anulado se conserva intacto; la prueba corrió dentro de una transacción con `ROLLBACK`,
así que dev quedó igual. Confirmado además que con un pago **vivo** la guarda nueva
devuelve `true` (bloquea con el 409 amable). `tsc` limpio, 180 tests.

### Decisión de negocio

Se pierde a propósito el desglose "a qué documentos se había aplicado" de un pago
anulado. Se conservan el pago, su monto, quién lo anuló, cuándo, el motivo y el
contraasiento en caja. La alternativa (marcar las filas en vez de borrarlas) exigía
migración y revisar una docena de consultas, con más riesgo de que alguna quedara sin
filtrar.

### Aplicado a producción (21 ago 2026)

El script de limpieza corrió con respaldo CSV previo: **12 aplicaciones liberadas** de 5
pagos anulados, sobre 11 deudas de dos proveedores (CAROL S/ 10 139.40 y NATHALY
S/ 700.00). Quedaron 0 aplicaciones y 0 punteros huérfanos, y la verificación de cierre
dio **0 deudas con el caché descuadrado**: ningún saldo, caja ni inventario se movió.

Dos correcciones al script antes de que corriera: la columna del proveedor es
`razon_social` (no `nombre`), y el `BEGIN/COMMIT` explícito sobra porque se ejecuta con
`psql -1`, que ya envuelve todo en una transacción ("there is already a transaction in
progress"). El primer intento abortó por `ON_ERROR_STOP` sin tocar una sola fila.

⚠️ **Matiz sobre el caso original:** entre la captura de Marianela y la limpieza, la
deuda de S/ 341.55 recibió dos pagos **vivos** (S/ 200.00 el 14/08 y S/ 141.55 el 19/08),
así que hoy figura pagada. Si intenta anular esa compra le saldrá — correctamente — el
409 pidiendo revertir primero los abonos. Eso ya no es el bug: es la regla de negocio
funcionando, ahora con un mensaje en español en vez del error del motor.

### Queda anotado

`compras/[id]/route.ts` hace `UPDATE cuentas_por_pagar SET proveedor_id = …` al editar
una compra. Como la FK es compuesta `(deuda_id, proveedor_id)`, cambiar el proveedor de
una compra con cualquier aplicación viva fallará igual — ahora al menos con un mensaje
entendible en vez del crudo.

---

## 20 ago 2026 — Yali puede cambiar precios: el primer permiso por usuario (no por rol)

**Qué pidió Antonio.** Que **Yali**, una asesora de ventas, sea la única (además de él) que
pueda cambiar los precios, y que el admin **elija desde el modal de usuarios** quién tiene
ese permiso — no cablearlo al código ni dárselo a todas las asesoras.

**Decisiones tomadas con Hugo:** alcance = solo el **precio de venta del catálogo** (no
aprobar autorizaciones de precio bajo); Antonio **conserva** el permiso; Yali **no ve** el
costo ni el margen; **sin piso de costo** (puede poner el precio que quiera, incluso bajo
costo — libertad para ofertas).

### Los dos hallazgos que condicionaron el diseño

1. **El precio de catálogo ES el precio mínimo.** No existe columna `precio_minimo`: el
   piso que dispara las autorizaciones sale de `productos.precio_venta`
   (`lib/autorizaciones-precio.ts:85-91`). O sea que **quien cambia el precio de lista mueve
   el piso de todo el equipo**. Quedó advertido en el `window.confirm` (para todos, también
   para Antonio) y en el texto del permiso.
2. **`PATCH /api/productos/[id]` edita mucho más que el precio**: acepta `precio_compra`,
   `nombre`, `codigo`, `categoria`, `activo`… en el mismo body. Ampliar el guard del rol le
   habría dado a Yali el **costo** y la baja de productos. Por eso el permiso terminó siendo
   **por campo**, no por endpoint.

### Cómo quedó

- **`users.puede_editar_precio_venta`** (migración `migrate-permiso-precio-venta-2026-08-20.sql`),
  réplica exacta del patrón `solo_lectura`: viaja en el JWT ⇒ **aplica al próximo login**;
  `src/auth.ts` no se tocó porque usa `SELECT *`. Se llama `precio_venta` y no "precios" a
  propósito, para que nadie meta el costo bajo el mismo permiso.
- **`src/lib/permisos-precios.ts`** (nuevo, puro, 10 tests) — `evaluarEdicionCatalogo(sesion, campos)`:
  admin = `alcance:"total"`; asesora con bandera y solo `precio_venta` = `"solo_precio_venta"`;
  cualquier otro campo → 403 **nombrándolo**; rol distinto de `asesor` con la bandera encendida
  (dato viejo tras un cambio de rol) → 403. Fail-closed. Es el **primer guard por endpoint del
  proyecto**: hasta ahora el único patrón de permiso era el middleware (`solo_lectura`).
- **Fuga de costo tapada**: el `RETURNING` del PATCH devolvía `precio_compra` y el cliente hace
  `{...p, ...data}` — se devuelve `null` a quien no es admin, mismo criterio que el GET.
- **UI**: `isAdmin` (costo, margen, historial, alta, baja) quedó **separado** de
  `puedeEditarPrecioVenta` (solo la celda de precio de venta). Se agregó **edición inline en la
  tarjeta MÓVIL**, que no existía para nadie: el admin usaba el modal completo, que una asesora
  no puede abrir — sin eso el permiso no le servía en el teléfono, que es donde trabaja.
- **Coherencia con el rol en 3 capas**: el modal manda `false` si el rol no es asesora; el PATCH
  de usuarios la apaga si el rol cambia; y el helper la ignora si el rol no es `asesor`.

### De paso: el catálogo estaba abierto sin login

`GET /api/productos` calculaba `esAdmin` de una sesión **opcional** y seguía aunque no hubiera
ninguna: la lista completa **con precios de venta** se respondía a cualquiera sin iniciar sesión
(el middleware solo protege `/dashboard`). El `CLAUDE.md` afirmaba lo contrario. Se agregó el
401. Verificado antes de tocarlo que los 8 consumidores están todos dentro del dashboard (o en
`ProductSelector`), y que la raíz `/` redirige a `/dashboard/nuevo-pedido`: no había ninguna
página pública que dependiera del hueco.

### Consecuencia a tener presente

Cuando Yali cambie su primer precio queda como autora en `precios_productos.created_by`, y
`DELETE /api/users/[id]` bloquea con 409 a cualquiera con historial: **a partir de ahí solo se
la puede desactivar, no borrar**. Es lo correcto (la auditoría manda), pero conviene saberlo.

### Lo que NO entró (anotado para después)

- `produccion` mueve `productos.precio_compra` al registrar compras, sin histórico ni auditoría
  (`api/compras/route.ts:239`).
- `produccion` puede reescribir el precio de venta de un pedido al pesar, **sin piso ni rastro**
  (`produccion/pedidos/[id]/pesos/route.ts:87-103`): el bypass más silencioso del sistema de
  autorizaciones.
- POS de planta y ventas de campo: precio libre, sin piso.
- Los `@deprecated` `/api/precios` y `/api/precios/[id]` siguen expuestos (admin-only). Si algún
  día se amplían, su guard tiene que pasar por el mismo helper.

---

## 20 ago 2026 — Los avisos de "motorizado en destino" perseguían pedidos ya entregados

**Cómo empezó.** La misma asesora que reportó las boletas mandó un segundo audio: *"este
cliente ayer se atendió y la notificación me está llegando hoy día… y así con varios
clientes, los pedidos que ya se entregaron ayer o antes de ayer me siguen llegando las
notificaciones, y eso a veces confunde"*.

### Lo que NO estaba pasando

No se re-creaban. `POST /api/repartidor/ubicacion` solo considera pedidos `En_Camino`
**de hoy**, con claim atómico (`WHERE notificado_llegada = FALSE AND estado='En_Camino'
RETURNING`) y descarta pings con `capturedAt` de más de 120 s. Los pings GPS tampoco
pasan por la offline-queue (sus tipos son entregar/fallido/iniciar-viaje/subir-foto/
pos-venta). El productor del gotcha #69 está correcto: **es imposible generar hoy una
alerta de un pedido de ayer**.

### Lo que sí pasaba: nadie apagaba la alerta, y el popup la resucitaba

Tres piezas se sumaron:

1. **Una notificación no leída no caduca nunca.** `limpiarNotificacionesAntiguas` borra
   solo `leida = TRUE` — correcto para no tragarse pendientes reales, pero nadie cerraba
   la alerta de arribo cuando el pedido salía de `En_Camino`. Entregar creaba una
   notificación *nueva* (`pedido_entregado`) y dejaba viva la de arribo.
2. **`ArriboPopup` no filtraba por antigüedad ni por estado del pedido**: cualquier
   arribo no leído del top-30 volvía a ocupar la pantalla completa.
3. **Su anti-repetición vivía en `sessionStorage`**, que muere al cerrar la pestaña. En
   celular cada apertura desde un enlace de WhatsApp es sesión nueva → el backlog entero
   volvía a desfilar, uno cada 15 s (el popup toma `alertasArribo[0]`, así que al cerrar
   uno aparecía el siguiente: el "me sigue llegando").

Y una asimetría que empeoraba todo: el botón gris "Cerrar" sí marcaba leída, pero **la ✕
y Escape solo escribían en `sessionStorage`** — el gesto más natural dejaba la alerta
viva para siempre.

### El bug visual que empujaba a usar la ✕

El botón principal usaba **`bg-emerald-650`** (y `bg-indigo-650`). Esos tonos **no
existen** en Tailwind v4 ni están definidos en el `@theme` de `globals.css`, así que la
clase no genera CSS: el botón quedaba **sin fondo, con `text-white`**, invisible sobre el
modal blanco. En la captura que mandó la asesora se ve como **un campo de texto vacío**
al lado de "Cerrar" — no sabía cuál era la acción correcta. Verificado en local
renderizando ambas variantes lado a lado: con `-650` salen dos rectángulos vacíos; con
`-600`, los botones verde e índigo con su texto. **Tailwind no avisa cuando el tono está
fuera de la escala: simplemente no pinta.**

### El arreglo (commit `8669372`, en producción el 20 ago)

- **`cerrarAlertasArriboDePedido(pedidoId)`** en `lib/notificaciones.ts`: marca leídas
  las alertas de arribo pendientes del pedido. La llaman las cuatro transiciones que lo
  sacan de `En_Camino` (entregar/fallar, revertir entrega, cancelar viaje, reprogramar
  cuando resetea el reparto). Best-effort e idempotente (la offline-queue repite el POST).
- **`avisoArriboVigente()`** en `lib/eta-reparto.ts` (puro, 7 tests): el popup solo
  interrumpe con avisos de la última hora (`VIGENCIA_POPUP_ARRIBO_MS`); fuera de eso
  quedan en la campana. Fecha inválida o futura = no vigente (fail-safe). La
  reprogramación conserva su persistencia: es agenda, no un evento que se agota.
- **✕ y Escape** ahora descartan de verdad el arribo (marcan leído); si el PATCH falla,
  el popup igual se cierra en la sesión en vez de quedarse trabado.
- El popup **muestra la antigüedad** del aviso, como ya hacía la campana.
- **`PATCH /api/notificaciones/[id]/leida`** devolvía 200 aunque no actualizara nada (id
  parseado a mano del pathname, sin `::uuid` ni `RETURNING`): ahora valida el UUID, usa
  `params` y responde 404 si no tocó ninguna fila.
- Backlog histórico: **`scripts/cerrar-alertas-arribo-huerfanas-2026-08-20.sql`**
  (idempotente, acotado: solo arribos no leídos cuyo pedido ya no está `En_Camino`; una
  alerta de un reparto vivo no se toca). **Pendiente de aplicar a producción por psql.**

Verificación: `tsc --noEmit` limpio, 160/160 tests, y el render de los botones
comprobado en el dev server. Regla que queda: *el popup interrumpe solo con lo que está
pasando; lo demás vive en la campana.*

### Postdata: la revisión adversarial encontró el camino que faltaba (commit `5cfdd3e`)

Tras desplegar se corrió una revisión multi-agente sobre el propio commit (4 dimensiones
— SQL, flujos, UI, endpoint/data-op — y cada hallazgo pasado por un verificador
instruido para refutarlo). De 28 agentes salieron **3 hallazgos confirmados, todos el
mismo y ninguno crítico ni alto**: `cerrarAlertasArriboDePedido` se cableó en cuatro
sitios pero **faltaba en el PATCH genérico `/api/pedidos/[id]`**, que es el camino de
`table.tsx:executeDelivery` ("Entregar" desde la lista del dashboard) y de
`despacho-content.tsx:handleDesasignar`. Es decir: el invariante no se cumplía
justamente por la vía que usa la asesora cuando el motorizado no marca la entrega desde
su app — el caso original del reporte. Sin eso, el filtro de vigencia tapaba el síntoma
pero el backlog de filas huérfanas se seguía acumulando y la data-op habría que
repetirla.

El verificador refutó dos partes del hallazgo que vale registrar: (a) **no** hace falta
resetear `notificado_por_llegar`/`notificado_llegada` en ese PATCH — el único camino a
`En_Camino` es `/iniciar-viaje`, que ya los limpia en cada viaje, y el claim de
`/api/repartidor/ubicacion` exige `estado='En_Camino'`, así que un flag huérfano no puede
disparar ni suprimir nada; (b) la severidad no es alta porque toda vía de descarte del
popup ya marca leído. El fix quedó en 3 líneas, con la condición evaluada en JS
(gotcha #45c) y dentro del bloque que aplicó el UPDATE, para no cerrar jamás la alerta
de un reparto vivo.

---

## 19-20 ago 2026 (noche) — Credenciales de Consulta Integrada creadas: las 9 boletas atascadas de Avícola por fin hablaron

**Cómo empezó.** Yesica reenvió el mismo síntoma del 11 ago (B002-318/319 "no las acepta SUNAT
y no puedo eliminarlas; necesito subir los pagos"). Esta vez se ejecutó el pendiente no-código
del 11 ago: crear la app de **Consulta de Validez de Comprobantes** en SOL del RUC 10.

### 1) La credencial: creada, validada y en producción la misma noche

- Con la sesión SOL de Antonio abierta (RUC 10), se navegó **Comprobantes de pago → Consulta de
  Validez de Comprobante de Pago → Credenciales de API SUNAT** (en el RUC 10 el bloque cuelga de
  "Personas"), se pulsó **HABILITAR** (sale un `confirm()` nativo del navegador — lo aceptó Hugo)
  y se registró la app **"AVICOLA ERP CONSULTA CPE"** (URL `https://app.transavic.com`).
  Runbook completo con las trampas del portal: [doc 11 §"Credenciales REST de boletas"](./arquitectura/11-comprobantes-sunat.md).
- ⚠️ Trampa cazada en vivo: la entrada de menú raíz **"Credenciales de API SUNAT → Gestión…"**
  es OTRA pantalla (registro unificado con checkboxes por API) y ahí vive la app de **GRE**
  ("TRANSAVIC ERP", `1fcf156c-…`). No se tocó. El registro de Consulta es aparte y nació vacío.
- La credencial se validó con `curl` ANTES de subirla (token OK al instante, sin la espera de
  propagación que tuvieron las GRE) y hasta se consultó `validarcomprobante` a mano:
  B002-318 y 319 → `estadoCp: 0` (NO EXISTEN). Coincide con lo que Antonio vio en SOL
  (Consulta de envíos del 06/08: entraron 316, 317, 320 y las dos facturas; 318/319 jamás).
- `SUNAT_AVI_CONSULTA_CLIENT_ID/SECRET` cargadas en Vercel (Sensitive) + copiadas a
  `.env.local` y `CREDENCIALES-PRODUCCION.local.md`; deploy vía commit de docs (`07f6e6c`).
  **Las `SUNAT_TRA_CONSULTA_*` del RUC 20 siguen pendientes** (misma receta, clave SOL de Transavic).

### 2) Qué dijo SUNAT de las 9 (todas resueltas con "Verificar ahora" esa misma noche)

| Boleta | Grupo (11 ago) | Resultado REAL | Estado final |
|---|---|---|---|
| 225, 226 (Milagros Olortegui), 230 (Norma Bedoya), 233 (Joel Arenas) | A (con reemplazos 244/235/239 aceptados) | **ACEPTADAS** — la falla 0130/0133 fue "a medias": SUNAT respondió error pero SÍ registró | `aceptado` → ⚠️ **dobles/triple emisión fiscal confirmada** (la venta de Milagros tiene 3 boletas vivas: 225+226+244). Cuadro para el contador → NC. **Nadie debe emitir nada más ahí.** |
| 284 (Lucero Vega) | B | **ACEPTADA** | `aceptado`, limpia (sin reemplazo) |
| 315 (Yali), 318, 319 (Yesica), 274 (Saraí) | B | **NO EXISTEN** (doble consulta ≥5 min confirmada) | `no_registrado`; a la 315 se le probó "Reintentar mismo número" y SUNAT lo **rechazó**: *"Solo puede enviar el comprobante en un resumen diario — Presentación fuera de fecha (5 días)"* → quedó `rechazado` (número liberado formalmente) |

### 3) Regla nueva aprendida de SUNAT: el canal individual de boletas caduca a los 5 días

`sendBill` de una boleta solo se acepta **hasta 5 días** después de su `IssueDate`; pasado eso,
SUNAT exige el **Resumen Diario** de ese día (extemporáneo). Implicancias:
- El reintento con el mismo número solo funciona si la boleta se destraba **dentro de esos 5 días**
  — con las credenciales ya puestas, la reconciliación resuelve en minutos/horas, así que los
  futuros `por_confirmar` de Avícola SÍ llegan a tiempo. El limbo de semanas era exclusivamente
  por la credencial faltante.
- Para las 4 no-registradas viejas la salida práctica es **boleta NUEVA con fecha de hoy**
  (misma serie, número siguiente): decisión de Hugo (20 ago) — a las 2 de Yesica (318/319) el
  admin les corrió el reintento formal ahí mismo (SUNAT las rechazó "fuera de fecha" → quedaron
  `rechazado`, número liberado) para que a ella le quede UN solo paso: emitir la boleta nueva
  desde el pedido (instrucción enviada); **315 ya estaba `rechazado` y 274 queda quieta** hasta
  hablar con el contador (es del 26/07: mes cerrado, la re-emisión cruzaría el período).

### 4) Pendientes que deja esta noche

1. **Verificar en la mañana** (cron abre a las 05:00) que el postproceso creó las cobranzas
   retroactivas de las 5 aceptadas — a las 00:30 aún no existían filas en `facturas` para
   Lucero ni para la venta de jul de Milagros. Si a media mañana no están: revisar
   `sunat_postproceso_estado` de esos 5 comprobantes.
2. **Cuadro de dobles para el contador**: 225+226+244 (Milagros), 230+235 (Norma), 233+239 (Joel)
   — decidir NCs. No emitir nada sobre esos pedidos mientras tanto.
3. **Crear `SUNAT_TRA_CONSULTA_*`** (RUC 20) con la misma receta del doc 11.
4. `sunat_revision_motivo` conserva el texto viejo de "credenciales faltantes" en filas ya
   resueltas (solo cosmético: el detalle de la UI lo muestra como "detalle técnico").
5. Sigue pendiente **rotar la clave de Neon** filtrada (11 ago) — más urgente que todo lo anterior.

---

## 11 ago 2026 (noche) — Boletas atascadas de Avícola, el Resumen Diario que nunca corrió, y una clave de producción en un repo público

**Cómo empezó.** Operación reportó 2 boletas de Avícola (B002-318 y B002-319, del 6 ago) que "no
las acepta SUNAT y tampoco se pueden eliminar". El botón *Verificar ahora* devolvía un aviso de
credenciales faltantes. Al investigar aparecieron **tres** cosas, dos de ellas no reportadas.

### 1) Las boletas atascadas: son 9, no 2 — y el candado del 20 jul funcionó

La pantalla estaba filtrada. En producción hay **9 boletas `por_confirmar`, todas de Avícola**
(RUC 10), desde el 15 jul. Los mensajes guardados son fallas **internas de SUNAT**, no rechazos:
`0130` "No se pudo obtener el ticket de proceso – Error 422", `0133` "No se pudo grabar la entrada
del log" (¡con ticket `202621530992392` ya asignado!) y `0140` "Existe un Documento igual en
Proceso". El XML nuestro estaba bien: boletas del mismo día, minutos antes y después
(B002-316 09:11, B002-317 09:26), salieron `aceptado` con código `0`.

**Hallazgo clave — las 9 se parten en dos grupos por el 20 jul** (deploy del candado anti-duplicado):

| Grupo | Boletas | ¿Tiene reemplazo aceptado? |
|---|---|---|
| **A — pre-fix** (15-16 jul) | 225, 226, 230, 233 | **Sí**: 244 (para 225 *y* 226, mismo pedido), 239, 235 |
| **B — post-fix** (26 jul–6 ago) | 274, 284, 315, 318, 319 | No |

Antes del candado la asesora podía re-emitir encima y lo hizo; después, ninguna pudo. **El candado
hace exactamente lo que debía.** Pero deja al Grupo A con riesgo fiscal real: si SUNAT aceptó la
atascada *y* su reemplazo, hay dos boletas válidas de la misma venta (el pedido de MILAGROS
OLORTEGUI tiene **tres** comprobantes) → Nota de Crédito. Se resuelve sabiendo qué tiene SUNAT.

**Por qué no se destraban:** una boleta `03` no se puede consultar por el SOAP de facturas (solo
serie F); necesita la API REST *Consulta Integrada*, que exige
`SUNAT_AVI_CONSULTA_CLIENT_ID/_SECRET` — **nunca creadas** (pendientes documentadas desde julio).
El cron reintenta ~4×/día y siempre recibe `CFG_API03`: **B002-225 lleva 75 intentos**. Bucle
cerrado por diseño: esa falta de configuración jamás autoriza otro correlativo.

**Descartado tras verificar:** las 9 no tienen fila en `facturas`, pero **las aceptadas del mismo
día tampoco** (`sunat_postproceso_estado='aplicado'`) — es el comportamiento normal de esta
operación, no hay deuda perdida. Correlativos sin huecos y XML firmado íntegro.

### 2) El Resumen Diario nunca completó una sola corrida (70 días)

Buscando por qué no se puede "eliminar" una boleta —no se anula con Comunicación de Baja, se anula
informándola en el RC con `estadoItem=3`— apareció esto en `resumenes_diarios`:

> **60 filas, TODAS en `enviando`**, desde el 2 jun. Sin ticket, sin XML y **sin mensaje de error**.
> Solo **1 fila de `avicola`** en toda la historia; las otras 59 de `transavic`.

**Causa:** `api/cron/resumen-diario-sunat/route.ts` **no declaraba `maxDuration`** (sus hermanas
`comprobantes/emitir`, `[id]/reintentar` y `guias/emitir` tienen `= 60`). Vercel mataba el handler
por timeout **después** de crear la fila `enviando` y **antes del `catch`** → silencio absoluto.
Y como recorría las dos empresas en serie sin protección, transavic consumía el tiempo y **avicola
casi nunca se ejecutaba**. La branch `dev-hugo` tenía el mismo cuadro (23 filas colgadas).

**Decisión (Hugo): NO reactivar el envío de altas.** Verificado que **las 579 boletas aceptadas
tienen CDR legible** → SUNAT ya las registra una por una vía `sendBill`; declararlas otra vez en un
RC sería una declaración repetida. Además Hugo advirtió que las asesoras pudieron emitir a mano en
el portal, lo que agravaría el duplicado.

**Fix aplicado** (`resumen-diario.ts` + el cron):

- `export const maxDuration = 60`.
- **Modo simulación por defecto**: opción `dryRun` que corta **antes** de consumir correlativo, de
  escribir la fila `enviando` y de llamar a SUNAT; solo cuenta y loguea. Se enciende con
  `SUNAT_RESUMEN_DIARIO_AUTO="true"` (pendiente de confirmar con el contador).
- **`sanearResumenesColgados()`**: las filas `enviando` de más de 15 min pasan a `error` con causa
  explícita. No presume que SUNAT no lo recibió (dice que es indeterminado) y **no reintenta solo**.
- **try/catch por empresa**: un fallo de transavic ya no deja a avicola sin correr.
- **`ESTADOS_BOLETA_EN_RESUMEN` como fuente única**: el envío ya no declara boletas inciertas
  (`por_confirmar`/`emitiendo`/`error`/`no_registrado`) — antes el preview filtraba y el envío no,
  así que la pantalla mostraba menos boletas de las que se habrían mandado. También se alineó la
  fecha (`COALESCE(fecha_emision, created_at)`; el preview usaba solo `created_at` y una boleta
  retroactiva caía en el día equivocado — gotcha #33).

**Verificado E2E en `dev-hugo`:** 401 sin token; saneó las 23 filas colgadas y es idempotente
(segunda corrida = 0); **corren las dos empresas**; con boletas reales devuelve `dryRun:true` y
`boletas:1` por empresa **sin escribir ninguna fila ni consumir correlativo** (0 y 0 comprobados en
DB); y una boleta puesta en `por_confirmar` **desaparece del conteo**. Fixture restaurado.

### 3) La clave de la base de producción, en un repo PÚBLICO

Barriendo el repo apareció que `scripts/check_e_series.mjs`, `compare_by_document.mjs`,
`compare_sales.mjs`, `analyze_differences.mjs` y **`query_db_scratch.mjs`** (5, no 4) llevaban la
cadena de conexión completa a Neon producción —usuario y contraseña— **en texto plano**, desde el
commit `21416a2` del **20 jul 2026**. `HugoHerreraCoach/transavic` es **público**: 22 días expuesta.

Fix (`820ad54`): los 5 leen `DATABASE_URL`/`DATABASE_URL_UNPOOLED` y abortan con mensaje claro si
falta. **Quitarlo del código NO lo borra del historial de Git** → **la contraseña de Neon debe
rotarse** (lo hace Hugo desde la consola; hay que actualizar Vercel y `.env` local). El resto del
barrido salió limpio: las únicas otras coincidencias eran placeholders de `.env.example` y
variables de shell en `create-neon-branch.sh`.

### Pendiente (no es código)

Crear la aplicación **"Consulta de Validez de Comprobantes"** en el portal SOL de cada RUC
(empezando por el 10) y cargar las 4 `SUNAT_*_CONSULTA_CLIENT_*` en Vercel. Es OAuth
`client_credentials` contra `api-seguridad.sunat.gob.pe/v1/clientesextranet/…`, scope
`.../contribuyente/contribuyentes` — **distinta** de la de GRE (`clientessol`), que no se debe
tocar ni rotar. Con eso las 5 del Grupo B se resuelven solas y el Grupo A queda con evidencia para
decidir la NC.

---

## 11 ago 2026 — ETA honesto: "a unos 5 minutos" ya no llega faltando 1 (reporte de operación)

**Síntoma (con captura de Ariana/operación).** La notificación "⏳ Pedido por llegar — el motorizado
está a unos 5 minutos de llegar" aparecía y **~1 minuto después** llegaba "📍 Pedido en destino".
Pasaba con todos los pedidos (caso Kelly Perez / Christian Odría del 11 ago). Además "los tiempos de
la campanita no coinciden con el tiempo transcurrido".

**Diagnóstico (6 causas concurrentes, todas en `src/app/api/repartidor/ubicacion/route.ts:94-165`):**

1. El texto **"5 minutos" estaba hardcodeado** pero la condición disparaba con `durationRemaining <= 5`
   (incluye 0 y 1). Si el motorizado pulsaba "Iniciar viaje" ya cerca del cliente (paradas consecutivas
   del mismo distrito — el caso típico), el PRIMER ping decía "5 minutos" faltando 1.
2. Con `d <= 0.15 km`, `durationRemaining = 0` **cumplía las dos condiciones** → "por llegar" y
   "llegado" salían en el MISMO ping (y el ArriboPopup podía mostrarlas invertidas).
3. **ETA ingenuo**: 3 min/km sobre Haversine EN LÍNEA RECTA (≡ 20 km/h radial, sin factor de ruta).
   La ventana entre umbrales (1.83 km → 0.15 km) una moto la recorre en ~2 min reales, no 5. Peor: el
   ETA REAL de Google Directions calculado en `iniciar-viaje` se PISABA con este modelo al primer
   ping (~12 s después).
4. **Pings rancios**: la cola offline preserva el `capturedAt` original pero la notificación se creaba
   con `NOW()` → "hace 1 min" de algo que pasó hace 10.
5. `LIMIT 1` sin `ORDER BY`: con 2 pedidos `En_Camino` solo se evaluaba uno arbitrario.
6. Flags `notificado_*` con read-modify-write NO atómico: el UPDATE final escribía valores del SELECT
   (stale) y podía **revertir** un flag recién marcado por un ping concurrente → duplicados posibles.

En la UI, `NotificationBell.formatHora` usaba `Math.round` (a los 30 s ya decía "hace 1 min") y no
tenía tick propio (el texto quedaba congelado entre polls). Timezone se descartó: `created_at` es
TIMESTAMPTZ con DEFAULT NOW(), correcto.

**Fix (commit de esta fecha):**

- **`src/lib/eta-reparto.ts`** (NUEVO, puro, con tests): el modelo completo. `calibrarViaje()` deriva
  del Directions que YA se paga en iniciar-viaje un **factor de ruta** (`distanciaRuta/líneaRecta`,
  clamp 1.1–2.2, default 1.3) y una **velocidad efectiva** (clamp 8–45, default 18 km/h), persistidos
  en `pedidos.eta_factor_ruta`/`eta_velocidad_kmh` (migración `migrate-eta-honesto.sql`, NULL = defaults).
  `estimarEtaMin()` los usa en cada ping → **el ETA recalculado es CONTINUO con el de Google por
  construcción** (primer ping ≈ duración Google; verificado E2E: Google 13 min, factor 1.36, 27.58 km/h).
  `decidirAlertasArribo()` es la decisión pura: "por llegar" SOLO con ETA en [2..5] min y mensaje con
  los **minutos reales** ("a unos 4 minutos"); con < 2 min se suprime; "llegado" (≤150 m) excluye
  mutuamente y consume AMBOS flags. `esCapturaFresca()`: ping con `|ahora−capturedAt| > 120 s` guarda
  posición pero NO evalúa alertas.
- **`ubicacion/route.ts`**: loop sobre TODOS los `En_Camino` (orden `orden_ruta`); **claim atómico**
  `UPDATE … WHERE flag = FALSE AND estado = 'En_Camino' RETURNING` ANTES de notificar (gana exactamente
  un ping; verificado E2E con 2 POSTs simultáneos → 1 sola notificación); el UPDATE de ETA ya no toca
  flags. El UPSERT de `rider_locations` lleva `WHERE EXCLUDED.captured_at >= rider_locations.captured_at`
  (un replay de la cola offline no retrocede la posición viva del mapa; cláusula de escape para
  `captured_at` futuro absurdo).
- **`iniciar-viaje/route.ts`**: captura también `legs[0].distance.value` (antes se descartaba), persiste
  la calibración, y si el viaje entero dura ≤ 6 min **suprime "por llegar" de fábrica**
  (`notificado_por_llegar = TRUE` en el UPDATE): la asesora recibe "Pedido en camino" + "en destino",
  sin un "por llegar" redundante segundos después. Fallback: sin Directions pero con origen real
  (GPS del rider / último entregado), el ETA se estima con defaults (antes quedaba NULL).
- **UI**: `src/lib/tiempo-relativo.ts` (NUEVO, con tests) unifica los 2 helpers "hace X" — SIEMPRE
  `Math.floor`; `NotificationBell` lo consume + tick de 30 s solo con el panel abierto; el helper
  duplicado de `mapa-despacho.tsx` se borró; etiqueta del popup "Arribo inminente (5 min)" → "Arribo
  inminente". Copy de llegada: "ya está en la dirección de entrega".

**Verificación:** 28 tests nuevos (131 total en verde), `tsc` limpio, y E2E completo contra `dev-hugo`
con sesión real de repartidor (login UI + fetch same-origin): viaje de 4.4 km → "en camino" /
"a unos **4** minutos" (ETA real 3.55 min) / "llegado", en orden y sin duplicados; ping rancio
(−10 min) → cero notificaciones y la posición del mapa no retrocede; viaje corto (500 m, Google 6 min)
→ nace suprimido; carrera de 2 pings simultáneos a 100 m → exactamente 1 "llegado"; campanita real:
30 s → "ahora", 90 s → "hace 1 min". Migración validada con rollback + re-aplicación idempotente en dev.

**Rollout:** `migrate-eta-honesto.sql` a producción por psql ANTES del deploy (gotcha #17/#58 — el
código nuevo SELECTea/UPDATEa las columnas: sin migración, iniciar-viaje daría 500). Cambio de
comportamiento a comunicar a operación: los minutos del aviso ahora son reales, y en entregas cortas
ya no llega "por llegar" (solo "en camino" + "en destino"). Knobs si hiciera falta re-tunear:
`VELOCIDAD_DEFAULT_KMH`, `UMBRAL_POR_LLEGAR_MIN`, `MIN_POR_LLEGAR_MIN`, `VIAJE_CORTO_MIN`,
`MAX_DESFASE_PING_MS` (constantes testeadas en `eta-reparto.ts`). Futuro opcional: `serverNow` en
`GET /api/notificaciones` para corregir clock skew del celular de la asesora.

---

## 7 ago 2026 — El POS lanzaba un error de hidratación en cada carga (`navigator.onLine` en el SSR)

**Síntoma.** Cada carga de `/dashboard/pos-planta` escupía en consola *"Hydration failed because the
server rendered HTML didn't match the client"*. El diff de React apuntaba al encabezado de la tarjeta
**"Venta Actual"**: el servidor pintaba un `<span>` donde el cliente pintaba un `<button>`. No rompía
nada, pero ensuciaba la consola y forzaba a React a re-renderizar ese subárbol en cada visita.
Preexistente, no lo introdujo ningún cambio reciente.

**Causa.** `pos-client.tsx` inicializaba el estado de red leyendo el navegador:

```ts
const [isOffline, setIsOffline] = useState(!navigator.onLine);   // ← corre TAMBIÉN en el servidor
```

Node 26 **sí** expone `globalThis.navigator`, pero **no implementa `onLine`** (comprobado:
`typeof navigator === "object"`, `navigator.onLine === undefined`). Así que en el SSR
`!navigator.onLine` es `true` y en el navegador `false`:

| | `navigator.onLine` | `isOffline` | HTML del encabezado |
|---|---|---|---|
| SSR (Node) | `undefined` | `true` | `<span>Sin conexión</span>` + `<button>` |
| Cliente | `true` | `false` | solo `<button>` |

El chip naranja de más corría la posición de los hijos, y de ahí el `span` vs `button` del reporte.
**No tenía nada que ver con el `lg:hidden` del botón**: las clases responsive son puro CSS y no
participan de la hidratación. La pista falsa es tentadora justamente porque el elemento que React
nombra es el que lleva el `lg:`.

**Fix** (dos líneas, `src/app/dashboard/pos-planta/pos-client.tsx`): el estado arranca en `false` —
igual que el servidor— y el `useEffect` que ya registraba los listeners `online`/`offline` lee ahora
`setIsOffline(!navigator.onLine)` al montar, para no perder el caso de abrir el POS ya sin conexión.
Se descartó `suppressHydrationWarning` (tapa el síntoma y deja el re-render) y `ssr:false` sobre
`PosClient` (mata el SSR de toda la pantalla por un chip).

**Cómo se verificó sin poder iniciar sesión.** `/dashboard/pos-planta` exige sesión y el `:3000` de
la máquina de desarrollo lo ocupaba otro proyecto (con `AUTH_URL` mandando los redirects ahí). Se
levantó el dev server del worktree en otro puerto y se montó una ruta temporal —borrada al terminar—
que renderiza el mismo `PosClient` con SSR **fuera de `/dashboard`** (el `authorized` de
`auth.config.ts` solo exige login bajo `/dashboard`, así que una ruta en la raíz es pública). Con el
código original: error de hidratación en cada carga y el HTML del servidor conteniendo literalmente
`<span class="… text-orange-600 bg-orange-100 …">` con la máquina conectada. Con el fix: el servidor
emite directamente `<button aria-label="Seguir agregando productos">` y la consola queda limpia.
El indicador offline se probó despachando los eventos `online`/`offline` y, para el arranque sin
conexión, mockeando `navigator.onLine = false` y forzando un remount real por Fast Refresh (un
cambio de whitespace NO remonta: hay que alterar la firma de hooks del componente).

**Regla que deja.** En un componente `"use client"` que igual se renderiza en el servidor, **nada de
leer el entorno del navegador en el inicializador de `useState`** — ni `navigator`, ni `window`, ni
`localStorage`, ni la hora local. El valor va en un `useEffect`. Y ojo con el reflejo de "`navigator`
no existe en Node": existe desde Node 21, solo que **incompleto**, así que no explota — devuelve
`undefined` y produce un mismatch silencioso en vez de un error claro.

---

## 13 ago 2026 (noche) — El bot cubre el hueco, no reemplaza a las asesoras

**Contexto.** Hugo pidió "que el bot de bienvenida responda por la noche cuando las asesoras no
están", partiendo de tres supuestos. Los tres eran incorrectos, y por qué lo eran es la parte
interesante:

| Supuesto | Realidad |
|---|---|
| "No responde de noche" | **Sí respondía.** Últimos 20 días: 22h → 11 mensajes de clientes / 9 del bot; 23h → 2 y 2; 1am → 1 y 1 |
| "No está entrenado" | Lo está: precios reales de `productos`, distritos, mínimos, horarios |
| "Está desactivado por defecto" | Al revés: todo lead de WhatsApp nace con `chatbot_activo = TRUE` |
| "Hay dos bots" | Hay **uno**. Ver abajo |

### Por qué parecían dos bots

`WelcomeBotConfig.tsx` — con su botón 🤖 en el CRM — mostraba "Estado del Bot", "Horario Comercial",
"Días Laborales" y "Mensaje Fuera de Horario"… y **no hacía absolutamente nada**. Guardaba en
`settings.crm_welcome_bot`, clave que **ningún proceso del servidor leía**. El backlog del propio repo
ya lo tenía anotado como *"decorativo"*. O sea: había una pantalla que prometía exactamente lo que
Hugo quería, y era de mentira. Configurarla no cambiaba nada, y de ahí la impresión de un segundo bot.

### El cambio de fondo

Hugo lo definió en una frase: **el bot cubre el hueco, no reemplaza a las asesoras**. Antes hablaba
las 24 h, encima de ellas. Ahora `settings.bot_ventas.cuando_responde` decide:

- **`"fuera_horario"` (default)** — calla dentro del horario de atención, responde de noche y en días
  no laborables.
- `"siempre"` — el comportamiento viejo, por si algún día se quiere.

La regla vive en `botDebeResponder({cfg, dentroDeAtencion})` (`src/lib/chatbot/fallback.ts`), **pura y
con tests**, y se evalúa en `ejecutarTurno`, donde antes solo se miraba `cfg.activo`.

> ⚠️ **Cambiar ese default cambió producción al instante:** `settings.bot_ventas` **no existía**, así
> que todo corría con los defaults del código. Por suerte los de horario ya eran exactamente los que
> Hugo quería (lunes a sábado 8:00–20:00), así que no hizo falta migración ni tocar datos.

### El agujero del handoff nocturno

El que de verdad lastimaba. Si el bot emitía `[HANDOFF]` a las 2 a.m., apagaba `chatbot_activo` y el
cliente quedaba **sin bot y sin humana**, escribiendo al vacío hasta que alguien entrara por la mañana
y lo reencendiera a mano. Ahora, fuera de horario, antes de apagar se envía un cierre que dice cuándo
lo retoman.

No se tocó la regla de que **un fallback NO apaga el bot** (aprendida a la mala en agosto): acá solo
se agrega un mensaje antes de un apagado que ya ocurría.

Y el prompt fuera de horario pasó de pasivo —*"puedes responder igual, pero no prometas una llamada
inmediata"*— a **ordenarle que se lo diga al cliente**, con el horario concreto.

### La pantalla que ahora sí sirve

`BotVentasConfig.tsx` reemplaza a la muerta y edita la config **real**: interruptor general, cuándo
responde, y el horario (horas + días) en que atienden las asesoras. Cierra con un resumen en palabras
—*"Las asesoras atienden lunes a sábado de 8:00 a 20:00. Fuera de ese horario responde el bot"*— para
que se entienda sin interpretar los controles. La clave `crm_welcome_bot` se sacó de la lista blanca
de `/api/settings`.

> ⚠️ El panel hace **merge sobre lo que ya había** (`{...crudo, ...cfg}`): `POST /api/settings`
> **reescribe la clave completa**, así que mandar solo los campos del formulario habría borrado
> distritos, mínimos, medios de pago y beneficios.

**Verificación.** 13 tests nuevos de las funciones puras (153 en total). En `dev-hugo`: el panel abre
con "Solo cuando no hay asesoras" y 08:00–20:00, se guarda y persiste en `settings.bot_ventas`. Y
ejercitando la regla con los defaults reales: martes 14:00 → el bot **no** responde; martes 23:00 y
domingo → **sí**.

**Queda fuera** (anotado, no hecho): los pushes no tienen hora de silencio —a las 2 a.m. igual suena
el celular de la asesora— y la cascada de escalado se congela de madrugada porque no tiene cron.

---

## 13 ago 2026 — Los leads por fin llegan a las asesoras (y no al admin)

**Contexto.** Hugo pidió "mejorar el reparto de leads, que por ahora sea equitativo". El modo
`equitativo` **ya estaba activo** desde el 6 ago y el filtro por marca **funcionaba** (cero leads
cruzados en producción). Pero el reparto real era:

| Marca | Reparto observado |
|---|---|
| Avícola de Tony | Mateo (admin) **5** · Jhoselyn **0** · Saraí **0** |
| Transavic | Yali 9 · Mateo (admin) **5** · Yesica 4 · Antonio 1 |

Las dos asesoras de Avícola, correctamente configuradas y activas, no habían recibido **ni un lead**.

### Las dos causas, encadenadas

**1. El lead nace sin dueña y cae al admin a los 2 minutos.** Un lead entrante se crea `en_cola` con
`vendedor_id = NULL` y solo `candidato_actual`; la asesora tiene que tocar "Atender". Si nadie lo hace
en **15 + 45 + 60 s**, el paso 3 de `escalateLead` hacía:

```sql
SELECT id FROM public.users WHERE role = 'admin' LIMIT 1
```

y le colgaba el lead. Nadie mira el CRM a las 21:19 para reclamar en dos minutos, así que **todos**
terminaban en el mismo admin. Los 5 leads de Avícola tenían la huella exacta: `estado_asignacion =
'asignado'`, `candidato_actual IS NULL`, `golden_ticket_phase IS NULL`, `inicio_turno IS NULL`.

**2. Y eso rompía la equidad, que se realimentaba sola.** Al escalar se pone `candidato_actual = NULL`,
y la carga del día se cuenta con `COALESCE(l.vendedor_id, l.candidato_actual) = u.id`. Un lead que
escalaba **dejaba de contar para nadie**. Jhoselyn y Saraí quedaban empatadas en
`leads_recibidos_hoy = 0` y `ultimo_lead_at = NULL` **para siempre**, así que el desempate caía en
`localeCompare(name)` y el sistema le ofrecía **siempre a la primera alfabéticamente**. No es que
repartiera mal entre las dos: nunca llegaba a rotar.

### El arreglo

El fallback final ahora llama a `rotateAndSelectCandidate` y **asigna a una asesora real de esa
marca**, elegida por la misma regla de equidad. Con eso el lead vuelve a tener `vendedor_id`, vuelve a
contar, y la rotación avanza sola. El admin queda **solo** como red de seguridad para cuando la marca
no tiene ninguna asesora habilitada — un problema de configuración, no de operación — y en ese caso el
aviso lo dice: *"no tiene ninguna asesora habilitada para su marca. Revisa el reparto"*. De paso ese
`SELECT` ahora filtra `activo` y ordena por `created_at` en vez de depender de un `LIMIT 1` sin
`ORDER BY`.

La regla de equidad se extrajo a **`src/lib/chatbot/equidad-leads.ts`**, pura y con 9 tests (incluida
una simulación de 6 leads que termina 3 y 3, y otra donde una asesora atrasada se empareja sola). Vive
aparte porque `bot-orchestrator.ts` importa `neon` en el top level y eso mata cualquier test bajo
Node 26 (gotcha #13).

> ⚠️ **Señal de alarma:** que el desempate **alfabético** se use seguido significa que las candidatas
> están todas en cero y sin historial — o sea, que los leads no les están quedando. Quedó anotado en
> el propio archivo.

### Data-op

`scripts/reasignar-leads-mateo-2026-08-13.sql` sacó del admin los 10 leads acumulados y los repartió
entre las asesoras de su misma marca **mirando la carga que ya tenían**, no por turno redondo: los 5
de Transavic fueron todos a Yesica (que iba 4 contra 9 de Yali) para dejar **9 y 9**, y los de Avícola
se alternaron **3 y 2**. Solo cambia el responsable: mensajes, estado e historial quedan intactos. Es
idempotente (el `WHERE` exige que el lead siga siendo del admin) y verifica al final que no haya
ningún lead en manos de quien no atiende esa marca (dio 0).

Antonio conserva 1 lead de Transavic: es el dueño, no se tocó.

---

## 7 ago 2026 — Fase 3 de las peticiones de Ariana: reimprimir guías sin el doble trabajo

**Contexto.** Tercer video, el más corto y el más barato de resolver:

> *"Que se puedan **imprimir las guías del día y también de días anteriores**, porque a veces los
> clientes piden la guía de fechas anteriores con los pesos que se les entregó. Pero ya **no se puede
> imprimir una vez que está asignado a los repartidores**: se tiene que **devolver a producción** para
> volver a imprimir y **otra vez asignar** — hay un **doble trabajo**."*

**El bloqueo era puramente de navegación.** `/pedidos/[id]/guia` no restringe nada: ni siquiera lee
`p.estado`. Pegando la URL a mano, un pedido Asignado o Entregado de cualquier fecha imprime perfecto.
Lo que lo escondía eran tres capas: (a) la query filtraba `estado IN (Pendiente, En_Produccion,
Listo_Para_Despacho)`, así que al asignar el pedido desaparecía; (b) el único enlace a la orden vivía
DENTRO del modal de pesos y encima gateado por `todoCompleto`; (c) en toda la app había solo dos
enlaces a esa página. Y el endpoint **ya aceptaba `?fecha=`** desde siempre — nadie se la mandaba.

**Qué se agregó** (sin migración): selector de fecha (`max` = hoy) con botón "Volver a hoy", toggle
**"Incluir ya despachados"** (`?incluir_despachados=1`) y un botón **Imprimir orden** en cada tarjeta,
fuera del modal. El subtítulo cambia a *"Otro día — solo para consultar y reimprimir"* cuando no es hoy.

**El default NO cambia:** al abrir la pantalla se sigue viendo la cola de trabajo del día, igual que
antes. Los despachados solo entran si se pide explícitamente, y su tarjeta no abre el modal de pesos
(sus endpoints `/pesos`, `/listo` y `/reabrir` devuelven 400 fuera de los 3 estados de producción).

**Tres trampas que aparecieron al ampliar el filtro de estados:**

1. **Las ventas del POS nacen en `Entregado`** → con el toggle se habrían colado en la cola de
   Producción. Se agregó `COALESCE(p.origen,'asesor') <> 'pos_planta'` (mismo criterio que
   `lib/data.ts`). No son pedidos de asesora: se preparan y cobran en el mostrador.
2. **`estadoBadge` solo cubría 3 estados** y no tenía `default` → devolvía `undefined` y la tarjeta
   reventaba al leer `badge.color`. Ahora cubre los 7 y nunca devuelve undefined.
3. **El backfill lazy de ítems escribe en DB durante un GET.** Hoy solo alcanza la cola del día; al
   listar fechas pasadas habría empezado a escribir sobre cientos de pedidos cerrados. Se acotó a los
   3 estados de producción — un pedido ya despachado no se va a pesar, así que reconciliarlo no aporta.

También: el `CASE` del `ORDER BY` lleva `ELSE 3` (los despachados al fondo, explícito en vez de
depender del NULLS LAST implícito), y el polling pasa a `immediate: false` porque la carga inicial la
hace el efecto que reacciona al cambio de fecha — si no, cada cambio disparaba dos peticiones.

**Verificación (dev-hugo, 7 ago).** Con el toggle activo y 0 pedidos hoy, las ventas del POS **no**
aparecen (el filtro de origen funciona). En el 27/06/2026 salen los 36 pedidos, incluidos 5
**Asignado** con su chip azul y su botón de imprimir — justo el caso del doble trabajo —, y la orden
abre con su correlativo (N° 00000366) y sus ítems. `tsc`, `eslint` y 103 tests limpios; sin errores
de consola.

---

## 7 ago 2026 — Fase 2 de las peticiones de Ariana: la ficha del cliente de planta

**Contexto.** Segundo video. Ariana abre la ficha de *Cabezón Acopio*, ve S/ 220.20 de deuda y dice:

> *"Me figura el **monto total** de lo que está debiendo, pero **no puedo visualizar el movimiento**,
> o sea qué cantidad de qué productos se ha llevado en esta compra de este día. Quisiera que se pueda
> visualizar **al igual que tiene la opción el señor Toño**, donde se verifica todos los abonos, todas
> las ventas; y también para poder **imprimir** y que se envíe al **WhatsApp del cliente**."*

La ficha de planta tenía **347 líneas**; la de campo, **1053**. No era cosmético: planta nunca tuvo
la capa de historial / estado de cuenta / guía.

### El bloqueante estructural

El POS insertaba el pedido con **`cliente_id = NULL`** (esa FK apunta a `clientes`, de ejecutivas) y
solo denormalizaba `razon_social`/`ruc_dni`. El **único** puente pedido↔cliente de planta era
`cobranzas_planta.pedido_id`, que **solo existe a crédito**. Consecuencias:

- una compra al **contado** de un cliente registrado era invisible desde su ficha;
- `listaClientesPlantaConSaldo` calculaba `ultima_compra` como `MAX(fecha_emision)` **de las
  cobranzas**, así que una venta al contado ni siquiera contaba como compra.

Lo irónico: `cliente_planta_id` **ya viajaba en el body del POS** y ya se validaba contra la tabla
incluso en contado (`api/pos/route.ts:106-122`). Solo faltaba persistirlo.

**Migración `migrate-planta-historial-2026-08-07.sql`:** `pedidos.cliente_planta_id` (+ índice
parcial) y `clientes_planta.saldo_anterior` (paridad con campo, `DEFAULT 0` ⇒ inocuo). Backfill
idempotente en dos pasos: **crédito** desde `cobranzas_planta` (recupera el 100 %) y **contado** por
`ruc_dni`, que es determinista gracias al índice único parcial `ux_clientes_planta_ruc` — las ventas
al paso sin documento quedan fuera a propósito. El bloque de verificación reporta cuántas filas
quedaron sin vincular, para revisarlo **antes** de correrlo en producción.

**Dos puntos de escritura, ambos obligatorios:** el INSERT del POS y la sentencia G del PATCH. Si se
hiciera solo el primero, editar una venta cambiándole el cliente actualizaría `razon_social`/`ruc_dni`
pero dejaría el `cliente_planta_id` viejo pegado — la venta seguiría colgando de la ficha anterior.

### Los dos agregados que NO son el mismo número

Es la decisión de diseño central, y está anotada en la cabecera de `lib/planta/saldos.ts`:

- El **saldo** lo mueven `saldo_anterior`, las ventas a **crédito** y los abonos.
- Lo **comprado** incluye además el **contado**, que no genera deuda.

Mezclarlos haría que la ficha se contradiga sola. Por eso el héroe mantiene las cifras de la deuda y
lo pagado en el acto va aparte ("Además compró S/ X al contado, ya pagado, no suma a la deuda"), y en
el PDF el contado aparece como línea `- S/ X` marcada *"Pagado al contado (no suma a la deuda)"* más
un total de pie, en vez de ensuciar la columna de saldo.

### Piezas nuevas

| Archivo | Rol |
|---|---|
| `src/lib/planta/historial.ts` | `historialClientePlanta` — UNION ALL de compras + abonos, ítems en 2ª query agrupados en un `Map` |
| `src/lib/planta/estado-cuenta.ts` | `construirEstadoCuentaPlanta` — **pura**, fuente única de pantalla y PDF |
| `src/lib/reportes/pdf-estado-cuenta-planta.ts` | PDF A4 violeta, con `construirFilasEstadoCuentaPlanta` pura |
| `src/app/dashboard/clientes-planta/estado-cuenta-planta-modal.tsx` | Período + toggle precio + WhatsApp/descarga |

**Diferencias con campo que NO se pueden copiar tal cual** (y por las que la query de avícola daría
resultados mal):

- En planta el abono cuelga de la **cobranza** (`abonos_planta.cobranza_id`), no del cliente: hay que
  pasar por `cobranzas_planta` filtrando anuladas de ambos lados.
- La venta vive en `pedidos` con `origen='pos_planta'`, no en tabla propia.
- Roles: planta es `admin` + `produccion`; campo es `admin` a secas.
- Las líneas llevan **unidad variable** (kg | uni), no kilos fijos.

Se reutilizó `abonosDeCobranza` (`lib/planta/saldos.ts`), que existía sin ningún consumidor.

### La orden impresa NO se tocó

El bloque de estado de cuenta se había quitado de `OrdenImprimible` **a propósito** el 19 jul
(`7e4f3c5`). Se respetó esa decisión: la prop `estadoCuenta` sigue declarada y sin renderizar. El
saldo viaja por los dos caminos donde sí corresponde — la guía JPEG de WhatsApp (que ya lo muestra
desde la Fase 1, en ventas a crédito) y este PDF nuevo. Ariana pidió los saldos *"en las guías que se
vayan a enviar"*, que es exactamente el JPEG.

### Verificación (dev-hugo, 7 ago)

Migración aplicada por psql. Cliente de prueba con **dos ventas el mismo día**: una al contado
(S/ 8.90) y otra a crédito (S/ 10.40), más un abono de S/ 4.00. Resultado: deuda S/ 6.40 y el contado
mostrado aparte; el historial lista las tres cosas con chip Crédito/Pagado y el acordeón abre
*"Alas — 1 uni/kg × S/ 10.40"*; el PDF sale con la aritmética a la vista. Confirmado por SQL que
**ambas** ventas quedaron con `cliente_planta_id` (la de contado era la que antes se perdía).
`npm test` 103/103, `tsc` y `eslint` limpios.

---

## 7 ago 2026 — Fase 1 de las peticiones de Ariana: el buscador vacío y la guía de planta

**Contexto.** Ariana mandó tres videos de pantalla (20:56–20:57). Se transcribieron con Whisper y
se analizaron los 90 fotogramas uno a uno; el análisis completo, con la transcripción literal de cada
video, está en `recursos/2. petición marianela 07-08-2026/ANALISIS.md`. Son **tres peticiones
independientes**, en tres módulos distintos, que se atacan en tres fases separadas y en el orden en
que ella las narró. Esta es la **Fase 1** (video 1, *Ventas de Planta*).

### Lo que pidió

> *"Él quiere la opción de imprimir o enviar la guía a su cliente, lo cual no lo podemos visualizar
> aquí. Aparte, en editar venta… a veces Mateo vuelve a pesar un tiempo después y me pide que incluya
> otro producto más. Entonces pongo producto, por ejemplo esta **molleja**, y no me bota aquí para
> seleccionar: dice **no se encontraron resultados**."*

### El bug del buscador: una línea, y no era "molleja"

`/api/productos` devuelve un objeto envoltorio (`route.ts:57`: `NextResponse.json({ data })`), pero
`ventas-planta-client.tsx:176` comprobaba si la respuesta **entera** era un array:

```ts
if (Array.isArray(data)) setCatalogoProductos(data);   // data es { data: [...] } → siempre false
```

`catalogoProductos` quedaba `[]` **para siempre**, y el `.catch(() => {})` se tragaba cualquier fallo
real. Las opciones del `SearchableSelect` se reducían al placeholder `"Buscar producto..."`, que no
contiene "molleja" → 0 resultados. **No faltaba el producto: no se podía agregar NINGUNO**, y abrir el
desplegable sin escribir tampoco mostraba nada. Los otros cuatro consumidores del endpoint
(`ProductSelector.tsx:66`, `emitir-client.tsx:784`, `emitir-guia-directa-modal.tsx:241`) lo leían
bien; este era el único roto. Se introdujo en `19b707a` (modal de edición inline, 24 jul 2026).

**Regla que deja:** `/api/productos` devuelve `{ data }`, no un array. Comprobar `Array.isArray(json?.data)`.

### Bug latente del mismo modal

`iniciarEdicion` mapeaba `productoId: it.producto_id || ""`, pero el PATCH exige `z.string().uuid()`
→ una venta con un ítem sin `producto_id` daba 400 "Datos inválidos" al guardar, sin decir cuál. Ahora
el id se recupera del catálogo por nombre (normalizado sin tildes) y, si aun así no aparece, el aviso
**nombra el producto**: *"«X» no está en el catálogo. Quítalo y vuelve a agregarlo desde el buscador."*

### Imprimir y enviar la guía

La página imprimible `/pedidos/[id]/guia` **ya funcionaba** para ventas del POS (son filas de
`pedidos` con `origen='pos_planta'`), pero en toda la app había **solo dos** enlaces hacia ella:
Producción y el panel post-venta del POS, que se pierde al cerrarlo. La lista histórica no lo
reofrecía. Se agregaron a cada venta:

- **Imprimir** → `<a href="/pedidos/{id}/guia">`, mismo patrón que `ventas-campo-client.tsx:511-519`.
- **Enviar guía** → `GuiaPlantaModal`, clon del pipeline JPEG de `guia-avicola-modal.tsx`.

Ambos aparecen **también en las ventas anuladas** (el ticket sale con la banda ANULADA): el cliente
suele pedir el comprobante de una venta dada de baja.

Piezas nuevas:

| Archivo | Qué hace |
|---|---|
| `src/lib/planta/guia-pos.ts` | `guiaDeVentaPlanta()` — arma la guía desde `pedidos` + `pedido_items`. Espejo de `lib/avicola/guia.ts` |
| `src/app/api/pos/ventas/[id]/route.ts` | `GET` nuevo (antes solo `PATCH`) → `{ guia }` |
| `src/app/dashboard/pos-planta/ticket-guia-planta.tsx` | Layout 500px para fotografiar |
| `src/app/dashboard/pos-planta/guia-planta-modal.tsx` | Modal JPEG + compartir |

**Diferencias de dominio con campo (no se copió tal cual):** las líneas llevan **unidad variable**
(kg | uni), no kilos fijos; y el **estado de cuenta es opcional** — una venta al contado no tiene
cuenta corriente que arrastrar, así que el recuadro solo sale si la venta fue a crédito.

El estado de cuenta de la guía se ancla por **`created_at`**, no por `fecha` (misma regla del caso
Vicki, gotcha #46), y en planta los abonos cuelgan de la **cobranza** (`abonos_planta.cobranza_id`),
no del cliente — el JOIN va por `cobranzas_planta` filtrando anuladas de ambos lados.

### Las tres salidas de WhatsApp (decisión de Hugo)

No se usa la Cloud API: la ventana de 24 h de Meta la haría fallar casi siempre con estos clientes,
que no escriben al número del CRM. En su lugar, tres botones: **Compartir** (`navigator.share`),
**Descargar** y **Abrir chat del cliente** (`wa.me`). ⚠️ Un enlace `wa.me` abre la conversación y
puede llevar texto, pero **no puede adjuntar la imagen** — por eso "Abrir chat" descarga primero y el
subtítulo dice explícitamente que hay que adjuntarla. El botón solo aparece si el cliente tiene teléfono.

### Verificación (dev-hugo, 7 ago)

Venta de prueba en el POS (S/ 19.30) → *Editar venta* → escribir "molleja" → aparece **"mollejas de
pollo (kg) — S/ 11.90"** → agregar y guardar → *"Venta editada correctamente"*, total S/ 31.20 (el
PATCH reversó y reaplicó bien stock y cobro). La guía JPEG se generó con logo y **TOTAL S/ 19.30**
coincidiendo con la venta; la orden imprimible salió como N° 00000367 con sus tres modos
(Ticket/A4, Precios, RawBT). `tsc` y `eslint` limpios.

**Hallazgo aparte (preexistente, no de este cambio):** `/dashboard/pos-planta` emite un error de
hidratación de React — el servidor pinta un `<span>` y el cliente un `<button lg:hidden>` en el
encabezado de "Venta Actual". No rompe nada visible pero fuerza un re-render de ese subárbol.

---

## 6 ago 2026 (noche) — El gasto recupera su fecha (petición de Marianela)

**Contexto.** Marianela mandó un audio y un video. Pedía "poder elegir la fecha del gasto", pero en el
audio contó sin darse cuenta el problema de fondo:

> *"Me dice «caja diaria», así que **creé una caja por 10,000 soles** y estoy metiendo los gastos."*

**Tuvo que inventar una caja de S/ 10,000 que no correspondía a ningún día real solo para poder escribir
gastos**: el formulario únicamente existía dentro de una caja abierta. Y como no había campo de fecha,
escribía la fecha DENTRO de la descripción — *"Gasto: Otros - PETER CON 13-07"*. En producción, **14 de
los 16 gastos** cargados eran así. Encima, el pago a proveedor SÍ tenía selector de fecha y el gasto no,
lo que terminaba de confundir.

**Lo que encontró el análisis y achicó el trabajo:**

- **`gastos.fecha` ya existía** (DATE) y **el API ya la aceptaba**. El único que forzaba "hoy" era la
  pantalla: `caja-diaria-client.tsx` mandaba `new Date().toISOString().split("T")[0]` — que además es un
  bug de zona horaria: **después de las 19:00 de Lima guardaba la fecha de MAÑANA**.
- **Nadie más lee la tabla `gastos`** (grep exhaustivo: solo su propio endpoint; ni rentabilidad, ni
  consolidado, ni crons). Arreglar la fecha no rompía nada aguas abajo.
- **El arqueo ni siquiera mira `gastos`**: suma `transacciones` de la cuenta de efectivo con
  `created_at >= caja.abierta_at`. Como `/api/gastos` no escribía `transacciones.fecha` ni `created_at`,
  **todo gasto atrasado descontaba del efectivo estimado de HOY** — de ahí los S/ 3,167 de "Gastos
  Planta" en su caja, que al cerrarla le habrían dado un faltante fantasma.

**Cómo quedó.** Formulario compartido entre Gastos y Caja; en **Gastos se registra sin caja abierta**
(que es donde se carga el mes atrasado); la fecha va primera, en ámbar cuando es de otro día, y **no se
resetea al guardar**. La transacción se escribe con `fecha` y un **`created_at` sintético en el día del
gasto**, que es lo que lo saca del turno de hoy sin tocar la aritmética del arqueo. Validación en
`src/lib/gastos/fecha-gasto.ts` (pura, con tests): futura no, hacia atrás sin límite, "hoy" resuelto por
SQL. Y por primera vez se puede **corregir o borrar** un gasto (`PATCH`/`DELETE /api/gastos/[id]`), con
409 si la caja de esa fecha ya fue arqueada.

**La misma fuga estaba viva en los pagos a proveedor** (`lib/proveedores/pagos.ts` escribía `fecha`
retroactiva pero dejaba `created_at` en "ahora"): un pago atrasado en efectivo descontaba de la caja de
hoy. Se corrigió en el mismo lote. La regla queda escrita: **todo movimiento con fecha elegible escribe
`fecha` Y `created_at`**.

**Verificado en vivo** contra dev-hugo: registrar un gasto del 13 de julio desde Gastos sin caja abierta
guarda `gastos.fecha`, `transacciones.fecha` y `created_at` en el 13 de julio, y queda fuera del turno
actual.

**Los 16 ya cargados.** `scripts/corregir-fechas-gastos.mjs` (dry-run por defecto) extrae la fecha del
texto: en producción detecta **14 para reubicar** (3 al 16 de julio) y 2 sin fecha en el texto
(`DESAYUNO ACOPIO` S/ 248 y `DESAYUNO KAREN` S/ 232) que hay que corregir a mano. **No se aplicó**: la
lista la revisa Marianela primero.

De paso: el concepto del ledger mostraba el UUID crudo del pedido (*"Venta Rápida - Pedido
43a6f3c9-4eca-…"*, visible en su video) y ahora dice "Venta Rápida en mostrador"; y los textos que decían
"los gastos se registran desde Caja Diaria" dejaron de ser ciertos y se reescribieron.

---

## 6 ago 2026 — Reparto de leads por marca, y el estado de cuenta que obligaba a sacar calculadora

**Reparto de leads por marca (pedido de Hugo).** Hugo pasó la asignación real: Jhoselyn y Saraí atienden
La Avícola de Tony; Yali y Yesica, Transavic. Al ir a implementarlo apareció el problema de fondo: **la
rotación tomaba a TODAS las asesoras activas sin mirar la marca**, así que un lead que escribía a la
Avícola podía caerle a una asesora de Transavic y al revés (el contador del día ya era por marca; el pool
de candidatas no). Lo mismo el escalado de un lead sin atender: se ofrecía a las asesoras de la otra marca.

Además el reparto **no era parejo por diseño**: el patrón de 20 pasos reparte 60/25/15 por nivel, y Yali
(nivel 2) y Yesica (nivel 3) recibían bastante menos. Hugo eligió reparto parejo con los niveles apagados.

Lo que se hizo: columna `users.empresas TEXT[]` (NULL o vacío = todas las marcas, para que un deploy no
deje a nadie fuera del reparto sin querer), filtro por marca en la rotación **y** en el escalado, y modo
**`equitativo` por defecto**: dentro de la marca gana la que MENOS leads recibió hoy en esa marca, y
desempata la que hace más tiempo que no recibe (`ordenarPorEquidad`). Se auto-corrige solo: si alguien
falta un día, al siguiente arranca abajo y recibe primero. En la pantalla de Reparto cada asesora tiene
dos chips de marca. Yohana quedó fuera del reparto por decisión de Hugo.

**De paso, una pantalla que mentía:** con el reparto parejo, el panel "Distribución de Carga 60/25/15"
seguía ahí como si mandara. Ahora hay un selector visible de modo (*Partes iguales* / *Por niveles*) que
se guarda al tocarlo, el subtítulo dice qué hace el modo activo, y los porcentajes se atenúan con el
motivo cuando no se usan. Migración `migrate-asesoras-por-marca-2026-08-06.sql`.

**Aclaración que salió en la misma conversación:** las **respuestas rápidas y las plantillas ya estaban
separadas por marca** desde el 19-20 jul (campo `empresa` opcional, badge en la lista, y el chat solo
ofrece las de la marca del lead). Lo único compartido que quedaba era el reparto.

### El PDF del estado de cuenta perdía el detalle por producto

Hugo mandó el estado de cuenta de una clienta: la columna **"Monto del día"** traía solo la suma. El
cliente veía *"Gallina doble pechuga 7.2 kg × S/ 12.50 / Pollo entero con menudencia 258 kg × S/ 8.80"* y
un único **S/ 2,360.40** al costado: para comprobar que le cobraban bien tenía que sacar la calculadora.
En un documento de deuda, eso es lo peor que puede pasar.

**El dato ya existía** (`VentaAvicolaItem.subtotal`) y **la pantalla del modal ya lo mostraba**: solo el
PDF lo tiraba. Ahora cada día es un bloque: una fila por producto con SU importe, y una fila
**TOTAL DEL DÍA** en negrita que lleva el saldo anterior, los abonos y el saldo actual. Un día de un solo
producto no repite el total (sería el mismo número dos veces) y un día de solo abono sigue siendo una fila.

Dos decisiones que vale la pena recordar:
- **Sin `rowSpan`.** `jspdf-autotable` parte mal los bloques con `rowSpan` entre páginas y este PDF ya
  pasa de una hoja; con filas planas (fecha y guía solo en la primera del bloque) + `rowPageBreak: "avoid"`
  la paginación no falla y ningún total queda huérfano.
- **Fila "Ajuste".** Al mostrar los importes uno por uno, la columna TIENE que sumar el total o el cliente
  lo nota. Si alguna vez no cuadra, la diferencia sale como "Ajuste" en vez de dejar un PDF que se
  contradice. Apareció justamente probando: una venta de dev-hugo tenía 5 ítems que sumaban 945.60 y un
  total de 1200. **Producción está limpia** (768 ventas, 0 descuadradas) porque el API calcula el total
  sumando los ítems — era un registro de prueba metido a mano, pero el seguro quedó.

La construcción de filas se extrajo a `construirFilasEstadoCuenta` (pura, 8 tests). De paso, `vitest`
ahora resuelve el alias `@/`, que era lo que impedía testear cualquier módulo que importara `@/lib/...`.

**Tres mejoras anotadas para el futuro** (pedido explícito de Hugo): asignar un pedido desde el celular
sin arrastrar ([07 §6.1](./arquitectura/07-despacho-rutas.md)), ver el trazo real de la ruta al asignar
([07 §6.2](./arquitectura/07-despacho-rutas.md)) y marcar las cámaras de velocidad de Lima para que los
motorizados no corran ([08 §5.1](./arquitectura/08-repartidores-gps.md)).

---

## 5 ago 2026 (noche) — Antonella: el bot deja de ser recepcionista y empieza a vender

**Contexto.** Con el CRM de la Avícola ya operando, Hugo pasó los cuatro documentos que usa Antonio
—"Antonella 2.0 – Verdad Única", la Ficha Comercial, los Beneficios y un manual de negociación basado
en *Rompe la barrera del NO* de Chris Voss— y pidió analizarlos a fondo y mejorar las respuestas del bot.

**El diagnóstico.** El bot no sabía nada del negocio. Su prompt vivía hardcodeado en
`bot-orchestrator.ts` y todo su conocimiento eran dos strings: el nombre de la marca y una lista de
categorías. No conocía precios, ni qué productos existen, ni cuáles son los 18 distritos (decía
"reparto en 18 distritos" sin poder enumerarlos), ni horarios, ni medios de pago, ni mínimos, ni el
nombre de quien le escribía, ni qué día era, ni si esa persona era cliente desde hacía años. Su única
meta era escribir `[HANDOFF]`.

Y tres agujeros hacían que el cliente recibiera una respuesta mala o ninguna:

1. **El saneo tiraba las cotizaciones.** `pareceTruncada()` descartaba toda respuesta que no cerrara
   con puntuación: una lista que termina en `- Alitas: S/ 12.00 por kg` se descartaba y el cliente
   recibía *"Disculpa, en este momento tengo un problema técnico"*. **Cotizar era literalmente
   imposible.** (De yapa: `quitarEtiquetaHandoff` colapsaba `\s{2,}` → " ", o sea que aplastaba los
   saltos de línea y dejaba cualquier lista en un renglón.)
2. **Ráfagas encimadas.** "20 kg" / "para mañana" / "en Surco" en cuatro segundos = tres llamadas a la
   IA y tres respuestas superpuestas. La idempotencia por wamid solo cubre el reintento del MISMO
   mensaje.
3. **El fallback mentía.** Se mandaba "una asesora se comunicará contigo" pero NO se apagaba el bot y
   NO se notificaba a nadie — peor: con el lead todavía en cola, `vendedor_id` es NULL, así que el `if`
   de la notificación ni siquiera entraba. Una foto sin caption era silencio absoluto (`return null`).

**Decisiones de Hugo (las cuatro, antes de escribir código).** El bot **vende y cierra** (pasa a la
asesora con el pedido armado); **sí da precios**, de una carta curada con el precio real de la base;
la verdad operativa del documento **sigue vigente** (reparto lun–sáb 8–12, atención 8–20, mínimos 5/10
kg); y esta tanda incluye el prompt **más** los tres arreglos críticos.

**Lo que se construyó.** Cinco módulos nuevos en `src/lib/chatbot/`: `carta-comercial.ts` (curaduría
comercial + alias del cliente), `config-bot.ts` (`settings.bot_ventas`, defaults = los documentos),
`contexto-negocio.ts` (precios reales, hora de Lima, próximo reparto, si ya es cliente),
`prompt-antonella.ts` (el prompt y los turnos) y `fallback.ts`. El orquestador se partió en
`registrarEntrante()` (síncrono, con Meta esperando) y `responderTurno()` (en `after()`), con lock de
turno, debounce de 7 s y chequeo pre-envío. `gemini.ts` ganó chat multi-turno con `systemInstruction`,
`finishReason` y presupuesto de tiempo. Detalle completo: [doc 15 §6](./arquitectura/15-asistente-ia.md).

**Tres decisiones que vale la pena recordar:**
- **Carta curada, no los 84 productos.** Los nombres de la DB son operativos (`"Cuy entero precio por
  uni."`) y volcarlos hace que el bot suene a inventario. Además Antonio pidió no ofrecer nada fuera de
  su lista, **incluida la milanesa**, que sí está en el catálogo.
- **El prompt en código, los datos en settings.** El prompt contiene el token `[HANDOFF]`; si fuera
  editable en un textarea, un pegado desprolijo dejaría al bot sin transferir clientes en silencio.
- **El precio nunca se inventa:** sin match en el catálogo el ítem sale "a consultar", y si la carta
  entera falla, el prompt PROHÍBE cotizar.

**Verificación.** 46 tests de funciones puras con `vitest` (corren en Node 26 porque ninguna importa el
driver de Neon — el motivo por el que `test-crm-flow.mjs` nunca corrió acá) y un simulador nuevo,
`scripts/simular-conversacion.mjs`, que postea webhooks firmados con HMAC contra el dev server con 17
escenarios. Probado contra `dev-hugo` en **modo mock** (la marca sin token no manda nada a Meta):

| Escenario | Qué hizo el bot |
|---|---|
| "¿a cuánto está la pechuga?" | Dos presentaciones con el **precio real de la DB**, nombre comercial y pregunta de avance |
| "soy de la pollería El Sabroso" | No cotizó, cerró con amabilidad |
| "¿llegan a Comas?" | Dijo que no, sin inventar, y ofreció tomar los datos |
| Ráfaga de 3 mensajes | **UNA** sola respuesta que junta los tres — y saludó "Buenas noches" (sabe la hora de Lima) |

**Trampa del entorno que casi cuesta caro:** el `localhost:3000` de la Mac estaba ocupado por el dev
server de OTRO proyecto (se delató con un 308 a URL con barra final, que Transavic no usa). Postearle
payloads de webhook a un proyecto ajeno habría sido feo: **verificar siempre de quién es el puerto**
antes de simular.

### La revisión adversarial (46 agentes) y lo que encontró

Antes de tocar producción se pasó todo el cambio por cinco lentes independientes (concurrencia, SQL de
Neon, prompt y seguridad, fallback/UX, regresiones) con un verificador escéptico por hallazgo. Salieron
**41 defectos distintos, 4 críticos** — tres de ellos **introducidos por este mismo cambio**. Los cuatro
grandes y su arreglo:

1. **El mensaje que llega con el lock tomado se perdía para siempre.** El diseño asumía que el ganador
   del lock leería los mensajes del perdedor, y eso solo es cierto si llegan durante el debounce. Si
   entraban después de que el ganador ya leyó, nadie los respondía: el cliente veía silencio absoluto.
   → Columna nueva **`leads.bot_turno_respondido`**: al soltar el lock se compara contra `bot_turno_seq`
   y, si quedó algo sin responder, se **reencola** el turno (hasta 2 rondas); si no alcanza el
   presupuesto, se avisa a una humana en vez de dejarlo colgado.
2. **El cliente podía apagar el bot poniéndose `[HANDOFF]` de nombre en WhatsApp.** El nombre de perfil
   es texto que elige el cliente; llegaba crudo al prompt, el modelo lo repetía al saludar y
   `pideHandoff()` lo leía como una orden de transferir. → `primerNombre()` ahora solo acepta
   `^[\p{L}\p{M}'’-]{2,24}$`. Verificado en vivo: un lead llamado `[HANDOFF]` recibe su saludo y el bot
   **sigue encendido**.
3. **El caption de una foto se descartaba.** `body` guarda la dataURL de la imagen, así que el texto
   escrito sobre la foto ("quiero 20 kg de esto para mañana") se perdía y el bot contestaba "recibí tu
   archivo, ¿qué necesitas?" a quien acababa de decirle exactamente qué necesitaba. → El caption se
   guarda como una fila de texto aparte.
4. **El fallback apagaba el bot para siempre.** Un 429 pasajero de Gemini, un falso positivo del saneo o
   una foto sin caption dejaban al lead sin bot **permanentemente**. → **Un fallback ya no apaga el
   bot**: solo lo apaga un `[HANDOFF]` explícito o una asesora. Se sumó anti-spam de notificaciones (una
   cada 30 min por lead) para que una caída de la IA no ametralle a las asesoras.

Otros arreglos de la misma tanda: `pareceTruncada` perdió la regla "más de 3 palabras sin puntuación"
(descartaba respuestas válidas — en WhatsApp nadie cierra con punto, y ahora cada falso positivo
despierta a una asesora); las notificaciones usan la cascada **asesora → candidatos en cola → admin**
(con `vendedor_id` NULL, o sea todo lead recién creado, antes no le llegaban a nadie); el presupuesto
del turno se mide desde el arranque de la invocación y no desde `responderTurno`; el `INSERT` de lead
lleva `ON CONFLICT (telefono, empresa)` (dos webhooks simultáneos reventaban con 23505); las gallinas y
el pato se cotizan **por kilo** aunque el catálogo diga `uni` (S/ 17.90 "por unidad" para un ave de 4 kg
es cuatro veces menos); el osobuco se partió en dos ítems porque son dos precios; el historial de
compras ya no mete en el prompt productos que la carta excluye; y `cargarCatalogo` ordena por nombre
para que el match sea determinista.

Reacciones, stickers y ubicaciones vuelven a ser no-op (antes se guardaban como texto vacío y
disparaban el "recibí tu archivo").

---

## 5 ago 2026 — El token de la Avícola, por fin (y las variables ya en Vercel)

**Contexto.** Hugo retomó el alta del RUC 10 con un mensaje corto: *"antonio ya esta activo, abre el
navegador y continua"*. El 3 de agosto todo había quedado en un punto muy concreto: la solicitud de token
del usuario del sistema *CRM Avicola de Tony* estaba **pendiente de verificación de identidad**, y esa
verificación es un paso humano.

**Lo que pasó.** El banner *"Verificación de la cuenta obligatoria"* **seguía intacto dos días después**
(la solicitud no caduca sola). Al pulsar *Verificar cuenta*, Meta mandó un **código SMS al celular del
admin del portfolio** (+51 946 209 950, el de Antonio); Hugo lo tecleó y el banner cambió a *"Generación
de identificadores de acceso aprobada"*. El botón **Generar identificador** que aparece ahí **emite
directamente el token de la solicitud anterior**: no vuelve a preguntar app, caducidad ni permisos — usa
los que se eligieron cuando se lanzó la solicitud. Por suerte esa solicitud era la relanzada del 3 ago,
con los tres permisos marcados a mano.

**Verificación (lo que no se puede saltar).** `debug_token` devolvió `type: SYSTEM_USER`, `is_valid: true`,
**`expires_at: 0`** (nunca caduca) y los scopes correctos, **con `whatsapp_business_messaging`** — el que
faltaba en el token del 3 ago y habría dejado al bot recibiendo pero mudo. Con ese token:
`GET /<PHONE_NUMBER_ID>` → `CONNECTED`, `code_verification_status: VERIFIED` y **`name_status: APPROVED`**
(subió solo desde `PENDING_REVIEW`); `health_status` → `can_send_message: AVAILABLE` en las cuatro
entidades (número, WABA, negocio, app), con un único aviso que es justamente el pendiente:
*"Your app is not subscribed to the message webhook"*. Los errores 138024/138025 que salen ahí son de
**llamadas SIP**, que no usamos.

**Vercel.** Las 4 variables (`WHATSAPP_AVI_PHONE_NUMBER_ID`, `WHATSAPP_AVI_WABA_ID`, `WHATSAPP_AVI_TOKEN`,
`META_APP_SECRET_AVI`) se cargaron por CLI a producción, con el valor entrando por *stdin* desde
`.env.local` para no pegarlo en un formulario. Dos hallazgos de camino, ya anotados en
[doc 28 §9](./arquitectura/28-alta-whatsapp-por-marca.md): (a) **no se pueden releer** — `vercel env pull`
devuelve `VAR=""` para todas las variables cifradas del proyecto (también las de Transavic, que funcionan)
y el CLI no tiene `env get`, así que la única comprobación real es la prueba end-to-end; (b)
**`vercel redeploy` falla con *"Deployment belongs to a different team"*** pese a que `whoami` y `switch`
dan lo correcto — el camino bueno es el de siempre: commit a `main` y que Vercel despliegue.

**El `META_VERIFY_TOKEN` que ya nadie podía leer.** Para suscribir el webhook hace falta ese token, y
resultó que **no estaba en ningún lado legible**: no está en `.env.local` ni en `.env` (nunca estuvo), y
en Vercel figura como **`Sensitive`** — o sea que *no se puede revelar*: `vercel env pull` devuelve `""`,
el CLI no tiene `env get`, en el panel *Copy to Clipboard* está deshabilitado y *Edit* abre el campo
vacío. La lección: **una variable Sensitive existe solo donde tú la anotaste**. Se rotó (valor nuevo en
`.env.local`, reemplazado en Vercel desde el panel — `vercel env update` **falla** sobre una Sensitive con
*"You cannot change the key of a Sensitive Environment Variable"*), lo cual es inofensivo porque ese token
solo interviene cuando Meta verifica una URL de webhook. Comprobación directa, que además es el **único
chequeo posible** de una Sensitive: `GET /api/webhooks/meta?hub.mode=subscribe&hub.verify_token=…&hub.challenge=12345`
→ devolvió **`12345`** (y `403` con un valor incorrecto, o sea que valida de verdad).

**Webhook y prueba real.** `POST /<APP_ID>/subscriptions` (`object=whatsapp_business_account`,
`fields=messages,message_template_status_update`) → `{"success":true}`, `active: true` en el GET, y el
aviso *"not subscribed to the message webhook"* desapareció del `health_status`. Con eso, un WhatsApp real
al **+51 936 303 850**: el lead entró con **`empresa = Avícola de Tony`**, el bot respondió *"¡Hola!
Bienvenido a La Avícola de Tony…"* **desde ese número y sin nombrar a la otra marca**, el saliente quedó en
**✓✓** (no `fallido`) y la rotación arrancó en fase grupal. **El CRM de la segunda marca está operando.**

**Higiene pendiente.** El token nuevo se pegó en texto plano en el chat (igual que el de Transavic el
19 jul), así que **los dos tokens siguen en la lista de rotación**; ninguno caduca, la exposición no
expira sola.

**Detalle de infraestructura para la próxima vez.** `vercel redeploy` falla con *"Deployment belongs to a
different team"* aunque `whoami`/`switch` estén bien; el camino que funciona es commit a `main`. Y las
variables que crea el CLI nacen **Sensitive**: anotar SIEMPRE el valor en `.env.local` y en
`CREDENCIALES-PRODUCCION.local.md` antes de subirlo, porque después no hay forma de recuperarlo.

---

## 3 ago 2026 — WhatsApp del RUC 10: la app, el usuario del sistema y dos trampas de Meta

**Contexto.** Hugo mandó una captura de `developers.facebook.com/apps`: había **cuatro apps llamadas
"CRM Avicola de Tony"** y ninguna servía. Su pedido: borrar las que sobran y crear de una vez la app de
La Avícola de Tony (RUC 10), porque la WABA y el número ya estaban listos en el portfolio desde el día
anterior.

**El diagnóstico.** Las cuatro tenían `Tipo de aplicación: Ninguno` y ninguna estaba ligada a un
portfolio. Al abrir *Añadir producto* en una de ellas, la lista traía App Events, Webhooks, Audience
Network, Facebook Login, Messenger, Marketing API, Instagram… **y no traía WhatsApp**. Comparando con
*Transavic CRM* (la que sí opera) se vio la diferencia: su panel dice *"Personaliza el caso de uso
**Conectar con los clientes a través de WhatsApp**"*. O sea: en el flujo actual de Meta, **WhatsApp no es
un producto que se agregue después — es un CASO DE USO que solo se elige al crear la app**, y el tipo no
se puede cambiar ni aparece "Añadir casos de uso" en una app que nació sin él. Por eso Hugo repitió el
intento cuatro veces con el mismo resultado. Conectar la app a un portfolio a posteriori (probado:
*Ajustes de TONIO LADT → Aplicaciones → Añadir → Conectar un identificador*) funciona, pero **no arregla
el tipo**.

**Lo que se hizo.**

1. **App nueva bien creada**: `developers.facebook.com/apps/creation/` → Detalles → **Casos de uso →
   filtro *Mensajes empresariales* → "Conecta con los clientes a través de WhatsApp"** → **Empresa:
   TONIO LADT** → Crear (Meta pide la contraseña de la cuenta: paso humano). Resultado:
   **CRM La Avicola de Tony `1572345110399260`**. En *Configuración de la API* ya aparecía el número
   **+51 936 303 850**, señal de que la app veía la WABA correcta.
2. **Las 4 duplicadas eliminadas** (`37590723450543044`, `1590104335862754`, `1534073668399964`,
   `1049460644499486`) desde *Opciones avanzadas → Suprimir aplicación*. Quedaron solo las dos que deben
   existir: la nueva (TONIO LADT) y *Transavic CRM* (TONIO DAT). Meta avisa que se pueden restaurar desde
   el correo de contacto (`trg199017@gmail.com`).
3. **Usuario del sistema** *CRM Avicola de Tony* **`61592610189811`**, rol Admin, con la **app** y la
   **WABA** asignadas en **control total**. Antes de dejar crearlo, Meta exige aceptar su *política de no
   discriminación* en nombre del portfolio (lo aceptó Hugo).
4. **IDs levantados y verificados por API**: WABA **`1372799911704998`** (divisa PEN,
   `account_review_status: APPROVED`), número **`1269524296240191`** con
   `status: CONNECTED` + `code_verification_status: VERIFIED`. **No hizo falta `POST /register`** — Meta
   dejó el número registrado desde el alta por la UI, así que no se gastó ninguno de los 10 intentos por
   72 h. `name_status: PENDING_REVIEW` no bloquea recibir ni responder.
5. **App suscrita a la WABA**: `POST /<WABA_ID>/subscribed_apps` → `{"success":true}`.
6. **App Secret** leído y validado con `debug_token`.

**Trampa nº1 — el WABA ID no se puede leer con ese token.**
`GET /<business_id>/owned_whatsapp_business_accounts` devuelve **error 200 "Requires business_management
permission"**: el token del system user tiene `whatsapp_business_management`, que es otro permiso.
Tampoco existe el campo `whatsapp_business_account` en el nodo del número. Sale en la **URL del
Administrador de WhatsApp** (`business.facebook.com/wa/manage/phone-numbers/?business_id=…` redirige a
una URL con `asset_id=<WABA_ID>`), y con ese ID en mano `GET /<WABA_ID>` y `/<WABA_ID>/phone_numbers` sí
responden.

**Trampa nº2 — el token salió sin permiso para enviar (la cara).**
El `debug_token` del primer token mostró `whatsapp_business_management`,
`whatsapp_business_manage_events` y `public_profile`: **faltaba `whatsapp_business_messaging`**. Con ese
token todo *parece* bien —`GET /me` responde, la suscripción a la WABA funciona— pero **el bot no puede
enviar una sola respuesta**, y como `src/lib/whatsapp/sender.ts` **nunca lanza**, los mensajes habrían
quedado en `lead_mensajes.estado='fallido'` sin ningún error visible: un CRM "conectado" y mudo. Al
reabrir el asistente se vio la causa: el desplegable *Seleccionar permisos* abre con **"2 opciones
seleccionadas"** (`manage_events` + `management`) y **`whatsapp_business_messaging` viene desmarcado**.
Se **revocó** el token (*Revocar identificadores* revoca todos los del usuario, no hay revocación
selectiva) — lo que además resolvió que se había pegado en texto plano en el chat — y se relanzó la
generación marcando los tres permisos. Se detectó de paso que **la caducidad se reinicia a "60 días
(recomendado)"** a partir de la segunda emisión (la primera abre en *Nunca*): un token de 60 días mata el
CRM en silencio dos meses después.

**Dónde quedó.** El token nuevo quedó a mitad: Meta pide **verificación de identidad en CADA emisión**
(*"Ya casi has terminado — para proteger esta cuenta, debes verificarla"*), no solo la primera vez, y eso
es un paso humano. **Al cierre del 3 ago no hay token válido para la Avícola** (`WHATSAPP_AVI_TOKEN`
vacío en `.env.local`, con el motivo anotado). Lo que falta: regenerarlo con los 3 permisos y caducidad
*Nunca* → validarlo con `debug_token` → cargar las 4 variables en Vercel (`WHATSAPP_AVI_TOKEN`,
`WHATSAPP_AVI_PHONE_NUMBER_ID`, `WHATSAPP_AVI_WABA_ID`, `META_APP_SECRET_AVI`) → redeploy → **y recién
entonces** configurar el webhook en Meta (al revés, Meta reintenta 7 días y puede desactivarlo) → probar
las dos marcas en paralelo.

**Pendientes que arrastra:** rotar los dos tokens (el de Transavic también se filtró, el 19 jul), el RUC
equivocado en la cuenta de pagos de la Avícola, y la Página de Facebook de TONIO LADT (solo la exige
Click-to-WhatsApp). Runbook actualizado: [doc 28](./arquitectura/28-alta-whatsapp-por-marca.md) — §1
(tabla de IDs), §4.7 bis (las tres trampas del token) y §8 (dos síntomas nuevos).

---

## 31 jul 2026 — La factura de Neon: $23 casi enteros por estar prendida sin trabajo

**Contexto.** Hugo vio que Neon le iba a cobrar **$22.94** y preguntó si convenía mudarse a Supabase
o si había otra salida. La respuesta resultó ser ninguna de las dos: no era el proveedor ni el
volumen de trabajo, era **un cron propio corriendo cada 5 minutos**.

### El diagnóstico

El plan Launch de Neon es **puro consumo, sin cuota fija**: $0.106 por CU-hora y $0.35 por GB-mes
(verificado en neon.com/pricing — el mínimo mensual de $5 fue eliminado).

| | |
|---|---|
| Base de datos | **118 MB** → $0.04/mes de almacenamiento (irrelevante) |
| Cómputo | $22.90 ÷ $0.106 = **~216 CU-horas** |
| Horas que tiene un mes | 730 |
| 730 h × 0.25 CU (mínimo de autoscale) | **182 CU-h = $19.35** |

O sea: **~85% de la factura era la base prendida sin hacer nada.** Los ~$3.60 restantes son el
escalado real de cuando el equipo trabaja.

**La evidencia que lo cerró**, medida el 31 de julio a las 18:33 UTC contra las dos branches:

```
PROD (ep-cool-sound)   pg_postmaster_start_time → despierta hace 12 h 32 min
DEV  (dev-hugo)        pg_postmaster_start_time → despierta hace 0.6 s
```

La branch de desarrollo dormía perfecto y despertó con la consulta del diagnóstico. Producción
llevaba despierta de corrido desde la 1:01 a.m. de Lima. **La diferencia eran los crons.**

**Por qué no dormía.** Neon auto-suspende a los **5 minutos** de silencio.
`reconciliar-cpe-sunat` corría **cada 5 minutos, 24/7** (288 veces al día) y siempre pegaba a la DB.
Reseteaba el contador de inactividad justo antes de que expirara: ni a las 3 a.m., ni un domingo,
ni en feriado llegaba a suspenderse. `repartidores-oscuros` (cada 10 min) sí tenía apagado nocturno
bien hecho, pero no servía de nada mientras el otro la mantuviera despierta igual.

El resto del sistema estaba sano: los 15 pollers del cliente ya pasaban por `usePollingVisible`
(migración de jun 2026) y se cortan solos al ocultar la pestaña.

### Por qué NO se migró a Supabase

| Opción | Costo/mes | Problema |
|---|---|---|
| Supabase Pro | **$25** | Más caro que la factura de entonces, y casi el doble del Neon optimizado |
| Supabase Free | $0 | **Sin backups.** 500 MB. Con ~35 comprobantes SUNAT diarios y la cobranza encima, no es opción |
| Neon Free | $0 | 100 CU-h y 0.5 GB por proyecto, y **suspende el proyecto** al pasarse. Aun optimizado hacen falta ~130 CU-h |
| **Neon Launch optimizado** | **~$13** | ✅ lo que se hizo |

Y migrar no era barato: **243 archivos** importan el driver de Neon, **18 `sql.transaction`** en
caminos de dinero y stock (POS, compras, caja, anulaciones), 771 puntos de consulta — 5 a 10 días
con ventana de corte. Lo decisivo: **no se usa nada de lo que hace distinto a Supabase** (0 RLS, 0
Supabase Auth, 0 Realtime, 0 Storage). Sería pagar la migración para terminar con lo mismo, más
caro. Render/Railway ($6–19 fijo) exigen la misma migración y se pierden las branches; un VPS
propio (~$5) convierte a Hugo en el DBA (backups, parches, seguridad) por $8/mes de ahorro.

### Qué se cambió

**1. Ventana de emisión, en `src/lib/ventana-operativa.ts`.** El módulo ya tenía la ventana de GPS;
se le sumó una **segunda ventana independiente** para la emisión (`dentroDeVentanaEmision`,
05:00–23:00 Lima, env `SUNAT_VENTANA_INICIO`/`_FIN`) y se extrajo el comparador `dentroDe()`. Están
deliberadamente separadas: responden a motivos distintos (privacidad vs costo) y mover una no debe
mover la otra.

El 05:00–23:00 no es al ojo. Distribución real de las horas de emisión en producción, últimos 60
días (1.855 comprobantes):

| Hora Lima | 0 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 23 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CPE | 5 | 1 | 36 | 198 | 391 | 481 | 203 | 67 | 119 | 101 | 111 | 70 | 57 | 2 | 9 | 3 | 1 |

El **99.7% cae entre las 07:00 y las 21:00**. La ventana 05:00–23:00 va con dos horas de margen a
cada lado.

**2. Gate en `api/cron/reconciliar-cpe-sunat/route.ts`.** Early-return **antes de instanciar el
cliente de Neon**, con el mismo patrón que ya usaba `repartidores-oscuros`. Y schedule de `*/5` a
`*/15` en `vercel.json`.

Resultado: de **288 corridas/día que tocaban la DB a 72**, con **6 horas de silencio garantizado**
todas las noches. Lo que quede pendiente fuera de la ventana no se pierde — lo levanta la corrida
de las 05:00 o el **saneo lazy de `GET /api/comprobantes`** en cuanto alguien abre la pantalla.

**3. `repartidores-oscuros` de `*/10` a `*/15`**, moviendo con él `OSCURO_STALE_MIN` (10 → 15), que
va atado al schedule. **No** se tocó el `OSCURO_STALE_MS` de `api/despacho/route.ts` (sigue en 10
min): es otro knob — pinta el mapa y se mide contra el heartbeat del rider (90 s), no contra el
cron. Se documentó la distinción en el propio archivo para que nadie los "sincronice" por error.

**4. Pollers.** `/api/caja-diaria` resuelve **18 consultas por request** y se llamaba cada 30 s
(~2.160 consultas/hora por pestaña abierta, el endpoint más caro del sistema) → 60 s. Y
`LeadAssignmentBanner` sondeaba cada 4 s, montado para admin + las 4 asesoras — 5 pestañas a 900
requests/hora cada una, todo el día, **para una cola que hoy recibe 1 lead por semana** (4 leads en
total, 0 en rotación al momento de medir). No se bajó a secas porque el turno de rotación dura 30 s
y ahí los 4 s son load-bearing: se hizo **adaptativo** (4 s con lead en juego, 15 s con la cola
vacía). El vencimiento del turno lo evalúa el orquestador cuando llega el siguiente mensaje
(`bot-orchestrator.ts:435`), no un reloj de pared, así que aparecer 15 s tarde no hace perder el
turno.

**5. Auto-suspend a 60 s** — cambio de consola, sin código (Neon Console → branch `production` →
Compute → "Scale to zero after"). Es lo que multiplica todo lo anterior: con suspend de 5 min y
cron cada 15, duerme 10 de cada 15 minutos; con 60 s, duerme 14 de cada 15. Cuesta ~500 ms de
arranque en frío en la primera consulta tras un silencio.

### Lo que se decidió NO hacer

El plan original incluía **sacar el `UPDATE` incondicional** de
`reconciliacion-cpe.ts:525` (el saneo de filas `emitiendo` >15 min, que corría siempre aunque no
hubiera nada). Se descartó al revisarlo:

1. **Neon se despierta con cualquier consulta**, no solo con escrituras — el `UPDATE` no era peor
   que el `SELECT` que lo acompaña. La premisa de "una escritura es la peor forma de despertar
   Postgres" no aplica al modelo de facturación de Neon.
2. Su costo real era correr **288×/día 24/7**. Con el cron ya en `*/15` y con gate, baja a ≤72×/día
   dentro de horas en que la DB está despierta igual por trabajo real. **Ahorro medible: cero.**
3. Fusionarlo con el `SELECT` en un CTE **rompería la corrección**: un CTE que modifica datos no
   expone sus cambios al `SELECT` hermano (comparten snapshot), y el comentario en
   `reconciliacion-cpe.ts:522-524` exige justamente que el saneo ocurra ANTES para que las filas
   recién marcadas `por_confirmar` se seleccionen.

Tocar el camino crítico de emisión SUNAT por $0 de ahorro es mal negocio (gotcha #58).

### El número

| | CU-horas/mes | Factura |
|---|---|---|
| Antes | 216 | **$22.94** |
| Después (crons + gate + auto-suspend) | ~125–140 | **$13–15** |
| Con los pollers aflojados | ~115–125 | **$12–13** |

**~$8–10/mes ≈ $100–120/año**, sin migrar, sin ventana de corte y sin tocar un solo dato.

### Cómo verificar que funcionó

A la mañana siguiente del deploy, contra producción:

```sql
SELECT pg_postmaster_start_time(), NOW() - pg_postmaster_start_time() AS despierta_hace;
```

Si la marca es de esa misma mañana y no de la madrugada anterior, **durmió**. A los 3 días,
comparar CU-hours/día en Neon Console → Billing → Usage.

---

## 30 jul 2026 — Cuadre de Pollo: reemplazar el Excel de Marianela

**Contexto.** Marianela (equipo de Antonio, lleva compras y proveedores) cuadra a mano en Excel, todos
los días, la merma del beneficio de pollo. Se le había construido la pestaña **"Cuadre de Mermas"** en
`/dashboard/reportes`, pero no le servía. Mandó un video de su pantalla del 30 de julio con la columna
CARGA (COMPRA) vacía y mermas de `-83.40 kg`, `-146.00 kg` por fila; una foto de su Excel con la nota
*"yo solo necesitaría un ítem para hacer este cálculo, o lo que tú colocaste cómo podría yo ingresar el
total de compras para poder analizar la merma"*; y un audio: *"todo lo que se va para delivery, que él
coloca en su hoja como corte, eso no lo estamos incluyendo en ningún lado… eso me tiene un poco
agobiada"*.

### Lo que su Excel realmente hace (descifrado de las 32 hojas de `VENTAS MARZO NELA mio.xlsx`)

No es un cuadre por producto. Es **un solo ítem: el pollo**, global del día:

```
Neto comprado   = Σ por proveedor (bruto − tara) − devoluciones     ← pollo vivo en jabas
Total salida    = clientes de campo + CORTE + CORTES ESPECIALES     ← lo beneficiado que sale
Merma real      = Neto comprado − Total salida
Merma esperada  = N° de aves × 0.32 kg
DIFERENCIA      = Merma esperada − Merma real
```

**La constante 0.32 kg/ave está verificada en las 32 hojas**: 28-02 → 217.6/680; 01-03 → 156.48/489;
05-03 → 198.4/620; 10-03 → 253.76/793; 20-03 y 31-03 → 247.36/773. Todas dan **0.32 exacto**. Los
"macho 0.35 / hembra 0.30" que anota al costado son referencia y **no entran en su fórmula** — el
código anterior sí los usaba, inventando una fórmula que nadie había validado. La DIFERENCIA también
cuadra en todas (05-03: 198.4 − 201.9 = −3.5; 31-03: 247.36 − 331.05 = −83.69).

### Las 4 causas de que no le sirviera (todas verificadas contra producción)

1. **El cuadre por producto no puede cuadrar nunca.** Se compra pollo vivo contra
   `Pollo entero con/sin menudencia` y se vende en ~20 cortes. Cada corte da merma = −(todo lo
   vendido) y el pollo entero da +(todo lo comprado). Es aritmética, no un bug.
2. **No había compras registradas desde el 26 de julio** → por eso CARGA salía vacía el día 30, sin
   ninguna explicación en pantalla.
3. **`total_pollos` / `jabas_macho` / `jabas_hembra` = 0 en el 100 % de las filas**
   (`SELECT COUNT(*) FROM compra_items WHERE total_pollos > 0` → **0**). La merma estimada que el
   código ya calculaba siempre daba 0.
4. **Faltaba el peso que sale a CORTE/delivery**: en su Excel es el **30-45 % del peso diario**
   (~500 kg de 1 650). Sin eso la merma se dispara.

### Módulos muertos encontrados

- `mermas_diarias` → **0 filas**. La "Calculadora Mermas" del sidebar nunca se usó. **Retirada.**
- `ajustes_cuadre_fisico` → **0 filas**. El "Ajuste Manual" del cuadre tampoco. Se conserva.

### Lo que se construyó

**`/dashboard/cuadre-pollo`** (ítem propio en el sidebar, grupo Producción & Compras, admin +
produccion), que reemplaza a la Calculadora de Mermas. Cuatro bloques: **1. Entró** (tabla por
proveedor con jabas/bruto/tara/neto y las devoluciones como fila propia en negativo, igual que su
"DEV. BENF."; aves macho/hembra), **2. Salió** (Campo y Planta automáticos + los 3 campos manuales de
lo que salió a picar), **3. Cuadre** (merma real vs esperada, DIFERENCIA con semáforo) y **4. Control
de delivery**. Con PDF y "Copiar Resumen" para WhatsApp.

**Decisión clave — no duplicar el peso del delivery:** el cuadre usa la **salida física a corte**, NO
lo que las asesoras facturaron. Son dos medidas del mismo flujo; sumarlas duplicaría el 30-45 % del
día. Lo facturado va aparte en el Control de delivery — que es literalmente lo que ella pidió en el
audio. Sin salida a corte digitada, el cuadre cae a lo facturado y lo advierte.

**Tolerancia:** la diferencia cuadra si `|diferencia| ≤ 1 % del neto ingresado`. Pesar ~2 000 kg tiene
ruido de varios kilos; sin esa banda, el −3.50 kg que su Excel daba por bueno salía como alerta roja.

**`productos.origen_fisico`** (`vivo` | `desposte` | `reventa`, default `reventa`): la pieza que
faltaba para separar los dos niveles de cuadre. `rendimiento_porcentaje` no servía — está en `100.00`
en los 84 productos.

### Lo que se corrigió del cuadre existente

- **Solo reventa:** `cuadre-fisico` ahora filtra `origen_fisico = 'reventa'`. Se renombró a **"Cuadre
  por Producto"** con una nota que remite al Cuadre de Pollo.
- **Filtro `kg`/`uni`:** sumaba unidades como si fueran kilos (a diferencia de `salida-carnes`, que sí
  filtraba) — por eso los dos reportes daban totales distintos para el mismo rango.
- **Fecha:** el agregado usaba `created_at` y su propio drill-down `fecha_pedido`. Ambos (y también
  `salida-carnes`) pasan a **`fecha_pedido` = fecha de ENTREGA**, que es lo correcto para un cuadre
  físico. Como ~86 % de los pedidos se entrega en fecha distinta a la de registro, **los números
  históricos de ambos reportes se movieron** — es la corrección, no un efecto secundario.

### Verificación E2E en `dev-hugo`

Se sembró la hoja **05-03-2026** (compras 1 954.75 neto con la devolución de −65.70, 620 aves, campo
1 204.55, corte 493.80 + 54.50) y la pantalla dio **exactamente** lo del Excel:

| | Excel | Sistema |
|---|---|---|
| Neto ingresado | 1 954.75 | 1 954.75 ✓ |
| Total salida | 1 752.85 | 1 752.85 ✓ |
| Merma real | 201.90 | 201.90 ✓ |
| Merma esperada | 198.40 | 198.40 ✓ |
| **DIFERENCIA** | **−3.50** | **−3.50** ✓ |

También verificado: día sin compras → banner ámbar en vez de tabla en blanco; guardar dos veces → una
sola fila en `cuadre_pollo_dia` y en `mermas_diarias` (upsert por PK `fecha`); caso rojo forzado
(−97.30 kg) → alerta correcta; el Cuadre por Producto ya NO muestra los cortes de pollo (0 filas ese
día); PDF generado sin errores; `/dashboard/produccion/mermas` → 404; Rentabilidad sigue cargando.

**Migración:** `scripts/migrate-cuadre-pollo-2026-07-30.sql` (+ rollback), aditiva e idempotente.
Detalle técnico: [doc 09 §7bis](./arquitectura/09-compras-inventario-mermas.md).

### Segunda vuelta el mismo día: que se VEA y se USE como su Excel

Hugo revisó la pantalla y señaló algo correcto: se había construido con tarjetas modernas y **rompía
el lenguaje visual de "hoja de cálculo"** que él ya había establecido en `cuadre-mermas-tab.tsx` y
`cartera-asesoras-tab.tsx` — que es justamente el que Marianela reconoce. *"Creo que ella quería algo
como su Excel, y si le damos una interfaz similar? por eso hice el cuadre de mermas."*

Al volver sobre el Excel con más detalle aparecieron **dos cosas de fondo**, no cosméticas:

**1. Su narrativa es mejor que la implementada.** Las fórmulas reales de la hoja (`E50 = N53*0.32`,
`J65 = G51-G66`) muestran que ella no calcula una pérdida: calcula **cuánto debió entrar**.

```
VENTA (lo que salió)      1,752.85
MERMA POLLO (620 × 0.32)    198.40
                        ──────────
DEBIÓ ENTRAR              1,951.25
ENTRÓ (proveedores)       1,954.75
                        ──────────
DIFERENCIA                   −3.50
```

Es algebraicamente idéntico a lo que ya había, pero se lee mucho mejor. Se adoptó como presentación;
la fórmula de `src/lib/cuadre-pollo.ts` no se tocó.

**2. Ella no teclea totales: teclea las pesadas una por una.** El **23 % de las celdas de peso de su
Excel son sumas** (218 de 942). En "CORTE" pasa **29 de 32 días, con 6.8 pesadas promedio y hasta
11**: escribe `62+62.2+62.5+61.75+62.3+62.9+58.5+61.7`. Y las aves las cuenta con `70+15+55*7+15`.
Con un input que solo aceptaba un número, **habría tenido que sumar ~7 pesadas en calculadora todos
los días** — más trabajo que su Excel. Eso ningún rediseño visual lo arregla.

**Lo construido:**

- **`src/lib/expresion-numerica.ts`** — `evaluarExpresion(texto)`, tokenizador propio (nunca `eval`,
  es entrada de usuario), con **precedencia correcta**: `70+15+55*7+15` = **485**, que son exactamente
  los machos de esa hoja; de izquierda a derecha daría 3 010. **Verificado contra las 667 fórmulas
  aritméticas reales de sus 32 hojas: 667/667 coinciden con lo que calculó Excel.**
- **5 columnas `expr_*`** en `cuadre_pollo_dia` (`migrate-cuadre-pollo-expresiones-2026-07-30.sql`)
  para guardar el texto y poder **reeditar una pesada suelta al día siguiente**. El número sigue
  siendo la fuente de verdad; el `POST` revalida en servidor y devuelve **400** si el desglose no
  cuadra con el total (probado: `"10+10" da 20, no 493.85`).
- **La pantalla es ahora una hoja**: membrete TRANSAVIC, tablas `border-collapse` con `tabular-nums`,
  filas de totales con `border-t-2`, pie "Generado el…" — el mismo lenguaje de los otros reportes.
  El orden es el de su Excel: SALIDA → VENTA + MERMA POLLO → DEBIÓ ENTRAR → PROVEEDORES (N° JABAS |
  PROVEEDOR | BRUTO | TARA | P. NETO) con las aves al costado → DIFERENCIA → CONTROL DE DELIVERY.
- El **PDF** sigue la misma narrativa e imprime el desglose de pesadas bajo cada concepto.

**Detalle de layout que costó:** el `minWidth` y el `overflow-x-auto` iban en el MISMO div (copiado
de `cuadre-mermas-tab`), y eso empujaba el layout de toda la página. El scroll va en el
**contenedor** y el ancho mínimo en el **hijo**; así la hoja scrollea sola y la página no se rompe
(verificado a 390 px).

**Verificado E2E:** la hoja 05-03-2026 sigue dando 1,954.75 / 1,752.85 / 198.40 / **−3.50**; las 8
pesadas reales dan 493.85; guardar y recargar devuelve la expresión completa, no el total; expresión
rota → botón bloqueado y celda en rojo; POST incoherente → 400.

### Tercera vuelta: flexibilidad de Excel sin perder la automatización

Hugo preguntó lo correcto: *"¿estás seguro que lo que has hecho se parece a su Excel o es mejor y más
intuitivo?"*. Al contrastarlo de verdad, la respuesta honesta fue **no**: era más automático, pero le
quitaba algo que ella sí tiene hoy.

- **Ella controla el 100 % del input en su Excel; en la pantalla controlaba el 30 %.** "Venta en
  Campo 1,204.55 kg" venía del sistema, sin poder verlo por dentro ni corregirlo.
- **Su "VENTA" es auditable línea por línea; la nuestra era un total opaco.**
- **No podía agregar conceptos propios** — y en su Excel, `CORTE` y `CORTES E.` son exactamente eso.

Y los datos reales de producción lo confirmaban: del 18 al 26 de julio las mermas daban 92–267 kg
(creíbles, su Excel da 200–330), pero el **25 de julio daba −1 837 kg** porque la compra se registró
incompleta — y ella se habría quedado sin cuadre y sin poder avanzar.

**Lo construido** (migración `migrate-cuadre-pollo-lineas-2026-07-30.sql`):

1. **Desglose inline de cada total automático.** Se toca `▸ Venta en Campo` y se despliegan los
   clientes con sus kilos, dentro de la misma tabla. Viaja en el GET principal (<80 filas/día), así
   que expandir es instantáneo. Las queries usan el MISMO WHERE que los totales — si un filtro se
   desalinea, el desglose no suma y la pantalla pierde crédito. (`/api/reportes/cuadre-fisico/detalle`
   no servía: exige `producto_id`.)
2. **Líneas propias — tabla `cuadre_pollo_lineas`.** Las columnas fijas de corte pasan a ser las tres
   líneas que se siembran por defecto, renombrables y borrables, y se pueden agregar más en salida y
   en entrada. El campo **`seccion`** es lo que protege la regla de no duplicar el peso del delivery.
   Guardado con replace-all dentro de `sql.transaction`.
3. **Corregir el total de Campo o Planta**, con **motivo obligatorio** (CHECK en la tabla + zod +
   botón bloqueado). El delta se calcula solo y la hoja muestra `el sistema calculó 1,204.55 · +45.45
   · motivo`. **El PDF lo imprime**: un cuadre corregido a mano que Antonio no puede distinguir de uno
   limpio deja de ser un control. Borrar el valor vuelve a automático.
4. **Entrada pendiente de registrar**: desbloquea el caso del 25 de julio y queda marcada en ámbar
   como recordatorio de que esa compra falta digitar en Compras.

**Verificado E2E en `dev-hugo`:** la hoja 05-03 sigue dando **−3.50** tras el refactor completo; el
desglose despliega los clientes y suma el total; las líneas persisten con su expresión
(`Corte especial = 16+38.5`); sin motivo el botón se bloquea y con motivo guarda `+45.45`; un día sin
compras deja de estar bloqueado al cargar una entrada a mano (1074+97.2 = 1 171.20 kg, 51 jabas); y
el CASCADE borra las líneas junto con el día.

**Detalle que costó encontrar:** el desglose "no se desplegaba" — resultó que el selector de la prueba
estaba clickeando el acordeón **del sidebar**, que también se llama "Venta en Campo". El componente
funcionaba desde el principio.

### Cuarta vuelta: auditoría antes de que lo use nadie

Hugo preguntó si faltaba algo y reportó que "hay campos donde solo deben aceptarse números pero se
pueden escribir letras". Tenía razón, y la auditoría destapó bastante más — **incluyendo bugs que se
habían introducido en las dos vueltas anteriores**. `cuadre_pollo_dia` tenía **0 filas en
producción**, así que se cerraron antes de que ella cargara el primer día.

**El peor: un error de 1000× que la propia pantalla inducía.** La hoja muestra 2 450 kg como
`2,450.00`; al teclear `2,450` copiando ese formato, el parser leía la coma como decimal y guardaba
**2.45 kg**, sin error y con la celda en ámbar. Ahora la coma se resuelve por forma:
coma + 3 dígitos que no siguen con otro = miles (`2,450`=2450, `1,234,567`=1234567); coma + 1-2
dígitos al final = decimal (`2,5`=2.5). **Las 667 fórmulas del Excel siguen dando 667/667.**

**Perdía el trabajo del día con una flecha del teclado.** Cambiar la fecha recargaba y pisaba todo lo
tecleado sin aviso — y en un `<input type="date">` cada pulsación ↑/↓ emite un `change` válido. Ahora
hay confirmación (detectando cambios por comparación contra una foto de lo cargado, no marcando
"sucio" en diez setters) y `beforeunload` al recargar.

**Podía guardar en el día equivocado.** `cargar()` no cancelaba la petición anterior: al saltar
30 → 29, si la respuesta del 30 llegaba después, guardar escribía las líneas del 30 sobre el día 29.
Se agregó `AbortController` y, como última defensa, **Guardar se bloquea si `data.fecha !== fecha`**.

**El espejo a `mermas_diarias` podía dejar Rentabilidad en blanco.** Escribía `mermaPct` sin tope; un
cuadre guardado con la compra cargada y sin ventas da 100 % → rendimiento 0 → `costoRealPorKg` =
`Infinity` → JSON lo serializa `null` → `.toFixed()` revienta. Además `porcentaje_merma` es
`DECIMAL(5,2)` y el DELETE+INSERT no era transaccional con el catch silenciado: un overflow borraba
la fila y el usuario veía "Cuadre guardado" en verde. Ahora: clamp, solo se escribe con el día
completo, todo en una `sql.transaction`, el DELETE corre siempre, y `rentabilidad` acota el
rendimiento a un piso del 1 %.

**Doble conteo de la entrada manual.** El **83 % de las compras se registran con retraso** (3.9 días
de promedio, hasta 18) y **Marianela es la única que las registra** (102 de 102): cargaba la entrada a
mano hoy y, al digitar esa compra días después, el día pasaba a contar ambas. Ahora se detecta por
nombre de proveedor y sale un aviso rojo con nombre y kilos —
*"AVICOLA EL RICO ya está en Compras con 1,171.20 kg. Estás contando esos kilos dos veces"*— sin
borrar nada solo, porque podría ser legítimamente otra compra.

**Se quitó el fallback "usar lo facturado".** Era una idea de la v1 y causaba tres problemas: se
apagaba con cualquier línea que no fuera corte (bastaba una de "Muestras 5 kg" para inflar la merma
~845 kg y disparar una alarma falsa), el cliente no lo replicaba —así que el PDF que ella mandaba por
WhatsApp no coincidía con lo guardado— y sobre todo inventaba un número en vez de decir que falta uno.
Ahora, si falta la salida a picar, el cuadre lo dice.

**Además:** los campos filtran la entrada (jabas solo dígitos — antes `"5o"` se guardaba como 0 en
silencio; las pesadas solo dígitos y operadores), los resultados negativos se marcan en rojo antes de
enviar en vez de morir en un 400 mudo, y el chip de Macho/Hembra de Compras (que llevaba **0 filas**
cargadas, dejando la merma esperada en 0) pasa a botón ámbar con "⚠️ Falta clasificar M/H".

**Sobre la rueda del mouse:** Hugo pidió verificar que no se puedan cambiar números scrolleando. El
guard global **ya existía** en `DashboardLayout` y cubre los ~62 inputs del sistema; solo estaba
declarado `{ passive: false }` sin llamar nunca a `preventDefault()`, penalizando el scroll de toda
la app. Se corrigió a `passive: true`.

**Lo que se descartó al verificar:** acotar el menú de Marianela con `vistas_permitidas`. La lista
propuesta le habría bloqueado el trabajo — aparece como autora en `ventas_avicola` (161),
`transacciones` (110) y `pagos_proveedores` (109), no solo en compras.

**Fuera de alcance (anotado):** la **cartera diaria de campo** (la zona izquierda de su hoja: ~43
destinos con SALDO ANTERIOR / A CUENTA / saldo final). Existe a medias en
`/dashboard/clientes-avicola/liquidacion`, sin saldo anterior anclado a la fecha, sin kg ni precio
por cliente y sin exportar. El molde para copiarlo es `cartera-asesoras-tab.tsx` +
`api/reportes/balance-asesoras`; además hay que decidir qué es "DESCT.", que **no existe en el modelo
de campo**.

---

## 20 jul 2026 (tarde) — Segunda marca en WhatsApp: el código listo para el RUC 10

**Contexto (pedido de Hugo):** Transavic (RUC 20) ya opera en WhatsApp desde el 19 jul. Ahora toca
**La Avícola de Tony (RUC 10)**, cuyo portfolio **TONIO LADT** (`2200578807071141`) ya fue
**verificado**, con el número **+51 936 303 850**. La duda concreta: *¿se agrega la cuenta de WhatsApp
al portafolio y luego se une a la app de Meta for Developers?*

### El hallazgo que cambió el plan: UNA APP POR PORTFOLIO
Investigación con 32 agentes (7 frentes + verificación adversarial; 20 afirmaciones confirmadas contra
doc oficial de Meta, 4 refutadas). Conclusión:

> **La app "Transavic CRM" (`1043268678158460`) NO puede operar la WABA del RUC 10.** Es propiedad de
> TONIO DAT y Meta exige **Advanced access** del permiso `whatsapp_business_management` para que una
> app acceda a WABAs *"not owned by your business"*; sin él **toda llamada devuelve error 200**. Ese
> acceso se obtiene por App Review dentro del programa Tech Provider (pensado para quien atiende
> negocios ajenos); para uso propio Meta deriva a la guía normal de Cloud API. **Dos portfolios del
> mismo dueño humano son "negocios distintos" para Meta** → La Avícola de Tony necesita **su propia
> app**, su propia WABA, su propio System User y su propio token.

Se **descartó** crear la WABA de Avícola dentro de TONIO DAT (funcionaría con una sola app, pero mezcla
las dos personas jurídicas, desaprovecha la verificación del RUC 10, ata display name/facturación al
RUC 20 y **es irreversible**: una WABA no se migra entre portfolios).

**Consecuencia técnica:** dos apps = **dos App Secrets**. El webhook sigue siendo UNO (misma URL, mismo
`META_VERIFY_TOKEN`, que solo interviene en el handshake GET), pero Meta firma cada POST con el secret
**de la app que entrega el evento**. Con un solo `META_APP_SECRET` todo el tráfico de Avícola se habría
rechazado con **401 en silencio**.

### Otras correcciones a la doc previa (gotcha #52)
- *"Las plantillas proactivas exigen verificación desde ene-2026"* → **no confirmable** en doc oficial.
  Lo verificable es que la verificación sube **cupos** (250 → 2 000 destinatarios únicos/24 h). Lo único
  oficial fechado el 1-ene-2026 es un ajuste **tarifario** por país.
- *"La ventana de 72 h del CTWA permite texto libre"* → **no**: la de 72 h es de **gratuidad**; la de
  **24 h** sigue gobernando *qué* se puede enviar (*"if the customer service window closes, you will only
  be able to send template messages"*). El 409 "fuera de ventana" del CRM debe seguir atado a las 24 h.
- Los **límites de mensajería son por portfolio** (desde 7-oct-2025): LADT arranca en 250 aunque
  Transavic esté escalada. No hereda nada.

### Entregable (código)
1. **Webhook multi-secret** (`api/webhooks/meta/route.ts`): `appSecretsConfigurados()` reúne
   `META_APP_SECRET` + `META_APP_SECRET_AVI` y `firmaValida()` acepta si **alguno** valida el HMAC del
   body crudo (con `timingSafeEqual`). Aditivo — Transavic no cambia. De yapa permite **rotar un secret
   sin downtime**. El payload de WhatsApp no trae `app_id`: la firma es el único discriminador válido.
2. **Rotación de asesoras POR MARCA** (`bot-orchestrator.ts`): `rotateAndSelectCandidate(sql, empresa)`.
   El patrón y la hora de reset siguen compartidos (es lo que administra la UI), pero
   `sequenceIndex`/`lastResetDate` viven en `porMarca.tra` / `porMarca.avi` dentro del mismo JSONB;
   la reserva del turno sigue siendo **un solo `UPDATE … jsonb_set … RETURNING`** (gotcha #56b) y la
   siembra copia el índice de la raíz para "tra" (no salta de turno con el despliegue). El **desempate
   por carga del día se deriva de `leads`** filtrando por empresa, en vez de `users.leads_recibidos_hoy`
   (contador global que se conserva intacto para la pantalla de rotación y `/atender`).
3. **Idempotencia real por `message.id`**: el `SELECT`+`INSERT` (check-then-act) permitía que dos
   reintentos concurrentes de Meta pasaran ambos y **el bot respondiera dos veces**. Ahora
   `INSERT … ON CONFLICT (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL DO NOTHING
   RETURNING id` apoyado en el índice único parcial nuevo.
4. **La bandeja abre el lead del push** (`crm-leads-client.tsx`): lee `?leadId=` de la URL, consulta el
   lead, **posiciona el filtro en SU marca** y abre el chat (antes arrancaba fija en Transavic y un lead
   de Avícola quedaba invisible). Se lee de `window.location` para no forzar un Suspense boundary.
5. **Bug de fecha encontrado durante las pruebas**: `todayDateStr` salía de `toISOString()` sobre una
   fecha ya convertida a Lima → de noche guardaba **la fecha de MAÑANA** y el reset diario se saltaba una
   jornada. Ahora `toLocaleDateString("en-CA", { timeZone: "America/Lima" })`.

**Migración:** `scripts/migrate-crm-idempotencia-wamid-2026-07-20.sql` (+ rollback) — índice **único
parcial** `ux_lead_mensajes_wamid` y baja del `idx_lead_mensajes_wamid` redundante. El saneo previo de
duplicados **no borra filas**: pone su wamid en NULL (quedan fuera del índice parcial). Aplicada en
`dev-hugo` y en **producción** (0 duplicados en ambas).

### Verificación (dev server contra `dev-hugo`, con secrets de prueba)
`tsc --noEmit` limpio. Seis POST simulados: (1) Transavic firmado con el secret TRA → 200 y lead
Transavic; (2) Avícola firmado con el secret AVI → 200 y lead Avícola **con el mismo teléfono**
(ruteo por `phone_number_id` ✔); (3) firma inválida → **401**; (4) cuerpo de Avícola firmado con el
secret de Transavic → 200 (firma válida de una app conocida); (5) reintento del mismo `message.id` →
200 **sin duplicar mensaje ni respuesta del bot**; (6) `phone_number_id` desconocido → ignorado.
Rotación: 3 leads nuevos de Avícola movieron `avi.sequenceIndex` 1 → 4 dejando `tra` en 1, y se
repartieron entre 3 asesoras distintas. Datos de prueba borrados y `.env.local` restaurado.

**Descubierto de paso:** la branch `dev-hugo` no tenía las columnas del "golden ticket"
(`estado_asignacion`, `candidato_actual`, `candidatos_nivel`…) — cualquier lead nuevo reventaba ahí.
Se alineó aplicando `scripts/migrate-lead-claim.sql` (producción sí las tenía).

### Textos del CRM por marca (mismo día, después de auditar la cuenta de Meta)
Con dos marcas en la misma bandeja, un texto escrito para una podía enviarse a un cliente de la otra:
- **Plantillas** (`TemplateModal.tsx`): el default `saludo_personalizado` decía *"del equipo comercial de
  Transavic y Avícola de Tony"*. Ahora hay un saludo POR MARCA (mismo `name`, textos distintos: en Meta
  las plantillas viven **por cuenta de WhatsApp**, así que cada marca resuelve la suya) y el modal recibe
  `empresa` y **solo ofrece las de esa marca** (las que no declaran marca siguen sirviendo para ambas).
  Si la marca no tiene ninguna, avisa y deshabilita el envío en lugar de mandar una plantilla inexistente
  (error 132001 de Meta).
- **Respuestas rápidas** (`crm_quick_replies`): campo `empresa` opcional; el gestor tiene selector
  ("Las dos marcas" / "Solo …") y etiqueta de color en la lista, y el chat solo ofrece las de la marca del
  lead. El atajo ahora es único **dentro de la marca** (cada marca puede tener su `/precios`; una común
  choca con todas). Estas se envían con el texto LITERAL, así que eran las más riesgosas.
- **Bot de bienvenida** (`WelcomeBotConfig`): su saludo por defecto ya no nombra a ninguna marca — esa
  configuración es compartida y la identidad la pone `PERFIL_MARCA` del bot de IA.

Todo es retrocompatible: lo ya guardado en `settings` no tiene `empresa` y sigue apareciendo en las dos.

### Lo que falta (trámite de Antonio en Meta, runbook completo en el plan)
Crear la WABA en TONIO LADT → método de pago → app propia *"Avicola de Tony CRM"* → alta y verificación
del número → System User propio con token permanente → `POST /{phone_number_id}/register` con el PIN
(**solo existe por API**; máx. 10 intentos por 72 h) → `POST /{waba_id}/subscribed_apps` → webhook con el
**mismo** `META_VERIFY_TOKEN` → cargar en Vercel `META_APP_SECRET_AVI`, `WHATSAPP_AVI_PHONE_NUMBER_ID`,
`WHATSAPP_AVI_TOKEN`, `WHATSAPP_AVI_WABA_ID` y **redeploy** (sin él la marca queda en modo mock sin
avisar). Para publicidad hace falta además una **Página de Facebook** dentro de LADT (hoy tiene 0).

---

## 20 jul 2026 — CRM: rediseño claro, feedback del bot, 4 bugs y estudio del CRM de Conexipema

**Contexto (pedido de Hugo):** mejorar la interfaz de `/dashboard/crm-leads` (se veía oscura),
quitar el Kanban (no lo usa), dar feedback de que el bot está pensando —decidió que se vea **a la
asesora en el CRM**, no al cliente— y **estudiar el CRM de `conexipema-eventos`** (su asignación
"golden ticket") para traer lo que sirva.

### Lo más valioso del estudio no fueron features: fueron 4 fallas activas
Verificadas leyendo el código, no asumidas:
1. **El mensaje de error del bot nunca llegaba al cliente.** El `catch` devolvía el texto de disculpa
   pero el webhook llama `await handleInboundMessage(...)` **sin usar el retorno** y el envío vive
   dentro del `try`. Si Gemini/Groq fallaban, el cliente no recibía nada. *(Regresión introducida el
   19 jul al mover el envío al orquestador.)* → helper `persistirYEnviarBot`, usado por el camino
   normal **y** por el catch.
2. **Carrera real en `sequenceIndex`.** Se leía con `SELECT` y se escribía con un UPSERT aparte, sin
   lock. Dos WhatsApp del mismo segundo (normal a las 5am) consumían el mismo índice → el patrón
   60/25/15 se degradaba y **ambos leads caían en la misma asesora**; además el UPSERT persistía el
   `config` leído antes y podía pisar el `lastResetDate`. → **un solo** `UPDATE … jsonb_set …
   RETURNING`. **Verificado**: 5 reservas concurrentes devolvieron 5 índices distintos (6,9,7,8,10) y
   el contador quedó exacto.
3. **`[HANDOFF]` se limpiaba sin flag `/g`** → si el modelo lo escribía dos veces, el segundo tag
   llegaba **visible al cliente**; y `[handoff]` en minúscula no se detectaba (venta caliente
   atrapada con el bot para siempre).
4. **Salida del LLM sin sanear** con `maxOutputTokens: 250` pidiendo "2 o 3 oraciones" → riesgo de
   mandar una frase cortada firmada por la marca. → `src/lib/chatbot/sanear-respuesta.ts`
   (`esRespuestaUsable`, `pareceTruncada`, `sanearRespuestaBot`, `pideHandoff`) y tope a 400.

### Interfaz
256 clases `dark:` eliminadas (código muerto) y superficies oscuras base a paleta clara; **Kanban
eliminado** (272 líneas + `DragDropContext` + `viewMode`; `@hello-pangea/dnd` se queda por Despacho;
`GuiaModulo` rescatada al estado vacío del chat); colores de marca corregidos (Transavic rojo /
Avícola ámbar, estaban invertidos); polling migrado a `usePollingVisible`.

⚠️ **Dos trampas encontradas al hacerlo** (verificadas en el navegador, no por el compilador):
- El mapeo masivo `bg-slate-900 → bg-white` **rompió el velo de los modales** (`bg-slate-900/60` →
  `bg-white/60`). Los overlays deben seguir siendo oscuros. Mismo problema en el estado seleccionado
  de `QuickReplySelector`, que quedó blanco sobre blanco.
- `usePollingVisible` **no re-ejecuta su efecto al cambiar `leadId`** (solo depende de `enabled`), así
  que al abrir una conversación el detalle quedaba en blanco hasta el siguiente tick. Y como la
  pestaña automatizada reporta `document.hidden = true`, la bandeja no cargaba nada. Solución: la
  **carga inicial va en su propio `useEffect` y es incondicional**; el helper solo gobierna el refresco.

### Feedback del bot (`leads.bot_pensando_desde`)
Migración `migrate-crm-bot-pensando-2026-07-20.sql` (aplicada a dev-hugo y producción por psql antes
del deploy). El orquestador lo prende antes de `callIA()` y lo apaga en un `finally`; la UI muestra
burbuja animada en el chat y badge en la lista **solo si la marca tiene < 60 s**, para que un flag
colgado por un crash no deje el indicador encendido. Probado end-to-end simulando el flag en dev-hugo.

### Backlog priorizado del estudio de Conexipema (NO implementado)
| # | Qué | Por qué a esta avícola | Esfuerzo |
|---|---|---|---|
| 1 | **Reenganche de clientes fríos** cruzando `leads.telefono` con `pedidos.created_at` | El chifa que pedía 40 kg cada martes y lleva 12 días sin pedir ya se fue y nadie se entera. **El que más dinero recupera.** Umbrales en `settings.parametros_negocio` (gotcha #45b) | medio |
| 2 | **Lock por lead + debounce 6 s** | El cliente escribe en ráfaga ("20 kg" / "para mañana" / "en Surco") → hoy son 3 llamadas a la IA y 3 respuestas encimadas. La única guarda actual (idempotencia por `wamid`) cubre el reintento del MISMO mensaje, no mensajes distintos | medio |
| 3 | **Horario de atención real** | `WelcomeBotConfig.tsx` **hoy es decorativo**: guarda `crm_welcome_bot` en settings y ningún proceso lo consume. La avícola arranca 4:30am — reusar `src/lib/ventana-operativa.ts` | medio |
| 4 | Cruzar el teléfono entrante contra la cartera de clientes | Un cliente de un año entra como lead "Nuevo" anónimo | bajo |
| 5 | **Golden Ticket**: exclusividad 15 s → escalar al nivel → rescate → `sin_atencion`, con claim atómico | Si Leslie está en ruta, el lead muere en su bandeja. En Postgres el claim es `UPDATE … WHERE estado_asignacion='en_cola' RETURNING` (mismo patrón que gotcha #49). No hace falta QStash: Vercel Pro da 40 crons | alto |
| 6 | Handoff tipado JSON + telemetría del bot | Hoy no hay forma de responderle a Antonio "¿el bot sirve?" con datos | medio |
| 7 | Normalizar teléfono a E.164 | `replace(/\D/g,"")` en 3 lugares sin unificar el prefijo 51 → `ux_leads_telefono_empresa` no deduplica bien | bajo |
| 8 | Latencia humana del bot + opt-out ("BAJA") | Percepción de robot; el opt-out lo exige la política de Meta al escalar envíos | bajo |

---

## 19 jul 2026 (tarde) — Estado REAL de Meta, dominios por marca y remitente de correo por marca

**Contexto:** tras dejar el CRM cableado (entrada anterior), se entró a la **cuenta real de Meta de
Antonio** ("Toñito") para ejecutar el runbook. Lo que se encontró cambió el plan, y en paralelo Hugo
compró **`laavicoladetony.com`** para el RUC 10 (ya existía `transavic.com` para el RUC 20).

### Estado REAL de los portfolios (verificado en la cuenta, no asumido)
| | TONIO DAT (RUC 20 / Transavic) | TONIO LADT (RUC 10 / Avícola de Tony) |
|---|---|---|
| `business_id` | `1324982862317136` | `2200578807071141` |
| Verificación | ✅ **Verificado** | ❌ **RECHAZADA** |
| WABA | ✅ **"Transavic20"** (`591728093936452`), Aprobada | ❌ ninguna |
| Número | ✅ **+51 936 889 205** — Conectado | ❌ ninguno |
| Página FB | ✅ 1 | ❌ 0 (la necesita para Click-to-WhatsApp) |
| Razón social | TONIO DAT | `RESURRECCION GAMARRA TONIO` ✅ (correcta para RUC 10) |

**Dato clave:** Transavic estaba MUCHO más avanzado de lo asumido (ya tenía WABA + número conectado).

### 🚧 Bloqueo duro encontrado: falta método de pago
En el WhatsApp Manager de Transavic: *"Falta un método de pago válido — Solo los clientes pueden iniciar
conversaciones gratuitas. **No podrás enviar mensajes a los clientes hasta que añadas un método de pago**."*
Consecuencia doble: el botón **"Añadir número de teléfono" queda DESHABILITADO** (por eso no se pudo
registrar el chip nuevo `+51 960 666 114`) **y el CRM no podría responder**. Matiz importante que
faltaba en el análisis previo: *no hace falta verificar la empresa para operar*, pero **sí hace falta una
tarjeta en archivo para poder enviar** — son requisitos distintos. Antonio quedó de cargarla. Las otras
3 alertas del panel son informativas (agenda de contactos, 24h gratis por anuncios CTWA, API de marketing).

### Motivo EXACTO del rechazo de la verificación del RUC 10
Meta (Centro de seguridad → Verificación de la empresa → "Más información"):
> *"No podemos verificar que el **sitio web empresarial** está asociado con la empresa RESURRECCION
> GAMARRA TONIO porque **la razón social debe aparecer en el sitio web**."* → arreglar con **una** de:
> (a) que el nombre legal aparezca en el sitio web, o (b) subir un nuevo documento acreditativo.

**NO era por ser persona natural** (la hipótesis inicial) ni por poner la marca como nombre legal (el
nombre legal ya estaba correcto). Por eso `laavicoladetony.com` es justo la pieza que lo destraba:
publicar una página con `RESURRECCION GAMARRA TONIO` + `RUC 10710548841` + `Cal. Las Esmeraldas 624,
Urb. Balconcillo, Lima`, declarar el dominio en el portfolio y reintentar.

### Correo por marca (implementado)
Investigación verificada contra fuentes oficiales: **Zoho Mail free aloja 1 solo dominio por
organización** (→ la 2ª marca necesita otra cuenta Zoho, con otro email de registro; el free tampoco
tiene IMAP/POP); **Brevo free admite varios dominios remitentes en UNA cuenta** (no hace falta una 2ª)
pero los **300 correos/día son de la cuenta y se comparten**; y **Meta prohíbe tener 2 cuentas
personales** (una sola administra varios portfolios). De ahí las decisiones: gmail nuevo **solo** como
email de registro de la 2ª organización Zoho, **un solo perfil de Chrome**, y una sola cuenta Brevo.

Código: `resolverRemitente()` en **`src/lib/brevo.ts`** (fuente única, usada por la rama Brevo y la
SMTP de `lib/email.ts`) resuelve el remitente por marca desde `BREVO_TRA_*`/`BREVO_AVI_*` con **fallback
a `BREVO_SENDER_*`** (cero regresión sin las vars nuevas). `comprobantes/[id]/enviar` pasa
`empresa: c.empresa` — la columna ya guarda el `EmpresaId`. **Gotcha DNS crítico:** un dominio debe
tener **UN SOLO registro TXT SPF** que incluya ambos proveedores
(`v=spf1 include:zoho.com include:spf.brevo.com ~all`); dos SPF separados invalidan la autenticación.

### ✅ Setup de WhatsApp de Transavic COMPLETADO y PROBADO EN VIVO (19 jul 2026, noche)
Todo el runbook se ejecutó: cuenta de desarrollador, App **Transavic CRM** (`1043268678158460`),
WABA del CRM (`883642441471852`), número **+51 960 666 114** (`phone_number_id 1181655271701439`,
`status CONNECTED`, display name "Transavic" APROBADO), webhook verificado por Meta con `messages`
suscrito, usuario del sistema `CRM Transavic` (`61591800645031`) con token permanente, y las 6 env
vars en Vercel. **Prueba end-to-end real:** un WhatsApp desde un celular al número creó el lead en
producción con `empresa=Transavic` (ruteo por `phone_number_id` ✔), lo asignó a una asesora por
rotación ✔, abrió la ventana de 24h ✔, la IA generó la respuesta ✔, se envió por la Graph API ✔ y el
webhook de `statuses[]` la marcó como **leída** ✔. Detalle del `status: PENDING → CONNECTED`: el
flujo de la UI se corta a medias; se completa con `POST /{phone_number_id}/register` + el PIN.

### ⏳ Pendientes anotados (no bloquean, pero conviene cerrarlos)
1. **Prompt del bot consciente de la marca** (`src/lib/chatbot/bot-orchestrator.ts`): el system prompt
   está escrito para las DOS marcas ("Transavic y Avícola de Tony") porque se hizo antes del ruteo por
   `phone_number_id`. Ahora el CRM SÍ sabe a qué marca escribió el cliente → hay que **pasarle
   `empresa` al prompt** para que quien escribe al número de Transavic vea solo Transavic. Confirmado
   en la prueba en vivo: el bot saludó mencionando ambas marcas.
2. **Rotar el token de WhatsApp** (`WHATSAPP_TRA_TOKEN`): el token de System User se compartió en
   texto plano en un chat con la IA el 19 jul 2026 y **no caduca**. Rotarlo ahora que el flujo ya está
   validado: Business Settings → Usuarios del sistema → *CRM Transavic* → *Revocar identificadores* →
   generar uno nuevo → `vercel env rm/add WHATSAPP_TRA_TOKEN production` → redeploy. Igual criterio
   para las contraseñas de Google/Zoho que se compartieron (prioridad: **activar 2FA**).
3. **Inscribir los bancos de datos en el RNPD** (`sipdp.minjus.gob.pe`, gratuito y automático), uno por
   RUC. Obligación formal vigente; ver gotcha #54.
4. **Publicar la app de Meta** (no bloqueó los mensajes de WhatsApp, pero conviene). Ya existe la URL
   de política de privacidad que exige: `https://transavic.com/privacidad`.
5. **RUC 10 / La Avícola de Tony:** reintentar la verificación ahora que `laavicoladetony.com` publica
   la razón social; luego crearle Página de Facebook, WABA, número y su propio usuario del sistema.

---

## 19 jul 2026 — CRM WhatsApp REAL para las dos marcas (Meta Cloud API) + deep research de verificación

**Contexto (pedido de Hugo):** completar el CRM para que reciba y responda por WhatsApp de verdad, con
**dos números** (uno por marca: Transavic RUC 20 / Avícola de Tony RUC 10), cada uno conectado a su
**Business Portfolio de Meta** para hacer publicidad **Click-to-WhatsApp (CTWA)**. La duda central: ¿hace
falta **verificar la empresa** en Meta para poder hacerlo, dado que el RUC 20 ya está verificado pero el
RUC 10 (persona natural, marca "La Avícola de Tony") aún no?

**Deep research (workflow `w2upuo65t`, 11 agentes, 4 afirmaciones críticas verificadas adversarialmente
contra la doc oficial de Meta 2025-2026). Conclusiones:**
- **NO se necesita verificar para OPERAR/publicitar.** Un negocio sin verificar puede registrar el número,
  **recibir entrantes sin tope**, responder libre dentro de la ventana (24h de servicio / 72h si vino de un
  anuncio) y enviar hasta **250 destinatarios únicos/día** iniciados por el negocio. Verificar solo sirve para
  **escalar** ese tope (250 → 2.000 → 10.000 → … → ilimitado) y, **desde ene-2026, para enviar plantillas
  proactivas** (Meta exige verificación + URL de política de privacidad). El volumen (~30 pedidos/día) está
  muy debajo de 250. → El RUC 10 puede publicitar y atender por el CRM sin verificar; solo no puede mandar
  plantillas de re-enganche en frío hasta verificarse.
- **Arquitectura obligatoria:** una WABA pertenece a **un solo portfolio** y no se migra → dos marcas en dos
  portfolios = **dos WABAs, un número cada una**. El webhook es COMPARTIDO; se ruteá por
  `value.metadata.phone_number_id`. Para CTWA, la Página + WABA + ad account deben vivir en el MISMO portfolio.
- **RUC 10 (persona natural):** Meta acepta "sole proprietorship". El rechazo típico NO es por ser persona
  natural sino por poner el **nombre comercial como nombre legal**. Regla: nombre legal = nombre de Antonio
  exacto como en la **Ficha RUC de SUNAT** (equivale al "tax/VAT registration certificate"); "La Avícola de
  Tony" va como nombre comercial / Alternative Business Name + nombre de la Página.
- **Lado técnico:** modelo self-serve de uso propio (NO Tech Provider Program / NO App Review completo para
  operar tus propias WABAs). 1 App en Meta for Developers, producto WhatsApp, webhook con verify token suscrito
  a `messages`, **token permanente System User por portfolio** (permisos `whatsapp_business_messaging` +
  `whatsapp_business_management`).

**Estado previo del código:** la UI del CRM (`crm-leads-client.tsx`) YA estaba hecha para dos marcas (selector
Transavic / Avícola de Tony, media, plantillas, respuestas rápidas) y `leads.empresa` existía, pero **todo el
cableado con Meta era mock**: el webhook no leía `phone_number_id`, el saliente era `console.log`, no había
credenciales ni manejo de la ventana de 24h, y `leads.telefono` era `UNIQUE` global.

**Entregable (implementación):**
- **Migración `scripts/migrate-crm-whatsapp-2026-07-19.sql`** (+ rollback): unicidad `leads` pasa de `telefono`
  global a compuesta **`(telefono, empresa)`**; nuevas columnas `leads.last_inbound_at` (ventana 24h),
  `leads.ctwa_clid/ctwa_source_id/ctwa_headline` (atribución del anuncio); `lead_mensajes.media_url/
  whatsapp_message_id/estado/error_msg` + índice por `whatsapp_message_id`. Backfill de `last_inbound_at` con
  el último entrante. Aplicada y verificada en `dev-hugo`.
- **Módulo nuevo `src/lib/whatsapp/`**: `config.ts` (credenciales por marca `WHATSAPP_TRA_*`/`WHATSAPP_AVI_*`,
  `empresaDesdePhoneNumberId`, `isWhatsAppConfigured`) + `sender.ts` (`enviarTexto/enviarMedia/enviarPlantilla`,
  subida/descarga de media como dataURL, detección del error 131047 = fuera de ventana; **nunca lanza**).
- **Webhook `api/webhooks/meta/route.ts`** reescrito: rutea por `phone_number_id` (con fallback a "Transavic"
  solo si NINGUNA marca está configurada = mock; si hay marcas pero el id no matchea → se IGNORA como tráfico
  ajeno), maneja **texto + media + `referral`** (CTWA), **idempotencia por `message.id`**, procesa `statuses[]`
  (estado de entrega, sin degradar 'leido'), `maxDuration=60`.
- **`bot-orchestrator.ts`**: firma `handleInboundMessage(telefono, nombre, cuerpo, empresa="Transavic", opts)`;
  lead scoped por `(telefono, empresa)`; setea `empresa`/`last_inbound_at`/ctwa; **envía la respuesta del bot de
  verdad** por WhatsApp y persiste su estado. Backward-compatible con `scripts/test-crm-flow.mjs` (3 args).
- **`api/crm/leads/[id]/mensajes/route.ts`**: envío real por la empresa del lead (texto/media/plantilla), schema
  ampliado con `templateName/language/variables`, **gate de ventana 24h** (409 si está cerrada y no es plantilla),
  persiste `whatsapp_message_id/estado/error_msg`. Modo mock si la marca no tiene credenciales (no frena pruebas).
- **`api/crm/leads/route.ts`**: el anti-duplicado de creación manual ahora es por `(telefono, empresa)`
  (coherente con la nueva unicidad — antes bloqueaba el mismo teléfono en la otra marca).
- **UI `crm-leads-client.tsx` + `types.ts`**: `handleSendTemplate` manda nombre/idioma/variables de la plantilla
  (antes descartaba todo salvo el preview); `handleSendMessage` acepta `extra` y muestra el error real del server
  (ej. ventana cerrada) vía toast; render del **estado de entrega** (✓/✓✓/leído azul/⚠ rojo) en salientes.

**Verificación:** `tsc --noEmit` OK. Webhook ejercido con POST simulados contra el dev server (runtime no
afectado por el bug Node 26 de `@neondatabase/serverless`): (1) lead creado + ruteado + mensaje guardado + bot
respondió (mock); (2) **idempotencia** sostenida (2 POST mismo `message.id` → 1 mensaje); (3) **ruteo por marca**
con dos `phone_number_id` de prueba → mismo teléfono generó DOS leads (Avícola de Tony vs Transavic); (4) `phone_
number_id` desconocido → **ignorado** (0 leads). `.env.local` restaurado y datos de prueba limpiados. Sin errores
en los logs del server.

**Runbook de Meta (pasos del usuario, con acompañamiento en el navegador):** conseguir 2 números nuevos por
marca; en cada portfolio, Página + ad account + WABA; App en Meta for Developers + producto WhatsApp + webhook
(`messages`) + "Ads Attribution"; token System User por portfolio; verificar el RUC 10 (nombre legal = persona,
Ficha RUC); cargar `WHATSAPP_*` en Vercel. **Límite de seguridad:** crear/loguear cuentas, meter contraseñas,
subir la Ficha RUC y cargar el método de pago de anuncios los hace el usuario en persona.

**Env vars nuevas:** `WHATSAPP_API_VERSION` (default v21.0), `WHATSAPP_TRA_PHONE_NUMBER_ID/TOKEN/WABA_ID`,
`WHATSAPP_AVI_PHONE_NUMBER_ID/TOKEN/WABA_ID`. Ver gotcha #52 y [doc 15 §5](./arquitectura/15-asistente-ia.md).

---

## 13 jul 2026 — POS de planta: "Ventas de Planta" (ver por día/semana) + ANULAR una venta

**Contexto (pedido de Ariana/Hugo):** el POS no daba visibilidad de las ventas de planta por
día/ayer/semana ni tenía apartado en el menú, y **no se podía eliminar/editar una venta** (Ariana hizo
una de prueba de S/8.90 y no la podía borrar). Es dinero + inventario reales en producción → reversión
atómica, con guardas y revisada adversarialmente antes de desplegar.

**Entregable (commit `9079949`, buildId prod `B8UkaSPdHE8ip5CZeBFLP`):**
- **Vista `/dashboard/pos-planta/ventas`** (`ventas-planta-client.tsx`, admin+produccion, chip violeta 🏭):
  lista el POS por **Hoy / Ayer / Esta semana / fecha** vía `GET /api/pos/ventas?desde=&hasta=` (espejo de
  `GET /api/avicola/ventas`) — hora, cliente, productos, total, a qué caja/cuenta cayó, badge de comprobante
  y "· ANULADA". Resumen (Vendido/Ventas) excluye anuladas. Entrada nueva en el sidebar bajo 🏭 Venta en Planta.
- **Anular = eliminar reversando dinero + stock** (`POST /api/pos/ventas/[id]/anular`). **Diseño atómico
  (endurecido tras revisión adversarial multi-agente):** la reversión es UNA sola `sql.transaction` y el
  "claim" (`pedidos.anulada=TRUE`) es su PRIMERA sentencia; si el claim se pierde por una carrera (doble-tap)
  `SELECT 1/(SELECT COUNT(*) FROM claim)` fuerza `division_by_zero` → ROLLBACK total. Así se elimina la
  ventana "anulada pero sin reversar" que tendría un claim-fuera + release manual (el diseño inicial la tenía;
  la revisión la señaló como el hallazgo ALTO). Efectos, todos en esa transacción: `inventario_lotes +=
  cantidad` + movimiento `anulacion_venta_pos`; por cada `ingreso`, `saldo -= monto` + **EGRESO compensatorio**
  en la MISMA cuenta del ingreso (ingreso+egreso=0, reversa el monto REAL, no un recálculo de ítems);
  `cobranzas_planta` → `anulada=TRUE, estado='Anulada'`.
- **Guardas (409):** comprobante SUNAT vivo → "emite una Nota de Crédito"; **la caja de planta de ese día ya
  cerrada** (arqueada) si el cobro cayó en su cuenta → ajuste manual (no reventar un arqueo); venta a crédito
  **con abonos** sin anular → gestionar la devolución primero. `Editar` = anular y rehacer en el POS (v1).
- **Exclusión de anuladas de TODOS los totales:** `resumenVentasGeneralesPorFecha` (Ventas Generales +
  Consolidado), `resumen-dia` ("Ventas de hoy") y **`rentabilidad`** (filtraba `estado='Entregado'` sin mirar
  anulada — el reporte quedaba incoherente con los demás; ahora `AND NOT anulada`). Etiqueta de kardex
  `anulacion_venta_pos` → "Venta Rápida anulada" en Inventario. Lista muestra "Crédito" aun anulada.
- **Renombre del selector de cobro del POS** (No me hagas pensar): "Cobrar en:" → **"El dinero entra a:"**,
  placeholder "Elige la caja o cuenta", y mensajes de validación más claros.

**Revisión adversarial (3 agentes):** confirmó que el núcleo era correcto (reversa el monto real del ingreso,
claim atómico contra doble-tap, inventario espejo, exclusión consistente en agregados) y encontró: atomicidad
(hallazgo ALTO — resuelto con el claim-en-transacción), guarda de caja cerrada, guarda de abonos, coherencia
de rentabilidad, `estado='Anulada'` en la cobranza, y la etiqueta de kardex. Todos aplicados. Se omitió solo
"saldo negativo sin guarda" (aceptable: la reversión contable es correcta; el efectivo se reconcilia por arqueo).

**Verificación:**
- **Beta (dev-hugo):** venta contado S/5.00 (Espinazo) → cuenta 11.00→16.00, stock 0→−1; anular → cuenta
  16.00→11.00, stock −1→0, `anulada=TRUE`, transacciones (ingreso+egreso) neto 0, movimientos (venta_pos +
  anulacion_venta_pos) neto 0. Re-probado con el diseño atómico ya aplicado: idéntico. Ventas Generales y el
  panel del POS dejan de contarla.
- **Migración a producción** (`migrate-pos-anular-2026-07-13.sql`, campos `anulada/anulada_at/anulacion_motivo/
  anulada_por` en `pedidos`, aditiva/idempotente) aplicada por psql a `ep-cool-sound` ANTES del deploy (gotcha
  #17). `git push` → Vercel deploy OK.
- **Prod:** la vista carga logueado como Antonio; se **anuló la venta de prueba de S/8.90** (Patas de pollo,
  Avícola de Tony) desde la UI nueva → Caja Efectivo Planta −543.40→−552.30, stock Patas −7.00→−6.00,
  `anulada=TRUE` motivo "Venta de prueba", transacciones y movimientos neto 0. Ventas Generales prod pasa a
  Planta S/0.00 (excluida). Gotcha #49; detalle en [doc 10 §2.4](./arquitectura/10-pos-caja-tesoreria.md).

---

## 13 jul 2026 — POS de planta: catálogo "Principales" + panel "Ventas de hoy"

**Contexto (pedido de Ariana):** el catálogo del POS se veía "muy cargado" de carnes de res/cerdo
que no se venden de madrugada, y tras hacer pruebas "no se veía dónde se acumula el dinero".

**Solución (rama `feat/pos-planta-principales-historial`, sin migraciones — solo lectura):**
- **Catálogo "Principales":** `pos-client.tsx` abre en una pestaña nueva "Principales" (primera, default)
  con solo los productos que se venden temprano (pollo entero/brasa, carcasa, espinazo, molleja, patas de
  pollo, menudencia mixta, alas). Matcher `PRINCIPALES_PATRONES` (nombre, acotado para no traer res/cerdo).
  El resto queda en las categorías o en la **búsqueda, que ahora manda sobre la categoría** (busca en todo).
- **Panel "Ventas de hoy":** barra colapsable arriba del POS que consume `GET /api/pos/resumen-dia` (admin+
  produccion): total del día, **"DÓNDE CAYÓ EL DINERO"** (por cuenta del contado + por cobrar del crédito) y
  las últimas ventas (hora/cuenta/monto). Se refresca tras cada venta.
- **Aclaración del dinero:** el contado del POS suma a la cuenta elegida en "Cobrar en" (`cuentas_bancarias`
  + `transacciones`); el crédito va a `cobranzas_planta`. No estaba "perdido", solo faltaba verlo junto.
- **Bug cazado en la prueba:** el desglose por cuenta salía 0 (con la venta igual visible en el historial)
  porque filtraba por `transaccion.created_at`; cerca de medianoche esa fecha caía un día antes que la del
  pedido. Fix: filtrar por `p.created_at` (la del pedido, autoritativa). Verificado E2E en beta: venta de
  S/10.40 → panel muestra "Caja Efectivo Planta S/10.40". Gotcha #48; detalle en [doc 10 §1](./arquitectura/10-pos-caja-tesoreria.md).

---

## 12 jul 2026 — Facturación SUNAT de la Venta en Campo (reutilizando el motor)

**Contexto / pedido de Antonio:** Antonio (dueño/GG) es quien hace la venta en campo
(módulo Clientes Avícola). Pidió (a) **ver** las ventas de campo como una lista tipo *Lista
de Pedidos* (día/día anterior/fecha), (b) **facturar** las ventas que elija (factura/boleta,
y sobre ellas GRE/NC) **reutilizando el motor** de las ejecutivas (no duplicar código; a futuro
también Planta), y (c) que se entienda **dónde está la facturación general y las ventas
generales** de las 3 operaciones, diferenciadas por color.

**Diagnóstico (exploración):** el motor ya era reutilizable — `emitir-manual` emite comprobantes
"sueltos" (sin pedido) y `emitir-client.tsx` ya postea ahí cuando no hay `pedidoId`;
`GET /api/avicola/ventas` ya listaba por rango de fechas y `GET /api/avicola/ventas/[id]` ya
devolvía los ítems. El único acoplamiento a resolver era el mismo que el POS (gotcha #42
`esPos`): `emitir-manual` SIEMPRE creaba cobranza en `facturas` (duplicaría la deuda de campo),
y `comprobantes` no tenía cómo saber que un comprobante nació en campo (solo `pedido_id`).

**Solución (mínima y aditiva):**
- **Esquema** (`scripts/migrate-facturacion-campo-2026-07-12.sql`, aplicado a `dev-hugo` por psql
  usando explícitamente la URL de `.env.local`; producción sin cambios):
  `comprobantes.venta_avicola_id` (FK + índice único parcial), índice único de NC activa por
  `referencia_comprobante_id`, `clientes_avicola.ruc_dni`, y recrear la vista
  `ventas_facturadas` con `AND venta_avicola_id IS NULL` (campo NO cuenta para metas de asesoras).
- **Motor** (`src/lib/sunat/index.ts`): Campo adquiere un claim en la venta y NC en el CPE base
  **antes del contador**; luego reservan una fila `emitiendo` antes del SOAP y actualizan esa misma
  fila. Los índices
  hacen duro el guard concurrente (409; nunca sale un segundo CPE externo). `emitir-manual` no crea
  factura de ejecutivas para Campo y guarda el RUC consultado en `clientes_avicola.ruc_dni`.
- **Formulario compartido** (`emitir-client.tsx`): prop `ventaAvicolaIdProp` / `?ventaAvicola=`,
  efecto de precarga que mapea `venta_avicola_items` (peso_kg→cantidad KGM, precio_kg→precio CON
  IGV) + cliente/empresa; incluye `ventaAvicolaId` en el POST; maneja el 409 `yaFacturada`.
- **Vista nueva** `/dashboard/clientes-avicola/ventas` (`ventas-campo-client.tsx`): lista por
  fecha, badge de facturación (LEFT JOIN LATERAL a `comprobantes`), botón **Facturar** (modal con
  el form compartido) + selección múltiple (cola 1:1).
- **Facturación general**: `/api/comprobantes` deriva la **operación** (campo/planta/ejecutivas)
  y acepta `?operacion=`; `comprobantes-client.tsx` muestra chip + filtro.
- **Ventas generales**: `/api/ventas-generales` + `/dashboard/ventas-generales` (3 tarjetas por
  operación, por fecha); Consolidado ahora incluye Campo (ventas de hoy + cartera avícola).
- **Colores por operación** (`src/lib/operaciones-venta.ts`, fuente única): 🛵 azul / 🏪 ámbar /
  🏭 violeta — chips de comprobantes, tarjetas de Ventas Generales, puntos en el sidebar.

**NC/GRE:** una vez que el comprobante de campo está en la lista, sus botones usan el flujo
compartido. La NC hereda `venta_avicola_id` y conserva el tipo de documento del CPE base (incluido
tipo 0/número 0 para boleta sin documento). **Verificación:** typecheck, lint, pruebas SUNAT y estado
de cuenta pasan; migración + rollback verificados y aplicada en `dev-hugo`; guardas concurrentes
probadas en transacción. Falta la validación E2E en SUNAT beta con una venta de Campo.
Resumen operativo en **gotcha #47**; detalle de diseño en [doc 21 §6b](./arquitectura/21-clientes-avicola.md).

**Adenda (mismo día) — vistas de comprobantes separadas por operación:** Hugo pidió que el menú lateral
tuviera entradas dedicadas (no solo el hub general mezclado). Se agregó el prop `operacionFija` a
`ComprobantesClient` (amarra la lista a una operación, oculta el filtro de Operación, adapta header/CTA)
y dos páginas envoltorio que lo reusan: `/dashboard/clientes-avicola/comprobantes` (🏪 solo campo, admin)
y `/dashboard/comprobantes/ejecutivas` (🛵 solo ejecutivas, admin+asesor). Sidebar: cada operación tiene su
entrada; la de Finanzas pasó a "Comprobantes (todos)". Los filtros de API y XLSX derivan Campo/Planta/
Ejecutivas también para NC y GRE desde su comprobante referenciado.

**Adenda de revisión integral (12 jul 2026):** se cerraron los hallazgos antes de subir a `main`:
(a) claim pre-contador + reserva pre-SOAP, recuperación de `emitiendo` y claim de reintento; (b) validación
server-side de empresa, cliente, ítems, pesos, precios y total contra la venta; (c) edición/anulación
bloqueadas según el ciclo SUNAT; (d) RUC con razón social fiscal; (e) cancelar con X detiene la cola
de facturación; (f) razón social fiscal revalidada server-side; y (g) estado de cuenta de Antonio
conserva **cada abono del mismo día por separado**.
El PDF se generó, extrajo y renderizó a PNG: 3 abonos visibles con hora, medio, monto, nota y saldo
posterior, una página A4 sin cortes ni glifos rotos.

**Adenda de código + documentación integral (12 jul 2026):** la trazabilidad entre módulos
descubrió y corrigió cuatro huecos adicionales: (1) reintentar un CPE POS ya no crea `facturas`,
y emisión/reintento enlazan `cobranzas_planta.comprobante_id`; una NC total aceptada anula solo
deuda activa de Planta, nunca una pagada; (2) un CPE de Campo `rechazado` ya no entra en el reintento
ciego del mismo XML: se conserva y se emite otro correlativo enlazado por
`reemplaza_comprobante_id` (migración adicional
`migrate-reemision-cpe-campo-rechazado-2026-07-12.sql`, aplicada solo en `dev-hugo`); (3) las NC
quedaron restringidas a los tipos totales 01/02/06 mientras no exista modelado de ítems/montos
parciales; y (4) POS filtra clientes/cuentas inactivos y el servidor rechaza una cuenta inactiva
antes de registrar pedido/inventario. La lista de Planta deriva `Vencida` por fecha Lima aunque el
estado aún no haya sido persistido por un movimiento.

La documentación se reorganizó con fuentes transversales nuevas: doc 22 (tres operaciones), 23
(dependencias/impacto), 24 (regresión/despliegue) y 25 (clientes/cobranzas de Planta), además de
actualizar modelo de datos, roles, SUNAT, GRE, carteras, metas, POS, plan y migraciones.

**Adenda de cierre adversarial (12 jul 2026):** dos riesgos P1 adicionales quedaron corregidos antes
de subir a `main`. Primero, una NC en `error` que ya tiene XML firmado sigue ocupando el índice de
unicidad y solo puede reintentarse con la misma fila/correlativo; un timeout ambiguo ya no habilita
una segunda NC. Esto se respalda con
`migrate-nc-error-reintento-unico-2026-07-12.sql`, aplicada solo en `dev-hugo`. Segundo, una NC total
aceptada (`01`, `02` o `06`) de Campo anula automáticamente `ventas_avicola` con auditoría, de modo
que la venta deja de sumar al estado de cuenta. El endpoint de anulación reconoce esa NC como
evidencia e idempotencia, pero nunca permite anular una venta con CPE vigente sin NC total.
El reintento de una NC aceptada replica el efecto en las tres operaciones: `facturas` de Ejecutivas,
`ventas_avicola` de Campo o `cobranzas_planta` de Planta. Los fallos posteriores al resultado legal
(enlace de cartera/notificación) son no bloqueantes y nunca degradan un CPE aceptado a `error`.

Quedó documentado el orden de despliegue pendiente: migración base de Campo → reemisión auditada
de rechazados → unicidad de NC en error → código. Producción no fue modificada durante esta revisión.

---

## Gotchas 18–32 — texto original completo

18. **El PDF y el correo del comprobante leen los ítems del XML firmado, NO de la DB** (fix 31 may 2026 — `src/lib/sunat/parse-cpe-items.ts`, usado en `GET /api/comprobantes/[id]`). Las facturas/boletas **standalone** (sin pedido) NO guardan sus líneas en ninguna tabla — solo viven en `comprobantes.xml_firmado_base64`. Antes, sin `pedido_id`, el endpoint **fabricaba una línea genérica** (`"Venta a <cliente>"`, cantidad 1, "UNIDAD", sin código, valor=subtotal) → el PDF salía con datos equivocados. Ahora el endpoint **parsea los ítems del XML firmado** (cantidad, unidad `unitCode`, código `SellersItemIdentification`, descripción, valor unitario sin IGV de `cac:Price`), que es **fiel a lo emitido y aceptado por SUNAT**. Orden de fuentes: (1) XML firmado → (2) `pedido_items` (comprobante sin XML) → (3) línea global (último recurso). Funciona para **factura (01), boleta (03) y NC (07)** y **ambas empresas** (la boleta usa `cac:InvoiceLine` igual que la factura; la NC usa `cac:CreditNoteLine` — ambos los maneja el parser; la empresa solo cambia el emisor, no las líneas). **CDR**: `GET /[id]/cdr` ahora sirve el **ZIP crudo de SUNAT** (`Buffer.from(cdr_base64,'base64')`) en vez de extraer el XML con el parser PKZip casero `descomprimirCDR`, que devolvía **vacío (0 bytes)** con el ZIP "data descriptor" de SUNAT. Ambos botones de descarga nombran el archivo `.zip`. **El XML firmado NO se toca** (es el documento legal, ya aceptado).
19. **Reintento robusto + observaciones SUNAT limpiadas (fix 31 may 2026, verificado contra BETA → factura ACEPTADA con `Observaciones: []`)**: (a) **`/[id]/reintentar` ya NO fabrica la línea genérica "Venta a …"** — **reenvía el `xml_firmado_base64` original tal cual** si existe (no reconstruye → imposible alterar ítems; cubre rechazado + error con respuesta), y si no hay XML, **reconstruye desde `comprobantes.items_json`** (columna JSONB nueva que `index.ts` persiste en CADA emisión con los ítems normalizados); si no hay ni XML ni items_json ni pedido, **aborta con 422** (nunca re-emite mal). Migración: `scripts/migrate-comprobante-items.sql` (aplicada en dev-hugo **y producción**). (b) **Observaciones INFO 4095/4260 eliminadas en `xml-builder.ts`**: **4260** → `cbc:InvoiceTypeCode @name` pasó de "Tipo de Documento" a **"Tipo de Operacion"** (apunta al catálogo 51); **4095** → ya NO se emite `cbc:CitySubdivisionName` vacío (se **OMITE** cuando no hay urbanización; configurable con `SUNAT_*_URBANIZACION`). Ambas son observaciones (la factura SIEMPRE fue válida) pero ahora el CDR sale limpio.
20. **"Orden de pedido" (antes "guía de remisión") — crash en prod + rename + opción de precios (31 may 2026)**: (a) **Crash arreglado**: `/pedidos/[id]/guia` tiraba "server-side exception (Digest 3834139025)" en producción porque `siguienteCorrelativo("guia_remision")` lanzaba error — la tabla `correlativos` se creó VACÍA en la migración del 30 may (el seed vivía solo en `migrate-correlativos-guias.mjs`, que nunca corrió por el gotcha #13). Fix doble: se sembró la fila en prod (`INSERT … VALUES ('guia_remision',0) ON CONFLICT DO NOTHING`) **y** `src/lib/correlativos.ts:siguienteCorrelativo` pasó de UPDATE-only a **UPSERT** (`INSERT … ON CONFLICT (tipo) DO UPDATE SET ultimo_numero = correlativos.ultimo_numero+1`) → nunca más falla aunque la tabla nazca sin sembrar. (b) **Rename a "orden de pedido"**: NO es una guía de remisión legal, es una orden interna. Se renombraron solo los TEXTOS VISIBLES (barra + título de compartir en `guia-imprimible-client.tsx`; el cuerpo ya decía "ORDEN DE PEDIDO"; botón en `produccion-client.tsx`; y el flujo "guía firmada"→"orden firmada" en `mi-ruta-content.tsx` + `api/.../guia-firmada`). Los IDENTIFICADORES internos se mantienen (ruta `/guia`, columnas `numero_guia`/`guia_firmada_*`, tipo de notificación `guia_firmada`, correlativo `guia_remision`) — renombrarlos sería churn + riesgo sin beneficio visible. (c) **Toggle "Incluir precios"**: cada cliente maneja precios distintos; el checkbox (default ON) muestra/oculta las columnas P. Unit./Importe + el TOTAL al imprimir. (d) **Formato Ticket (80mm) vs A4 (31 may 2026)**: `guia-imprimible-client.tsx` ahora imprime en DOS formatos con un selector en la barra — **Ticket (térmica/ticketera 80mm) por DEFECTO** y A4 opcional. El `@page size` es dinámico (`80mm auto` ↔ `A4`) según el formato (styled-jsx global con interpolación de estado). El layout Ticket (`TicketLayout`) lleva en el encabezado **solo el logo a color de la empresa** (`/transavic.jpg` o `/avicola.jpg` según `empresa`) y debajo, directo, "ORDEN DE PEDIDO" + N° + fecha — **sin datos del emisor** (Antonio pidió quitar razón social/RUC/dirección; eran innecesarios). **Ojo con el recorte del logo:** los JPG son 600×600; el de Transavic trae ~28% de aire abajo dentro del cuadrado (se veía como un hueco), así que se recorta con un contenedor `aspect-[3/2]` + `object-cover` (recorta arriba/abajo el aire sin cortar el arte); el de Avícola llena el cuadrado → `aspect-[1/1]` (se muestra entero). El resto del ticket es **monocromo** (negro + negritas + separadores punteados), una columna, ancho `80mm`, ítems Cant·Producto·Importe (omite P. Unit. por el ancho) + TOTAL + línea de firma. El logo sale en escala de grises en térmica pero **a color** al "Guardar como PDF"/compartir (`print-color-adjust: exact`). El layout A4 (`A4Layout`) es el documento completo de siempre (logo, tabla, acentos rojos). Ambos respetan "Incluir precios". Si la ticketera fuera de **58mm** (no 80mm), cambiar el `width`/`@page` a 58mm es trivial.
21. **"Resumen del día" (totales por producto para PRODUCCIÓN) vive en `/dashboard/resumen` (31 may 2026)**: el "cuánto preparar de cada producto para tal fecha de entrega" sale de `/api/resumen-diario` (devuelve `totalesPorProducto` = `SUM(cantidad) GROUP BY producto, unidad` por `fecha_pedido`). Históricamente era una página/menú propio; en el rediseño de Reportes se fusionó en la pestaña **Reportes → "Día a día"** (solo-admin) y el cliente "la perdió". **Se RE-EXPUSO** como ítem de menú propio **"Resumen del día"** (grupo Operación, ícono `FiBox`, archivos `src/app/dashboard/resumen/{page,resumen-client}.tsx`), **abierto a `admin` + `produccion`** — y el endpoint `/api/resumen-diario` también pasó de solo-admin a `admin+produccion`. Abre por DEFECTO en **mañana** (lo que se prepara esta noche), con presets Hoy/Mañana + selector. La pestaña "Día a día" de Reportes sigue viva (misma data, enfoque de revisión con KPIs). **Ojo:** un mismo producto con ítems en distintas unidades (kg vs uni) sale como **tarjetas separadas** — es correcto (son preparaciones distintas). Componentes huérfanos detectados de paso (no se usan, candidatos a borrar): `resumen-despacho.tsx`, `print-button.tsx`, y los `@deprecated` `productos-client.tsx`/`precios-client.tsx`.
22. **App Repartidor (Capacitor) — build local en esta Mac (31 may 2026)**: el proyecto `android/` se construye con **`compileSdk 36`** porque el SDK de esta máquina tiene `android-36`/`android-36.1` pero **no `android-35`** (que es lo que pide Capacitor 7 por defecto), y no hay `sdkmanager`/`cmdline-tools` para instalarlo. Por eso `android/variables.gradle` usa `compileSdkVersion = 36` y `android/gradle.properties` lleva `android.suppressUnsupportedCompileSdk=36` (AGP 8.7.2 fue probado hasta 35; el flag silencia solo esa advertencia y el APK compila bien — verificado: `BUILD SUCCESSFUL`, `app-debug.apk` 4.4MB). Si instalas `android-35` por el SDK Manager, podés volver a `compileSdkVersion = 35` y quitar el flag. **`@capacitor-community/background-geolocation` se registra con `registerPlugin("BackgroundGeolocation")`** (el paquete solo trae `definitions.d.ts` con los tipos, sin entry JS) — el `<service>` + permisos de ubicación/FGS/notificación los aporta su propio manifest vía *merge*. **El módulo nativo se importa con `next/dynamic({ssr:false})`** para que `@capacitor/core` nunca corra en el SSR de Next. **(Actualizado 4 jun 2026: la app YA está en producción — la carpeta `android/` se commiteó a `main` en el PR #18 y siguientes; ya no es "solo local". El ícono de la app se regenera con `@capacitor/assets` desde `assets/icon-*.png` → `npx capacitor-assets generate --android`; subir el AAB con `npm run app:build:prod` y acordarse de subir el `versionCode` en `android/app/build.gradle` en cada release de Play.)** Ver `docs/app-repartidor-guia-prueba-y-build.md` y la sección "App Repartidor" más abajo.
23. **Tiquetera con espacios en blanco = `break-inside:avoid` + `grid`, NO el `@page size` (fix 4 jun 2026, 2 iteraciones)**: el **"REPORTE DE PEDIDOS"** (`src/components/VistaImpresion.tsx`, reporte de TODOS los pedidos del día que se imprime desde el Dashboard; NO confundir con la "orden de pedido" individual `guia-imprimible-client.tsx`) salía en la tiquetera térmica con **grandes tramos de papel en blanco entre pedidos**. **⚠️ Primer intento ERRADO:** inyectar `@page { size: 80mm auto; margin: 0 }`. **`size: 80mm auto` es CSS INVÁLIDO** — no se puede mezclar una medida (`80mm`) con `auto`; la sintaxis válida es `<length>{1,2}` (`80mm` o `80mm 297mm`) **o** `auto` **o** un nombre (`A4`), nunca mezclados. Chrome lo **descarta** y vuelve al papel por defecto → el reporte siguió paginando con huecos, y el `margin:0` además cambió cómo la térmica encajaba el contenido (la asesora reportó "la letra ahora sale pequeña"). La orden individual "funciona" con ese mismo valor inválido solo porque es **corta** (un pedido cabe en una página y el hueco no se nota). **Causa REAL de los huecos:** cada tarjeta lleva `break-inside: avoid` + el contenedor es un **CSS `grid`**; cuando un pedido no cabía en lo que restaba de la página, saltaba a la siguiente y **dejaba el resto vacío** → hueco enorme en el rollo continuo (aparecía tras los pedidos largos). **Fix correcto:** (a) se **quitó** el `@page` inválido (devuelve la letra a como era); (b) en formato **Ticket** el reporte fluye en **bloque continuo (NO grid) y SIN `break-inside`** → cada "página" se llena y el reporte sale junto; (c) en `globals.css`, `break-inside:avoid` quedó **solo bajo `.formato-a4`** (en hoja fija sí conviene no partir una tarjeta), y `.formato-ticket > div > div` usa `break-inside:auto` + `.formato-ticket .grid{display:block}`. **Verificado empíricamente** con Chrome headless: `Page.printToPDF` (CDP) con `preferCSSPageSize:true` confirmó que `size:80mm auto`→MediaBox **612×792 (Letter, ignorado)** mientras `80mm 297mm`→**227×842 (sí respeta 80mm)**; y el PDF del reporte en bloque sin `break-inside` llena las páginas sin huecos. **Reglas:** para tiquetera, lo que importa NO es forzar `@page size` (un valor inválido se ignora; una altura fija deja blanco al final y puede forzar form-feed) sino que el contenido **fluya sin `break-inside` ni `grid`**, confiando en que la impresora térmica aporta el ancho de 80mm continuo. (El CSS de impresión solo se valida 100% imprimiendo; tsc/eslint no lo cubren — por eso se usó Chrome headless + CDP como verificación.) **⚠️ SEGUIMIENTO (5 jun 2026) — sobrante de papel en blanco AL FINAL (≠ huecos entre pedidos):** una vez resueltos los huecos, quedaba un tramo grande de papel en blanco al **final** de cada impresión. **Causa:** la ticketera es continua, pero **Chrome** sí pagina; **sin ninguna regla `@page`** usaba el papel por defecto (Carta/A4 ~297mm) y le mandaba a la impresora una **página más alta que el contenido** → la térmica alimentaba todo ese alto, incluido el relleno vacío. **Fix (`src/lib/impresion.ts` + handler `onPrint` en `dashboard-content.tsx` + 2 reglas `.medir-impresion` en `globals.css`):** justo antes de `window.print()`, `aplicarTamanoPaginaImpresion(formato)` **mide el alto real** del reporte (clona el `.impresion-container` —que está `display:none`— en un nodo `.medir-impresion` fuera de pantalla con el mismo 80mm + 9pt + grid→block que la impresión, lee `scrollHeight`, px→mm con `25.4/96`) e inyecta `@media print { @page { size: 80mm <alto+4mm>mm; margin: 0 } }` (Ticket) o `size: A4; margin: 1cm` (A4); limpia el `<style>` en `afterprint`. **Esto NO contradice el "no forzar @page" de arriba:** ahí el error era una altura **inválida/fija**; acá es una altura **dinámica = al contenido** (la forma válida `80mm <N>mm`), que da **una sola página del tamaño justo** → sin sobrante. **Verificado** (Chrome headless `--print-to-pdf`, repro fiel del DOM+CSS): SIN fix = **2 páginas Carta** (612×792, la 2ª casi vacía = el sobrante); CON fix = **1 página de 227×1244 pt = 80×439 mm = exacto al contenido**. Solo aplica a Ticket; A4 sin cambios. La "orden de pedido" individual (`guia-imprimible-client.tsx`) tiene el mismo `80mm auto` inválido latente pero al ser corta no molesta (pendiente opcional aplicarle el mismo patrón).

24. **Estado `Anulada` en cobranzas (`facturas`) — excluirlo SIEMPRE de "deuda" (4 jun 2026)**: una cobranza puede estar **`Anulada`** (soft-cancel: creada por error, o su factura/boleta se anuló con Nota de Crédito). Ya **NO es deuda**. Las queries de "lo que se debe" deben excluirla. La mayoría ya usa la allowlist `estado IN ('Pendiente','Vencida')` (aging, Mi Día, crons `facturas-vencidas`/`daily-digest`, perfil del cliente) → la excluye sola; el `GET /api/facturas` la saca con `estado <> 'Anulada'` salvo `?estado=Anulada`. Si agregas una query nueva sobre `facturas`, **NO uses `estado <> 'Pagada'`** (incluiría las Anuladas) — usa `IN ('Pendiente','Vencida')`. La NC la auto-anula por **`comprobante_id` / `pedido_id`+número, NUNCA por `numero_comprobante` solo** (las dos empresas comparten las series F001/B001 → anularías la cobranza de la otra). Ver §13 "Anular cobranzas (soft)".

25. **Orden de pedido en celular + ticketera Bluetooth (fix 6 jun 2026)**: Producción imprime desde celular Android con ticketera Bluetooth, así que `window.print()`/Chrome no es confiable como salida única: el navegador convierte HTML/PDF a páginas y el servicio/driver Bluetooth puede ignorar `@page`, escalar o dejar sobrantes. Fix en `src/app/pedidos/[id]/guia/guia-imprimible-client.tsx`: (a) el botón **Imprimir** ya no usa `size: 80mm auto`; al imprimir Ticket mide `.orden-ticket` (`scrollHeight`, px→mm) e inyecta `@page { size: 80mm <alto+6mm>mm; margin: 0 }`, A4 mantiene `size: A4`; (b) se agregó botón **Bluetooth** visible solo en formato Ticket, que genera un ticket de **texto monoespaciado** (42 columnas, datos del cliente, ítems, total opcional, notas y firma) y abre RawBT por Android intent (`intent:<texto>#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;...`). **Operación recomendada:** en celular Android + ticketera Bluetooth, instalar/configurar RawBT una vez y usar el botón **Bluetooth**; usar **Imprimir** solo en PC, PDF o impresora normal. Este flujo evita por completo el paginado HTML/PDF del navegador.

26. **DOS documentos de impresión — no confundirlos + el botón de IA se colaba en el REPORTE (6 jun 2026)**: hay **dos** impresiones distintas y es fácil mezclarlas. **(A) "Imprimir Pedidos" = el REPORTE** (`src/components/VistaImpresion.tsx` + `src/lib/impresion.ts`): TODOS los pedidos del día juntos, se abre con el botón **"Imprimir"** del `/dashboard` y **es el que SIEMPRE se imprime**; vive **bajo `DashboardLayout`**. **(B) "Orden de pedido" individual** (`src/app/pedidos/[id]/guia/guia-imprimible-client.tsx`, ruta `/pedidos/[id]/guia`): una hoja por pedido, se abre desde Producción ("Imprimir orden de pedido"); está **fuera de `/dashboard`** (layout raíz). **Bug del REPORTE:** el **botón flotante de IA** (`FloatingAssistant`, `position: fixed bottom-5`, renderizado en `DashboardLayout.tsx`) **salía impreso**. Causa: el `@media print` de `globals.css` **NO** hace "ocultar todo y mostrar solo el reporte"; oculta cosas puntuales (`aside, header, nav, .print-hidden, .print:hidden`) y **todo lo demás se imprime** → un `position: fixed` sin `print:hidden` se cuela. Peor: al estar **anclado abajo** (`bottom-5`), al imprimir desde el celular **fuerza la página a su alto completo** para colocar el botón al fondo → **papel en blanco al final** en la ticketera (bug clásico de Chrome con elementos `fixed` al fondo). Encaja con el "antes no ocurría" de Producción: el botón de IA es **nuevo** (mayo 2026) y era el único elemento anclado abajo que se imprimía. **Fix:** `print:hidden` en `FloatingAssistant.tsx`. El sobrante del reporte tenía DOS causas: (1) el `@page` dinámico de `impresion.ts` [ya resuelto, commit `fix(impresion): quitar sobrante…`] y (2) este botón de IA [este fix]. **Regla:** todo elemento `position: fixed`/flotante bajo `DashboardLayout` (botones, toasts, campanita) debe llevar `print:hidden` si no debe salir en NINGUNA impresión del dashboard. **Nota:** el Bluetooth/RawBT (gotcha #25) está en el documento **B (la orden)**, OTRO documento — sigue **en local, sin desplegar**, pendiente de validar en el celular; no afecta al REPORTE.

27. **`clientes.rubro` (giro del negocio) ≠ `clientes.tipo_cliente` (8 jun 2026)**: se agregó la columna **`rubro`** (TEXT, nullable) para clasificar el directorio de clientes por giro: `Restaurante · Cafetería · Avícola · Chifa · Fast food · Market / Minimarket · Tienda / Bodega · Casa / Hogar · Otro` (NULL = "Sin clasificar"). **⚠️ NO confundir con `tipo_cliente`**, que es OTRA cosa y ya existía: guarda `Frecuente`/`Nuevo` (estado de relación), se **denormaliza a `pedidos.tipo_cliente`**, sale en el ticket (`TicketPedido.tsx`), `PedidoForm`, la columna del dashboard y el perfil — **no se recicla ni se mezcla**. `rubro` es solo del directorio: **NO se denormaliza a pedidos** ni toca despacho/comprobantes/reportes. Lista de rubros **FIJA en código** (`RUBROS` en `clientes-client.tsx`); el backfill (`scripts/backfill-rubro.sql`) escribe esos mismos strings. UI: `<select>` "Rubro" en el form, sección de chips **"POR RUBRO"** (espeja "POR DISTRITO": conteo `GROUP BY` en `/api/clientes`, filtro combinable con asesora/distrito/búsqueda, chip "Sin clasificar" para los pendientes), badge en tarjeta + perfil. El filtro `?rubro=Sin clasificar` ⇒ `c.rubro IS NULL`. Migración aditiva **`scripts/migrate-cliente-rubro.sql`** (`ADD COLUMN IF NOT EXISTS` + índice). La pre-clasificación por palabras clave es **conservadora** (en prod clasificó 17/420; el resto queda Sin clasificar y la asesora lo completa con el uso) — apisperu **no** devuelve el giro/CIIU, así que no hay autodetección desde SUNAT.

28. **GRE: banner del entorno + M1/L exime placa y conductor + auto-búsqueda destinatario (8 jun 2026)**: tres ajustes al modal de Guía de Remisión (`src/app/dashboard/guias/emitir-guia-modal.tsx`). (a) **El banner "Entorno de Pruebas (SUNAT Beta)" estaba HARDCODEADO** (salía siempre, aun en producción, asustando al usuario). Ahora es **dinámico**: lo alimenta el endpoint nuevo `GET /api/sunat/entorno` (devuelve `{environment, esProduccion}` leyendo `SUNAT_ENVIRONMENT`; dato NO sensible) → en producción muestra una nota verde "Producción (SUNAT real)", en beta el aviso ámbar. **La simulación de éxito** (`api/guias/emitir/route.ts`: ante error de SUNAT devuelve `[SIMULADO BETA]` + `<MockCDR>`) **solo corre si `environment === "beta"`**; en producción NO simula → ⚠️ al validar contra SUNAT beta, el mock **enmascara** rechazos: un éxito real se distingue porque su `descripcion` **NO** contiene `[SIMULADO BETA]`. (b) **Indicador M1/L hace OPCIONALES placa + TODOS los datos del conductor** (DNI, nombres, apellidos, licencia). Regla SUNAT confirmada: en la **GRE-Remitente, transporte privado (02) + indicador M1/L** (una **moto es categoría L**), se pueden OMITIR placa y conductor — es el camino legal para **delivery externo en moto** sin DNI/placa del chofer. El `xml-builder-guia.ts` **ya** omitía placa (`if repartidor?.placa`) y `DriverPerson` (`if repartidor.docNum`) cuando venían vacíos y ya emitía el indicador (`SpecialInstructions = SUNAT_Envio_IndicadorTrasladoVehiculoM1L`); **lo único que lo bloqueaba era la validación demasiado estricta** del modal y de `api/guias/emitir/route.ts` (antes con M1/L solo liberaba la licencia). Ahora ambas exigen DNI/placa/licencia **solo cuando NO es M1/L**. El builder recibe `docNum`/`placa` como `"" ` (vacío = omitir). (c) **Auto-búsqueda del destinatario**: al tipear un DNI(8)/RUC(11) en el modal, consulta apisperu (`/api/consulta-documento`, mismo patrón que el form de comprobantes) y autocompleta "Nombres o Razón Social". **0 GRE emitidas en producción** al 8 jun (`comprobantes_guias` vacía) → la 1ª emisión real la hace Hugo para validar end-to-end (la prueba en beta no es concluyente por el mock). **(d) UX (9 jun 2026):** como con M1/L el chofer es opcional, el modal **oculta** los campos del chofer por defecto y muestra un botón "+ Agregar datos del chofer (opcional)" (estado `mostrarChofer`; se auto-despliega si el pedido ya trae un repartidor con DNI/placa). Si quedan ocultos, el form **no envía** datos del chofer (`incluirChofer = !indicadorM1L || mostrarChofer`) **y** el endpoint **no los auto-rellena** desde el repartidor del pedido cuando es M1/L (`finalRepartidorId = repartidor_id || (indicadorM1L ? null : repartidorAsignadoId)`) → "sin datos del chofer" se respeta de verdad. Sin M1/L, los campos son visibles y obligatorios como antes. **(e) 🔴 RECHAZO REAL POR ORDEN XSD (9 jun 2026, T002-8/9 — RESUELTO):** las 2 primeras GRE reales fueron RECHAZADAS por SUNAT con `Error al ValidarEsquema … Invalid content … 'cbc:GrossWeightMeasure'`. Causa: en UBL 2.1 `cac:Shipment` es una **secuencia XSD estricta** y el indicador M1/L (`cbc:SpecialInstructions`, pos. 18) se emitía ANTES de `GrossWeightMeasure` (pos. 6). Fix en `xml-builder-guia.ts`: el indicador va DESPUÉS de `TotalTransportHandlingUnitQuantity` y antes de `ShipmentStage`. **Verificado con el XSD oficial OASIS UBL 2.1 + xmllint** (3 casos: M1/L sin chofer, sin M1/L, mixto → "validates"; el XML rechazado reproduce el error exacto). El mock de beta (401→simulado) fue lo que enmascaró este rechazo en todas las pruebas M1/L. **De paso:** los guards anti doble-emisión usaban `NOT IN ('anulado','RECHAZADA','ERROR')` con estados que se guardan en MINÚSCULA → una guía `rechazado`/`error` bloqueaba reemitir; corregido a `('anulado','rechazado','error')`. Si tocas el orden de elementos del XML de la guía, valida SIEMPRE contra el XSD oficial (`xmllint --schema UBL-DespatchAdvice-2.1.xsd`), no contra beta. **(f) DOS modales de emisión + módulo compartido (9 jun 2026):** además del modal por pedido existe **`emitir-guia-directa-modal.tsx`** (GRE directa/standalone, botón "Emitir GRE" en Comprobantes), que se había **desincronizado** (exigía chofer con M1/L vía `required`, banner "SUNAT Entorno Beta" hardcodeado, sin auto-búsqueda del destinatario). Las reglas/constantes compartidas viven ahora en **`src/lib/guia-form-shared.ts`** (`validarChofer` — LA regla del chofer, espejo del backend —, `DISTRITOS_LIMA`, `dividirNombreLocal`, `datosChoferDesdeMotorizado`, `consultarDocumento`, `fetchEntornoSunat`) y AMBOS modales las consumen → **cambios de reglas del chofer/M1L se hacen ahí, NUNCA en un solo modal**. Hoy tienen paridad: banner dinámico, auto-búsqueda, M1/L exime y oculta el bloque del chofer. **(g) La consulta RUC autocompleta también DIRECCIÓN + DISTRITO de llegada (10 jun 2026):** al consultar un RUC (apisperu devuelve `direccion`/`distrito`; el DNI NO trae dirección) ambos modales pegan la dirección y seleccionan el distrito vía **`matchDistritoLima`** (en `guia-form-shared.ts`: normaliza MAYÚSCULAS/tildes y matchea contra `DISTRITOS_LIMA`; el alias "LIMA" de apisperu = "Cercado de Lima"). Si el campo `distrito` no matchea, **`detectarDistritoEnDireccion`** busca un distrito DENTRO del texto de la dirección (también al pre-cargar la dirección del pedido/cliente sin distrito) — pero SOLO si la coincidencia es **inequívoca**: exactamente un distrito como palabra completa, longest-match primero ("San Juan de Lurigancho" gana sobre "Lurigancho"); con 0 o 2+ coincidencias (o zonas como "Salamanca") deja el select libre para elegir a mano. Se agregaron **"Pueblo Libre"** y **"Cercado de Lima"** a `DISTRITOS_LIMA` (faltaban; `ubigeos.ts` ya los conocía). **La regla de QUÉ pisar vive en `decidirAutollenadoDestino` (guia-form-shared, 10 jun 2026 tarde):** si el **usuario TIPEA** el documento (modo forzado), la dirección fiscal **REEMPLAZA** lo que haya y el distrito se actualiza — tipear un RUC es redefinir el destinatario (feedback de Hugo: con la regla anterior "no pisar lo precargado" parecía que no funcionaba); si el RUC nuevo no trae distrito de Lima reconocible (ej. provincia: Cajamarca) y el distrito visible era autollenado del RUC anterior, se **LIMPIA** (nunca dejar un distrito ajeno). Las consultas **automáticas** (al abrir el modal con factura sin dirección, o al elegir cliente frecuente — `consultaSuaveRef`) son "suaves": solo llenan campos vacíos, jamás pisan la dirección de ENTREGA del pedido/ficha. **Dato SUNAT (Anexo N° 12, RS 357-2015, campos 18-19):** la dirección Y el **ubigeo del punto de llegada** (catálogo 13) son **requisito mínimo obligatorio** de la GRE remitente → el select Distrito (fuente del ubigeo) debe seguir siendo obligatorio en la UI. Limitación conocida: el select solo tiene Lima/Callao — un traslado a provincia hoy no puede expresar su ubigeo real. Regla del autollenado: **solo si el campo está vacío o si lo que hay es lo que el propio autollenado puso antes** (corregir el RUC actualiza) — nunca pisa lo escrito a mano ni la dirección de ENTREGA del pedido (que manda sobre la fiscal). Además, el modal desde pedido/factura consulta el RUC **al abrir** cuando el comprobante ya trae RUC pero NO dirección (factura standalone abierta desde la lista). ⚠️ Lección React: la 1ª implementación mutaba las refs DENTRO del updater funcional de `setState` — **Strict Mode (next dev) doble-invoca los updaters** y la 2ª invocación veía la ref ya mutada → el campo no se actualizaba al corregir el RUC; el patrón correcto es **refs espejo del estado** (`direccionLlegadaRef`) y decidir FUERA del setter. Verificado en navegador mockeando `/api/consulta-documento` (en local no hay token: `.env.local` tiene `APISPERU_TOKEN=""` vacío — la consulta real solo funciona en Vercel).

29. **🔢 Numeración de la GRE legal SEPARADA de la orden de pedido interna (10 jun 2026)**: hasta ahora la "orden de pedido" interna (`/pedidos/[id]/guia`) y la **GRE legal** (T001/T002) compartían el correlativo `correlativos.guia_remision`. Como la orden interna reserva un número con **solo ABRIR la página** (`page.tsx`: `if (!numero) siguienteCorrelativo(...)`), cada orden impresa **gastaba un número de la numeración LEGAL** → las guías SUNAT saltaban de número (el contador del 10 jun: `guia_remision=9`, de los cuales 1..7 fueron órdenes internas y 8..9 guías T002 rechazadas). **El contador de SUNAT no debe tener saltos.** Fix (esto **revisa el gotcha #20c** que mantenía `guia_remision` compartido a propósito): (a) la **orden interna** usa el correlativo NUEVO `correlativos.orden_pedido` (`page.tsx` + `TipoCorrelativo` en `correlativos.ts`); (b) la **GRE legal** usa un contador **POR SERIE** en `comprobantes_contador` (T001/T002), la misma tabla que boletas/facturas, vía una **reserva atómica CTE** en `api/guias/emitir/route.ts` (bump del contador + fila `'emitiendo'` en un solo statement → ningún número queda "fantasma" si algo falla; el catch la pasa a `'error'`); (c) la GRE **ya NO escribe `pedidos.numero_guia`** (ese campo es solo de la orden interna; el número legal vive en `comprobantes_guias`) — evita además chocar con el `UNIQUE idx_pedidos_numero_guia` al separar; (d) el **badge "GRE" de despacho** (`despacho-content.tsx` + `api/despacho/route.ts`) pasó de mirar `numero_guia` a `EXISTS(comprobantes_guias aceptado/observado) AS tiene_gre`; (e) el **mock de beta** (gotcha #28e) ahora está APAGADO por defecto, solo se activa con `SUNAT_GRE_MOCK_BETA=1`. **Migración** `scripts/migrate-guias-numeracion-2026-06-10.sql` aplicada a dev-hugo Y prod ANTES del deploy: `orden_pedido` sembrado desde `guia_remision` (continúa la numeración), `comprobantes_contador` T001=0 (próxima=1) y T002=9 (próxima=10, sin reusar las rechazadas — regla SUNAT). `guia_remision` queda **congelado** (DEPRECATED). Verificado: el CTE da `T001-00000029` en dev-hugo; abrir una orden ya solo mueve `orden_pedido`. **Si tocás la emisión de guías:** la reserva del número va por el contador POR SERIE (no `siguienteCorrelativo`), y NO vuelvas a escribir `numero_guia` desde la GRE.

30. **🔴 GRE atascada en "emitiendo" (T002-00000010) + peso bruto EXACTO de la factura (10 jun 2026)**: (a) **CAUSA RAÍZ del atascamiento**: `comprobantes_guias` **NUNCA tuvo columna `updated_at`**, pero el flujo de reserva del gotcha #29 hace `UPDATE … SET updated_at = NOW()` → el UPDATE post-SUNAT fallaba con "column does not exist" **y el catch que marca 'error' fallaba por lo mismo** → la fila quedaba en `'emitiendo'` para siempre aunque SUNAT SÍ procesó la guía (el resultado se perdía y el endpoint devolvía 500). Estrenó (y reventó) con la primera guía real post-fix-numeración. Fix: **`scripts/migrate-guias-reintento-2026-06-10.sql`** (aplicada a dev-hugo Y prod) agrega `updated_at` + columnas que persisten la emisión para poder reintentarla fiel: `direccion_llegada`, `distrito_llegada`, `indicador_m1l`, `chofer_nombres/apellidos`, `items_json` (la reserva del emitir ahora las llena). Además **`export const maxDuration = 60`** en `emitir` y `reintentar` (el polling REST es 6×2s + token + envío ≈ 15-25s > los ~15s default de Vercel — segunda forma de morir a mitad). (b) **Recuperación**: endpoint nuevo **`POST /api/guias/[id]/reintentar`** — reusa el **MISMO serie-número** (reconstruye el XML desde `items_json`/factura/pedido, toma la fila de forma atómica); estados reintenables: `error`, `pendiente`, o `emitiendo` >15 min; si SUNAT responde "ya fue registrada" (códigos 1032/1033 o texto), marca **`aceptado`** ("la emisión original llegó; CDR en SOL"). Las **rechazadas NO se reintentan** (número no reutilizable — se emite una nueva). UI: ítem **"Reintentar emisión (mismo número)"** en el menú "⋯" de la guía (admin + asesora dueña). El GET `/api/comprobantes` hace **saneo lazy**: `emitiendo` >15 min → `error` con instrucción de reintentar. La T002-10 de prod quedó en `error` lista para reintentar (su PDF bajado de SOL sugiere que SUNAT SÍ la tiene → el reintento la marcará aceptada). (c) **Peso bruto = el de la FACTURA, sin estimaciones** (pedido de Antonio): el modal por pedido ahora carga los ítems de la **factura/boleta aceptada vinculada** (no los del pedido — las unidades del pedido pueden diferir: el caso real tenía 'uni' en pedido_items y KGM en la factura, por eso salía 157.36 en vez de 280.75); el peso se autocompleta con la **suma EXACTA solo si TODOS los ítems están en KGM**; con unidades mixtas queda **EN BLANCO** para ingresarlo a mano. Igual en el modal directo y en el backend (`emitir` ya no usa `estimarPesoPorUnidad`: suma exacta si todo KGM, si no **400** pidiendo el peso). El flete "ENVIO" se excluye de bienes y peso. Verificado E2E en dev-hugo: factura beta con 10.5 kg + 4.25 kg → el modal prellenó **14.75** y 2 bultos; emisión → fila persistida completa; reintento → reconstruye y persiste (401 beta esperado). **(e) 🔴 SEGUNDO bug nocturno: fecha de emisión en UTC → SUNAT 2329 (10 jun 2026, 22:40 — RESUELTO; T002-10 ACEPTADA):** al reintentar la T002-10 en producción SUNAT respondió `RECHAZADA 2329 "La fecha de emisión se encuentra fuera del límite permitido"`. Causa: las GUÍAS ponían `IssueDate` con `new Date().toISOString()` (UTC) — en Vercel, desde las **~19:00 hora Lima** la fecha UTC ya es "mañana" y SUNAT (hora Perú) la rechaza. Las facturas/boletas NO sufrían esto (`lib/sunat/index.ts` ya usaba helper Lima); en local jamás se reproduce (la Mac está en hora Lima). Fix: **`src/lib/sunat/fechas.ts`** (`fechaHoyLima`/`horaActualLima`) usado por `emitir` y `reintentar` — **NUNCA `toISOString()` para fechas de documentos SUNAT**. De paso: (1) el driver Neon devuelve `DATE` como objeto `Date` — `String(date).slice(0,10)` da "Wed Jun 10" → SUNAT 0306; formatear con `toISOString().slice(0,10)` si es `instanceof Date`; (2) las guías **rechazadas SÍ se reintentan con el MISMO número** (un rechazo NO registra el documento en SUNAT — verificado empíricamente: la T002-10 fue rechazada 2 veces y aceptada a la 3ª con el mismo número; el endpoint y `puedeReintentar` incluyen `rechazado`); (3) el reintento ajusta `fechaInicioTraslado` para no quedar anterior a la emisión. **La T002-00000010 quedó ACEPTADA por SUNAT (código 0, sin observaciones, CDR guardado) el 10 jun 22:35 — primera GRE real aceptada de Avícola de Tony**, con los 5 ítems en KGM y peso 280.75 exactos a la factura F002-62. **(d) Destinatario SIEMPRE visible + distrito normalizado + mensaje de unidades mixtas (10 jun 2026 noche, feedback de Hugo):** (1) el bloque "Destinatario (SUNAT)" del modal por pedido/factura ya **NO se oculta** cuando el doc es válido: siempre se muestra **prellenado y editable** (cascada FACTURA → pedido; comprobantes-client ahora pasa `{pedido, comprobante}` juntos al abrir desde una factura — antes pasaba solo el pedido y si este no tenía `ruc_dni` el bloque salía VACÍO aunque la factura tuviera el RUC). El payload SIEMPRE manda `cliente_doc_*` (lo que se ve es lo que se emite); el resumen del modo simplificado muestra los overrides editados, no los props (hallazgo del review multi-agente); la rama "coincidir destinatario con factura" del endpoint queda como fallback para llamadas sin override. El init setea `ultimoDocConsultado` para que el prellenado no dispare la consulta forzada (pisaría la dirección de entrega). (2) **Distrito normalizado contra el `<select>`**: los pedidos/fichas traen valores coloquiales ("Surco") que no matchean ninguna opción y dejaban el select mudo — todo distrito entrante pasa por `matchDistritoLima` (alias: lima→Cercado de Lima, surco→Santiago de Surco, sjl, smp) con fallback `detectarDistritoEnDireccion`. (3) Con **unidades mixtas** el campo Peso muestra mensaje ámbar "pesa la carga e ingresa el total en kg" (ambos modales). (4) **El PDF de la guía** (`/api/guias/[id]`) reconstruye ítems en orden de fidelidad: XML propio → `items_json` propio → **XML de la factura vinculada** → pedido_items (los huecos de la T002-10 con "UNIDAD" donde la factura decía KILOGRAMO eran el fallback de pedido_items: el XML ENVIADO a SUNAT sí llevaba KGM — el bloque ítems-desde-factura de `28de689` ya estaba desplegado al emitirse).
31. **Observación libre en comprobantes y GRE (21 jun 2026)**: se agregó `observacion_comprobante` en `comprobantes` y `comprobantes_guias` para la nota escrita por la asesora/admin, separada de `observaciones` (CDR/SUNAT/logs). Factura y boleta la imprimen en la fila "Observación" del PDF y la emiten como un `cbc:Note` adicional **sin `languageLocaleID`**; el primer intento con `languageLocaleID="2012"` fue rechazado en SUNAT Beta con **3027 "Valor no se encuentra en catalogo: 52"**, así que NO usar ese atributo. La GRE la emite como `/DespatchAdvice/cbc:Note` después de `cbc:DespatchAdviceTypeCode` y antes de `cac:Signature` (el orden UBL es sensible). La nota de crédito no recibió campo adicional: conserva solo su motivo/sustento legal.

32. **🛰️ GPS obligatorio para repartidores con pedidos activos + detección de "repartidor oscuro" (21 jun 2026)**: pedido de Antonio — *"que el repartidor no pueda apagar su ubicación en tiempo real, porque a veces lo apagan a propósito"*. Diagnóstico previo (3 exploraciones + 2 diseños + revisión adversarial): el motorizado podía dejar de transmitir por **dos vías**. **Vía A (interruptores propios, 100% controlables):** el botón **"Pausar"** de `seguimiento-nativo.tsx` (localStorage `transavic_gps_pausa_v1`), el rechazo del consentimiento, y en web el GPS "bajo demanda" (solo con el mapa abierto o un pedido En_Camino — ocultar el mapa lo apagaba). **Vía B (sistema operativo, NO impedible sin MDM/kiosk):** revocar el permiso, force-stop, ahorro de batería de marca (Xiaomi/HONOR), modo avión, GPS falso (mock). Decisión del dueño: **bloquear A al 100% + detectar/alertar B + rechazar mock**; rastrear **solo mientras tenga pedidos activos del día** (privacidad fuera de jornada); avisar al admin + marca en el mapa (sin historial auditable).

   **Lo implementado, por capas:**
   - **Migración** `scripts/migrate-rider-gps-enforcement.sql` (aditiva, idempotente, por **psql** ANTES del deploy — si no, el endpoint de ubicación 500ea por columnas faltantes y el mapa marca a todos "sin señal"): agrega a `rider_locations` → `simulated BOOLEAN`, `gps_status VARCHAR(24)` (`'activo'|'permiso_revocado'|'mock'`), `gps_status_changed_at`.
   - **Regla de jornada** `src/lib/repartidor-jornada.ts` (`tienePedidosActivosHoy`, `ridersConPedidosActivosHoy`) — una sola definición de "activo" = `estado IN ('Asignado','En_Camino') AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date`, compartida por cliente, endpoint y cron. **Ventana operativa** `src/lib/ventana-operativa.ts` (PURO, sin DB, lo usan cliente y server): `dentroDeVentanaOperativa()`, default 04:30–22:00 Lima, override `NEXT_PUBLIC_GPS_VENTANA_INICIO/FIN`. Fuera de la ventana NO se rastrea (no perseguir a nadie en su casa por un pedido sin cerrar) y el cron no alerta.
   - **Bloquear A (nativo)** `seguimiento-nativo.tsx`: se ELIMINÓ el botón Pausar y la `PAUSA_KEY`; el watcher arranca con `esNativo && consent && hayPedidosActivos` (prop nuevo); el aviso destacado de Play se mantiene (reformulado: "se activa automáticamente mientras tengas entregas y se detiene al completarlas"); ante `NOT_AUTHORIZED` ahora (a) manda un **beacon** una vez por episodio, (b) **reintenta** enganchar el GPS cada 45s (al reactivar el permiso desde Ajustes, vuelve solo), (c) muestra un **banner rojo NO bloqueante** (la ruta sigue visible — no romper la herramienta de trabajo, y es lo correcto para Play); el payload ahora incluye `simulated` (lo expone el plugin v1.2.26). **Lección React (otra vez):** el reintento NO usa el updater de `setEstado` (Strict Mode lo doble-invoca) → ref espejo `estadoRef`.
   - **Bloquear A (web)** `mi-ruta-content.tsx`: `useGeolocation(showMap || debeRastrear, debeRastrear)` con `debeRastrear = hayPedidosActivos && dentroDeVentanaOperativa()` — el **reporte ya no depende de `showMap`** (ocultar el mapa no apaga el envío) y suma `Asignado` (antes solo `En_Camino`).
   - **Rechazo de mock** `api/repartidor/ubicacion/route.ts`: el schema acepta `simulated`; si viene `true` → UPDATE `gps_status='mock'` **sin pisar la última posición real** y **return 200** (no 4xx — un 4xx envenenaría la cola offline del repartidor que reintenta para siempre, Y silenciaría las notificaciones de ETA a la asesora que dispara el MISMO endpoint), saltando el recálculo de ETA. El filtro de mock es del SERVIDOR (no se confía en el cliente: un APK modificado lo saltaría).
   - **Detección + alerta**: endpoint `POST /api/repartidor/beacon` (registra `gps_status` desacoplado de lat/lng; ante `permiso_revocado` con pedidos activos en ventana, avisa al admin al instante). Cron `GET /api/cron/repartidores-oscuros` (cada 5 min en `vercel.json`, protegido con `CRON_SECRET`; fuera de ventana hace return): clasifica a cada rider con pedidos activos — `permiso_revocado`/`mock` → **deliberado**, sin fila o `updated_at` > 10 min → **sin señal** — y notifica con **debounce en `settings.gps_oscuros_alertados`** (JSON por día; cubre uniformemente a los riders sin fila en `rider_locations`, que no podrían debounce-arse en una columna). Helper compartido `src/lib/repartidor-oscuro.ts` (`notificarRepartidorOscuro`). Tipo de notificación nuevo `repartidor_oscuro` (`notificaciones.ts` + `NotificationBell.tsx`, ícono `FiAlertTriangle` rojo + acento rojo).
   - **Mapa de Despacho** `api/despacho/route.ts` calcula server-side por rider `tienePedidosActivos` + `alerta` (`'deliberado'|'sin_senal'|null`); `mapa-despacho.tsx` pinta el marcador **rojo** (deliberado, con badge `!`) / **ámbar** (sin señal) / verde (en vivo) / gris, InfoWindow con la causa ("revocó el permiso"/"GPS simulado"/"hace N min"), y badge en la lista lateral.

   **Límite honesto comunicado a Antonio:** revocar permiso/force-stop/ahorro de batería/modo avión NO se pueden IMPEDIR sin volver los celulares equipos administrados (MDM/kiosk — proyecto aparte). Las dos señales de **alta confianza** son `permiso_revocado` (beacon) y `mock`; la ausencia de POST a secas es ambigua (túnel/cobertura) y se marca **ámbar "sin señal"**, no como acusación. Es **disuasor + auditoría**, no candado. **No requiere rebuild del AAB** (thin shell que carga la web; `simulated` ya lo da el plugin instalado — validar en dispositivo real que llega; si fuera `undefined` habría que actualizar el plugin + subir `versionCode`). Resumen operativo: CLAUDE.md gotcha #40. `npm run build`/`lint` OK; los dos endpoints nuevos compilan.

---

## Estado del proyecto — crónicas completas (mayo–junio 2026)


### 🚀 LANZADO A PRODUCCIÓN — 30 mayo 2026
**Todo el trabajo de las 8 mejoras está DESPLEGADO Y EN VIVO** en `main` → Vercel (`transavic.vercel.app`). Ya NO es "local / dev-hugo": se hizo el merge a producción.
- **DB de producción migrada** (`ep-cool-sound`): se aplicó `scripts/migrate-produccion-2026-05-29.sql` por psql (8 tablas nuevas + 14 columnas + backfill de código de producto). La data real (~6.024 pedidos, 394 clientes, 87 productos) quedó **intacta**; las tablas nuevas nacieron vacías. Respaldo previo completo en `backups/` (gitignored) + restore automático de Neon.
- **24 env vars cargadas en Vercel (Production)**: `SUNAT_*` con credenciales **reales** (`APIFACTU`/`Transavic123`, `SUNAT_ENVIRONMENT=production`, certs `.p12` en base64), `APISPERU_TOKEN`, `BREVO_*`, `GEMINI_API_KEY`, `CRON_SECRET`. Las credenciales reales SOLO viven en Vercel + archivos gitignored (`.env.local`, `CREDENCIALES-PRODUCCION.local.md`) — nunca en el repo.
- **SUNAT en producción**: ambas empresas listas — Transavic (RUC 20 `20612806901`) y Avícola de Tony (RUC 10 `10710548841`, persona natural; APIFACTU creado + régimen confirmado por Antonio: emite boletas **y** facturas). **Pendiente: la 1ª emisión fiscal REAL** (Hugo la hará manualmente para validar end-to-end; los 3 tipos ya están validados en BETA).
- **Vercel**: proyecto `hugoherrerateam/transavic`, plan **Pro** (permite 40 crons; usamos 4). Auto-deploy desde `main`; **rollback instantáneo** disponible si algo sale mal.
- **`.env.local` sigue en `beta`** (testing local contra `dev-hugo`). Lo que está en `production` es Vercel.

> ⚠️ Las secciones de abajo describen CÓMO se construyó cada módulo (siguen vigentes). Donde digan **"TODO LOCAL / producción intacta / falta mergear / falta validar en producción"**, entender que **eso ya se ejecutó el 30 may 2026** (merge + migración + deploy hechos).

### Mejoras post-lanzamiento (31 may 2026 — pedido de Antonio) — ✅ EN PRODUCCIÓN
5 cambios construidos + probados en `dev-hugo` y **desplegados a producción** (2 migraciones por psql + deploy). Verificados en navegador (mapa, incentivos, orden de pedido) y E2E (bono guardar/borrar, historial registra el diff).
1. **Editar pedido + historial de cambios**: la asesora ya podía editar sus pedidos (modal en `/dashboard`); ahora **la asesora puede eliminar SUS pedidos, pero solo si están `Pendiente`** (⚠️ actualizado el 2 jun 2026 — ver subsección "Permisos de asesora" más abajo; antes era solo-admin); el admin elimina cualquiera, el repartidor nunca. Cada corrección de datos se **audita**: el PATCH guarda un diff (antes→después + quién + rol) en la tabla nueva **`pedido_ediciones`** (`scripts/migrate-pedido-ediciones.sql`). Solo se auditan campos de DATOS del pedido (ver `src/lib/pedido-historial.ts:CAMPOS_AUDITABLES`: cliente, dirección, detalle, fecha, etc.), NO el ruido del ciclo de vida (estado, repartidor, ruta, banderas legacy). El admin ve el historial con el botón **"Ver historial"** (menú "⋯" de cada fila) → modal `historial-pedido-modal.tsx` que lee `GET /api/pedidos/[id]/ediciones` (solo admin). El INSERT del historial es **no-bloqueante** (si falla, la edición igual queda aplicada).
2. **"Orden de pedido" (ex "guía de remisión")**: crash en prod arreglado + renombrado + opción de precios al imprimir. Ver **gotcha #20**.
3. **Notificación de entrega a la asesora**: ya estaba implementada (`api/pedidos/[id]/entregar` emite `pedido_entregado` al `asesor_id` al cerrar la entrega, + `pedido_fallido` si falla). Solo se verificó (no requirió cambios).
4. **Bono personalizado + % de meta configurable**: (a) el **% de crecimiento de la meta automática mensual** dejó de estar hardcodeado en 1.15 → ahora es `settings.incentivos_config.metasIndividuales.factorCrecimientoPct` (default 15; editable en la pantalla Incentivos). `lib/metas.ts` lo lee **directo de `settings`** (no importa `incentivos.ts` para no crear dependencia circular, ya que `incentivos.ts` importa de `metas.ts`). (b) **bono personalizado por asesora** al cumplir su meta del mes: columna nueva `metas_asesoras.bono` (`scripts/migrate-meta-bono.sql`; además `monto_meta` pasó a **NULLABLE** para permitir una fila con solo-bono sin override de meta — `calcularMetaDiaria` trata `monto_meta IS NULL` como "sin override" → meta automática). El admin lo fija por asesora en Incentivos (junto a su meta); la asesora lo ve en "Mis Metas" (banner ámbar → verde al cumplir). `POST /api/metas/override` acepta `monto_meta` nullable + `bono`; si ambos quedan vacíos, **borra la fila** (vuelve a automática sin bono).
5. **Filtro de motorizado en el mapa de despacho**: pasó de multi-toggle (había que apagar a los demás uno por uno) a **selección única "Ver ruta de"** en `mapa-despacho.tsx` — un clic en un motorizado aísla SU ruta (oculta a los demás + los "sin asignar"), "Todos los motorizados" para resetear; el mapa hace **zoom automático** a lo visible al cambiar el foco. De paso se arregló un bug latente de color de polyline (se re-indexaba al filtrar; ahora el color es estable por repartidor). Aplicada la skill `/mejora-diseño`. **Iteración (feedback de Antonio):** "Ver ruta de" se movió **arriba** del panel (es la acción principal) y "Estados" quedó **abajo** con **presets de 1 clic** ("Por entregar" / "Todos") — el filtro abre por defecto en **"Por entregar"** (oculta Entregado/Fallido) para que el mapa no nazca saturado de verde cuando hay ~116 entregados; los conteos por estado pasaron a ser **reales** (antes dependían del propio filtro y mostraban 0 al ocultar un estado).

**Migraciones nuevas aplicadas a dev-hugo Y producción (psql)**: `migrate-pedido-ediciones.sql` + `migrate-meta-bono.sql`. La fila `correlativos.guia_remision` se sembró en prod (crash fix, gotcha #20).

### Comprobantes — tipos diferenciados, vínculo NC↔factura, visibilidad total + emisor (2 jun 2026 — ✅ EN PRODUCCIÓN)
Pedido de Antonio/Hugo. Todo en la **lista** `/dashboard/comprobantes` (`comprobantes-client.tsx`); el PDF y el módulo SUNAT NO se tocaron. Se subió por un PR aparte (NO por el branch `respaldo-pre-migracion-2026-05-29`, que arrastraba la app repartidor — que en ese momento aún era solo-local; ya se subió a `main` el 4 jun en los PRs #18–#22).
1. **Chip de tipo con color + ícono** (helper `tipoUI`, hermano de `estadoUI`): Factura = índigo + `FiFileText`, Boleta = slate + `FiFile`, N. Crédito = naranja + `FiCornerUpLeft`. Antes la columna "Tipo" era texto plano e indistinguible. Tabla desktop + cards mobile; los chips del filtro "Tipo" llevan swatch del mismo color. Chip `rounded-md` lleno. Hecho con `/mejora-diseño`.
2. **Vínculo NC↔factura**: una NC muestra bajo su número "↩ anula F001-11" (clic → escribe esa serie en el buscador y salta a la factura); una factura/boleta ya acreditada mostraba el chip "↩ con N. Crédito". El 20 jul se reemplazó por `Corregida con <NC>` con el número exacto y sin opción de emitir otra NC.
3. **Visibilidad** — ⚠️ **REVERTIDO el mismo 2 jun (tarde); ver subsección "Permisos de asesora" más abajo.** Por unas horas se abrió a que TODAS las asesoras vieran TODOS los comprobantes, pero Antonio pidió volver al scoping por asesora. **Estado ACTUAL en prod:** cada asesora ve/maneja **solo los suyos** (de sus pedidos o emitidos por ella, vía helper `lib/comprobante-scope.ts`); el admin, todos. La separación por asesora se mantiene también en los insights de IA.
4. **Emisor**: columna "Emitido por" (desktop) / línea "Emitió: X" (mobile) con el nombre de quien emitió. Columna `emitido_por` llenada al emitir (`session.user.name`) en los 3 endpoints (`emitir`, `emitir-manual`, `[id]/nota-credito`); el reintento hace UPDATE (no reinserta) → preserva el emisor original.

**Migraciones (aplicadas a producción por psql ANTES del deploy — gotcha #17):** `scripts/migrate-comprobante-referencia.sql` (columna `referencia_comprobante_id`) y `scripts/migrate-comprobante-emisor.sql` (columna `emitido_por` + backfill best-effort desde la asesora dueña del pedido). Ambas **aditivas e idempotentes**; NO tocan XML/CDR/montos/estados → los comprobantes y NC ya emitidos quedan **intactos**. En comprobantes viejos: sin referencia (no muestran vínculo hasta re-emitir) y `emitido_por` solo para los que tienen pedido (los sueltos viejos quedan "—"). `OpcionesEmision` ganó `referenciaComprobanteId` y `emitidoPor`. Validado en dev-hugo; tsc/eslint limpios.

### Validaciones de emisión — boletas con datos basura + doble NC (2 jun 2026 — ✅ EN PRODUCCIÓN, PR #4)
En producción se detectaron comprobantes "malos" (SUNAT los aceptó con XML+CDR, pero el dato estaba mal): una boleta con **DNI "00000000"** (gloria), una boleta a **nombre suelto sin documento** (keila roja: tipo "0" + razón "keila roja"), y una factura con **DOS notas de crédito** por el total (doble anulación, S/254.80 → S/509.60 acreditado). Causas: el regex de DNI aceptaba 8 ceros; el cliente genérico conservaba el nombre escrito; `emitir/route.ts` inventaba `numDocumento: cliNumDoc || "00000000"`; y `[id]/nota-credito` no chequeaba si ya había una NC.

**Dato clave que definió el enfoque:** 400 de 404 clientes NO tienen DNI/RUC cargado. Por eso NO se exige documento en boletas (frenaría casi todas) — se normaliza a CLIENTES VARIOS.

Fix (helper nuevo `src/lib/sunat/validacion-cliente.ts`: `esDniValido` rechaza 8 dígitos iguales; `esRucValido` exige prefijo 10/15/16/17/20 **+ dígito verificador módulo 11** → rechaza RUC mal tecleado; `esReceptorIdentificado`):
- **Boletas** (`emitir`, `emitir-manual`, form `emitir-client`): un documento ingresado debe ser válido (rechaza 00000000); **sin DNI/RUC válido y < S/700 → "CLIENTES VARIOS"** automático (ya NO inventa DNI; en su momento también descartaba el nombre suelto — ⚠️ **eso se revirtió el 4 jun 2026**, ahora el nombre SÍ se respeta, ver "Boleta a nombre del cliente SIN DNI" abajo). **NO se exige documento** aunque haya nombre — 400/404 clientes no tienen doc, obligarlo frenaría la operación (decisión de Antonio jun 2026: opción "CLIENTES VARIOS"). Boletas ≥ S/700 siguen exigiendo DNI/RUC (ley SUNAT). La razón social del cliente identificado se normaliza a MAYÚSCULAS.
- **Nota de crédito** (`[id]/nota-credito`): **bloquea una segunda NC** si el comprobante ya tiene una NC aceptada/observada que lo acredita — por `referencia_comprobante_id` (NC nuevas) y por las `observaciones` (NC históricas, regex). Evita el doble de hoy.
- **Completar RUC del cliente** (form `emitir-client` + `emitir-manual`): al elegir del buscador un cliente registrado SIN documento válido, aparece un **aviso ámbar** que guía a ingresar el RUC/DNI y tocar Consultar (apisperu trae sus datos). Al emitir, si ese cliente no tenía doc válido, se **guarda el RUC/DNI en su ficha** (`UPDATE clientes` con guard `COALESCE(ruc_dni,'') !~ '^([0-9]{8}|[0-9]{11})$'` para no pisar uno bueno) → la base de 400/404 clientes sin doc se completa con el uso. Decisión de Antonio jun 2026.
- **Confirmación de comprobante duplicado** (`lib/sunat/duplicado.ts` + `emitir`/`emitir-manual` + form): antes de emitir, si ya hay un comprobante igual (misma empresa + tipo + cliente IDENTIFICADO + mismo monto ±0.10, estado válido, últimos 2 días — NO aplica a "CLIENTES VARIOS"), el endpoint responde **409** con `{ duplicado, mensaje }` y el form muestra un **modal**: "Ya existe un comprobante igual (F00x-…) por S/ … a este cliente" con **Cancelar · Ver comprobante · Sí, emitir igual** (reintenta con `confirmarDuplicado:true`). Evita duplicar por doble clic o re-emisión; no bloquea (la venta repetida legítima se confirma). Verificado en local end-to-end (el 409 corta antes de SUNAT). **Ojo:** `onClick={emitir}` se cambió a `onClick={() => emitir()}` (si no, el evento del click llegaba como `confirmarDuplicado` truthy y saltaba la guarda).

Sin migración (solo lógica). Los comprobantes ya emitidos NO se tocan (son fiscales, aceptados; corregirlos es tema del contador). Verificado: el dígito verificador valida los 5 RUCs reales de prod y rechaza los mal tecleados; regex de NC contra el caso real `F002-00000002`; tsc/eslint limpios. **Las facturas estaban OK** (RUC válido + razón formal); el lío era solo en boletas y NC.

### Permisos de asesora + 5 mejoras + hallazgo de metas (2 jun 2026, tarde — ✅ EN PRODUCCIÓN)
Sesión con Hugo. Todo en `main` y desplegado (PRs #6–#9). Verificado en producción (navegador como admin + queries a la BD real `ep-cool-sound`).

**A. Comprobantes — scoping por asesora (REVIERTE la "visibilidad total" de arriba) — PR #8.** Decisión final de Antonio: cada asesora ve/maneja **SOLO sus comprobantes**; el admin, todos. "Suyos" = los de sus pedidos (`pedidos.asesor_id`) **o** los que ella emitió (`comprobantes.emitido_por`, match con TRIM+lower por los nombres con espacio — gotcha #11). Helper nuevo `src/lib/comprobante-scope.ts:asesoraPuedeVerComprobante`, usado en `GET /api/comprobantes` (condición SQL) y en los endpoints por id (`[id]`, `/xml`, `/cdr`, `/enviar`, `/nota-credito`) → 404/403 si no es suyo. La asesora SÍ descarga PDF/XML/CDR y emite NC, pero solo de los suyos. (El OR es necesario: en prod solo 3 de 14 comprobantes tienen `emitido_por`; los 11 legacy se ven por el pedido.) Verificado contra prod: admin 14, Saraí 2, Yali 1, resto 0.

**B. La asesora elimina SUS pedidos, solo si están `Pendiente` — PR #9.** (Reemplaza el "borrar es solo-admin" del 31 may.) Guardas revalidadas en el BACKEND (el frontend solo decide qué botón mostrar): solo sus pedidos (`asesor_id = session.user.id`), solo estado `Pendiente` (si ya avanzó → 409 "pídele al admin"), y nunca si tiene comprobante aceptado/observado (→ 409 "anula con Nota de Crédito"). Admin borra cualquiera; repartidor nunca. Archivos: `src/app/api/pedidos/[id]/route.ts` (DELETE), `table.tsx` (recibe `userId`, calcula `puedeEliminar`, muestra "Eliminar" en el menú "⋯" a la asesora dueña de un Pendiente; `handleDelete` muestra el mensaje real del backend), `dashboard-content.tsx` (pasa `userId`). Sin migración.

**C. 5 mejoras — PR #7.** (1) **M1 Editar pedido con selección de productos**: el modal de edición trae el `ProductSelector`; el PATCH de `/api/pedidos/[id]` acepta `items[]` y **reemplaza `pedido_items`** con snapshot de precio (`DELETE`+`INSERT`) → editar SÍ cuenta en "Resumen del día"/reportes (antes editar solo el texto libre `detalle` no actualizaba `pedido_items`). (2) **M2 Ocultar "Anular" entrega a asesoras**: el botón Entregar/Anular se oculta para `asesor` cuando el pedido ya está Entregado (revertir la entrega es del motorizado/admin). (3) **M4 Cobranzas — revertir pago + método + captura**: `facturas` ganó `metodo_pago`/`pago_detalle`/`pago_img_base64`/`pago_img_mime` (migración `scripts/migrate-cobranza-pago.sql`, aplicada a prod+dev); al marcar pagada se elige método (efectivo/transferencia/yape/plin/otro) y opcionalmente se sube una captura **comprimida a webp ~60-90KB** en el cliente (`browser-image-compression`); la fila muestra el método + "ver captura" (`GET /api/facturas/[id]/pago-imagen`) + botón **Revertir** (`DELETE /api/facturas/[id]/pago` → vuelve a Pendiente/Vencida). (4) **M5 "Resumen del día" ya no redirige al admin**: el guard de `/dashboard/resumen/page.tsx` pasó de allowlist a blocklist (`if rol asesor|repartidor → redirect`), con trim+lower. (M3 = verificación de descarga PDF/XML, ya OK.)

**D. NC + descargas para asesoras — PR #6.** Las asesoras descargan PDF/XML/CDR y emiten Notas de Crédito (luego acotado a "solo los suyos" por el scoping del punto A).

**E. 🔴 HALLAZGO CRÍTICO — las metas automáticas dan S/0 porque NO hay precios cargados.** La meta automática FUNCIONA (`lib/metas.ts:calcularMetaDiaria`: si no hay override en `metas_asesoras` para el mes, meta = `ventas_mes_anterior × factor`; factor configurable, hoy **15%** en prod; se calcula al vuelo cada mes, sin cron). PERO en producción **0 de 88 productos tienen `precio_venta`**, así que aunque las asesoras registraron cientos de pedidos en mayo (Saraí 249, Yali 217, Jhoselyn 190, Yesica 138), TODOS los `pedido_items.subtotal` salen S/0 → la venta del mes anterior se valoriza en ~S/0 → la meta automática daría ~S/0. **Por eso hoy las metas son overrides manuales** (Jhoselyn 67k, Saraí 153k, Yali 85k, Yesica 34k) y NO se deben quitar hasta que se carguen los precios. **Fix de raíz:** cargar `precio_venta` de los productos en Catálogo; desde el mes siguiente las metas se vuelven automáticas (+15% sobre lo realmente vendido) sin overrides. Misma causa raíz del S/0 en reportes (gotcha #8 / banner "sin precio"). **Es la tarea pendiente más importante para que metas/reportes muestren números reales.**

**F. Diagnósticos (sin cambio de código).** (1) **"Sin permiso" del admin en Reportes/Resumen**: era una **sesión vieja** — un JWT emitido antes de un deploy quedó sin `role` (`auth.config.ts:jwt` solo setea `token.role` en el login; no se auto-repara). Se arregla **re-logueándose**; el código siempre permitió admin. Mejora opcional pendiente: auto-reparar el rol leyéndolo de la BD cuando el token no lo trae. (2) **Metas "desaparecidas" a fin de mes**: los overrides de `metas_asesoras` son **por mes** (`mes = 'YYYY-MM-01'`); junio nació sin fila → la pantalla los mostró vacíos. Se restauraron copiando los de mayo (`INSERT … SELECT … '2026-06-01' … ON CONFLICT DO NOTHING`). (Ver punto E: lo correcto a futuro es automático, no overrides.)

**G. Unidad de medida verificada (factura).** El `<select>` de unidad guarda el código SUNAT (`<option value="NIU">Unidad</option>`, `value="KGM">Kg</option>`), `emitir-manual` lo deja pasar (`mapUnidad`), el `xml-builder` lo escribe como `unitCode` y el PDF lo traduce con `getUnidadLabel` ("UNIDAD"/"KILOGRAMO"). **Correcto de punta a punta en XML y PDF.**

**H. App del motorizado (Capacitor, carpeta `android/`)**: ⚠️ ESTO YA NO ES ASÍ — el 4 jun 2026 la app **pasó a producción** (PRs #18–#22: carpeta `android/` en `main`, tabla `rider_locations` migrada a prod, validada en teléfono real, app en Google Play). Ver la sección "App Repartidor — Capacitor + GPS en vivo" más abajo.

### Cambiar la asesora encargada de un comprobante (3 jun 2026 — ✅ EN PRODUCCIÓN)
Pedido de Antonio: el admin necesitaba asignar/cambiar quién ve un comprobante (muchos tenían "Emitido por —" → no le aparecían a ninguna asesora, solo al admin). **Decisión de Antonio: se reescribe directamente `comprobantes.emitido_por`** (NO hay campo separado "encargada"). Como el scoping de `/api/comprobantes` ya filtra por `emitido_por` (match por nombre, TRIM+lower — gotcha #11), al poner el nombre de la asesora el comprobante le aparece en SU lista; `asesorId:null` lo deja en "—" (solo admin). Endpoint nuevo **`PATCH /api/comprobantes/[id]/emisor`** (solo admin; body `{ asesorId: uuid|null }`; resuelve el nombre EXACTO desde `users` con `role='asesor'` para que el match del scoping funcione). UI: ítem **"Cambiar asesora"** en el menú "⋯" de cada fila (solo admin) → modal `ModalAsignarAsesora` (dropdown de asesoras + "Sin asignar"); actualiza la fila al instante. **Sin migración** (la columna `emitido_por` ya existía). NO toca XML/CDR/montos — solo la atribución/visibilidad interna (el dato fiscal de quién emitió SÍ se pierde si se reasigna, era la contra aceptada de esta opción). Aplicada `/mejora-diseño` (modal calcado del estilo de los demás, acento índigo). tsc/eslint limpios.

### Unidad de medida (kg/unidad) + UX de emisión + chip Anulados (3 jun 2026 — ✅ EN PRODUCCIÓN)
Reporte de Antonio + auditoría de los flujos de emisión. Cuatro cosas:
1. **🐛 BUG FISCAL — la unidad salía siempre "UNIDAD" al emitir DESDE un pedido.** El form manda `items_override` con la unidad ya como código SUNAT (`KGM`/`NIU`), pero `/api/comprobantes/emitir` la mapeaba con `it.unidad === "kg" ? "KGM" : "NIU"` → como `"KGM" !== "kg"`, degradaba TODO a NIU. (El PDF lee del XML — gotcha #18 — así que mostraba lo mismo: "unidad".) Verificado en prod: las facturas/boletas DESDE pedido (B002, F002-2, F001-2, B001-2) tenían `kg` en `pedido_items` pero `NIU` en el XML firmado. El flujo MANUAL NO estaba afectado (usaba `mapUnidad`, que sí dejaba pasar `KGM`). **Fix:** helper único **`src/lib/sunat/unidades.ts:aUnitCodeSunat`** — idempotente (acepta `kg`/`uni` crudos Y los códigos `KGM`/`NIU`, **nunca degrada KGM→NIU**) — usado en los 4 caminos: `/emitir`, `/emitir-manual`, `/pedidos/[id]/entregar` (auto-emisión) y `unidadSunatDesde` del form. **Los comprobantes ya emitidos NO se tocan** (aceptados por SUNAT; corrige de aquí en adelante). Nota: 53 de 88 productos tienen unidad ambigua (`uni/kg`) → el autocompletado cae a NIU y la asesora elige la unidad real por ítem; ahora esa elección se respeta de punta a punta.
2. **"Consultar" ~obligatorio para factura (datos fieles a SUNAT).** Al elegir un cliente registrado **con RUC**, `handleSelectCliente` (emitir-client) ya NO autocompleta la razón social con el NOMBRE informal ni la dirección de ENTREGA: limpia ambos y deja que la **auto-consulta a SUNAT** (apisperu) traiga la razón social + dirección **FISCAL** oficiales → la factura sale fiel. Para DNI (boleta) sí usa el nombre. Sin documento → no autocompleta (boleta < S/700 → "CLIENTES VARIOS").
3. **Etiqueta del receptor según tipo:** factura → "Razón social"; boleta → "Nombre completo" (antes siempre "Razón social / Nombre completo").
4. **Chip "Anulados" quitado** del filtro de estado de `/comprobantes`: verificado que el estado `anulado` **NUNCA se usa** (los 16 comprobantes de prod están `aceptado`; la Comunicación de Baja está desactivada y la NC **enlaza**, no marca `anulado`). El `estadoUI("anulado")` se mantiene por si algún día se reactiva la baja.

Sin migración; tsc/eslint limpios. **Por qué "CLIENTES VARIOS":** una boleta < S/700 sin DNI/RUC válido se emite a "CLIENTES VARIOS" por decisión de negocio (400/404 clientes no tienen documento) — NO es error, es el fallback. Las NC heredan el cliente del comprobante que anulan.

### Unidad "UNIDAD" en boleta real reportada por asesora — diagnóstico + blindaje de UX (4 jun 2026 — ✅ EN PRODUCCIÓN)
La asesora **Yali** reportó una boleta (`B001-00000002`, transavic) con la unidad en **"UNIDAD"** "a pesar que puse kilo". **Diagnóstico (no es error de la asesora, es el bug ya corregido):** la boleta se emitió **3 jun 10:02 Lima** (el XML pone `IssueTime 15:02:39` en **UTC** = 10:02 Lima — ojo con eso al cotejar horas), pero el fix de la unidad (commit `b317952`) se mergeó a prod recién **3 jun 13:53 Lima** → la boleta salió **~4 h ANTES del fix**, con el código viejo (`it.unidad === "kg" ? "KGM" : "NIU"`, que convertía la selección `"KGM"` en `NIU`). El `pedido_items` del pedido origen tenía `unidad: "kg"` (ella SÍ puso kilos) y el `items_json` guardó `NIU`. Es una de las 4 ya conocidas (B002, F002-2, F001-2, **B001-2**). **Prueba de que ya estaba arreglado:** las emisiones POST-13:53 (`B001-00000003`, `B002-00000002`) salieron con `KGM` correcto. `ENVIO` siempre `NIU` es **correcto** (es un servicio, no se vende por kilo). **Qué hacer con la boleta vieja:** montos correctos (solo la etiqueta de unidad está mal); SUNAT la aceptó → se deja, o se anula con NC y se reemite (decisión de negocio).

**Blindaje de UX agregado (para que no vuelva a pasar), todo en `emitir-client.tsx`, sin migración, tsc/eslint limpios:**
1. **Precarga normalizada al "Facturar" desde un pedido**: la unidad del `pedido_items` se pasa por `unidadSunatDesde` → el `<select>` (opciones NIU/KGM) muestra **"Kg"** cuando el pedido dice kg. Antes metía la unidad cruda `"kg"`, que no matchea ninguna opción y el desplegable mostraba **"Unidad"** (engañoso), aunque al emitir el backend igual mandaba KGM (por el helper). Ahora el display coincide con la realidad → la asesora no se confunde ni la "corrige" mal.
2. **No pisar la unidad en productos ambiguos**: `onDescripcion` ahora usa el helper nuevo `unidadInequivoca(prod.unidad)` → solo fija la unidad si el catálogo es **claro** (`kg`→KGM, `uni`→NIU). Si es ambiguo (`uni/kg`) devuelve `null` y **respeta** la unidad que la fila ya tiene (la del pedido o la que la asesora eligió), en vez de degradarla a "Unidad" en silencio al re-tipear la descripción.

**Hallazgo de datos (importante, NO tocar el catálogo a ciegas):** `uni/kg` es **ambigüedad intencional, no un error**. El histórico de `pedido_items` lo confirma: kg 2880 / uni 2125, y los productos `uni/kg` se venden **de las dos formas** (Filete de Pechuga 279 kg vs 123 uni; Pechuga especial 273 vs 241; Pollo entero 526 uni vs 2 kg). Por eso **no se debe forzar una unidad única por producto** — la asesora elige por venta y el sistema debe **respetar** esa elección (lo que hacen estos fixes). Mejora futura posible (necesita endpoint): **default inteligente** = sugerir la unidad más usada históricamente por producto al elegirlo del catálogo en emisión MANUAL (la emisión desde pedido ya queda cubierta por el punto 1).

### Boleta a NOMBRE del cliente SIN DNI (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #25)
La asesora **Yesica** reportó: emitió una boleta poniendo el **nombre del cliente** pero salió **"CLIENTES VARIOS"** ("en SUNAT sí me permite boletas con nombre sin DNI"). **Diagnóstico (cruzando XML firmado + DB de prod + código):** NO fue error de la asesora ni un bug — fue la regla del 2 jun (anti-basura "keila roja") que quedó **demasiado agresiva**: en boleta < S/700 sin DNI/RUC válido, el backend **descartaba el nombre escrito** y forzaba "CLIENTES VARIOS" (curiosamente conservaba la dirección, no el nombre → inconsistente). La asesora **tiene razón**: SUNAT, en boletas < S/700, **no exige** documento pero **permite** emitir A NOMBRE del cliente (tipo doc "0", número "0", denominación de texto libre). Caso real: **B002-00000002** (avícola, Yesica, 3 jun 16:05, S/85.30, emisión **MANUAL** — `pedido_id` vacío) → salió tipo "0" + "CLIENTES VARIOS" con la dirección "av José Gálvez… san isidro" **intacta**, prueba de que ella sí ingresó datos del cliente.

**Fix (decisión de Antonio/Hugo: "permitir nombre + aviso claro"; SIN migración, solo lógica):**
- **Backend** — en boleta < S/700 sin documento válido, ahora `razonSocial: razon ? razon.toUpperCase() : "CLIENTES VARIOS"` (antes SIEMPRE "CLIENTES VARIOS"). En los **3 flujos**: `api/comprobantes/emitir-manual/route.ts` (manual), `api/comprobantes/emitir/route.ts` (desde pedido, usa `cliRazon`), y `api/pedidos/[id]/entregar/route.ts` (auto-emisión, apagada por `AUTO_EMITIR_COMPROBANTE`). De paso, en `entregar` se quitó el `numDocumento ?? "00000000"` **inventado** (mismo dato basura que el fix del 2 jun quería eliminar) → ahora valida con `esRucValido`/`esReceptorIdentificado` y cae a tipo "0" + nombre o CLIENTES VARIOS. Se **mantiene** el rechazo de DNI falsos (00000000) y la exigencia de DNI/RUC en boletas ≥ S/700.
- **Frontend** (`emitir-client.tsx`): (1) `handleSelectCliente` rama sin-doc ahora **conserva** nombre y dirección del cliente elegido (antes los borraba; útil para boleta — en factura la consulta SUNAT los sobreescribe). (2) El aviso del panel "Requisitos" dejó de **mentir** (decía "el nombre queda en el pedido", **falso** en emisión manual): ahora dice `Sin DNI, esta boleta saldrá a nombre de "X". Si quieres que figure el DNI, agrégalo arriba.` (o "se emitirá a CLIENTES VARIOS" si no hay nombre).
- **Verificado en BETA (E2E real):** boleta de prueba (transavic, sin DNI, nombre "JUAN PEREZ PRUEBA SIN DNI", S/10) → **ACEPTADA con CDR**; el **XML firmado** lleva `<cbc:ID schemeID="0">0</cbc:ID>` + `<cbc:RegistrationName>JUAN PEREZ PRUEBA SIN DNI</cbc:RegistrationName>` (el nombre, NO "CLIENTES VARIOS"). Confirma que SUNAT acepta boleta a nombre sin DNI. Comprobante de prueba borrado de dev-hugo; tsc/eslint limpios.
- **Los comprobantes ya emitidos NO se tocan** (fiscales, aceptados). La boleta de Yesica está bien emitida; solo dice "CLIENTES VARIOS" en vez del nombre — se deja, o se anula con NC y se reemite (decisión de negocio).
- ⚠️ **Revierte parcialmente la regla del 2 jun** ("sin DNI → CLIENTES VARIOS, descartar nombre"): ahora el nombre se **respeta**. El resto del fix del 2 jun (rechazar 00000000, exigir doc ≥ S/700, anti-doble-NC, anti-duplicado) sigue **igual**.

### PDF de comprobante sin documento — sin la línea "- : 0" (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #25)
Una boleta a nombre del cliente sin DNI (tipo doc "0") mostraba en el PDF una línea **"- : 0"** (guión + cero) donde iría el documento — se veía poco prolijo (lo mismo pasaba con "CLIENTES VARIOS"). Ahora esa línea **se OMITE** cuando el receptor no tiene documento (helper `clienteSinDocumento` en `src/lib/sunat/pdf-comprobante.ts`: tipo "0" o número vacío/"0"), en **factura y boleta** → el PDF queda solo con "Señor(es): NOMBRE" y pasa directo a "Tipo de Moneda". **No toca el XML ni SUNAT** (solo la representación impresa). Verificado generando el PDF real (el módulo del bundle): el nombre se conserva, sin guión ni cero.

### Todas las ventas entran a cobranzas (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #25, decisión de Antonio)
**Antes:** la factura (contado/crédito) creaba cobranza; la boleta solo si era a crédito. **Ahora:** **TODA venta —factura O boleta, contado o crédito— crea cobranza por defecto**, porque en Transavic el "contado" casi siempre se cobra **días después** (el cliente no paga el mismo día). Único opt-out: el check **"¿el cliente pagó en el acto?"** (cash de mano), que ahora se muestra para **boletas también** (antes solo facturas). La lógica quedó `debeCrearCobranza = serieNumero && emisionOk && (esCredito || !yaCobrado)` en `emitir/route.ts` y `emitir-manual/route.ts`. **Incluye las boletas a "CLIENTES VARIOS"** (Antonio eligió "todas sin excepción", aunque sean consumidor anónimo → la cobranza queda a nombre "CLIENTES VARIOS"). Archivos: los 2 endpoints + el checkbox/`cobradoYa` en `emitir-client.tsx`. Sin migración. Ojo: sube el volumen de la lista de `/cobranzas` (entra todo) — el opt-out "ya pagó" es la válvula para el cash de mostrador. **Además (mismo PR #25):** se arregló que las cobranzas creadas **desde un pedido** salían **sin nombre** (la lista mostraba solo el número de comprobante) — el código usaba `pedido.razon_social ?? pedido.cliente` y un `razon_social` vacío (`""`, no `null`) pasaba el `??` dejando el nombre en blanco; ahora usa `cliRazon` con `||`. Las 2 cobranzas ya existentes en prod (`F001-00000002`, `F002-00000002`) se corrigieron por **backfill** (tomando la razón social del comprobante). **⚠️ ACTUALIZADO 4 jun 2026 (PR #31):** el opt-out **"¿el cliente pagó en el acto?" se ELIMINÓ** — confundía y dejó 8 ventas sin cobranza. Ahora `debeCrearCobranza = serieNumero && emisionOk` (sin `yaCobrado`): TODA venta crea cobranza **sin excepción**; si ya pagó, la asesora marca "pagada" a mano. Ver "Toda venta crea cobranza" abajo.

### Factura/PDF: muestra la dirección del CLIENTE, no la del emisor (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #26)
Una asesora reportó que la factura mostraba la **dirección de Transavic** en vez de la **del cliente**. Causa doble: (1) el PDF (`pdf-comprobante.ts`) dibujaba la fila **"Establecimiento del Emisor"** con `EMISOR.direccion` (la de Transavic), justo en el bloque del adquirente donde el cliente espera ver SU dirección, y **nunca** dibujaba `cliente.direccion`; (2) el endpoint `GET /api/comprobantes/[id]` devolvía `cliente.direccion = pedido_direccion` (la de ENTREGA del pedido; `null` en facturas standalone), no la del XML firmado. La dirección fiscal del cliente **sí estaba en el XML firmado** (`cac:AccountingCustomerParty` → `RegistrationAddress` → `cbc:Line`, traída de SUNAT al consultar el RUC), solo que no se mostraba. **Fix (consistente con gotcha #18, el PDF lee del XML firmado):** (a) `parse-cpe-items.ts:parseCpeClienteDireccion(xml)` extrae la dirección del cliente del XML **acotada a `<cac:AccountingCustomerParty>`** para NO tomar la del emisor (`AccountingSupplierParty`); (b) el endpoint usa esa dirección con fallback a `pedido_direccion`; (c) el PDF de la **factura** muestra **"Dirección del Cliente: …"** (reemplaza "Establecimiento del Emisor"), la **boleta** la muestra si existe, y la fila se **omite** si no hay dirección (helper similar a `clienteSinDocumento`). **Retroactivo:** como la dirección sale del XML firmado (que no cambia), las facturas YA EMITIDAS muestran la dirección correcta al **regenerar/descargar** el PDF (sin tocar el XML legal). Verificado: parser (test unitario — toma la del cliente, no la del emisor) + PDF real generado muestra `Dirección del Cliente : AV. LA MARINA NRO. 2593 LIMA LIMA SAN MIGUEL`. tsc/eslint/build limpios. Sin migración. **Nota:** si en el futuro Transavic emite desde un local **anexo**, habría que re-agregar el "Establecimiento del Emisor" como fila aparte (hoy emite desde el domicilio fiscal principal, que ya está en el header).

### Cobranzas: un pedido = una cobranza (no duplicar entregar + facturar) (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #27)
Antonio notó que en `/cobranzas` algunas filas (Matías Córdova, Alejandra Ormeño) no muestran número de comprobante: son pedidos **entregados pero aún no facturados** — la cobranza se crea al ENTREGAR el pedido (`crearFacturaParaPedido`, flujo `pedidos/[id]/entregar`), sin comprobante. Investigando salió un **riesgo de cobranza duplicada**: hay DOS caminos que crean cobranza sin coordinarse — al entregar y al emitir el comprobante (`emitir/route.ts`). Un pedido entregado y luego facturado generaría **dos** cobranzas (deuda duplicada). Hoy casi no ocurría porque **0 de 88 productos tienen precio** → `calcularMontoPedido` da S/0 → al entregar no se crea cobranza (`if monto > 0`); pero **al cargar los precios se duplicaría en masa**, y el cambio de "toda venta crea cobranza" lo agrava. **Fix "un pedido = una cobranza"** (`lib/cobranzas.ts`): (a) `crearFacturaParaPedido` ahora es **idempotente** (si el pedido ya tiene cobranza, devuelve la existente, no crea otra); (b) nueva **`vincularCobranzaAComprobante`** — al emitir desde un pedido, si ya existe la cobranza de la entrega (sin comprobante) la **ASCIENDE** (UPDATE con número/monto/vencimiento/nombre del comprobante) en vez de crear otra; idempotente al reintentar (rama por `numero_comprobante`); si no hay ninguna, crea (`crearFacturaStandalone`). `emitir/route.ts` usa la nueva función; `emitir-manual` (standalone, sin pedido) no cambia. Verificado por SQL en dev-hugo (transacción + rollback): entrega→1 sin número, emitir→sigue 1 con número y monto actualizado (no duplica), reintento→no duplica. Sin migración. **De paso:** la cobranza `F001-00000007` tenía el nombre del cliente en blanco (factura anterior al fix de nombre del PR #25) → corregida en prod por backfill a "ARRARRAY SOCIEDAD ANONIMA CERRADA". **Pendiente de raíz (recordatorio):** cargar `precio_venta` en Catálogo — hoy 0/88 productos tienen precio (gotcha #8 / hallazgo del 2 jun); hasta entonces los montos de pedidos/cobranzas-de-entrega salen S/0. **⚠️ ACTUALIZADO el mismo día (PR #28):** Antonio decidió que **ENTREGAR un pedido ya NO crea cobranza** — la cobranza la genera **SOLO el comprobante emitido** (boleta/factura). Se quitó la creación de cobranza del flujo `entregar/route.ts` (`crearFacturaParaPedido` quedó `@deprecated`, sin uso); `vincularCobranzaAComprobante` se mantiene (crea la cobranza al emitir desde un pedido; para pedidos nuevos ya no hay "cobranza de entrega" que ascender, así que simplemente la crea). Las 2 cobranzas viejas sin comprobante (Matías Córdova S/1200, Alejandra Ormeño S/80) se **BORRARON de prod** → ahora **toda cobranza tiene comprobante**. Para cobrar un pedido entregado hay que **emitirle la boleta/factura** (eso crea su cobranza).

### Despacho para asesoras (solo lectura) — ver motorizados en vivo (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #29)
Pedido de Antonio: las **asesoras** ahora entran a **Despacho** (`/dashboard/despacho`, Lista **y** Mapa) para **monitorear los motorizados y entregas en tiempo real** (y avisarle al cliente). **Alcance TOTAL** (ven TODOS los motorizados y pedidos del día, igual que el admin — decisión explícita de Antonio, **NO** scoping por asesora) pero en **SOLO LECTURA**: cero acciones de gestión.
- **Acceso abierto a `asesor`:** `DashboardLayout.tsx` (Despacho → `roles: ["admin","asesor"]`), `despacho/page.tsx` (guard; repartidor/producción siguen a su home con `homeForRole`), `GET /api/despacho` (lee admin + asesor; **sin** filtro por `asesor_id`).
- **Solo lectura** (`despacho-content.tsx`, bandera `soloLectura = session.user.role !== "admin"`): se ocultan Optimizar Ruta, "Asignar a…", Desasignar, Delivery Externo (WhatsApp/devolver/Entregado/Fallido) y editar Ubicación Base; el **drag&drop se desactiva** (`isDragDisabled={soloLectura}` + guarda en `handleDragEnd`); chip "👁️ Solo lectura" en el header.
- **Doble candado:** las mutaciones (`/despacho/asignar`, `/optimizar-ruta`, `/reordenar`, `/asignar-externo`) **siguen admin-only** (403). `mapa-despacho.tsx` NO se tocó (es 100% visualización: marcador "moto en vivo", filtros). Para admin no cambia nada. Sin migración. tsc/eslint/build limpios.

### Anular cobranzas (soft) + la NC auto-anula (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #30)
Pedido de Antonio ("darle más poder a la asesora en cobranzas"). Las asesoras pueden **anular** sus cobranzas creadas por error o cuya factura/boleta se anuló con Nota de Crédito. **"Anular", NO borrar:** pasa al nuevo estado **`Anulada`** con rastro (`anulada_por` / `anulada_at` / `anulada_motivo`), sale de la lista y de los totales, pero el registro queda (auditable). Migración **`scripts/migrate-cobranza-anular.sql`** (aditiva, 3 columnas; aplicada a prod **y** dev-hugo por psql ANTES del deploy — gotcha #17). Ver **gotcha #24**.
- **Decisiones (Antonio):** anular (no hard delete) · la asesora solo las "seguras" · la NC auto-anula.
- **`POST /api/facturas/[id]/anular`** (guardas en BACKEND): la asesora solo las **suyas**; **409** si ya está **Pagada** (revertir el pago primero). Helper `anularCobranza()` en `lib/cobranzas.ts`. **⚠️ ACTUALIZADO 4 jun 2026 (PR #33):** se **quitó** el candado "respalda una factura vigente sin NC → emite la NC primero" — anular una cobranza **ya NO exige** una NC. Ver "Anular cobranza ya no exige NC" abajo.
- **La NC auto-anula** (`api/comprobantes/[id]/nota-credito/route.ts` → `anularCobranzasDeComprobante`): al aceptarse la NC, su cobranza ligada pasa a Anulada (no bloqueante; **NO toca las Pagadas**). **Match SÓLIDO por `comprobante_id` o `pedido_id`+número** — NO por `numero_comprobante` a secas (las 2 empresas comparten las series F001/B001 → anularía la cobranza de la otra). Por eso `crearFacturaStandalone` ahora guarda `comprobante_id` (forward-fix en `emitir-manual`).
- **Exclusión de `Anulada`:** `GET /api/facturas` la saca del default y de los stats (filtro `?estado=Anulada` para revisarlas); perfil del cliente y `/pago` la excluyen/bloquean. UI: botón **Anular** + modal con motivo + chip de filtro **"Anuladas"** en `cobranzas-client.tsx`. Verificado por SQL en dev-hugo (transacción+rollback): anula por id/pedido, **respeta Pagadas, NO cruza empresas**. NO se tocó `lib/sunat/*`.

### Toda venta crea cobranza — se quitó el check "¿pagó en el acto?" + backfill (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #31 + data op)
El check **"¿El cliente pagó en el acto?"** confundía y dejó **8 ventas sin cobranza** en prod (las asesoras reportaron *"no me aparecen las cobranzas de algunos clientes"*). **Se ELIMINÓ:** ahora `debeCrearCobranza = !!resultado.serieNumero && emisionOk` en `emitir/route.ts` y `emitir-manual/route.ts` (sin `yaCobrado`). **TODA factura/boleta —de pedido o manual, Contado o Crédito— crea SIEMPRE su cobranza, sin excepción.** Si el cliente ya pagó, la asesora marca **"Marcar pagada"** (botón que ya existe en `/cobranzas`). Se quitó el campo `yaCobrado` de los 2 schemas zod y del form (`emitir-client.tsx`), reemplazado por una **nota** ("se registrará una cobranza pendiente; si ya pagó, márcala en Cobranzas"). Sin migración; tsc/eslint/build limpios.
- **Backfill (operación de DATOS en prod, NO va a git):** se crearon las **8 cobranzas faltantes** por SQL (ensayo con ROLLBACK → confirmado 8, las 8 con asesora → recién COMMIT). **Clave:** cada una con su **`asesor_id`** resuelto vía `pedidos.asesor_id` o `emitido_por` (TRIM+lower — gotcha #11) → así le aparece a la asesora correcta. **Sin `asesor_id`, una cobranza solo la ve el admin** — ESA era la causa real de "no me aparece". Estado/vencimiento = emisión + 7 días; enlazadas por `comprobante_id`. La detección de "ya tiene cobranza" fue por `comprobante_id` / `numero_comprobante` / `pedido_id` (verificado que **NO hay series compartidas entre empresas** → seguro; NO se usó el monto para detectar, porque 3 cobranzas legítimas tenían monto distinto al del comprobante y habrían salido como "faltantes" → duplicado). Resultado: **0 comprobantes aceptados sin cobranza, 0 duplicados**. Total backfill **S/1002.91** (Yesica 4, Jhoselyn 2, Yali 1, Saraí 1). **Recordatorio:** algunas eran "Contado" ya pagadas → las asesoras deben marcar "pagada" las que ya cobraron.

### Anular cobranza ya NO exige NC (causa raíz: NC históricas) + data fix (4 jun 2026 — ✅ EN PRODUCCIÓN, PR #33)
Una asesora no podía anular cobranzas cuya factura **ya tenía Nota de Crédito**: el sistema la bloqueaba con *"emite primero la Nota de Crédito"*. **Causa raíz (depuración sistemática):** el candado `comprobanteVigenteSinNC` del endpoint de anular detectaba la NC **solo por `referencia_comprobante_id`**, pero **5 NC históricas** (emitidas antes del 2 jun, cuando se agregó esa columna) tienen `referencia = NULL` y se enlazan al comprobante **solo por `observaciones`** (el endpoint de NC SIEMPRE escribe "Nota de crédito FC0x-… (ACEPTADA) — motivo" en el `observaciones` del comprobante original). El candado no las veía → bloqueaba aunque la NC existiera.
- **Fix (decisión de Antonio): anular una cobranza NO debe exigir una NC** — la cobranza es el registro INTERNO de cobro, separado del comprobante fiscal (anularla NO toca SUNAT). Se **quitó el candado por completo** (`api/facturas/[id]/anular`: fuera el bloque + el helper `comprobanteVigenteSinNC`); quedan solo: la asesora **solo las suyas**, **409 si Pagada** (revertir primero), motivo + auditoría. La nota del modal (`cobranzas-client.tsx`) ya no menciona la NC. Sin migración; tsc/eslint/build limpios.
- **El detector COMPLETO de "el comprobante tiene NC" es `comprobantes.observaciones ILIKE '%nota de cr%'`** (atrapa históricas + nuevas), NO `referencia_comprobante_id` (solo las nuevas). Tenerlo presente si en el futuro hay que detectar NC desde el lado del comprobante original.
- **Data fix (prod, NO va a git):** se **anularon las 10 cobranzas vivas cuya factura ya tenía NC aceptada** (`UPDATE … estado='Anulada'`, motivo "acreditada con NC"; detector por `observaciones`; match a la cobranza por `comprobante_id` o `numero_comprobante` — series disjuntas entre empresas → seguro). Eran ventas anuladas, NO deuda. Ensayo+rollback → COMMIT. Verificado: **0 cobranzas-con-NC vivas**. (4 de esas 10 las había creado de más el backfill del PR #31, que le dio cobranza a facturas ya anuladas con NC — esto las limpia.)

### Tres fixes de UI + limpieza de usuario de prueba (4 jun 2026 — ✅ EN PRODUCCIÓN, PRs #35–#37)
1. **IA: caché persistente + respaldo Groq (PR #35).** Resuelve el 429 de Gemini. Ver **gotcha #16** (ya marcado RESUELTO) + §4 (`GROQ_API_KEY`/`GROQ_MODEL`). Caché en tabla `ia_insights_cache`; `callIA()` reintenta con Groq si Gemini falla. Verificado E2E: miss 7s → hit 151ms; fallback Groq probado rompiendo la key de Gemini.
2. **Selector "¿Quién realizó la entrega?" → solo repartidores (PR #36).** En `dashboard-content.tsx` la lista `usuarios` (que alimenta ese modal en `table.tsx`) ahora filtra `role === 'repartidor'` (antes listaba admin + asesoras + repartidores). Una línea; la lista `asesoras` (impresión) queda igual. Sin backend.
3. **Traductor de Chrome desactivado (PR #36).** El root layout decía `<html lang="en">` aunque la app es 100% en español → Chrome la auto-traducía y alteraba nombres propios ("Clever"→"Inteligente", "Wilder"→"Salvaje", **"Alas"→"¡Ay!"**). Fix global en `layout.tsx`: **`lang="es" translate="no"`** + `metadata.other = { google: "notranslate" }`. Apaga la traducción para todo el ERP (protege nombres/direcciones/productos). Si una pestaña ya estaba traducida, requiere recarga a fondo una vez. (También documentado en `docs/arquitectura/01-negocio-avicola.md`.)
4. **Eliminar usuario: pre-check de historial completo + mensaje real (PR #37).** Borrar un usuario daba siempre "No se pudo eliminar el usuario." sin explicar. Causa: (a) el guard de `api/users/[id]/route.ts` solo miraba `pedidos.asesor_id`, así que un **repartidor** con pedidos pasaba el chequeo y el DELETE fallaba por FK (`pedidos.repartidor_id` es NO ACTION) → 500 genérico; (b) el frontend descartaba el mensaje del backend. Fix: el guard cuenta TODAS las refs que bloquean (pedidos asesor **o** repartidor, `facturas.asesor_id`, `precios_productos.created_by`) → **409 con motivo claro** ("tiene N pedido(s) en su historial…"); catch de FK (`23503`) → 409 amable; el frontend muestra el `error` real. Un usuario **sin** historial se borra (refs CASCADE/SET NULL se limpian solas). Verificado: Yoiclin (281 pedidos) → bloqueado con mensaje; RepartidorTest (0) → se borra. Sin migración. (Docs 03 §7.4 y 05 actualizados.)
5. **Limpieza de `repartidorprueba` (data op en prod, NO va a git).** La cuenta de prueba tenía **6 pedidos reales** (clientes reales de abril, marcados con la cuenta de prueba; sin comprobante ni cobranza) que impedían borrarla. Decisión de Antonio: **desvincular** (los 6 pedidos `repartidor_id = NULL`, se conservan en historial/reportes — cero ventas perdidas) y luego **borrar** la cuenta. Ensayo+ROLLBACK (UPDATE 6, DELETE 1) → COMMIT. Verificado: 0 usuarios, 0 pedidos ligados, los 6 pedidos siguen vivos. (Nota: el texto `entregado_por='repartidorprueba'` quedó en varios pedidos de abril — es solo etiqueta histórica, no FK, no afecta.)

### Las 8 mejoras (acordadas con Antonio — S/ 4 000, 17 días)
| # | Mejora | Fase | Estado |
|---|---|---|---|
| 1 | Pesos digitales + flujo completo (estados `En_Produccion`, `Listo_Para_Despacho`, rol `produccion`) | A | ✅ En producción |
| 2 | Guía de remisión digital + foto firmada (HTML imprimible, foto base64 en DB) | A | ✅ En producción |
| 4 | Avisos automáticos entre áreas (campanita, polling 30s) | B | ✅ En producción |
| 5 | Dashboard comercial + metas + panel gerencial | B | ✅ En producción |
| 6 | Cobranzas con plazos flexibles + cron diario | B | ✅ En producción |
| 7 | SUNAT con 2 RUCs (XML UBL 2.1 + firma + SOAP + CDR) + emisión standalone + NC + consulta RUC/DNI + correo Brevo. Validado en BETA (factura/boleta/NC ACEPTADAS). | B | ✅ En producción · falta 1ª emisión real |
| 8 | IA comercial Gemini Flash — admin y asesoras (scoped) | C | ✅ En producción (caché persistente + respaldo Groq, 429 resuelto — gotcha #16) |
| 3 | Seguimiento motorizado en vivo (app Android Capacitor + GPS en segundo plano) | C | ✅ EN PRODUCCIÓN (4 jun 2026) — web desplegada (PRs #18–#22) + validado en teléfono real; app **publicada en Google Play** (Prueba Interna, v1; AAB v2 con ícono por subir). Tracking por **polling** (sin Pusher). Ver "App Repartidor" abajo |

**Decisiones técnicas tomadas durante implementación:**
- PDF de guía → HTML + `window.print()` (sin `@react-pdf/renderer`). $0 costo.
- Foto firmada → Base64 en columna DB (sin Vercel Blob). $0 costo.
- SUNAT → **módulo real portado** desde `conexipema-eventos/src/lib/sunat/` (mayo 2026). Genera XML UBL 2.1, firma con certificado .p12 (XML-DSig), comprime ZIP, envía SOAP a webservice SUNAT, parsea CDR. **VALIDADO contra SUNAT BETA con el cert real de Transavic (mayo 2026): factura (01), boleta (03) y nota de crédito (07) → todas `ACEPTADA` con CDR.** El código quedó idéntico a conexipema (probado en producción) en xml-builder/xml-signer/soap-client; la firma (RSA-SHA1, digest SHA256, C14N, transform enveloped+C14N, en ExtensionContent) valida sin problema.
- Dependencias: `xmlbuilder2`, `xml-crypto`, `node-forge`, `archiver@7` (¡no @8, cambió de API!). `archiver`, `node-forge` y `xml-crypto` listados en `next.config.ts:serverExternalPackages` para evitar bugs de bundling webpack.
- Gemini Flash Latest → cuenta dedicada `transavicdev@gmail.com`, project 88126347805. Requiere `thinkingConfig: { thinkingBudget: 0 }` en `generationConfig` para evitar que el modelo gaste tokens en thinking interno y trunque respuestas.

### App Repartidor — Capacitor + GPS en vivo (Mejora 3) — ✅ EN PRODUCCIÓN (4 jun 2026)

> **ACTUALIZACIÓN 4 jun 2026 (esto supera el "LOCAL, NO SUBIDO" histórico de abajo):** el seguimiento GPS del motorizado **pasó a PRODUCCIÓN**.
> - **Web desplegada a `main`/Vercel:** **PR #18** (integración a main + tabla `rider_locations` migrada a prod por psql + `/api/despacho` endurecido para tolerar ausencia de la tabla), **PR #19** (la app pide solo el permiso de notificación + **cola offline** de GPS: guarda la última posición y la reenvía al volver la señal), **PR #20** (firma de release + página pública `/privacidad`), **PR #21** (assets de la ficha de Play + docs al día), **PR #22** (ícono de la app con el logo de Transavic — la v1 había salido con el ícono genérico de Capacitor).
> - **Cómo funciona el tracking en vivo (NO usa Pusher):** el plan original mencionaba Pusher/websockets, pero **se resolvió con polling**, que ya existía: la app (o la web) hace `POST /api/repartidor/ubicacion` cada ~12s → UPSERT en `rider_locations` (1 fila viva por motorizado) → el mapa de despacho del admin la levanta en su poll de 15s a `GET /api/despacho`. Cero infra nueva, $0 de costo. (Pusher quedó descartado.)
> - **Validado en teléfono real** (HONOR, Android 15): GPS en vivo con la pantalla bloqueada cuando hay datos. Hallazgos de la prueba de calle: (1) el permiso de **notificación** debía estar activo —si no, el HONOR congela el foreground service— ahora la app lo pide solo (PR #19); (2) **sin señal** las posiciones se perdían → ahora hay cola offline; (3) el bloqueo agresivo de HONOR/Xiaomi se resuelve con ajustes de **batería/inicio automático** (Android no deja automatizarlo → va en el instructivo por equipo).
> - **Google Play:** app **"Transavic Reparto"** creada (appId interno `4972377973183273901`, paquete `pe.transavic.reparto`, español, gratuita) y **versión 1 (1.0) PUBLICADA en Prueba Interna**. **Ícono corregido en la v2** (`versionCode 2` / `versionName 1.0.1`): se reconstruyó el **AAB v2** con el logo de Transavic (`npm run app:build:prod` → `android/app/build/outputs/bundle/release/app-release.aab`) para que el ícono correcto aparezca al instalar/actualizar. **Cada release de Play exige `versionCode` mayor al anterior** → subirlo en `android/app/build.gradle` antes de cada build. **Llave de firma (upload key):** `android/app/upload-keystore.jks` + `android/keystore.properties` (gitignored) con respaldo en `backups/firma-play/` y credenciales en `CREDENCIALES-PRODUCCION.local.md` (huella SHA1 `49:51:0D:…`). Assets de la ficha (ícono 512, gráfico 1024×500, 2 capturas) en `docs/play-assets/`. **Pendiente (NO bloquea la prueba interna):** subir el AAB v2 a Play como nueva versión; agregar los 6 Gmail de los motorizados como testers; completar "Contenido de la app" / Data Safety / clasificación (respuestas en `docs/play-store-transavic-reparto.local.md`; harían falta para producción abierta, no para la prueba interna). Las subidas de archivos a Play **no** se pueden hacer por el MCP del navegador → el AAB lo sube Hugo a mano. Cuenta de prueba en prod: `repartidorprueba` / `Repartidor1234`.

**Lo de abajo es el registro histórico de cuando estaba solo en local (31 may 2026):**

Implementadas **F1–F6** del spec `docs/superpowers/specs/2026-05-31-app-repartidor-capacitor-gps.md`. (En su momento la regla era: nada se sube hasta probar en teléfono real — ya cumplido.) Guía práctica completa: **`docs/app-repartidor-guia-prueba-y-build.md`** (cómo probar con `adb reverse` sin tocar producción, reconstruir el APK, y pasar a prod + Play).

- **Qué es:** app Android "cascarón" Capacitor que **carga la web** (`server.url`), no la re-empaqueta. Solo el repartidor la usa. Aporta **GPS en segundo plano** (pantalla apagada) vía *foreground service*, que el navegador móvil no puede.
- **Backend (F1):** tabla `rider_locations` (1 fila viva por rider, UPSERT; migraciones `scripts/migrate-rider-locations.sql` + `scripts/migrate-rider-locations-accuracy.sql` — esta última amplía `accuracy` a `NUMERIC(10,2)`: con señal mala el GPS reporta miles de metros y `NUMERIC(6,2)` desbordaba → 500 → ping perdido; el endpoint además recorta `accuracy`. **Ambas aplicadas a dev-hugo Y producción por psql — gotcha #13**). Endpoint `POST /api/repartidor/ubicacion` (rol `repartidor`, scoping por sesión, zod, idempotente por el UPSERT). `GET /api/despacho` ahora adjunta `ubicacion` por rider (envuelto en try/catch: si la tabla faltara, el resto del mapa sigue funcionando).
- **Mapa admin (F2):** marker "moto" en vivo en `mapa-despacho.tsx` (color estable por rider, flecha de rumbo, halo "en vivo" si ≤5 min, gris si viejo), InfoWindow "hace N min" + pedidos por entregar, toggle "Motos en vivo". El reencuadre dejó de saltar en cada poll (solo al cambiar selección).
- **Reporte web (F3):** `useGeolocation` en `mi-ruta-content.tsx` postea cada ~12s **solo en web**; en nativo se desactiva (lo hace el plugin). Guard `esPlataformaNativa()` en `src/lib/plataforma.ts`.
- **Nativo (F4+F5):** `src/app/dashboard/mi-ruta/seguimiento-nativo.tsx` (cargado con `next/dynamic({ssr:false})`): hook con `@capacitor-community/background-geolocation` (`addWatcher` + foreground service) que reporta con **`CapacitorHttp`** (HTTP nativo — el `fetch` del WebView se estrangula en background) + UI de **aviso destacado** (requisito de Play, antes de pedir permiso), estado en vivo, pausar/reanudar y tips de batería/autostart.
- **Capacitor 7** (`capacitor.config.ts`: `appId pe.transavic.reparto`, `useLegacyBridge:true`, `server.url` configurable por `CAP_SERVER_URL`, default `http://localhost:3000`; en build de prod = `https://transavic.vercel.app`). Proyecto en `android/` (ya commiteado a `main`). Deps: `@capacitor/core|cli|android@7`, `@capacitor-community/background-geolocation@1`, `@capacitor/local-notifications@7`, `@capacitor/splash-screen@7`, `@capacitor/assets@3` (genera el ícono). Scripts: `npm run app:sync|app:open|app:build` (APK debug) `|app:build:prod` (AAB release firmado). SDK: `compileSdk 36` / `targetSdk 35` / `minSdk 23`.
- **Decisiones clave:** (a) **sin `ACCESS_BACKGROUND_LOCATION`** — el plugin rastrea con foreground service + permiso "mientras se usa", lo que **evita la revisión especial de "ubicación en segundo plano" de Play**. (b) cleartext **acotado a localhost** (`network_security_config.xml`) para la prueba local; en prod (https) no aplica. (c) **`compileSdk 36`** (en esta Mac hay `android-36`, no `android-35`) + `android.suppressUnsupportedCompileSdk=36` en `gradle.properties` — ver gotcha #22.
- **✅ Validado en teléfono real (4 jun 2026):** HONOR Android 15, GPS en vivo con la pantalla bloqueada y datos móviles. Lecciones de la prueba de calle (ya resueltas): el permiso de **notificación** debe estar activo (si no, HONOR congela el foreground service) → la app lo pide solo; **sin señal** las posiciones se perdían → cola offline; el bloqueo agresivo de HONOR/Xiaomi se resuelve con ajustes de **batería/inicio automático** (no automatizable → va en los tips de la propia app).

### Branch Neon `dev-hugo` (testing aislado)
- Project: `pedidos_transavic` (`fragrant-sun-30707890`), org "Vercel: Hugo Herrera's projects"
- Branch ID: `br-tiny-frost-aduw14pu`
- Endpoint: `ep-super-violet-adyp68ne` (vs producción `ep-cool-sound-adxrsjt5`)
- Conexión guardada en `.env.local` (no en `.env`)
- El merge a producción se hizo el **30 may 2026** (migración por psql + deploy). `dev-hugo` sigue como branch de testing aislado para cambios futuros: probar acá primero, y recién mergear a `main`.

Planes formales: `docs/superpowers/plans/2026-05-13-fase-{a,b}-*.md`.

### Módulo de comprobantes ampliado (mayo 2026 — ✅ EN PRODUCCIÓN desde 30 may 2026)
Construido y probado en `dev-hugo` + `.env.local`, **ya mergeado y desplegado en producción** (30 may 2026). Validado en BETA SUNAT; pendiente solo la 1ª emisión fiscal real (Hugo).

- **Emisión standalone** (factura/boleta SIN pedido): `src/app/dashboard/comprobantes/nuevo/{page,emitir-client}.tsx` + `POST /api/comprobantes/emitir-manual`. Botón "Emitir comprobante" en `/dashboard/comprobantes`.
  - **Rediseño UX (mayo 2026, "No Me Hagas Pensar")**: (1) **Detalle conectado al catálogo** — cada ítem usa un `<datalist id="catalogo-productos">` con los productos de `/api/productos` (que ahora devuelve `precio_venta`); al elegir/escribir el nombre exacto, `onDescripcion()` autocompleta **precio (con IGV) y unidad** (helper `unidadSunatDesde` mapea "uni/kg"/"kg"→KGM, resto→NIU). El usuario solo ajusta cantidad → facturas mucho más rápidas. Sigue permitiendo texto libre para no-catalogados. (2) **Empresa emisora diferenciada de un vistazo**: tarjetas grandes con **logo** (`/transavic.jpg`, `/avicola.jpg`) + razón social + RUC, y un **banner persistente** "Emitiendo como … · RUC …" con **color por empresa** (Transavic=rojo, Avícola=ámbar, vía `EMPRESA_UI`). El `page.tsx` (server) pasa `{ruc, razonSocial}` de ambas empresas vía `getSunatConfig` (datos públicos, sin exponer cert/clave). Verificado en navegador: autollenado (Bistec→S/30) y switch de empresa (banner cambia rojo↔ámbar).
- **Nota de crédito (07)**: `emitirComprobante` (index.ts) extendido con `documentoReferencia` (series FC0x/BC0x); `POST /api/comprobantes/[id]/nota-credito`; botón "N. Crédito" (**admin y la asesora dueña** de sus pedidos, sobre comprobantes aceptados/observados) en `comprobantes-client.tsx`. Sirve para anular facturas Y boletas (la Comunicación de Baja `/anular` solo cubría facturas ≤7 días). **Acceso (jun 2026, EN PRODUCCIÓN · PR #2):** la NC dejó de ser solo-admin — las asesoras (que son quienes facturan) pueden emitir NC sobre comprobantes de **SUS pedidos**; el endpoint valida la propiedad vía `pedidos.asesor_id` (mismo scoping que la lista de `/comprobantes`) y los comprobantes standalone (sin pedido) siguen siendo solo-admin. La notificación de NC rechazada/errada llega también a la asesora dueña.
- **Consulta RUC/DNI** (apisperu): `src/lib/apisperu.ts` + `POST /api/consulta-documento`. Botón "Consultar" auto-llena razón social/dirección en el form de clientes y en emisión.
- **Correo vía Brevo**: `src/lib/brevo.ts` (API v3, free 300/día). `lib/email.ts` usa Brevo si `BREVO_API_KEY` está; si no, SMTP/nodemailer. Sender `transavicdev@gmail.com` verificado en Brevo (no requiere dominio propio). Plantilla por defecto editable en el modal de envío.
- **Validaciones inteligentes SUNAT** (`emitir-manual` + form `emitir-client`, mayo 2026, verificadas en BETA):
  - **Factura (01)**: siempre RUC válido (11 díg, prefijo 10/15/16/17/20) + razón social. Si no, error.
  - **Boleta (03) ≥ S/700**: SUNAT exige identificar al cliente con **DNI (8) o RUC**. El form deshabilita el botón y muestra aviso ámbar si falta.
  - **Boleta (03) < S/700**: cliente **OPCIONAL** → si se deja vacío, se emite a **cliente genérico** (`tipoDocumento="0"` sin documento, `numDocumento="0"`, razón "CLIENTES VARIOS"). El form lo permite (botón habilitado sin doc) y avisa "se emite a CLIENTES VARIOS". El schema zod del cliente pasó a opcional (`default("")`); la lógica de identificación vive en el endpoint.
  - **Código interno ESTABLE por producto** (`SellersItemIdentification`, mayo 2026): SUNAT lo deja **opcional** (cardinalidad 0..1, an..30) pero ahora cada producto tiene su código fijo. Migración `scripts/migrate-codigo-producto.sql` agregó la columna `productos.codigo` y la pobló por categoría (POL001/CAR001/HUE001…); el `POST /api/productos` genera el código de los nuevos (prefijo categoría + correlativo); el `GET` lo devuelve. En la emisión: `emitir-manual` usa `it.codigo` que el form (`emitir-client`) envía al elegir del catálogo (o secuencial `P00x` si es texto libre); `emitir` (desde pedido) hace lookup del código por nombre del producto (fallback secuencial). Verificado en BETA: el XML lleva `<cbc:ID>CAR005</cbc:ID>` dentro de `SellersItemIdentification` y SUNAT responde `ACEPTADA`. El **código es visible y editable** en cada ítem del form (`emitir-client`): se autocompleta del catálogo pero el usuario puede cambiarlo.
  - **🐛 FIX factura a CRÉDITO (mayo 2026)**: estaba roto — `index.ts`/`emitir-manual` pasaban `formaPago="Credito"` pero **no la fecha de vencimiento**, así que el XML salía sin cuotas y SUNAT **rechazaba con error 3249** ("Si el tipo de transacción es al Crédito debe existir al menos información de una cuota de pago"). Verificado contra BETA (sin cuotas → RECHAZADA 3249). **Corregido**: `emitirComprobante` calcula `fechaVencimiento = fechaEmisión + plazoDias` (default 7) cuando es crédito y la pasa al xml-builder, que genera `cac:PaymentTerms` con `PaymentMeansID="Credito"` + monto + `Cuota001` con `PaymentDueDate`. Re-probado: crédito 15 días → `ACEPTADA` + CDR. (El `plazoDias` viene del form/endpoint y también define el vencimiento de la cobranza en `/cobranzas`.)
  - **Dirección del cliente (opcional)**: campo nuevo en `emitir-client` (se autocompleta de apisperu al consultar RUC, editable). Viaja a `cac:RegistrationAddress` del XML (el xml-builder ya lo soportaba). SUNAT no la exige pero queda registrada. Verificado en BETA → `ACEPTADA`.
  - **Verificado contra BETA**: los 3 casos (boleta genérica tipo "0" · boleta ≥700 con DNI · factura con RUC) → `ACEPTADA` + CDR, todos con el código interno presente. El cliente genérico (tipo "0") es aceptado por SUNAT.
- **Operaciones SUNAT con UI (cierre de gaps, mayo 2026)**: los endpoints que existían pero no tenían botón ya están en `comprobantes-client.tsx` (solo admin):
  - **Reintentar** (`POST /[id]/reintentar`): botón en comprobantes en estado `error`/`rechazado` (reusa el mismo correlativo).
  - **Comunicación de Baja** (`POST /[id]/anular`): modal `ModalComunicacionBaja` sobre **facturas** aceptadas (≤7 días). Pide motivo, devuelve ticket, y permite consultarlo ahí mismo.
  - **Resumen Diario de boletas** (`POST/GET /comprobantes/resumen-diario`): `ModalResumenDiario` (empresa + fecha, muestra conteo de boletas, envía, consulta ticket). **Acceso (mayo 2026)**: el Resumen Diario **se envía solo por cron** (`/api/cron/resumen-diario-sunat`, 2am Lima, con idempotencia), así que el botón directo en el toolbar se **quitó** (confundía: parecía una acción pendiente del admin). Ahora vive en un **menú "⋯" discreto de admin** en la toolbar de `/comprobantes`, con copy que aclara "se envía solo cada noche; entrá solo si querés revisar o reenviarlo". Es solo un **respaldo** por si el cron falla algún día.
  - **Consulta de ticket** (`POST /comprobantes/consultar-ticket`): envuelve `consultarTicket()` (getStatus); actualiza `resumenes_diarios` o marca el comprobante `anulado` si la baja fue aceptada.
- **Idempotencia del Resumen Diario**: nueva tabla **`resumenes_diarios`** (migración `scripts/migrate-resumenes-diarios.{mjs,sql}`, aplicada en dev-hugo). El helper compartido `src/lib/sunat/resumen-diario.ts` (lo usan el cron y el endpoint manual) NO reenvía un RC si ya hay uno `enviado`/`aceptado`/`enviando`-reciente del mismo día (evita duplicados si el cron se dispara dos veces). `forzar:true` permite resúmenes complementarios.
- **Datos del emisor por env**: `nombreComercial/departamento/provincia/distrito` ahora se overridean con `SUNAT_*_NOMBRE_COMERCIAL/DEPARTAMENTO/PROVINCIA/DISTRITO` (antes hardcodeados a "LA VICTORIA").
- **PDF SIN código QR (decisión deliberada)**: el PDF replica el diseño de las boletas/facturas que la propia SUNAT entrega, que **no llevan QR**, así que NO se agrega. (Aplica al SEE-Del Contribuyente; si en el futuro se exigiera la representación impresa con QR, se agregaría con `qrcode`.)
- **PDF de factura/boleta AL CRÉDITO (mayo 2026)**: antes el PDF mostraba siempre "Forma de pago: Contado" y un "Fecha de Vencimiento" vacío (la forma de pago viajaba en el XML pero **no se persistía**). Ahora: migración `scripts/migrate-comprobante-credito.sql` (aplicada en dev-hugo vía psql — gotcha #13) agrega `comprobantes.forma_pago VARCHAR(10)` + `fecha_vencimiento DATE`; `lib/sunat/index.ts` calcula el vencimiento (emisión + `plazoDias`, def. 7) una sola vez y lo guarda en los 3 INSERT (pendiente/éxito/error); `api/comprobantes/[id]` los devuelve (`formaPago`, `fechaVencimiento`); `comprobantes-client.tsx` los pasa al PDF; `lib/sunat/pdf-comprobante.ts` dibuja **"Forma de pago: AL CRÉDITO"** + bloque **"INFORMACIÓN DEL CRÉDITO"** (helper `drawInformacionCredito`: monto neto pendiente de pago + tabla N° Cuota · Fecha de Vencimiento · Monto) en factura Y boleta. Replica la representación de SUNAT (la NC y la factura/boleta al contado ya tenían diseño; faltaba solo el crédito). Verificado en dev-hugo: render del PDF de muestra OK + round-trip de columnas (INSERT/SELECT/DELETE) OK + tsc/lint limpios. Genera **1 cuota** por el total (caso de pago único; cuotas múltiples no soportadas — no las necesita Antonio).
- **URL del menú SUNAT SOL** (operativo, dato público — NO es credencial): la consulta/emisión por web entra por `https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm`. Para una empresa, las facturas emitidas se ven en **Empresas → Comprobantes de pago → SEE - SOL → Factura Electrónica → "Consultar Factura y Nota"** (página pesada, a veces tarda). Ojo: la "forma de pago" (Contado/Crédito) NO es columna del listado — está dentro de cada comprobante. **Las credenciales SOL (usuario/clave) NUNCA van en archivos del repo**: van solo en `.env.local` (gitignored) y env de Vercel, puestas por Hugo.
- **Clientes — rediseño UX "No Me Hagas Pensar" (mayo 2026)**: `clientes-client.tsx` pasó de cards con forms inline + 5 íconos sueltos → patrón consistente con comprobantes/catálogo. (1) **Crear y Editar cliente ahora son MODALES** (antes el form inline con `MapInput` empujaba toda la lista / reemplazaba la tarjeta). Reusan el mismo `ClienteFormFields` (ya extraído); el modal tiene header sticky + footer sticky + `overflow-y-auto` para que el mapa entre sin romper. El botón "Nuevo Cliente" abre el modal (antes era toggle inline). (2) **Acciones consolidadas**: de 5 íconos ambiguos (Perfil·Pedidos·Transferir·Editar·Eliminar) → **acción primaria "Ver perfil"** (botón con texto, indigo) + **menú "⋯"** con el resto etiquetado (Últimos pedidos · Editar datos · Transferir a otra asesora · divisor · Eliminar cliente). El dropdown usa `absolute` + overlay `fixed inset-0` para cerrarse al click-afuera. (3) **Avatar con inicial de color** por tarjeta (color estable derivado del nombre vía hash) → escaneo visual rápido; el avatar y el nombre linkean al perfil 360°. (4) **WhatsApp clickeable**: el número ahora es un link `wa.me/51…` (verde, con FiMessageCircle) en vez de texto plano — 1 clic para escribirle. Helper `whatsappHref` + `avatarPara`. **No tocado**: lógica de datos (fetch paginado server-side 15/pág, búsqueda debounce, transferencia, consulta RUC apisperu en el form), el panel inline de "Últimos pedidos" (sigue, ahora se dispara desde el menú), el Transfer Modal. tsc/eslint/build limpios.
- **Excel de comprobantes — reporte contable inteligente (mayo 2026, portado de conexipema)**: el export pasó de UNA hoja plana sin fechas → **reporte multi-hoja con período**, modelado sobre `conexipema-eventos/src/lib/sunat/generar-reporte-excel.ts`. Helper nuevo `src/lib/sunat/reporte-excel-comprobantes.ts` (`generarBufferReporteComprobantes(filas, periodo)` → Buffer) construye hasta 5 hojas: **Resumen** (por tipo · por estado · desglose diario) · **Registro de Ventas** (lista cronológica unificada) · **Facturas** · **Boletas** · **Notas de Crédito** (las 3 últimas solo si hay de ese tipo). Reglas contables: las **NC (07) restan** del total neto; los estados inválidos (**rechazado · error · anulado**) NO suman (no son documentos fiscales válidos). Adaptado a Transavic: estados en minúscula, 2 empresas (`transavic`/`avicola`), montos de `comprobantes.monto_subtotal/igv/total`, fechas en zona Lima. El endpoint `GET /api/comprobantes/export-xlsx` ahora acepta **`?desde&hasta`** (YYYY-MM-DD, filtra `(created_at AT TIME ZONE 'America/Lima')::date`) además de tipo/empresa/cliente_doc_num; `ORDER BY created_at ASC`, LIMIT 10000; filename con el rango (`reporte-comprobantes-2026-05-01_al_2026-05-28.xlsx`). UI: el botón "Excel" abre el **`ModalExportarExcel`** (en `comprobantes-client.tsx`) con presets de período — **Este mes** (default) · **Mes anterior** · **Solo hoy** · **Todos (sin filtro de fecha)** · **Rango personalizado** (2 date inputs); valida desde≤hasta; muestra aviso azul si hay filtros de tipo/empresa activos (se respetan). Helpers de fecha en cliente: `primerDiaDelMes`, `ultimoDiaDelMes`, `mesAnteriorISO`, `etiquetaMes`. Sin migración. tsc/eslint/build limpios.
- **Comprobantes — rediseño UX "No Me Hagas Pensar" (mayo 2026, sin tocar módulo SUNAT)**: aplica las leyes de Krug sobre `/dashboard/comprobantes` y `/dashboard/comprobantes/nuevo`. Cambios en `comprobantes-client.tsx`: (1) **4 KPIs arriba** (Total · Aceptados · Con problemas · Pendientes) — la asesora ve al abrir cuánto hay y qué necesita atención; "Con problemas" es clickeable y aplica el filtro de estado=rechazado. (2) **Buscador local** que matchea sin distinguir mayúsculas contra `serie_numero / cliente_razon_social / cliente_doc_num / pedido_cliente` (escribir "F001-23", "Lucy" o el RUC funciona). (3) **Filtros consolidados en una sola card** (Tipo · Empresa · Estado) con etiqueta corta a la izquierda y "swatch" de color para asociar visualmente (verde=aceptado, ámbar=observado, rojo=rechazado, etc.). (4) **Estado con ícono + label legible** (✓ Aceptado / ⚠ Observado / ✗ Rechazado / ⏳ Pendiente / 🚫 Anulado) reemplaza el texto lowercase. (5) **Mensaje SUNAT** pasa de bloque debajo del badge → ícono ℹ️ rojo con `title` (tooltip) — menos ruido, info accesible. (6) **Footer con total del filtro** (`S/ … en pantalla`) — útil para conciliar con contabilidad. (7) **Banner pedido_id** ahora muestra el ID corto (8 chars) en vez de "un pedido específico". (8) **Toolbar separado**: buscador toma protagonismo; Excel/Resumen/Refrescar quedan ahí, "Emitir comprobante" sigue de acción primaria en el header. Helpers nuevos: `estadoUI()` (color + label + ícono), `KpiCard`, `GrupoFiltro`. En `emitir-client.tsx`: (1) **Tipo (Factura/Boleta) movido a la sección 1 junto a Empresa** — antes vivía en la columna derecha pero define las reglas (RUC obligatorio o no), ahora se elige primero con un hint dinámico "RUC del cliente es obligatorio. Para empresas." vs "DNI o RUC del cliente. Para consumidor final." (2) **Pasos numerados 1·2·3·4·5** con `SectionHeader` (círculo negro con número + título) — antes los emojis 🏢👤📋⚙️💰 no daban orden mental. (3) **Separador "O Ingreso Manual / SUNAT"** → "o ingresá los datos manualmente" (el botón Consultar ya dice qué hace). (4) **Botón Emitir**: "Emitiendo en SUNAT…" → "Enviando a SUNAT…" + nota explicativa abajo ("Esperá unos segundos — SUNAT puede tardar hasta 10s. No cierres ni recargues."). Sin migración. Build pasa OK; `npx tsc --noEmit` y `npx eslint` limpios (1 warning preexistente no relacionado, `cargandoDetalle` no usado en ModalEnviarEmail). **NO tocado**: `lib/sunat/*` (BETA-validado), modales (NC, Baja, Resumen), endpoints, ticket digital de resultado, autocomplete clientes/catálogo, lookup RUC apisperu, panel de requisitos dinámico, barra flotante mobile.
- **Comprobantes — rediseño de acciones + robustez SUNAT (mayo 2026)**: (1) **Botones de acción**: de íconos sueltos ambiguos → **acción primaria "PDF" + menú "⋯"** (posición FIJA con `getBoundingClientRect` para escapar del `overflow-x` de la tabla) con el resto etiquetado y agrupado (XML · CDR · Correo · divisor · Nota de crédito); patrón "Don't Make Me Think", mismo en desktop y móvil (`celdaAcciones` en `comprobantes-client.tsx`). (2) **Descarga de CDR**: endpoint nuevo `GET /api/comprobantes/[id]/cdr` que **extrae y sirve el XML** de la constancia (no el ZIP, que trae una carpeta `dummy/` vacía que **la propia SUNAT** incluye — confirmado inspeccionando bytes). (3) **Comunicación de Baja DESHABILITADA en la UI** (`ANULAR_HABILITADO = false`): se usa **siempre Nota de Crédito** (cubre factura y boleta, cualquier momento; la baja es frágil: solo facturas ≤7 días). El endpoint `/anular` queda disponible si se reactiva. (4) **Filtro por "N. Crédito"** (tipo 07) en la lista (el API ya lo soportaba). (5) **Paginación en cliente** (15/pág, Anterior/Siguiente) en `/comprobantes`; pendiente extenderla a pedidos/catálogo/clientes (tarea abierta). (6) **Mensaje amigable de "SUNAT caído"**: `soap-client.ts` distingue SUNAT no-disponible (SOAP fault tipo `SUNAT_SERVIDOR` + errores de red/timeout/HTTP 5xx) de un rechazo de datos y propaga `sunatCaido` (`ResultadoEmision` en `types.ts`) → el form de emisión muestra banner ámbar ("es problema de SUNAT, no del sistema; el comprobante NO se emitió; emitilo manualmente desde el portal SEE-SOL") y el reintento un toast equivalente. (7) Botón **"Descargar PDF"** + auto-descarga en la pantalla de éxito de emisión (`emitir-manual` devuelve el `id`). tsc/lint limpios.
- **Nomenclatura SUNAT — auditoría (mayo 2026)**: **Transavic está correcto** — `contador.ts` genera correlativos atómicos (`UPDATE … +1 RETURNING`) y las series de NC son propias `FC01/BC01`. Reglas confirmadas: serie alfanumérica de 4 (F001/B001), NC/ND con **serie propia** (1er char = tipo afectado), correlativo 1..99999999 secuencial por (tipo, serie), nunca reusar un número ya aceptado. Los rechazos por "nombre/número" que reporta Hugo son del proyecto **conexipema-eventos** (NC reusa serie `F001` en vez de `FC01` → rechazo **2345**; loop de 50 reintentos que detecta "duplicado" por texto y salta correlativos) → derivado a tarea aparte en ese repo.
- **P0 "Cierra el loop del dinero" (mayo 2026 — brainstorming → spec → plan → ejecutado)**: audit completo en `docs/superpowers/specs/2026-05-27-audit-conexiones-roadmap-design.md` + plan task-by-task en `docs/superpowers/plans/2026-05-27-p0-cierra-loop-dinero.md`. Implementado:
  - **Factura Contado → cobranza por default** + checkbox "Ya cobrado" para opt-out (cash de mano). Refleja la realidad Transavic ("contado = paga después" en la mayoría de casos). (⚠️ **Actualizado 4 jun 2026:** ahora **TODA venta —factura o boleta, contado o crédito— crea cobranza por defecto**, salvo que marquen "ya cobrado"; ver "Todas las ventas entran a cobranzas" abajo.) `emit-manual/route.ts` + `emit-client.tsx`.
  - **Cobranza manual conectada**: el modal de `cobranzas-client.tsx` ahora autocompleta clientes desde `/api/clientes?q=` (debounce 300ms) y, si el cliente tiene facturas emitidas, muestra un selector con esas facturas (autopobla el monto). Backend: migración `scripts/migrate-factura-vinculo.sql` (aplicada en dev-hugo) agrega `facturas.cliente_id` + `comprobante_id` (FK ON DELETE SET NULL), `POST /api/facturas` los guarda + deriva `numero_comprobante` del comprobante elegido, `GET /api/comprobantes` acepta `?cliente_doc_num=` para filtrar las facturas de un cliente.
  - **Modal compartir ticket**: card con `max-h-[90vh] overflow-y-auto` + header sticky con la X siempre visible. Antes el contenido se cortaba y el cerrar quedaba off-screen.
  - **Exportar Excel** en `/comprobantes` (admin): nuevo endpoint `GET /api/comprobantes/export-xlsx` (usa `xlsx` lib, respeta los filtros activos `tipo/empresa/cliente_doc_num`, scope por rol, hasta 5000 filas), botón "Excel" en el header. Columnas pensadas para contador (Fecha · Serie-Número · Tipo · Empresa · Cliente · Doc · Subtotal · IGV · Total · Forma de pago · Vencimiento · Estado SUNAT · Mensaje). tsc/lint limpios.

**Estado: ✅ DESPLEGADO EN PRODUCCIÓN (30 may 2026).** Validado en BETA (factura 01, boleta 03, NC 07 → `ACEPTADA` con CDR, cert real) y ya en producción con credenciales reales. Lo que se resolvió para el paso a producción:
1. ✅ **Usuario SOL real**: `APIFACTU`/`Transavic123` (perfil "Emisión Electrónica") creado para AMBAS empresas (Transavic RUC 20 y Avícola RUC 10). En `.env.local` (testing) se sigue usando `MODDATOS`/`moddatos` porque el endpoint beta solo acepta ese usuario.
2. ✅ **`SUNAT_ENVIRONMENT=production`** configurado en Vercel.
3. ✅ **Env vars en Vercel**: `APISPERU_TOKEN`, `BREVO_*`, `GEMINI_API_KEY`, `CRON_SECRET` y todas las `SUNAT_*` reales (cert `.p12` en base64).
4. ⏳ **Único pendiente**: emitir la 1ª factura/boleta REAL de monto bajo (la hace Hugo manualmente) y, si se quiere, anularla con NC.

> ✅ **Corrección de diagnóstico (mayo 2026): la BETA SÍ funciona.** La conclusión previa ("BETA rechaza por esquema viejo, validar solo en producción") era **incorrecta**. El endpoint `ol-ti-itcpfegem-beta` acepta UBL 2.1 sin problema (factura/boleta/NC ACEPTADAS). El error **2335 NO significa "cert no reconocido por CA"** sino **"el documento electrónico ha sido alterado"** (fuente: greenter/xcodes + manual del programador SUNAT) — causado por inconsistencia de encoding o por modificar el XML tras firmar. El bug real era que el código **saltaba la firma en beta** (condición `beta && !certificatePath`, pero siempre se usa `certificateBase64` → nunca firmaba → SUNAT veía un XML sin firma); **corregido** para firmar siempre que haya certificado. La BETA acepta certificados autofirmados (no valida la CA).

### Optimización de UI (mayo 2026 — ✅ EN PRODUCCIÓN desde 30 may 2026)
Refactor de navegación/UX en `dev-hugo`. Plan: `docs/superpowers/plans/2026-05-21-optimizacion-menu-catalogo-ia.md`.
- **Catálogo** (`/dashboard/catalogo`): fusiona Productos + Precios en una página con 2 pestañas que reutilizan `productos-client` y `precios-client`. `/dashboard/productos` y `/dashboard/precios` redirigen a `/catalogo`. **Actualización (mayo 2026, vista única)**: las 2 pestañas se eliminaron. Hoy hay UNA sola tabla en `src/app/dashboard/catalogo/catalogo-unificado.tsx` con columnas Producto · Código · Categoría · Unidad · Compra · Venta · Margen · Acciones. Click sobre la celda Compra/Venta → input inline + Enter guarda (con confirm si cambia la venta — afecta pedidos nuevos). Botón ✏️ → modal completo (nombre, código, categoría, unidad, compra, venta). Filtros: chips por categoría + buscador (matcha nombre Y código) + chip clickeable "Sin precio (N)" que filtra los que no se pueden vender. Banner ámbar al tope cuando hay productos sin `precio_venta`. El modal "Agregar Producto" ahora acepta precio opcional → un producto nuevo nace listo para vender. **Endpoints actualizados (cero migración de DB)**: `GET/POST/PATCH /api/productos` ahora devuelven y aceptan `precio_venta`, `precio_compra` y `codigo` (antes vivía en `/api/precios`); el PATCH además **preserva el histórico** en la tabla `precios_productos` (cierra el vigente, inserta el nuevo) — la auditoría que ya tenía `/api/precios/[id]` sigue funcionando. Los archivos viejos `productos-client.tsx`, `precios-client.tsx` y los endpoints `/api/precios*` quedaron marcados `@deprecated` como red de seguridad (se borran tras unas semanas sin regresiones). El tipo `Producto` en `lib/types.ts` se extendió con `codigo`, `precio_venta`, `precio_compra` opcionales. **Rediseño UX "No Me Hagas Pensar" (mayo 2026)**: (1) **Barra de 4 KPIs** arriba (`KpiCatalogo`): Productos · Listos para vender (con precio) · **Sin precio** (clickeable → filtra, reemplaza al banner ámbar viejo) · **Margen promedio** del catálogo (promedio de `margenPct` de los que tienen compra+venta). (2) **Edición inline descubrible**: las celdas Compra/Venta muestran el número con un **lápiz** que se intensifica en hover + fondo azul de "campo editable" (antes solo un `title` invisible) + una pista textual arriba de la tabla ("Tocá un precio para editarlo"). (3) **"Sin precio" → botón accionable** "+ Poner precio" (ámbar) en la celda Venta, en vez de texto rojo pasivo. (4) **Columna Código eliminada**: el código va **debajo del nombre** (gris mono pequeño) → de 8 a 7 columnas, menos ruido. El emoji de categoría queda como identificador del producto. tsc/eslint limpios. **Pulido con skill `/mejora-diseño` (mayo 2026)**: (a) **animación de UI sutil** — keyframes reutilizables nuevos en `globals.css` (`fadeIn`/`modalIn`/`toastIn` + clases `.anim-fade`/`.anim-modal`/`.anim-toast`, curva ease-out `cubic-bezier(0.25,1,0.5,1)`, `modalIn` entra desde `scale(0.96)` no 0) + bloque global `@media (prefers-reduced-motion: reduce)`. Beneficia a todo el dashboard (de paso revive los `animate-[fadeIn]` que estaban muertos en `emitir-client`). Modales del catálogo entran con `anim-modal` + backdrop `anim-fade`; micro-feedback `active:scale-[0.97/0.98]` en botón Agregar, chips de categoría, paginación y botones de modal. (b) el **mensaje de éxito/error pasó de banner (empujaba el contenido) a toast flotante** (`fixed bottom-6 right-6` + `anim-toast`), mismo patrón que `/comprobantes` y `/cobranzas`. (c) **`tabular-nums`** en Compra/Venta/Margen (tabla y cards) para que las cifras alineen parejo. (d) **radios unificados** (cards/tabla/modales → `rounded-xl`/`2xl`; botones/chips → `rounded-lg`). NO se tintaron los neutros (habría roto consistencia con las pantallas hermanas que usan gris Tailwind — queda como recomendación global). tsc/eslint limpios.
- **Reportes** (`/dashboard/reportes`): originalmente hub con 3 pestañas (Panel Gerencial · Analítica · Resumen). **Rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador con Chrome MCP):** se fusionó a **2 pestañas de propósito claro** porque las 3 se pisaban (KPIs/top productos/ranking repetidos; Panel tenía dinero sin fechas, Analítica fechas sin dinero):
  - **Ventas** (`reportes/ventas-tab.tsx`): reporte de análisis por período. **Selector único de fechas con presets** (Hoy · Esta semana · Este mes · Mes pasado · Personalizado) — antes Analítica tenía DOS selectores. KPIs en **dinero**: hero "Facturado" (protagonista) + ticket promedio + pedidos + % de entrega. Ranking de asesoras (barras por S/ facturado), top productos (S/ + cantidad), ventas por día (barras), por empresa, por distrito. **Exporta Excel + PDF** (lo pidió Hugo). Si hay entregas pero `total_facturado === 0` (faltan precios), muestra **banner ámbar** que explica el S/0 y linkea al Catálogo (Krug: no hacer pensar "¿por qué todo es 0?").
  - **Día a día** (`reportes/dia-tab.tsx`): el viejo Resumen operativo repulido (sin el gradiente del "Tip del día", KPIs unificados). Lista de pedidos de un día puntual (cliente/WhatsApp/dirección/items) + totales por producto, para planear despacho/producción. Sigue usando `/api/resumen-diario`.
  - **Medición = facturación ENTREGADA** (coherente con gotcha #8 / §13: reportes de admin miden entregado, NO `created_at`). Monto = `COALESCE(subtotal_real, subtotal)` de pedidos `Entregado`, por `fecha_pedido`.
  - **Backend nuevo** (DRY): `lib/reportes/datos-ventas.ts` (`obtenerReporteVentas(desde,hasta)` — única fuente de cifras) lo consumen `GET /api/reportes/ventas` (JSON), `GET /api/reportes/ventas/export-xlsx` (vía `lib/reportes/excel-ventas.ts`, 4 hojas: Resumen · Ventas por día · Top productos · Ranking) y el PDF de 1 página `lib/reportes/pdf-ventas.ts` (jsPDF + autotable, generado en cliente, import dinámico). Componentes compartidos en `reportes/ui.tsx` (KpiCard sin gradientes estilo comprobantes, HeroMetric, SelectorPeriodo, GraficoBarrasDia). Estilo alineado al resto (sin degradés, `tabular-nums`, `anim-*`, `active:scale`).
  - **Se borraron** los huérfanos: `panel-gerencial-client.tsx`, `analytics-client.tsx`, `resumen-client.tsx` y los endpoints `/api/analytics` + `/api/panel-gerencial` (ya nadie los importaba; git los preserva). Los redirects `/panel-gerencial`, `/analytics`, `/resumen` → `/reportes` se mantienen. tsc/eslint limpios; Excel verificado (200, XLSX válido) y PDF sin errores de consola.
- **Menú lateral agrupado** (`DashboardLayout.tsx`): `GROUP_BY_HREF` + `GROUP_ORDER` agrupan en Operación / Comercial / Reportes / Configuración (de 15 ítems planos a ~9 agrupados). El `<Link>` se extrajo en `mobileLink`/`desktopLink` (DRY); el header de grupo en desktop solo aparece on-hover (sidebar colapsado).
- **IA fuera del menú**: ya no hay ítem "Asistente IA". Acceso por **botón flotante** (`FloatingAssistant.tsx`, todas las páginas, roles admin/asesor) + **insights embebidos** (`InsightCard.tsx`) en Reportes (admin) y Mis Metas (asesora). `InsightCard` llama a `/api/asistente-ia` (scoped por rol). La página `/dashboard/asistente-ia` sigue existiendo (destino del botón flotante). **Rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar `/api/asistente-ia` ni `insights.ts`):** era la única pantalla con "look de IA" — gradiente violeta/índigo en cada texto de IA + header y botón violetas + arcoíris de 8 colores de cabecera. Se alineó al sistema: (1) **fuera el violeta y los gradientes**, acento = rojo de marca (header `FiZap` rojo, botón "Refrescar" rojo); (2) el texto de la IA es el **protagonista** de cada card, marcado con un chip rojo "SUGERENCIA DE LA IA" (`FiZap`), y los datos crudos pasan a **apoyo** debajo de un divisor `border-t`; (3) **color solo con significado** en el ícono de cabecera (verde tendencias · rojo riesgo · ámbar ranking · azul día · teal cartera), sin bloques de color rellenos; (4) las cajitas de datos (resumen del día, performance) pasaron de fondos multicolor a `bg-gray-50` uniforme con el valor en color semántico; (5) fuera los emojis sueltos (📦/✨/🔒 → texto sobrio + `FiLock`); `tabular-nums`, `rounded-2xl`, `active:scale`, `.trim()` en nombres. tsc/eslint limpios.
- **Usuarios** (`/dashboard/users`: `page.tsx` + `users-client.tsx` + `user-modal.tsx`) — **rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar `/api/users`):** era la pantalla más vieja (de abril, acento **azul**, `alert()`/`confirm()` nativos, rol como texto crudo en minúscula, doble título + botón "Regresar al Dashboard"). Ahora: (1) acento **rojo de marca**, estilos del sistema; (2) **rol como badge** legible con ícono y color (Administrador gris+`FiShield` · Asesora azul+`FiBriefcase` · Repartidor verde+`FiTruck` · Producción ámbar+`FiPackage`); (3) **avatar con inicial** coloreado por rol + **panorama de chips** con el conteo por rol arriba; (4) acciones por fila = botón "Editar" con texto + ícono de borrar sutil (hover rojo); (5) **`confirm()` → modal de confirmación** de borrado y **`alert()` → toast**; (6) header limpio (un título "Usuarios", sin "Regresar al Dashboard"); el modal crear/editar reestilizado (`anim-modal`, inputs `focus:ring-red-200`, select de rol con descripción de cada rol). tsc/eslint limpios.
- **Pendiente:** verificación visual en navegador (quedó bloqueada por selección multi-browser durante la sesión). El botón flotante es un link; se puede mejorar a panel slide-over después.

### Conectividad entre áreas — Facturación↔Cobranzas (mayo 2026 — local)
Auditoría: las áreas se conectan vía `pedido_id` + `pedidos.estado` (cadena Pedido→Producción→Despacho→Entrega→Cobranza+Factura). Decisión de negocio sobre independencia: necesaria solo para **Facturación** (venta de mostrador) y **Cobranzas** (registro manual); **Producción/Despacho son order-driven** por naturaleza (no necesitan modo standalone).
- **Lazo cerrado**: una venta facturada standalone (`/api/comprobantes/emitir-manual`) marcada **a Crédito** crea su cobranza automáticamente (`crearFacturaStandalone` en `lib/cobranzas.ts`), pero SOLO si el comprobante salió OK (estado ACEPTADA/ACEPTADA_CON_OBSERVACIONES/PENDIENTE — no rechazado/error, para no registrar deuda inválida ni duplicar al reintentar). UI: toggle Contado/Crédito + plazo en `emitir-client.tsx`.
- **Cobranza manual**: botón "Registrar cobranza manual" en `/dashboard/cobranzas` + `POST /api/facturas` (deudas sin pedido). `facturas.pedido_id` es nullable → no requirió migración.

### Roadmap "Mejor flujo para usuarios" — P0–P3 ejecutado (mayo 2026 — local, build OK)
Audit completo y plan en `docs/superpowers/specs/2026-05-27-audit-conexiones-roadmap-design.md` + `docs/superpowers/plans/2026-05-27-p0-cierra-loop-dinero.md`. Lo ejecutado (construido en `dev-hugo`, **ya en producción desde 30 may 2026**):

**P0 — Cierra el loop del dinero (~14h):**
- **P0.1 — Contado → cobranza por default** (`/api/comprobantes/emitir-manual` + `emitir-client.tsx`): toda factura (tipo 01) crea cobranza automáticamente, sea Contado o Crédito. Toggle "El cliente ya pagó al instante" cuando es Contado-cash. (⚠️ **jun 2026: ahora las boletas también crean cobranza por defecto** — toda venta entra; ver "Todas las ventas entran a cobranzas" abajo.)
- **P0.2 — Cobranza manual conectada** (`/api/facturas` + `cobranzas-client.tsx`): el modal "Registrar cobranza manual" ahora tiene autocomplete contra `/api/clientes` (debounce 300 ms, `<datalist>`) + selector de facturas ya emitidas del cliente (filtra por `cliente_doc_num`). Migración `scripts/migrate-factura-vinculo.sql` agrega `facturas.comprobante_id` (NULLABLE, FK). Fallback texto libre intacto.
- **P0.3 — Modal compartir ticket** (`ticket-share-modal.tsx`): `max-h-[90vh] overflow-y-auto` + header sticky con X siempre visible.
- **P0.4 — Excel de comprobantes** (`/api/comprobantes/export-xlsx` + botón en header `comprobantes-client.tsx`): admin descarga `.xlsx` respetando filtros activos (tipo, empresa, doc cliente). Columnas para contador: Fecha · Serie-Número · Tipo · Empresa · Cliente · RUC/DNI · Subtotal · IGV · Total · Estado · Mensaje SUNAT. Usa `xlsx` (SheetJS).

**P1 — Conexiones que faltan (~14h):**
- **P1.5 — Perfil 360° del cliente** (`/api/clientes/[id]/perfil` + `/dashboard/clientes/[id]`): pantalla con identidad, KPIs (facturado / cobrado / pendiente / vencido), 4 tabs (Pedidos · Comprobantes · Cobranzas · Top productos), acciones rápidas (WhatsApp, Nuevo pedido, Emitir comprobante). Botón "Ver perfil 360°" (FiUser indigo) en cada fila de `/clientes`.
- **P1.6 — "Cobrado" 1-clic + undo 5s** (`/api/facturas/[id]/pago` DELETE + `cobranzas-client.tsx`): se reemplazó el modal de confirmación por **optimistic update + toast "Deshacer" 5 s** (patrón Gmail). El endpoint DELETE revierte el pago al estado anterior (Pendiente / Vencida según fecha).
- **P1.7 — Duplicar pedido** (botón FiCopy en `table.tsx`): copia cliente + ítems al sessionStorage y navega a `/nuevo-pedido`. El form (`PedidoForm.tsx`) lee la key y precarga.
- **P1.8 — Link cruzado Comprobante ↔ Pedido**: badge "Facturado" en `table.tsx` ahora linkea a `/comprobantes?pedido_id=X` (filtro server-side ya soportado por el endpoint). Banner "Filtrando por pedido N" con "Quitar filtro" en `comprobantes-client.tsx`.

**P2 — UX que ahorra clics (~13h):**
- **P2.9 — Búsqueda global Cmd+K** (`/api/buscar` + `components/CmdKModal.tsx` + `DashboardLayout.tsx`): atajo ⌘K/Ctrl+K abre un command palette con TOP-5 de clientes/pedidos/comprobantes (scoping por rol). Navegación con ↑↓/Enter/Esc. Búsqueda debounce 250 ms.
- **P2.10 — Notificación de comprobante rechazado** (`lib/notificaciones.ts` helper `notificarComprobanteConProblema` + hooks en los 4 endpoints emit): cuando SUNAT rechaza (RECHAZADA) o hay error de infra (ERROR), se notifica al admin + asesora dueña (si aplica). Nuevos tipos `comprobante_rechazado` / `comprobante_error`. Hookeado en `/emitir`, `/emitir-manual`, `/[id]/reintentar`, `/[id]/nota-credito`. Sin tocar `lib/sunat/*` (módulo BETA-validado, protegido).
- **P2.11 — Aviso post-emisión al editar pedido** (`edit-modal.tsx`): cuando el pedido ya tiene comprobante "vivo" (no RECHAZADA/ERROR/ANULADO), aparece banner ámbar al abrir el modal: "Este pedido ya tiene Factura F001-X. Los cambios no se reflejarán en el comprobante. Para corregir, emitir Nota de Crédito." Con link directo al comprobante.

**P3 — Vista de jefe (~12h):**
- **P3.12 — "Mi Día" de la asesora** (`/api/mi-dia` + `/dashboard/mi-dia`): panel unificado con saludo según hora Lima, métricas del día (pedidos registrados + monto vendido — coherente con `created_at` del sistema de incentivos), pedidos para entregar hoy con estado/hora, cobranzas vencidas + venciendo hoy, **clientes dormidos** (sin pedido hace ≥20 días) con botón WhatsApp directo. Nuevo ítem "Mi Día" en sidebar (icono FiSun, roles asesor+admin, grupo Operación).
- **P3.13 — Aging de cobranzas** (`/api/cobranzas/aging` + panel colapsable en `cobranzas-client.tsx`): 5 buckets (Por vencer · 0–30 · 31–60 · 61–90 · +90) con monto + count + color escalado. Top-5 morosos por monto de deuda vencida. Asesor solo ve los suyos. Lazy fetch al expandir.
- **P3.14 — Daily digest a Antonio** (`/api/cron/daily-digest-admin` + entrada en `vercel.json` a las 13:30 UTC = 8:30 Lima): cron que junta cobranzas vencidas + que vencen hoy + comprobantes en error/rechazado (últimos 7 días) + pedidos pendientes sin asignar, y manda **una sola notificación consolidada** al admin con link al área más relevante. Si no hay señales (todo en cero), no spamea. **Además, este cron purga las notificaciones YA LEÍDAS de más de 30 días** (helper `limpiarNotificacionesAntiguas(30)` en `lib/notificaciones.ts`): corre al inicio, antes del posible return temprano, así limpia todos los días aunque no haya digest. Las **no leídas se respetan siempre** (son pendientes reales). Se enganchó acá —y no en un 5º cron— por el límite de crons de Vercel. La campanita (`NotificationBell.tsx`) importa `TipoNotificacion` directo del backend (`import type`) para no quedar desfasada cuando se agregan tipos nuevos.

**Lo que NO se tocó** (en respeto al spec): el módulo SUNAT real (`lib/sunat/xml-builder.ts`, `xml-signer.ts`, `soap-client.ts`, `index.ts`) — BETA-validado, se evitó cualquier riesgo de regresión en la firma/envío.

**Estado**: ✅ en producción (30 may 2026). `tsc`/`eslint` limpios, build OK. La migración `migrate-factura-vinculo.sql` quedó incluida en `migrate-produccion-2026-05-29.sql` (ya aplicada en producción).

### Mejoras UX/flujo (mayo 2026 — local, tras pruebas en navegador)
Plan: `docs/superpowers/plans/2026-05-22-mejoras-ux-flujo.md`. 11 mejoras de las pruebas E2E:
- **Menú lateral** (`DashboardLayout.tsx`): "Mis Metas" para `asesor` (su panel diario) y `admin` (vista previa con banner — ver §"Sistema de Incentivos"; inicialmente se ocultó del admin por mostrar S/0, luego se reactivó como vista previa porque el ranking y la meta de equipo sí traen datos reales); spacing más compacto (links `py-2`, grupos `pt-2`, headers `pt-1 pb-0.5`, nav `py-4 space-y-1 min-h-0`) + footer de sesión en 1 línea → entran los 4 grupos sin scroll en pantallas ≥900px.
- **Botón flotante IA** (`FloatingAssistant.tsx`): compacto (círculo solo-ícono, rótulo on-hover, `z-40` bajo modales) + `pb-24` en el `<main>` → ya no tapa acciones del fondo.
- **Comprobantes** (`comprobantes-client.tsx`): fila de filtro por **ESTADO** (client-side sobre lo ya traído por tipo/empresa) + muestra `mensaje_sunat` (motivo) en filas error/rechazado/observado.
- **Lista de Pedidos** (`table.tsx`): `detalle` con `line-clamp-3` + `title` (texto largo ya no rompe la fila).
- **Catálogo › Precios** (`precios-client.tsx`): banner ámbar con conteo de productos sin `precio_venta` (no suman a ventas/metas/reportes — explica los S/0 en reportes con data de prueba).
- **Resúmenes enviados**: `GET /api/comprobantes/resumenes` + lista con "Consultar" en `ModalResumenDiario` (consultar tickets de RC- de días previos, ej. los del cron).
- **Notificaciones** (`lib/notificaciones.ts`): se conectaron 4 tipos que estaban declarados pero nunca se emitían — `pedido_asignado` (despacho/asignar → repartidor), `pedido_en_camino` (iniciar-viaje → asesora), `guia_firmada` (guia-firmada → asesora), y **`meta_diaria_alcanzada`** (en `pedidos/[id]/entregar`, al cerrar una entrega: si `ventasHoy(asesor) >= metaDiaria` se avisa a la asesora **una sola vez al día** — guard por `notificaciones` del día; reusa `ventasHoy`/`calcularMetaDiaria` de `lib/metas.ts`, mismo cálculo que `/api/metas`, no bloqueante). **Pendiente a propósito**: `pesos_listos` (redundante con `listo_para_despacho`, que ya se emite cuando producción marca el pedido listo).
- **Ya existía** (solo verificado): emitir comprobante desde un pedido entregado (`table.tsx`, badge "Facturado" si ya tiene).

### Sistema de Incentivos (mayo 2026 — local, verificado en navegador)
Plan: `docs/superpowers/plans/2026-05-22-sistema-incentivos.md`. Motiva a las asesoras con metas día/semana/mes + racha, una meta de equipo semanal con premio, y un ranking mensual con premios — **todo configurable por el admin desde una sola pantalla**. **Sin migración**: la config vive en `settings.incentivos_config` (JSONB); las metas individuales reusan la tabla `metas_asesoras` ya existente.

- **Config en `settings` (key `incentivos_config`)** — forma:
  ```json
  {
    "metaEquipoSemanal": { "activo": true, "criterio": "monto|pedidos", "monto": 5000, "premio": "texto libre" },
    "rankingMensual": { "activo": true, "criterio": "monto|pedidos",
      "premios": [ { "puesto": 1, "premio": "S/200…" }, { "puesto": 2, "premio": "…" } ] },
    "rachaSemanal": { "activo": true, "diaFin": 6, "criterio": "monto|pedidos", "minimoDiario": 300, "premio": "texto libre" },
    "metasIndividuales": { "activo": true }
  }
  ```
  `rachaSemanal.diaFin`: 1=lunes … 6=sábado (hasta qué día cuenta la semana; default sábado). `rachaSemanal.minimoDiario`: el mínimo del día (S/ si criterio=monto, o N° de pedidos si criterio=pedidos); con `minimoDiario:0` ningún día cuenta. `metaEquipoSemanal.monto` es el objetivo (S/ o N° de pedidos según su criterio).
  **`criterio` (flexible en equipo, racha y ranking)**: `monto` (facturación S/) · `pedidos` (N° entregados). _(Se quitó "% de cumplimiento de su meta" por decisión de negocio.)_ Premios = **texto libre** y **flexibles**. `metasIndividuales.activo` controla si la asesora ve sus tarjetas de progreso (Hoy/Semana/Mes). Helpers en `src/lib/incentivos.ts`: `getIncentivosConfig()` (merge con `DEFAULT_INCENTIVOS` + normaliza criterios), `saveIncentivosConfig()` (upsert `ON CONFLICT (key)`), `getVendidoEquipoSemana(criterio)` (S/ o conteo de pedidos del equipo), `getRankingMensual(criterio)`.
- **🔑 Medición por VENTAS, no por entregas (decisión de negocio, mayo 2026)**: TODAS las métricas del desempeño de la asesora (metas día/semana/mes, racha, meta de equipo, ranking) cuentan el pedido por el **día en que la asesora lo REGISTRÓ** (`created_at`, zona Lima), **no** por la fecha de entrega (`fecha_pedido`, que en el form se llama "Fecha de Entrega"). Razón: la asesora vende, el repartidor entrega días después (~86% de los pedidos se entregan en fecha posterior); medir por entrega mezclaría su esfuerzo con el del motorizado y lo mandaría a fechas futuras. El **monto** usa `pi.subtotal` (precio estimado al vender), **no** `subtotal_real` (peso real al entregar). **No se filtra por estado** (un pedido que luego sale Fallido igual fue una venta del día). _Esto aplica solo a metas/incentivos de la asesora; los reportes de admin (`lib/insights.ts`, analytics, comprobantes) siguen midiendo facturación ENTREGADA, que es lo correcto para ese contexto._
- **Cálculos de meta** (`src/lib/metas.ts`, extendido): helper interno `sumarVentasCreadas` (por `created_at`); `calcularMetaDiaria`/`ventasMesActual`/`ventasHoy`/`ventasSemana(asesorId)` (lunes→hoy), `rachaDiaria(asesorId)` (legado, ya no se muestra) y **`getRachaSemanal(asesorId, diaFin=6, criterio="monto", minimoDiario=0)`** → `RachaSemanal { dias: DiaRacha[], diasCumplidos, totalDias, diasTranscurridos, semanaPerfecta, criterio, minimoDiario }`: por cada día (lun→`diaFin`) trae monto Y conteo de pedidos vendidos; `cumplido = minimoDiario>0 && valor(criterio)>=minimoDiario`. Reinicia cada semana. `meta_semanal = metaDiaria × 6`.
- **Endpoints**:
  - `GET /api/incentivos` (admin+asesor) → `{ config, criterio, equipo, ranking, racha, metasIndividuales }`; marca `esTu:true` en la fila del asesor; `equipo` usa su `criterio` (S/ o pedidos); `racha` = `getRachaSemanal(user.id, diaFin, criterio, minimoDiario)`. `POST` (solo admin) valida con zod (`ConfigSchema`: equipo+racha con `criterio`, racha con `minimoDiario`, `metasIndividuales`).
  - `GET /api/metas/asesoras` (solo admin) → metas individuales de todas las asesoras (para la pantalla de config).
  - `GET /api/metas` extendido: agrega `metaSemanal`, `ventasSemana`, `racha`, `porcentajeAvanceSemanal`.
  - `POST /api/metas/override` (ya existía) → meta individual mensual a `metas_asesoras` (mes `YYYY-MM-01`).
- **Pantalla admin** `src/app/dashboard/incentivos/{page,incentivos-client}.tsx` (guard admin → `redirect(homeForRole)`). 4 secciones, **cada una con su interruptor on/off**: (1) **Racha semanal de consistencia** (Activa + "se mide por…" monto/pedidos + mínimo por día + "cuenta de lunes hasta…" Vie/Sáb + premio — va primero, lo más destacado), (2) **Meta de equipo** (Activa + "se mide por…" monto/pedidos + objetivo + premio), (3) **Ranking mensual** (Activo + criterio + premios por puesto editables), (4) **Meta mensual de cada asesora** (Activa = la asesora ve sus tarjetas de progreso; + override por asesora → `/api/metas/override`). Botón "Guardar configuración de incentivos" (`POST /api/incentivos`, guarda los 4 toggles + criterios). Ítem de menú **Incentivos** (`FiAward`, adminOnly) en Configuración. **Rediseño UX con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar endpoints ni cálculo):** la pantalla es de interruptores, así que el foco fue hacer visible el estado on/off y limpiar el caos de guardado. (1) **Interruptor (toggle switch) grande** por bono en vez del checkbox chico; la tarjeta **se atenúa y colapsa sus campos cuando está apagada** (`BonoCard` muestra solo "Apagado · la asesora no lo ve") → se ve el estado de un vistazo y se va el ruido de configurar bonos apagados. (2) **Franja-panorama arriba**: "N de 4 bonos activos" + 4 chips (`EstadoChip`) con el activo en rojo y el resto gris. (3) **Fin del caos de 6 botones rojos "Guardar"**: las metas por asesora ya no tienen botón fijo — aparece un botón secundario **"Fijar"** (gris, no rojo) **solo cuando editás esa fila** (estado `dirty` comparando con el valor cargado), con nota de que se guardan aparte al instante; la fila muestra "Meta fija S/X" o "Meta automática (mes anterior +15%)". El botón rojo grande **"Guardar configuración de bonos"** queda como única acción primaria. (4) **Consistencia**: toast flotante (`anim-toast`) en vez de banner que empujaba; inputs `border-gray-200`/`focus:ring-red-200`; `active:scale`; se quitó la numeración "1·2·3·4" (no son pasos). tsc/eslint limpios.
- **Panel asesora** `src/app/dashboard/mis-metas/mis-metas-client.tsx`: cada bloque aparece **solo si su incentivo está activo** (flexibilidad total). Tarjetas **Hoy / Esta semana / Este mes** + indicador de ritmo (solo si `metasIndividuales.activo`); bloque **🔥 Racha de consistencia** (si `rachaSemanal.activo`) = cuadros por día (lun→diaFin) verde ✓/rojo ✗/gris · futuro, hoy con ring, con texto "cada día cuenta si vendes S/X / entregas N pedidos" según criterio; bloque **🏆 Meta del equipo** (si `activo`, progreso en S/ o pedidos según criterio); bloque **🥇 Ranking del mes** (si `activo`, medallas + premios); + `InsightCard` IA. La ven `asesor` y `admin`: para la asesora es su panel; el **admin la abre como VISTA PREVIA** (banner azul + `esVistaPrevia` desde `page.tsx`). **Rediseño con `/mejora-diseño` (mayo 2026 — local, verificado en navegador; UI only, sin tocar `/api/metas` ni `/api/incentivos`):** (1) **jerarquía** — antes 3 barras (Hoy/Semana/Mes) del mismo peso; ahora **"Hoy" es el hero** (% en `text-5xl`, barra gruesa, fondo de semáforo) y **Semana + Mes son 2 tarjetas compactas** de apoyo lado a lado; (2) el hero dice **cuánto falta** ("Te faltan S/ X para tu meta") y maneja el caso `metaDiaria<=0` ("Aún no tienes meta para hoy") en vez de un falso "¡cumplida!"; (3) **coherencia de color** — equipo pasó de **índigo** a la paleta del sistema (barra de semáforo + ícono `FiUsers` azul), racha perdió el **gradiente naranja** (semana perfecta = verde sólido), premios de índigo → **ámbar con `FiGift`**, amarillo → ámbar; (4) emojis de cabecera → íconos Feather (`FiZap` racha · `FiUsers` equipo · `FiAward` ranking; medallas 🥇 se quedan); quité el 🎉 del indicador de ritmo; (5) el `InsightCard` bajó del tope a después del progreso (no compite con "Hoy"); `tabular-nums`, `bg-gray-50` de fondo, `active:scale`. tsc/eslint limpios.
- **Verificado (dev-hugo)**: tsc/lint limpios; lógica de criterios confirmada por SQL (racha por **pedidos** mín. 1 → L✓ M✗ X✓ J✓ V✓ S✗ = 4 días, donde el Jueves de S/80 que con criterio *monto* fallaba ahora con *pedidos* cuenta; equipo por pedidos = `COUNT(DISTINCT pedidos)`). El round-trip POST/GET del endpoint con on/off por bono se probó en navegador (cada bono aparece/desaparece del panel según su `activo`). **Medición por ventas (created_at) confirmada por SQL**: ranking mensual por pedidos = Jhoselyn 115, Leslie 106, Yali 104, Yesica 73 (datos reales preexistentes en dev-hugo); el monto sale S/0 porque los items de prueba no tienen `precio_venta` (lo explica el banner ámbar del catálogo). Los **datos de prueba ya se borraron** (pedidos `__DEMO_RACHA__`, overrides de meta de Antonio/AsesoraTest y la `incentivos_config` demo) → dev-hugo limpio; `getIncentivosConfig` devuelve `DEFAULT_INCENTIVOS` (todo inactivo) hasta que el admin configure. **Pendiente:** spot-check visual de los selectores de criterio tras re-login en el navegador (la sesión del tab se cerró sola).

### Metas medidas por comprobantes emitidos — vista `ventas_facturadas` (6 jun 2026 — ✅ EN PRODUCCIÓN)

**Contexto:** `pedido_items.subtotal` da S/0 porque 0 de 88 productos tienen `precio_venta` → las metas automáticas de las asesoras mostraban S/0 y se sostenían con overrides manuales (Jhoselyn S/67k, Saraí S/153k, etc.). **Solución permanente:** medir el desempeño de la asesora por los **comprobantes emitidos** (facturas 01 + boletas 03 aceptadas/observadas, menos NC 07), no por pedidos.

**Piezas:**

1. **Vista SQL `ventas_facturadas`** (`scripts/migrate-ventas-facturadas-view.sql`, aplicar por psql antes del deploy):
   ```sql
   CREATE OR REPLACE VIEW ventas_facturadas AS
   SELECT c.id AS comprobante_id, c.tipo, c.empresa,
     (c.created_at AT TIME ZONE 'America/Lima')::date AS fecha,
     COALESCE(ue.id, p.asesor_id, uref.id, pref.asesor_id) AS asesora_id,
     CASE WHEN c.tipo = '07' THEN -c.monto_total ELSE c.monto_total END AS monto_neto,
     CASE WHEN c.tipo = '07' THEN 0 ELSE 1 END AS es_venta
   FROM comprobantes c
   LEFT JOIN pedidos p   ON c.pedido_id = p.id
   LEFT JOIN users   ue  ON ue.role='asesor' AND LOWER(TRIM(ue.name))=LOWER(TRIM(c.emitido_por))
   LEFT JOIN comprobantes cref ON c.referencia_comprobante_id = cref.id
   LEFT JOIN pedidos pref ON cref.pedido_id = pref.id
   LEFT JOIN users   uref ON uref.role='asesor' AND LOWER(TRIM(uref.name))=LOWER(TRIM(cref.emitido_por))
   WHERE c.tipo IN ('01','03','07') AND c.estado IN ('aceptado','observado');
   ```
   - **Atribución** (única, sin doble conteo): `emitido_por` → match por nombre en `users` (TRIM+lower, gotcha #11); fallback `pedido.asesor_id`; para NC sin señal propia, hereda de la factura que referencia.
   - **NC (07) resta** con `monto_neto` negativo en el período de emisión de la NC (no de la factura — estándar contable).
   - **Rechazado/error/pendiente** excluidos (`estado IN ('aceptado','observado')`).
   - **Monto:** `monto_total` con IGV (lo que paga el cliente), nunca `monto_subtotal`.

2. **`src/lib/metas.ts`**: `sumarVentasCreadas(asesorId, desde, hasta)` reescrita para leer de la vista (`SUM(monto_neto) WHERE asesora_id = X AND fecha BETWEEN`). Cascada: `ventasMesActual`, `ventasHoy`, `ventasSemana`, `calcularMetaDiaria`, `getRachaSemanal` — todos usan la vista.

3. **`src/lib/incentivos.ts`**: `getVendidoEquipoSemana(criterio)` y `getRankingMensual(criterio)` también leen de la vista. El criterio "pedidos" ahora = `SUM(es_venta)` (N° de boletas/facturas), no pedidos.

4. **Vincular comprobante a pedido** — endpoint nuevo `PATCH /api/comprobantes/[id]/pedido` (`src/app/api/comprobantes/[id]/pedido/route.ts`): permite ligar/desligar un comprobante standalone a un pedido. Permisos: admin siempre; asesora solo en sus propios. Valida que empresa coincida. Actualiza también la cobranza ligada.

5. **UI** — `src/app/dashboard/comprobantes/comprobantes-client.tsx`: nuevo ítem **"Vincular a pedido"** en el menú "⋯" + modal `ModalVincularPedido` con buscador via `/api/buscar?q=`.

**Casos que quedan cubiertos automáticamente** (la vista se evalúa al vuelo, `/api/metas` es `force-dynamic`):
- **NC anula factura** → resta en el período de la NC, no de la factura (correcto contablemente).
- **"Cambiar asesora" traslada el dinero** → se reescribe `emitido_por`; la vista lo recoge al instante; el monto se mueve al período correcto de la fecha original del comprobante (útil para metas día/semana/mes).
- **Regla vigente de reintento:** un `error` reutiliza la misma fila/correlativo; un CPE 01/03 de
  Campo `rechazado` conserva la fila y se corrige con un `INSERT` nuevo enlazado, sin contar dos
  ventas activas. Esta regla reemplaza el comportamiento original de junio.
- **Vincular/desvincular a pedido** → cambia el fallback `pedido.asesor_id`, también al instante.

**Regla importante — meta de equipo:** solo cuenta comprobantes con `asesora_id IS NOT NULL` → ventas del admin sin asignar no inflan el equipo.

**Copys actualizados**: `incentivos-client.tsx` ("N° de ventas (facturas/boletas)" en vez de "N° de pedidos vendidos") y `mis-metas-client.tsx` ("ventas" en vez de "pedidos" en el texto de la racha).

**Alcance**: SOLO metas/incentivos de asesoras. Los reportes de admin (`lib/insights.ts`, `lib/reportes/*`, analytics) siguen midiendo pedidos entregados — sin cambio.

**Verificación E2E (6 jun 2026):** boleta BETA `B001-00000007` (S/59.00, CLIENTE PRUEBA METAS, ACEPTADA por SUNAT beta) → asignada a AsesoraTest via "Cambiar asesora" → psql: `ventas_facturadas` muestra `asesora_id=AsesoraTest, monto_neto=59, es_venta=1` → `/api/metas/asesoras` responde `ventasMesActual: 59` para AsesoraTest → **confirmado**. La boleta de prueba puede borrarse de dev-hugo (es solo BETA, no fiscal).

**Deploy a producción:** aplicar la migración de la vista **antes** del deploy del código nuevo:
```bash
psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-ventas-facturadas-view.sql
```
Idempotente (`CREATE OR REPLACE VIEW`), sin riesgo para datos existentes.

**Notas de robustez:**
- Los overrides manuales de meta (`metas_asesoras`) siguen vigentes hasta que se carguen precios en el catálogo; no hay que borrarlos.
- Una NC en junio sobre una factura de mayo: mayo suma el original, junio resta la NC (período de la NC). Si eso afecta un bono ya cerrado, tenerlo presente (la historia no se congela automáticamente).
- Si una NC histérica no tiene `referencia_comprobante_id` ni `emitido_por`, no resta de ninguna asesora puntual (caso muy raro, ya pre-existente).

### Próximas fases (no cotizadas aún)
- CRM con WhatsApp Business API (Antonio lo postpuso explícitamente).
- App iOS del repartidor (solo Android por ahora — todos los motorizados usan Android).

### Producción sin productos para pesar — "Duplicar pedido" creaba pedidos sin pedido_items (11 jun 2026)
Reporte de la asesora: el modal de `/dashboard/produccion` salía vacío (sin productos, "Total a cobrar S/ 0.00") para los pedidos de **Manuel lince** y **Nikuya** — imposible registrar pesos. Diagnóstico verificado en BD de producción: esos pedidos tenían el texto en `pedidos.detalle` pero **0 filas en `pedido_items`** (la fuente del modal). Causa raíz: el botón **"Duplicar pedido"** (`table.tsx`) armaba el payload solo con campos de texto → `PedidoForm` rehidrataba el form con el texto pero `selectedItems` quedaba vacío → el POST mandaba `items: undefined` → el duplicado nacía sin ítems estructurados. Evidencia: los rotos eran duplicados en ráfaga (Manuel lince: 4 pedidos casi idénticos en 6 min; Nikuya: 2 idénticos); `pedido_ediciones` = 0 registros (descartado el PATCH). **Fix en 3 capas** (commit `58a3c13`): (1) RAÍZ — Duplicar copia también los ítems (fetch del detalle; `ProductSelector` ya tenía la prop `initialItems`); (2) DEFENSA — parser nuevo `src/lib/parse-detalle-pedido.ts` (líneas "N uni|kg - Nombre…" → ítems; tolera decimales con coma, "paquete x 6", saltos de línea raros; matching de catálogo por PREFIJO normalizado para producto_id+precio) + **backfill lazy** en `GET /api/produccion/pedidos`; (3) PREVENCIÓN — el POST deriva los ítems del texto cuando no vienen, el PATCH ya no vacía con `items: []`, y el modal de producción muestra aviso claro si llegara sin ítems. **Data-op**: backfill puntual en prod de los 5 pedidos operativos rotos (Manuel lince 1 ítem S/45.60; Nikuya ×3; veronica 5 ítems S/454.20) con el mismo parser + catálogo real. Verificado E2E en dev: pedido réplica sin ítems → el GET lo reconstruyó con producto_id y precio; POST sin items derivó ítems matcheados. (Nota ambiental: el dashboard local en el perfil Chrome transavicdev quedó sin hidratar — se verificó con `git stash` que NO era el diff; pendiente de observar.)

### Paquete del 11 jun 2026 (tarde): ticket legible + control de precios + anti-duplicados de clientes + cobranzas con asesor
Cinco trabajos pedidos por Hugo/Antonio: **(1) Ticket de orden de pedido** — la ticketera imprimía con letra muy pequeña; se subieron los tamaños del `TicketLayout` (contenido 12→14px, título 16, N° 18, TOTAL 18) en `guia-imprimible-client.tsx`; la vía RawBT no cambia. **(2) Historial de cambios de precios** (solo admin): endpoint `GET /api/precios/historial` que une `precios_productos` (LAG para el precio anterior; `created_by` = admin que cambió) con `autorizaciones_precio` aprobadas (ventas bajo catálogo: asesora, catálogo→autorizado, `aprobada_por`); modal "Historial de precios" en el catálogo. Sin tabla nueva. **(3) Catálogo para asesoras**: `/dashboard/catalogo` ahora admite asesor en SOLO LECTURA (prop `isAdmin`: sin Compra/Margen/KPI de margen/edición/altas); sidebar `roles: [admin, asesor]`; control real en `GET /api/productos` (antes ¡sin auth!): exige sesión y entrega `precio_compra: null` a no-admin. La regla "vender a catálogo o mayor" ya existía (402 + autorizaciones). **(4) Anti-duplicados de clientes**: `GET /api/clientes/verificar` (global sin scoping, respuesta mínima — existe + ejecutiva responsable, jamás datos del cliente ajeno) + `POST /api/clientes` con 409 ante match exacto de RUC/WhatsApp-últimos-9 (duro si es de otra asesora — la vía es transferencia por admin; blando con `permitir_duplicado` si es propio; admin exento); UI con verificación en vivo en el form de clientes y en "guardar como frecuente" del PedidoForm (el PEDIDO nunca se bloquea). Al probar el dup-check contra dev se encontró un duplicado real preexistente (mismo celular registrado por Leslie y Yesica) — el problema que esto previene. **(5) Cobranzas sin asesor** (bug): cuando el ADMIN emitía, `asesorId` iba null (emitir:413 / emitir-manual:293); ahora cascada `pedido.asesor_id` → emisora asesora → `clientes.asesor_id`, y backfill en prod de las 8 cobranzas huérfanas con la misma cascada. Además: migración `migrate-autorizaciones-precio.sql` aplicada a dev-hugo (faltaba) y dato actualizado: 74/90 productos de prod ya tienen `precio_venta`.

### Rechazados en /comprobantes: clasificación correcta de "SUNAT caído" + mensajes amigables (11 jun 2026, noche)
Hugo reportó 3 documentos "Con problemas": **F001-78** (KAME, 10/06 18:00) y las guías **T002-8/9** (09/06). Diagnóstico con datos de prod: **(a) F001-78 fue culpa de SUNAT** — SOAP Fault "El sistema no puede responder su solicitud. (El servicio de autenticación no está disponible)" = caída transitoria de su servidor de autenticación, NO un rechazo de datos; Yali emitió la F001-79 (ACEPTADA) 10 min después y solo la 79 generó cobranza — operativamente resuelto. Nuestros errores: `clasificarErrorSunat` no reconocía ese mensaje (cayó al genérico → quedó `rechazado` en vez de `error` reintentable) y las entidades XML del faultstring se mostraban crudas (`&#243;`). **(b) T002-8/9 fueron nuestro bug del orden XSD** (`GrossWeightMeasure`) ya corregido el 10/06 (T002-10 ACEPTADA lo demuestra); un rechazo no registra el documento ante SUNAT y los traslados ya pasaron → solo faltaba presentarlas claro. **Fix:** módulo nuevo `src/lib/sunat/mensajes-amigables.ts` (`decodeEntidadesXml` + `mensajeSunatAmigable` con patrones "SUNAT caído" / "error de esquema"); `soap-client.ts` decodifica entidades en `extractSoapValue` (cubre sendBill/sendSummary/getStatus) y clasifica "no puede responder su solicitud"/"servicio de autenticación" como `SUNAT_SERVIDOR` → estado **error** (con guard: un faultcode de validación 2xxx-4xxx nunca se enmascara); la UI (`comprobantes-client.tsx` card móvil + tooltip desktop, y `guias-client.tsx`) muestra el texto amigable con el técnico en el tooltip — cubre las filas históricas SIN data-op. Decisión: F001-78 se queda `rechazado` (reclasificarla a `error` invitaría a reintentarla por accidente y duplicar la venta de KAME — ya existe la 79).

### Reasignación de asesora en cobranzas ↔ comprobantes (11 jun 2026, noche)
Pedido de Hugo (derivado del fix de cobranzas sin asesor): que el admin pueda **reasignar la asesora de una cobranza** y que el sistema **pregunte si también reasigna el comprobante** (y viceversa) — bidireccional e inteligente. Implementado: **(a)** `PATCH /api/facturas/[id]/asesor` (admin-only): actualiza `facturas.asesor_id` y, si se pide y hay `comprobante_id`, reescribe `comprobantes.emitido_por` con el nombre EXACTO de la asesora (mismo mecanismo que `/emisor`: la asesora lo ve en su lista y la venta cuenta para sus metas vía `ventas_facturadas`). **(b)** `GET /api/comprobantes/[id]/emisor` nuevo (admin): devuelve la cobranza vinculada no-anulada (estado/monto/asesora) para que el modal "Cambiar asesora" PREGUNTE antes de guardar; su PATCH acepta `reasignarCobranza` (mueve `facturas.asesor_id`, anuladas intactas). **(c)** `GET /api/facturas` ahora trae `comprobante_id` + **sugerencia automática** para cobranzas huérfanas (LATERAL: asesora del pedido → asesora de la cartera del cliente — la misma cascada de la emisión), validada contra dev (encuentra a Yali/Yesica en huérfanas reales). **(d)** UI: en Cobranzas la celda "Asesora" (admin) es clickeable → modal con select (sugerida marcada y preseleccionada si está huérfana) + checkbox pre-marcado "Reasignar también el comprobante X (contará para sus metas)" solo si existe vínculo; en el modal "Cambiar asesora" de Comprobantes, checkbox pre-marcado "Reasignar también la cobranza vinculada (S/ monto · estado · quién la cobra hoy)". Decisión: los `pedidos.asesor_id` NO se tocan (historia operativa); el vínculo cobranza→comprobante solo por `comprobante_id` FK (jamás por `numero_comprobante` — gotcha #24).

### Anti-duplicados de clientes: el admin ya no está exento + cierre del bypass del PATCH (11 jun 2026, noche)
Hugo reprodujo el caso: registró como ADMIN un cliente con el celular de uno existente (ECO AMIGABLE, 978508430, de Yali) y "nada" lo detuvo — correcto según el diseño original ("admin exento", solo banner azul informativo), pero no según la expectativa. **Endurecimiento:** (a) la regla anti-duplicados se movió a **`src/lib/clientes-duplicados.ts`** (compartida) y el **admin ahora recibe 409 blando con `puede_forzar`** — la UI le muestra banner ÁMBAR de advertencia y un `confirm` explícito ("se creará un DUPLICADO") antes de reintentar con `permitir_duplicado: true`; (b) la revisión adversarial (workflow, 7 agentes, 4 hallazgos confirmados/0 refutados) encontró un **bypass crítico pre-existente**: `PATCH /api/clientes/[id]` no chequeaba duplicados — una asesora podía editar un cliente propio y ponerle el RUC/celular de un cliente ajeno; ahora el PATCH aplica la misma regla compartida, pero SOLO cuando el RUC/WhatsApp **cambia** respecto al valor actual (editar dirección/notas de un duplicado ya consentido no vuelve a molestar) y excluyendo el propio id; (c) otro hallazgo: con doble colisión (matchea un cliente propio Y uno ajeno a la vez) el `LIMIT 1` sin orden podía devolver el propio y dejar pasar el duro vía `permitir_duplicado` → ahora **`ORDER BY (asesor_id IS DISTINCT FROM userId) DESC`**: el match ajeno siempre gana (validado contra dev); (d) UX: `saveEdit` del directorio maneja el 409 (confirm + retry); en PedidoForm, cancelar el confirm ya no cierra la oferta de guardar (conserva contexto). Las asesoras siguen SIN poder forzar un duplicado ajeno por ninguna vía.

**Adenda (11 jun, cierre):** Hugo cuestionó que el PEDIDO no se bloquee cuando el cliente es de cartera ajena (objetivos: evitar duplicados, proteger cartera, control comercial, reducir conflictos). Tras explicarle el trade-off (bloquear = ventas perdidas o celulares falsos para evadir), **ratificó dejarlo así**: protección SOLO a nivel directorio; el pedido siempre se registra. Se le ofrecieron y declinó por ahora: "avisar antes de registrar + notificar al admin" (la preferida si Antonio reporta conflictos) y "atribuir la venta a la dueña de la cartera". No implementar nada de eso sin pedido explícito.

### F002-83 en "Error" sin mensaje: la asesora no sabía si la factura valía (12 jun 2026)
La F002-83 (FUMANCHUREST, S/818.04, Saraí) quedó `error` con `mensaje_sunat` NULL: ni la card ni el ⓘ mostraban nada. Diagnóstico en prod: XML firmado ✓, CDR ✗ → SUNAT nunca la registró (la factura NO valía aún); el fallo fue de CONEXIÓN con SUNAT (los datos estaban bien — 5 facturas previas aceptadas del mismo cliente). Causa del silencio: `index.ts` persistía solo `resultadoEnvio.descripcion`, y los fallos de conexión (catch de `enviarComprobante`) viajan en `.error` → NULL en DB → la UI exigía mensaje para mostrar algo. Y peor: el botón "Reintentar envío" de CPE era SOLO-ADMIN (las guías sí permitían a la asesora) — Saraí no podía hacer nada. **Fix (commit del 12 jun):** (a) `mensaje_sunat` persiste `descripcion ?? error` en TODOS los write-sites (emisión en `index.ts` y los 3 puntos del reintento — la revisión adversarial, 8 agentes/5 hallazgos/0 refutados, encontró que el reintento reproducía el mismo bug y además PISABA el mensaje previo con NULL); notificaciones de emitir/emitir-manual/nota-credito también con fallback `?? error`; (b) **fallback de UI por estado** (`mensajeEstadoSinDetalle` en `mensajes-amigables.ts`): filas con problema y sin mensaje muestran texto claro que responde ¿vale? y ¿qué hago? (copys cortos a propósito: en 360px el line-clamp-3 cortaba la garantía "no se duplica"); patrón "no se recibió respuesta"/"no está respondiendo" agregados a `esMensajeSunatCaido`; (c) **la asesora dueña puede reintentar sus CPE** (`puedeReintentar` + gate del endpoint con `asesoraPuedeVerComprobante`, 404 para ajenos — consistente con guías); (d) `maxDuration=60` en emitir/emitir-manual/reintentar (SUNAT lento > 15s default de Vercel). La F002-83 se reintentó tras el deploy con el MISMO número → **ACEPTADA con CDR**. **Gap adicional detectado al verificar:** la regla "toda venta crea cobranza" se aplicaba solo en la EMISIÓN exitosa; un reintento exitoso no creaba la cobranza (la 83 quedó aceptada sin deuda registrada) → el reintento ahora la crea/vincula (idempotente, misma cascada de asesor, plazo del crédito o del cliente; NC excluidas); la cobranza de la 83 se repuso por el endpoint de cobranza manual + reasignación a Saraí.

### Autorizaciones de precio aprobadas que no desbloqueaban la emisión — caso Saraí ×3 (12 jun 2026)
Antonio aprobó 3 veces la misma solicitud de Saraí (Huevos a GRANEL @ S/89.90 vs mínimo S/99.00) y ella seguía bloqueada. Causa raíz: la ÚNICA vía que conectaba la aprobación con la emisión era el link de la notificación (`?autorizacion_id=`); si la asesora abría el form por el menú o desde el pedido, la UI la mandaba a solicitar OTRA autorización (loop), la página `/dashboard/autorizaciones` era solo-admin y sin botón de uso, y el server exigía el id en el body. **Fix:** (a) helper compartido **`src/lib/autorizaciones-precio.ts`** (`controlarPrecioMinimo`) usado por emitir y emitir-manual: usa la autorización enviada si es válida **y cubre los ítems**, o AUTO-MATCHEA una aprobada sin usar de la asesora (misma empresa/tipo, prioriza el mismo cliente); 402 solo si no hay ninguna; (b) UI del form: auto-adjunta la aprobada disponible (con estado "Buscando autorizaciones aprobadas…" para no invitar a re-solicitar), banner que explica el auto-uso y que se consumirá al emitir, "Quitar" recuerda los ids descartados (sin bucle), la PRECARGA solo corre cuando el id viene por URL (no pisa lo tipeado), links viejos usados/rechazados avisan y sueltan el id, y los códigos 402 se traducen a texto claro; (c) `/dashboard/autorizaciones` abierta a asesoras (ven las suyas; botón "Emitir con esta autorización"); sidebar admin+asesor. **La revisión adversarial (17 agentes, 12 hallazgos confirmados/0 refutados) endureció el diseño:** la vía explícita era un cheque en blanco (no comparaba ítems — ahora exige cobertura), el match ignoraba CANTIDAD (autorizar 10 validaba 1000 — ahora cantidad ≤ autorizada×1.1), empresa/tipo/cliente no se filtraban, el fallback `?? body.autorizacion_id` quemaba autorizaciones en emisiones que no las usaban (ahora solo se consume la realmente usada, con guard atómico `AND usada_at IS NULL`), y el auto-adjuntar disparaba la precarga pisando el form (gated por ref). Pendiente conocido (pre-existente, chip aparte): un nombre de producto alterado ("Pollo entero." con punto) no matchea el catálogo → mínimo 0 → sin control. Sin data-op: las 3 aprobadas de Saraí quedan utilizables; su siguiente intento las usa solo.

### UX de notificaciones: descartar con "x" + limpiar leídas + badge de autorizaciones (12 jun 2026)
Pedido de Hugo (tras el caso Saraí): poder cerrar notificaciones y que lo importante no se escape. Decisión de diseño: **TODA notificación se puede descartar** (la "x" borra la fila — el dato de fondo vive en su módulo: cobranza vencida en /cobranzas, comprobante rechazado en /comprobantes, autorización en /autorizaciones); lo importante se **DESTACA** con borde de color (rojo: comprobante rechazado/error/pedido fallido; ámbar: factura vencida; índigo: autorizaciones), no se vuelve imposible de cerrar. Implementado: `DELETE /api/notificaciones/[id]` (solo propias) + `POST /api/notificaciones/limpiar-leidas` (borra las YA leídas, con `confirm` que muestra el conteo — "leída ≠ vista" si se usó "Marcar todas leídas"); en `NotificationBell` la "x" tiene área táctil ≥40px (las asesoras usan celular y la fila entera es un Link — un fallo de dedo navegaría); **badge índigo en el ítem "Autorizaciones" del sidebar** (solo asesoras) con sus aprobadas sin usar de los últimos 7 días (acotado a propósito: un badge eterno entrena a ignorarlo), polling 60s. Revisión adversarial: 3 hallazgos confirmados (target táctil chico, limpiar sin confirm, badge eterno) — los 3 corregidos antes del deploy.

### Consulta de cliente en vivo (celular/DNI/RUC) en nuevo-pedido (12 jun 2026)
Pedido de Hugo: reemplazar la consulta manual del grupo de WhatsApp ("¿este número es de alguien?") por una verificación automática al crear el pedido. En `PedidoForm.tsx` se agregó un useEffect debounced (500ms, solo `appState==='editing'`) que reusa `/api/clientes/verificar` (global, respuesta mínima) mientras la asesora escribe el celular/DNI/RUC, y muestra un banner inline bajo el campo WhatsApp: **propio** → azul "Es tu cliente: {nombre}" + botón "Cargar sus datos" (fetch `/api/clientes/[id]` → `handleClienteSelected` autocompleta y enlaza el pedido, evitando duplicar); **ajeno** → ámbar "Cliente ya registrado · Ejecutiva responsable: {asesora}" SIN nombre ni datos del cliente (privacidad de cartera — decisión del usuario); **sin match** → verde "Cliente nuevo". NUNCA bloquea el pedido ([[pedido-cartera-ajena-no-bloquear]]); guard: si ya se cargó un cliente por el buscador de nombre (`clienteGuardadoId`), no consulta. Sin cambios de backend. Revisión adversarial: 0 hallazgos.

### GRE: el punto de llegada usa la dirección de la FACTURA, no la de entrega del pedido (12 jun 2026)
Hugo preguntó por qué, al emitir la GRE de la F002-90, el punto de llegada salía "Av. Arequipa 5100, Miraflores" (dirección de entrega del pedido) en vez de la dirección de la factura "AV. SAN JUAN 378… SAN LUIS". Diagnóstico: era DELIBERADO (el modal priorizaba la dirección de entrega del pedido). Hugo pidió que use la dirección de la factura porque varios clientes exigen que coincidan. **Solución (corregida tras 4 rondas de revisión):** cuando la GRE se emite DESDE una factura (`comprobante` presente), el modal toma la dirección del **XML firmado** de la factura (`data.cliente.direccion`, ya descargado en `cargarItems`) y deriva el distrito con `detectarDistritoEnDireccion` del texto. **Por qué el XML y no apisperu:** un primer intento forzaba la consulta del RUC, pero apisperu es intermitente — verificado en prod que NO devuelve dirección para el RUC 10423036741 (y, observación de Hugo, para muchos RUC 10/persona natural). El XML siempre tiene lo que se emitió. Desde un pedido sin factura se mantiene la consulta SUAVE (respeta la dirección de entrega). Cambios: `emitir-guia-modal.tsx` (consulta forzada si hay comprobante; no auto-simplificar desde factura para que la asesora vea/edite los datos fiscales) y `guia-form-shared.ts` (`decidirAutollenadoDestino` ahora es ATÓMICO en modo forzar: si reemplaza la dirección y no hay distrito reconocible, limpia el distrito — nunca deja dirección de un distrito + etiqueta de otro). **Revisión adversarial (3 rondas, ~24 agentes):** la ronda 1 descartó el enfoque del XML (perdía el distrito → bloqueaba la emisión); la ronda 2/3 endurecieron la coherencia dirección↔distrito y destaparon un fallback PREEXISTENTE peligroso — el server de emisión/reintento, si el distrito llegaba vacío, usaba el ubigeo **150101 (Cercado de Lima)** en silencio → GRE con ubigeo de otro distrito que la dirección. Se agregó guard en `api/guias/emitir` y `api/guias/[id]/reintentar`: ABORTAN si falta el distrito. Pendiente documentado (preexistente, no del cambio): en modo SUAVE desde pedido, si el distrito del pedido no es reconocible, la consulta suave lo rellena con el distrito fiscal manteniendo la dirección de entrega (par potencialmente incoherente; raro y editable). Verificado: `decidirAutollenadoDestino` con los 4 escenarios (F002-90 → SAN JUAN + San Luis; provincia sin distrito → dirección + distrito vacío; pedido suave → respeta entrega).

**Adenda (corrección del mismo día):** el enfoque inicial (forzar apisperu) se descartó porque apisperu no devuelve dirección para RUC 10. Versión final: dirección del **XML** + distrito derivado del texto; el server (`api/guias/emitir`) además garantiza coherencia — el distrito de pedido/ficha solo se hereda si la dirección vino de esa fuente, y si la dirección la mandó el frontend (XML) sin distrito, se deriva del texto (nunca dirección-del-XML + distrito-del-pedido); emisión/reintento abortan si falta distrito (evita el ubigeo fallback 150101). Verificado en prod (read-only, SIN emitir — la F002-90 ya tiene su guía): el XML de la F002-90 devuelve "AV. SAN JUAN 378 … SAN LUIS" y `detectarDistritoEnDireccion` → "San Luis". Asimetría deliberada: GRE desde el PEDIDO (no desde la factura) usa la dirección de entrega del pedido.

### Buscador de clientes: detectar clientes de OTRA asesora por teléfono/DNI/RUC (13 jun 2026)
Pedido de Hugo: que el buscador de `/dashboard/clientes` permita a la asesora encontrar también clientes de OTRAS asesoras al buscar por número (igual que el grupo de WhatsApp, pero en la pantalla de clientes). La lista scopeada solo muestra la cartera propia; ahora, cuando la asesora escribe un término numérico (≥6 dígitos = teléfono/DNI/RUC), un useEffect consulta `/api/clientes/verificar` (global, respuesta mínima — reusado) y, si hay match EXACTO de otra asesora, muestra un banner ámbar "Ese número/documento ya está registrado · Ejecutiva responsable: X · pide la transferencia a un administrador". Sin revelar datos del cliente ajeno (el endpoint solo da `asesora_nombre`). El admin no lo ve (su lista ya incluye a todos); los clientes propios ya salen en la lista. Cambio acotado a `clientes-client.tsx` (estado `matchGlobal` + useEffect + banner); placeholder actualizado a "...RUC, DNI, WhatsApp...". Revisión adversarial: 0 hallazgos.

### Datos del conductor (SUNAT) opcionales al crear un repartidor (13 jun 2026)
Hugo: crear un usuario repartidor pedía los 5 datos del conductor (nombres, apellidos, DNI, licencia, placa) como obligatorios (`required` HTML5) → no se podía guardar sin llenarlos. Ahora son opcionales: se quitaron los `required` en `user-modal.tsx` y el bloque se rotula "Datos de Conductor (SUNAT) · opcional" con nota ("se piden al emitir la guía si hacen falta; con moto/auto ligero no son necesarios; varios repartidores pueden tener la misma placa"). El backend (`/api/users`), la DB (`users.chofer_*` nullable) y la GRE ya soportaban los datos vacíos. **Sobre el supuesto "error al repetir la placa":** se analizó y NO existe restricción de placa — la tabla `users` en prod solo tiene UNIQUE en `id` y `name`; ni el backend ni el frontend validan la placa. Dos repartidores YA pueden compartir moto; el único choque de duplicado al crear es el **nombre de usuario** (debe ser distinto). Lo que bloqueaba era el `required`, ya resuelto.

### Fecha de emisión seleccionable en boletas/facturas (16 jun 2026)
Pedido de Hugo: poder emitir un comprobante con una fecha distinta a "hoy" (días anteriores/posteriores). **Investigación SUNAT (fuentes oficiales):** las fechas **futuras NO se permiten** — SUNAT rechaza con el error tipo **2329 / ERR-1079** ("la fecha de emisión no puede ser mayor a la de recepción"); las **retroactivas SÍ**, dentro del plazo de envío: **factura 3 días** calendario (RS 003-2023, vigente ene-2023), **boleta 7 días** (vía resumen diario, RS 193-2020). `cbc:IssueTime` es opcional y SUNAT no lo valida contra la hora real. Decisiones de Hugo: bloquear futuras en la UI; límite 3/7 por tipo; lo usan admin y asesoras (validado en SERVER); alcance completo (la fecha elegida se persiste y se usa en cobranza/reportes/PDF) pero FLEXIBLE (al emitir desde un pedido se precarga la fecha del pedido recortada al rango, editable).

**Punto de partida:** el motor `emitirComprobante` (`src/lib/sunat/index.ts:165`) YA aceptaba `opts.fechaEmision?` y calculaba bien el vencimiento de crédito desde ella + la escribía en el XML; faltaba exponerla, validarla y persistirla. **Implementación:** (1) migración `scripts/migrate-fecha-emision-comprobante.{mjs,sql}` — nueva columna `comprobantes.fecha_emision DATE` (nullable; backfill con `(created_at AT TIME ZONE 'America/Lima')::date` → ninguna fecha histórica cambia); (2) validador compartido en `src/lib/sunat/fechas.ts` — `LIMITE_DIAS_ATRAS={"01":3,"03":7}`, `rangoFechaEmision`, `validarFechaEmision` (regex `YYYY-MM-DD` + fecha calendario real + rango, comparando como string para evitar bugs de TZ; `min`/`max` siempre devueltos); (3) endpoints `emitir` y `emitir-manual` — `fechaEmision` opcional en zod + `validarFechaEmision` → 400 con mensaje claro (defensa en SERVER, una asesora no puede saltarse el límite) + passthrough al motor y a la cobranza; (4) motor — persiste `fecha_emision` en los TRES INSERT (sin-cert/éxito/catch), `horaEmision` normalizada a `horaActualLima()`, y barrera defensiva que aborta fecha futura ANTES de quemar el correlativo; (5) UI `emitir-client.tsx` — input `type="date"` con `min`/`max` dinámicos por tipo, precarga clampeada desde el pedido, re-clamp al cambiar factura↔boleta, y plazo de crédito calculado como `diasEntre(fechaEmision, fechaVenc)` (vencimiento absoluto preservado); (6) coherencia completa — cobranza (`cobranzas.ts`, vencimiento y `facturas.fecha_emision` desde la fecha real, con `COALESCE` para respetar el NOT NULL/default), PDF (`[id]/route.ts`), reporte Excel (`reporte-excel-comprobantes.ts` + `export-xlsx` filtra/ordena por `COALESCE(fecha_emision, created_at_lima)`), reintentar (`[id]/reintentar.ts` reconstruye el XML con `fecha_emision`), y **resumen diario** (`resumen-diario.ts` agrupa boletas por `COALESCE(fecha_emision, created_at_lima)` — CRÍTICO: una boleta retroactiva debe ir en el RC de SU día de emisión, no del de registro). NC, comunicación de baja y GRE **no cambian** (su fecha es siempre la del día).

**Verificación E2E contra SUNAT BETA** (branch `dev-hugo`, `VERCEL_ENV` neutralizado solo para habilitar el bypass de test; SUNAT en beta): migración aplicada por psql (25 filas backfilleadas, 0 NULL); validador 10/10 casos; emisión real a beta — **futura → 400, factura hoy-4 → 400, boleta hoy-8 → 400** (con su mensaje), **boleta hoy → ACEPTADA (B001-11)**, **boleta retroactiva hoy-2 → ACEPTADA (B001-12)**, con `fecha_emision` y `cbc:IssueDate` del XML firmado = la fecha elegida (06-14, no created_at 06-16); **crédito retroactivo (B001-13)** → `DueDate`/`PaymentDueDate` = 06-21 (= emisión 06-14 + 7) y la cobranza con esa misma fecha/vencimiento; resumen diario: la query nueva ve las 2 boletas retroactivas del 14, la vieja (por created_at) veía 0. Quedaron 3 boletas de prueba (B001-11/12/13) en dev-hugo + beta (no reales). **Producción:** aplicar `scripts/migrate-fecha-emision-comprobante.sql` por psql ANTES del deploy.

### GRE: las cantidades por línea deben venir del XML de la factura, no del pedido estimado (16 jun 2026)
Bug reportado por Hugo (factura F002-00000121 / guía T002-00000022, Avícola de Tony, prod): en la GRE, la columna **Cantidad** por línea traía el peso **estimado del pedido** (30/30/15) en vez del **real de la factura** (29.4 / 30.98 / 15.55), aunque el **peso bruto total** (75.93) sí era correcto. **Confirmado con el XML firmado real de prod (solo lectura):** `DeliveredQuantity` = 30/30/15 (estimadas) pero `GrossWeightMeasure` = 75.93 (real) → XML **internamente incoherente** (líneas suman 75.00, peso declara 75.93). **El error estaba en el XML, no solo en el PDF** (el PDF se genera del XML firmado vía `parseDespatchItems`).

**Causa raíz** (`src/app/api/guias/emitir/route.ts`): la carga de `itemsRows` va por 3 caminos excluyentes — `else if (pedido_id)` carga `pedido_items` con `COALESCE(cantidad_real, cantidad)` = estimadas (y `cantidad_real` estaba NULL: la factura se emitió con cantidades editadas no volcadas a `pedido_items`); `else if (comprobante_id)` parsea el XML firmado de la factura (correcto). El bloque que reemplaza `itemsRows` con los ítems del XML de la factura estaba guardado por `if (!finalComprobanteId && finalPedidoId)`. El modal de la **página de Comprobantes** (`comprobantes-client.tsx:3578`) abre `<EmitirGuiaModal pedido comprobante />` con AMBOS → el body manda los dos IDs (`emitir-guia-modal.tsx:498-499`) sin `items`. Con ambos IDs: gana `else if (pedido_id)` (estimadas) y el guard `!finalComprobanteId` (falso) salta el reemplazo por factura. El peso 75.93 venía del request (`pesoBrutoTotal`, que el modal calculó de la factura mostrada) y se respetaba tal cual. Desde el dashboard de pedidos (solo `pedido_id`) sí reemplazaba → por eso el bug solo aparecía al emitir desde Comprobantes.

**Fix (solo `route.ts`, preventivo — la T002-22 ya emitida se deja como está):** (1) flag `itemsDesdeComprobanteXml` (true cuando el camino comprobante_id ya parseó el XML); el guard del bloque de vinculación pasa de `!finalComprobanteId && finalPedidoId` a `!itemsDesdeComprobanteXml && finalPedidoId`, y **dentro** usa el `comprobante_id` EXPLÍCITO si vino (no "la última factura aceptada del pedido", que podría ser otra) o lo descubre por pedido_id → las líneas de la GRE SIEMPRE del XML firmado de la factura vinculada; `pedido_items` solo si no hay factura. (2) Peso bruto **autoritativo**: cuando TODOS los ítems son KGM, `GrossWeightMeasure` = suma de las líneas ya corregidas (se ignora el `pesoBrutoTotal` del request) → `GrossWeight == Σ DeliveredQuantity` por construcción; con unidades mixtas, se exige el peso del request (sin estimar). No se tocó el modal, el reintento (reusa el XML firmado original — el fix es preventivo) ni la T002-22.

**Verificado E2E en beta (dev-hugo):** se montó el escenario (pedido con `pedido_items` 30/15 redondas + factura vinculada con XML 29.4/15.55) y se emitió la GRE con ambos IDs mandando a propósito `pesoBrutoTotal=50` (incorrecto): el XML firmado salió con `DeliveredQuantity` = **29.4/15.55** (de la factura) y `GrossWeightMeasure` = **44.95** (recalculado, ignoró el 50). No-regresión: GRE con solo `pedido_id` sigue tomando 29.4/15.55. (El envío a SUNAT beta dio 401 por credenciales del token GRE de beta — no afecta la construcción del XML, que es lo que el fix toca.) `npm run build` OK. Datos de prueba limpiados.

**Impacto en prod (medido el 16 jun, read-only):** de 17 guías vinculadas a factura, **5 quedaron con el desglose por línea estimado** (todas Avícola: T002-8, T002-9, T002-15, T002-16, T002-22). En las 5 el **Peso Bruto total SÍ coincide con la factura** (lo calculaba el modal de la factura) — solo el desglose por producto salió con el estimado del pedido. Las 12 restantes correctas. Decisión de Hugo: dejarlas (no se pueden editar CPE firmados); el fix aplica de aquí en adelante.

### GRE: lista de productos editable en el modal (16 jun 2026)
Mejora propuesta por Hugo tras el fix anterior: en el modal de GRE, sección "Detalles del Envío", mostrar **cada producto con su cantidad y unidad, editable**, en vez de solo el Peso Bruto total. Doble objetivo: **flexibilidad** (traslado parcial, ajuste de peso real al cargar) y **cerrar la clase de bug de raíz** — antes el modal cargaba los productos por dentro pero no los mostraba ni los mandaba, así que "lo mostrado != lo emitido"; ahora el usuario VE y aprueba lo que se emite ("lo mostrado == lo emitido"), que pasa a ser la red de seguridad. Decisiones: editar cantidad y unidad (no agregar/quitar; descripción fija); peso bruto auto-calculado de las líneas y editable (todos KGM → suma automática; mixtas → manual).

**Implementación** (2 archivos): (1) `emitir-guia-modal.tsx` — helper de módulo `calcularPesoMixtas(items)` (misma fórmula que el backend), `useEffect([items])` que recalcula peso/aviso de mixtas al editar (no toca `totalBultos` porque no se agregan/quitan productos; con todo KGM el peso es la suma autoritativa, con mixtas no toca el peso manual), handlers `handleItemCantidad`/`handleItemUnidad`, render de la lista editable `[descripción readonly | cantidad number | select kg/uni]` (el `value` del select se deriva idempotente con `aUnitCodeSunat`), validación `cantidad>0` antes de emitir, y se manda `items` en el body (el estado `items.cantidad` pasó a `number|string` para tolerar la edición). (2) `api/guias/emitir/route.ts` — un override quirúrgico tras toda la resolución (dirección/repartidor/cliente + vinculación de la factura) y antes del anti-doble-emisión: `if (parsed.data.items?.length) itemsRows = items.map(...)` → los ítems del request son la última palabra; sin ítems, queda el fix (XML de la factura). El peso autoritativo y `items_json` ya leen de `itemsRows` → coherentes con lo editado.

**Verificado E2E en beta:** con factura 29.4/15.55 vinculada a un pedido con estimadas 30/15, emitiendo desde "ambos IDs": (A) con ítems editados (29.4→20) → `items_json` 20/15.55 y peso **35.55** (recalculado); (B) sin ítems → `items_json` 29.4/15.55 y peso 44.95 (el fix intacto). `npm run build` + lint OK (desaparecieron los warnings de `items`/`cargandoItems` sin usar). Datos de prueba limpiados.

### Bug crítico: comprobantes RECHAZADOS por SUNAT guardados como "aceptado" (17 jun 2026)
Un contador observó que una NC (FC02-00000005) figuraba "aceptada" en el sistema pero SUNAT la había RECHAZADO (3286). Investigación (read-only en prod) → **DOS bugs encadenados**:
- **Bug 1 — el sistema no leía el rechazo.** En `soap-client.ts`, el parser PKZip casero `descomprimirCDR` fallaba con el ZIP "data descriptor" de SUNAT (gotcha #18, arreglado solo para la *descarga*, no para la *clasificación del estado*) → devolvía crudo/vacío → `parsearRespuestaCDR` no hallaba el `ResponseCode` → `parseInt("")`=NaN → la cascada de rangos caía al **`else` final → `EstadoSunat.ACEPTADA`**. Diagnóstico contundente: los **473** comprobantes 'aceptado' tenían `mensaje_sunat` VACÍO (el parseo fallaba en TODOS; 468 con ResponseCode 0 quedaban correctos por casualidad, 5 con 3286 eran falsos aceptados). Python/zipfile descomprime los mismos `cdr_base64` guardados sin problema → confirma que el parser Node era el que fallaba.
- **Bug 2 — la NC excedía la factura por 1 céntimo (causa del 3286).** `nota-credito/route.ts` armaba la NC como **1 línea consolidada** con `precioUnitario = monto_subtotal` recalculando el IGV al 18%; la factura sumó el IGV línea por línea → la NC daba hasta 1 céntimo más (F002-34: PayableAmount del XML 649.69 vs NC 649.70). SUNAT exige NC ≤ factura → 3286.
- **Impacto:** 5 NC (FC01-6, FC01-11, FC02-3, FC02-5, FC02-10) marcadas "aceptado" sin existir ante SUNAT; cada una anuló la cobranza de su factura (~S/1,996). Las 5 facturas SÍ están aceptadas en SUNAT (verificado, ResponseCode 0).

**Fix (prevención):** (1) `descomprimirCDR` reescrita con **`fflate.unzipSync`** (lee el central directory como python; maneja el data descriptor) y nuevo contrato `{ xml, ok }` — **nunca** devuelve crudo; (2) clasificación **fail-safe** en `soap-client` (`enviarComprobante`+`consultarTicket`) y `rest-client`: si el CDR es ilegible (`!ok`) o el código no es entero válido → **`ERROR` (nunca ACEPTADA)**; `100-3999`→RECHAZADA (incluye 3286); además persiste `mensaje_sunat` también en aceptados ("0: …") como señal de salud; (3) la NC ahora usa **las líneas reales del XML firmado de la factura** (`parseCpeItems`) en vez de consolidar → `NC.total == factura.total` exacto (verificado: las 2 líneas de F002-34 suman 649.69 = PayableAmount del XML → NC == factura → no 3286).

**Remediación de datos** (`scripts/remediar-cdr-falsos-aceptados.mjs`, idempotente, dry-run por defecto, usa psql + fflate → no depende de neon-en-Node): re-clasifica las 5 NC a 'rechazado' decodificando su `cdr_base64` ya guardado, y corrige las `observaciones` de las 5 facturas ("(ACEPTADA)"→"(RECHAZADA)") para desbloquear la re-emisión (el anti-duplicado de NC mira ese texto). **NO reactiva cobranzas** (decisión de Hugo: las ventas se cancelaron de verdad; lo correcto es re-emitir las NC). Dry-run contra prod detectó exactamente las 5 NC. `build`+`lint` OK. **Pendiente operativo:** aplicar la remediación (`--apply`), desplegar, y re-emitir las 5 NC (saldrán con número nuevo; las facturas y la NC se rigen por su propia fecha de emisión + plazo de envío de 3 días → se pueden emitir hoy aunque las facturas sean de inicios de junio). **Aplicado a prod el 17 jun** (backup previo): 5 NC → rechazado, 5 facturas con observaciones corregidas, cobranzas intactas; idempotente verificado.

### UX: "Reintentar envío" contextual + re-emisión de NC rechazadas (17 jun 2026)
Tras lo anterior, Hugo observó que el menú ofrecía "Reintentar envío" en las NC rechazadas, pero reintentar reenvía el MISMO XML (monto malo) → mismo 3286; y que varias NC rechazadas confunden a las asesoras. 3 mejoras (sin migración):
- **"Reintentar envío" solo donde ayuda** (`comprobantes-client.tsx` `puedeReintentar`): para CPE, solo en estado `error` (transitorio: SUNAT caído / CDR ilegible / emisión interrumpida → reenviar el mismo XML puede pasar). NO en `rechazado` (SUNAT evaluó y rechazó por datos → reenviar lo idéntico es inútil). Guías (09) sin cambio (semántica propia).
- **"Emitir nota de crédito corregida"** desde una NC rechazada: nuevo botón en el menú (`puedeReemitirNC`) que reusa `ModalNotaCredito` abriéndolo sobre la **factura referenciada** (`referencia_comprobante_id`) → emite una NC NUEVA con el monto ya corregido. La asesora no busca la factura a mano.
- **Chip "ya reemplazada por FCxx"**: el GET `api/comprobantes` calcula `reemplazada_por` (otra NC aceptada/observada que acredita la misma factura) en las subconsultas CPE (NULL en guías para alinear el UNION); la UI muestra un chip verde en la NC rechazada ya resuelta y oculta el botón de re-emitir. Reduce el ruido visual. Verificado: `build`+`lint` OK; la query da NULL para las 5 NC (aún sin re-emitir) — el chip aparecerá al re-emitir.

### Descuadre de 1 céntimo: el monto del PDF/sistema no coincidía con el del XML/SUNAT (18 jun 2026)

**Síntoma (lo reportó Hugo validando las 5 NC re-emitidas):** en la **Consulta de Validez del CPE** de SUNAT, una NC salía como *"no existe"* al tipear el monto del PDF (ej. 223.**83**), pero **sí** aparecía con el del XML (223.**82**). El PDF mostraba un total que no validaba contra SUNAT.

**Diagnóstico (workflow de 4 agentes + lectura directa + norma SUNAT):** había **dos cálculos del total en paralelo** con distinto orden de redondeo:
- `src/lib/sunat/xml-builder.ts:calcularTotales` (L57‑107): redondea **cada línea** (`r2(valorVenta)`, `r2(montoIGV)`) y suma líneas ya redondeadas → produce el `cbc:PayableAmount` del XML, **lo que SUNAT registra y valida**.
- `src/lib/sunat/index.ts:emitirComprobante` (L184‑195, código viejo): sumaba **sin redondear por línea** y redondeaba la suma al final → guardaba ese total en `monto_total/monto_subtotal/monto_igv`. El comentario del propio código lo admitía: *"el xml-builder los recalcula pero acá los queremos en DB"*.

Como `r2(Σx) ≠ Σr2(x)`, divergían 1‑2 céntimos cuando los precios tenían >2 decimales (típico: precio CON IGV /1.18 da neto con muchos decimales; en NC, `parseCpeItems` extrae el precio del XML con hasta 4 decimales). **Alcance sistémico medido:** de 479 comprobantes con XML, **161 con descuadre de total** (Facturas 90/282, Boletas 67/143, NC 4) — y 194 si además se cuenta subtotal/IGV. El PDF, la lista (`comprobantes-client.tsx` → `route.ts:119`) y el PDF (`pdf-comprobante.ts` ← `[id]/route.ts:267`) leían `monto_total` de DB, NO el XML → 1 de cada 3 PDFs no validaba. La cobranza (`facturas.monto`) heredaba el mismo total. **Norma:** el XML firmado es la única fuente de verdad legal (RS 318‑2017); la Consulta de Validez compara el importe **exacto al céntimo, sin tolerancia**.

**Fix (3 frentes, $0):**
- **(A) Prevención — un solo cálculo:** se exportó `calcularTotales` (+ `r2`) de `xml-builder.ts`; `emitirComprobante` ahora la usa para `subtotal/igv/total` y **pasa ese mismo objeto `totales` al builder** (`datos.totales`) → el XML y la DB usan el cálculo idéntico, `monto_total == PayableAmount` por construcción. Cubre factura/boleta/NC (las tres pasan por `emitirComprobante`; `emitir-manual` también).
- **(B) Blindaje del PDF:** nuevo helper `parseCpeTotales(xml)` en `parse-cpe-items.ts` (quita las líneas y lee los totales de cabecera: `PayableAmount`, `LineExtensionAmount` global de `LegalMonetaryTotal`, `TaxAmount` del `TaxTotal` de documento). El detalle `comprobantes/[id]/route.ts` devuelve esos totales del XML firmado cuando existe → el PDF SIEMPRE iguala a SUNAT, aunque `monto_total` derivara.
- **(C+D) Backfill** `scripts/backfill-monto-total-desde-xml.mjs` (patrón de `remediar-cdr-falsos-aceptados.mjs`: psql, dry‑run/--apply, respaldo CSV automático en `scratch/`): alinea `monto_total/subtotal/igv` de los comprobantes al XML, y `facturas.monto` de **cobranzas no pagadas** (`Pendiente`/`Vencida`) emparejadas por `comprobante_id` o `numero_comprobante+pedido_id` (gotcha #24: las 2 empresas comparten series F001/B001 → numero solo NO basta) con **guarda ≤0.02** (solo el descuadre de redondeo). Las pagadas NO se tocan (decisión de Hugo).

**Verificación (read-only contra prod, sin emisiones reales):** réplica en JS de ambos algoritmos sobre 60 XMLs reales → **NUEVO (calcularTotales) == PayableAmount del XML 60/60**, y **VIEJO (suma sin redondear) == monto_total guardado 60/60** (confirma raíz). `parseCpeTotales` validado 6/6 (incluye casos multi‑línea y de 2 céntimos). `npm run lint` + `npm run build` OK. **Aplicado a prod el 18 jun** (backup previo): **194 comprobantes + 54 cobranzas** alineados; re‑verificación → **0 descuadres** en los 479. Las 5 NC ahora muestran el total del XML (FC02‑14 = 223.82, etc.) → validan en SUNAT con el monto del PDF. **3 cobranzas** Pendiente/Vencida sin vínculo seguro quedaron sin tocar (reportadas para revisión manual). **Pendiente operativo:** desplegar el código (git push a main) para que las nuevas emisiones no vuelvan a derivar; el backfill ya dejó el histórico correcto.

### El total se ANCLA al precio con IGV tecleado (100, no 100.01) — y SUNAT lo acepta (18 jun 2026)

**Síntoma (lo detectó Hugo emitiendo "desde cero"):** al teclear un precio CON IGV de **S/100**, la pantalla mostraba Op.gravada 84.75 / IGV 15.25 / **Total 100.00**, pero el comprobante emitido daba **100.01**. El cliente acordaba 100 y el documento legal salía 100.01.

**Diagnóstico (workflow de 3 agentes: norma SUNAT + conexipema + comportamiento Transavic):**
- El método estándar (el que usa `calcularTotales`, y también **conexipema** y Greenter/Facturador SUNAT) calcula `neto=100/1.18=84.7458`; `valorVenta=r2(84.7458)=84.75`; `IGV=r2(84.75×0.18)=r2(15.255)=15.26`; total **100.01**. **Es SUNAT-válido** (conexipema lo emite en producción), pero el total no es "redondo".
- Medición en prod: **189/479 comprobantes (39%)** tenían el total emitido ≠ al bruto tecleado (Σ precio con IGV × cantidad), por ±1‑2 céntimos.
- Decimales (lo que Hugo notó en conexipema): SUNAT permite **hasta 10 decimales en el valor unitario** (`cac:Price/PriceAmount`; Transavic usa 4, conexipema hasta 10 — ambos correctos) y **2 en los montos**. No era el problema.
- Tres números no cuadraban: preview del frontend (100.00, calcula IGV=total−neto), XML emitido (100.01), cobranza (`facturas.monto`=bruto crudo, 100.00).

**Decisión de Hugo:** que el total sea **EXACTO** (100.00) — el cliente paga lo acordado.

**Implementación (anclaje al bruto en `xml-builder.ts:calcularTotales`):** por línea `bruto=r2(precioConIgv×cant)`, `valorVenta=r2(bruto/1.18)`, **`IGV=bruto−valorVenta`** (en vez de `r2(base×0.18)`). El total queda exacto = bruto. El IGV difiere ≤0.005 de base×18%.

**Validación contra SUNAT (lo crítico): BETA aceptó.** Se emitió una boleta real S/100 a SUNAT beta con el anclaje (vía dev server + dev-bypass, credencial MODDATOS): respuesta **ACEPTADA**, CDR ResponseCode 0, XML con `TaxAmount=15.25`, `PayableAmount=100.00`. Confirma que **SUNAT aplica una tolerancia al IGV por línea** (acepta 15.25 aunque 84.75×0.18=15.255) — beta y producción usan el mismo motor de validaciones. (El error 3286 que vimos antes es sobre NC>factura, NO sobre la precisión del IGV por línea; no se contradicen.)

**Notas de crédito — fidelidad exacta (evita 3286):** con el anclaje, una NC sobre una factura VIEJA que quedó 1 céntimo por debajo podría recalcular un total mayor → SUNAT 3286 (NC>factura). Fix: `calcularTotales` ahora **respeta los importes de línea ya fijados** (`item.valorVenta`+`item.montoIGV`); la ruta de NC los copia EXACTO del XML firmado de la factura (`parseCpeItems` ya devuelve `valorVenta`/`montoIGV`). Así la NC reproduce el total de su factura al céntimo y nunca la supera. Verificado read-only contra las **425/425** facturas/boletas de prod: la NC reconstruida da el PayableAmount exacto; **0 superarían** a su factura.

**Consistencia de la cobranza:** `emitirComprobante` ahora devuelve `total` (== PayableAmount) en `ResultadoEmision`; `emitir-manual` y `emitir` (pedido) usan `resultado.total` como monto de la cobranza (antes el bruto crudo, que con cantidades fraccionarias podía diferir 1 céntimo del XML). El preview del frontend ya calculaba el bruto (100.00), así que pantalla/XML/cobranza cuadran sin tocar el frontend.

**Archivos:** `xml-builder.ts` (anclaje + rama pre-set), `index.ts`/`types.ts` (`ResultadoEmision.total`), `emitir-manual` + `emitir` (cobranza usa `resultado.total`), `[id]/nota-credito/route.ts` (NC con importes exactos). `lint`+`build` OK. **Las 189 ya emitidas NO se corrigen** (XML firmado, inmutable y válido); aplica de aquí en adelante. Desplegado a main (commit `2224f9f`, 18 jun 2026). Decisión de diseño: conexipema NO ancla (emite 100.01); Transavic SÍ ancla por decisión de Hugo.

### 🔧 Diagnóstico y recuperación de totales (runbook para errores futuros)

Si vuelve a aparecer un problema con los importes de un comprobante (PDF ≠ SUNAT, cobranza ≠ comprobante, NC rechazada, total que no cuadra), esta es la caja de herramientas:

**Scripts (read-only salvo el backfill con `--apply`; por defecto apuntan a PROD `.env`; para dev: `DATABASE_URL_UNPOOLED="…" node …`):**
- **`scripts/diagnostico-totales-comprobantes.mjs`** — chequeo de salud. Reporta: (1) `monto_total` (DB) ≠ `PayableAmount` (XML); (2) total emitido ≠ bruto intencional (no anclado); (3) cobranza `facturas.monto` ≠ comprobante vinculado. NO escribe.
- **`scripts/backfill-monto-total-desde-xml.mjs`** — corrige (1) y alinea cobranzas NO pagadas. Dry-run por defecto; `--apply` para escribir (respaldo CSV automático en `scratch/`). Idempotente.

**Baseline sano (tras los fixes del 18 jun 2026)** — `node scripts/diagnostico-totales-comprobantes.mjs` debe dar:
- (1) **0** — si sube de 0, el motor está guardando un total distinto al XML → revisar que `emitirComprobante` (`index.ts`) siga usando `calcularTotales` y pasándole el mismo `totales` al builder; correr el backfill.
- (2) **189** (los emitidos ANTES del anclaje, XML inmutable). En comprobantes NUEVOS debe ser **0**: si un nuevo sale "no anclado", el anclaje de `calcularTotales` regresó (revisar el bloque `bruto/valorVenta/IGV=bruto−valorVenta`).
- (3) **16** (todas `Pagada`, 1 céntimo, intencional). Si sube con `Pendiente/Vencida`, la cobranza no tomó `resultado.total` (revisar `emitir-manual`/`emitir`).

**Probar un total contra SUNAT BETA (receta reproducible, sin tocar prod):**
1. `.env.local` ya está en `SUNAT_ENVIRONMENT="beta"`. Lanzar el dev server habilitando el bypass de auth y forzando la credencial de prueba MODDATOS (vacía → el config la usa en beta):
   `VERCEL_ENV=development SUNAT_TRA_SOL_USER= SUNAT_TRA_SOL_PASSWORD= SUNAT_AVI_SOL_USER= SUNAT_AVI_SOL_PASSWORD= SUNAT_ENVIRONMENT=beta npm run dev -- -p 3055`
   (el bypass se bloquea si `VERCEL_ENV=production` o `SUNAT_ENVIRONMENT=production` — por eso los overrides).
2. Emitir con el header `x-bypass-auth: <AUTH_SECRET de .env.local>`:
   `POST http://localhost:3055/api/comprobantes/emitir-manual` con `{tipo:"03", empresa:"transavic", cliente:{numDocumento:"",razonSocial:"PRUEBA"}, items:[{descripcion:"X",unidad:"NIU",cantidad:1,precio_unitario:100}], formaPago:"Contado"}`.
3. La respuesta trae `estado` (`ACEPTADA`/`RECHAZADA`), `xmlFirmadoBase64` y `cdrBase64`. Decodificar el XML (base64→utf8) y mirar `cbc:PayableAmount`/`cbc:TaxAmount`. **Nota:** el bypass NO aplica a la ruta de NC (`/[id]/nota-credito` usa solo `auth()`); para probar una NC, loguearse de verdad o validar la lógica con un script read-only sobre el XML de la factura.

**Señales de alarma → dónde mirar:**
- *El PDF muestra un total distinto a SUNAT* → `[id]/route.ts` debe leer los totales del XML vía `parseCpeTotales` (gotcha #36); correr diagnóstico (1).
- *Un comprobante nuevo no totaliza el precio con IGV tecleado* → anclaje de `calcularTotales` (gotcha #37).
- *NC rechazada 3286 (NC > factura)* → la NC debe copiar `valorVenta`+`montoIGV` exactos del XML de la factura y `calcularTotales` respetarlos (rama pre-set); verificar con el chequeo "NC reproduce el total exacto" (425/425 al 18 jun).
- *SUNAT rechaza un total recién cambiado* → re-validar en beta con la receta de arriba ANTES de tocar el cálculo (la tolerancia del IGV por línea se confirmó así).

**Respaldo de la corrección de datos:** `scratch/backup-comprobantes-2026-06-18.csv` y `scratch/backup-facturas-2026-06-18.csv` (gitignored; estado previo al backfill, por si hay que revertir un valor puntual).

---

## 2026-07-05 — QA integral de los módulos beta + correcciones (sesión de prueba en navegador)

**Contexto:** tras el deploy de la expansión ERP (beta), se probó TODO el flujo real contra la branch `dev-hugo` con un usuario admin de QA (`ClaudeQA`): proveedor → compra → merma → venta rápida → caja (apertura/gasto/arqueo/cierre) → inventario/kardex → préstamo → pago CxP → rentabilidad → consolidado → CRM.

### Bugs críticos encontrados y corregidos (ambos estaban ROTOS en producción)
1. **Compras no registraba nada** (`api/compras`): el guard SQL `AND ${costo} > 0` hacía que Postgres infiriera INTEGER para el parámetro → cualquier costo con decimales (S/ 8.50) reventaba el batch atómico completo (`invalid input syntax for type integer`). Fix: la condición vive en JS y la query de `precio_compra` solo se incluye si costo > 0. Commit `7d2df25`.
2. **Venta Rápida fallaba SIEMPRE** (`api/pos`): el INSERT usaba columnas `lat, lng` que NO existen en `pedidos` (usa `latitude/longitude`); como siempre eran NULL, se eliminaron del INSERT. Bug heredado del código original del módulo. Commit `d3266a9`.

> Lección: el build compilaba verde con ambos bugs. Los flujos nuevos deben probarse E2E en navegador antes de darse por buenos.

### Mejoras aplicadas tras el QA (decisiones de Hugo: "aplica todo, documenta")
- **Caja↔cuenta por id** (`migrate-caja-cuenta-id.sql`, aplicada a dev y PROD): la caja fija `cuenta_id` al abrirse; GET/PUT la usan con fallback al nombre `'Caja Efectivo Planta'` (cajas pre-migración). Antes, renombrar la cuenta rompía el arqueo en silencio.
- **Apertura pisa saldo → ahora es VISIBLE**: se mantiene la semántica "la apertura sincroniza el saldo al conteo físico" (es un arqueo inicial), pero la pantalla de apertura AVISA si la cuenta ya tiene saldo registrado, y la guía instruye "abre la caja ANTES de la primera venta". Si esto no basta en la práctica, la alternativa es registrar una transacción de regularización (pendiente de evaluar con datos reales).
- **Regla documentada del arqueo**: cuenta SOLO el efectivo de la cuenta de la caja; Yape/Plin/banco no entran al conteo (nota agregada a la guía del módulo).
- Gasto de caja: cuenta por defecto = efectivo (antes caía en Yape). POS: cuenta de cobro preseleccionada (efectivo). Compras: las filas vacías ya no bloquean el registro (se ignoran); subtítulo corregido (no hay "pollo vivo"). CxP: concepto sin sufijo "- Sin notas". Cuentas: tipo `billetera` habilitado en UI y zod.

### Pendientes que dejó el QA (revisar más adelante)
- Evaluar si la apertura debe registrar una transacción de regularización cuando pisa un saldo previo ≠ 0.
- El aviso de saldo previo usa el saldo de `/api/cuentas` al montar; si otra persona vende mientras la pantalla está abierta, puede quedar desfasado hasta el siguiente fetch.
- Datos de prueba en `dev-hugo` etiquetados "PRUEBA QA" (proveedor, compra, merma, venta, caja del 5 jul, préstamo, lead) + usuario `ClaudeQA` (admin) — limpiar cuando estorben.

---

## 2026-07-06 — Migración de dominio: transavic.vercel.app → app.transavic.com

**Contexto:** Hugo compró `transavic.com` (Hostinger). Decisión: el ERP vive en el subdominio **`app.transavic.com`** y la raíz `transavic.com` queda RESERVADA para una futura web pública de la marca (patrón `app.conexipema.com`). DNS: un solo CNAME en Hostinger (`app` → `cname.vercel-dns.com`), sin tocar nameservers. Vercel validó y emitió SSL el mismo día.

### Problema encontrado
Con el dominio ya "Valid Configuration", entrar por `app.transavic.com` **rebotaba a `transavic.vercel.app`**: la env `AUTH_URL=https://transavic.vercel.app` en Vercel hacía que NextAuth fijara callback-url y redirects al dominio viejo (verificado con `curl -sI`: `set-cookie __Secure-authjs.callback-url=https%3A%2F%2Ftransavic.vercel.app`).

### Restricción crítica (por qué NO se fijó AUTH_URL al dominio nuevo)
La app del motorizado (Capacitor thin-shell, Google Play) tiene HORNEADO `server.url=https://transavic.vercel.app` en el AAB (v1.0.1/versionCode 2). Capacitor solo permite navegar dentro del host de `server.url`: si NextAuth rebotara al rider hacia `app.transavic.com`, el WebView lo expulsaría a Chrome y **mataría el GPS en background** de los 6 motorizados. Solución: **dual-domain durante la transición**.

### Cambios aplicados (código)
- `src/auth.ts`: **`trustHost: true`** — NextAuth deriva la URL base del host de CADA request (`x-forwarded-host` de Vercel). Ambos dominios sirven auth de forma independiente. Seguro: Vercel solo enruta dominios configurados del proyecto.
- **Vercel: se ELIMINÓ `AUTH_URL`** (no se reemplazó — re-crearla fijaría un dominio único y rompería al otro).
- `package.json` (`app:build:prod`): hornea `CAP_SERVER_URL=https://app.transavic.com`.
- `android/app/build.gradle`: `versionCode 3`, `versionName "1.0.2"`.
- `capacitor.config.ts`: `allowNavigation: ["transavic.vercel.app", "app.transavic.com"]` (red de seguridad: el WebView puede saltar entre ambos hosts sin expulsar al rider a Chrome).
- Docs actualizados: CLAUDE.md §13, AGENTS.md, arquitectura README + 08, guía de build, play-store doc (política de privacidad → `https://app.transavic.com/privacidad`), comentarios en `privacidad/page.tsx` y `network_security_config.xml`.

### Secuencia de despliegue (el ORDEN importa)
1. **Fase 1 (hecha hoy):** deploy con `trustHost` + borrar `AUTH_URL` en Vercel + redeploy → dual-domain activo. Asesoras migran a `app.transavic.com` (re-login una vez; cookies son por dominio).
2. **Fase 2:** AAB v1.0.2 (apunta al dominio nuevo) → Play Internal Testing → riders actualizan (re-login una vez). Actualizar URL de política de privacidad en Play Console.
3. **Fase 4 (⚠️ SOLO tras confirmar que los 6 riders están en v1.0.2):** Vercel → Domains → `transavic.vercel.app` → "Redirect to Another Domain" → `https://app.transavic.com` (307 primero, 308 tras una semana estable). **Activarlo antes de tiempo rompe la app vieja de los riders** (redirect a host fuera de `server.url` sin `allowNavigation` → Chrome externo → sin GPS). Señal de confirmación: los pings de ubicación llegan vía el dominio nuevo en los logs de Vercel.
4. Los crons de `vercel.json` NO pasan por el redirect (invocación interna por path). El webhook de Meta aún no está conectado; cuando se conecte, usar directamente el dominio nuevo.

### Verificaciones
- `curl -sI https://app.transavic.com/api/auth/csrf` → callback-url en el dominio NUEVO; el dominio viejo mantiene el suyo (dual OK).
- Login real en ambos dominios → `/dashboard/nuevo-pedido` sin rebote.
- AAB: `android/app/src/main/assets/capacitor.config.json` con url nueva + `cleartext: false` + AAB firmado, ANTES de subir a Play.
- Google Maps: verificar en Google Cloud Console (cuenta `hugoherreradeveloper@gmail.com`) que la key `NEXT_PUBLIC_MAPS_API_KEY`, si tiene restricción por referrer, incluya `https://app.transavic.com/*` (agregar SIN quitar `*.vercel.app`).

**Rollback:** Fase 1 = re-crear `AUTH_URL` + redeploy (2 min). Fase 4 = desactivar el redirect en el panel (instantáneo). El dominio viejo funciona indefinidamente hasta que se active el redirect — no hay reloj corriendo si un rider tarda en actualizar.

### ✅ ESTADO AL CIERRE DEL 6 JUL 2026 (todo verificado en vivo)

**Aclaración clave (pregunta de Hugo):** ambos dominios son DOS PUERTAS A LA MISMA APP — mismo proyecto Vercel, mismo deploy, misma DB Neon (`ep-cool-sound`). Lo único per-dominio: cookies de sesión (re-login una vez al cambiar) y el `localStorage` del navegador (cola offline, guías vistas).

| Paso | Estado | Evidencia |
|---|---|---|
| DNS Hostinger (CNAME `app` → `cname.vercel-dns.com`, SIN tocar nameservers) | ✅ | Vercel "Valid Configuration" + SSL |
| Código dual-domain (`trustHost`, commits `9cc64af` + `4b1ed3c`) | ✅ | deploy Ready |
| `AUTH_URL` ELIMINADA de Vercel (3 entornos, por CLI) | ✅ | `vercel env ls` sin AUTH_URL; cada dominio sirve su propio login sin rebote (curl verificado) |
| Mapa Google en dominio nuevo | ✅ | La key (cuenta `hugoherreradeveloper@gmail.com`, proyecto "My First Project" `helpful-skyline-466916-i1`, key "Maps Platform API Key") tenía referrer restriction sin el dominio nuevo → se agregó `https://app.transavic.com/*` (manteniendo vercel.app y localhost). ⚠️ El form nuevo de Google OBLIGÓ a restringir APIs: quedó limitada a 5 (Maps JavaScript, Places, Places New, Geocoding, Directions). Si a futuro algo de Maps falla con "ApiNotActivated/denied", revisar esa lista. Verificado: mapa de despacho carga con motos en vivo |
| AAB v1.0.2 (versionCode 3, apunta a `app.transavic.com`, allowNavigation ambos dominios, firmado SHA1 49:51:0D…) | ✅ subido a Play (Prueba interna) por Hugo | `jar verified` + config dentro del AAB inspeccionada |
| Política de privacidad en Play → `https://app.transavic.com/privacidad` | ✅ actualizada por Hugo | — |

### ⏳ LO QUE FALTA (en orden — para retomar en cualquier sesión futura)

1. **Avisar a los motorizados** (grupo WhatsApp, fuera de horario): "actualicen Transavic Reparto desde Play Store (v1.0.2); les pedirá iniciar sesión una vez". **Protocolo de actualización (clave):** actualizar al INICIO de la jornada, CON señal y con la cola offline VACÍA (todos sus pedidos del día anterior ya en Entregado/Fallido en el sistema) — el `localStorage` (cola offline con entregas/fotos sin sincronizar, punto de partida, consentimiento GPS) NO migra al nuevo origin; con la cola drenada, la pérdida es cero.
2. **Confirmar que los 6 están en v1.0.2** — señal fiable: sus pings de GPS (`POST /api/repartidor/ubicacion`) llegan por el host `app.transavic.com` en los logs de Vercel (la app vieja pega por transavic.vercel.app). Alternativa: Play Console → versiones instaladas.
3. **SOLO ENTONCES → activar el redirect**: Vercel → proyecto transavic → Settings → Domains → `transavic.vercel.app` → Edit → "Redirect to Another Domain" → `https://app.transavic.com`, código **307**. ⚠️ Activarlo ANTES rompe la app vieja de los riders (v1.0.1 sin allowNavigation → el WebView los expulsa a Chrome → sin GPS). Rollback: desactivar el redirect (instantáneo, sin deploy).
4. **Tras 1 semana estable**: cambiar 307 → **308** (permanente).
5. **Limpieza final**: quitar los curls del dominio viejo de `.claude/settings.local.json` (líneas 15-19; agregar equivalentes con el dominio nuevo — un intento previo fue bloqueado por permisos del clasificador, hacerlo con el usuario); opcional en un futuro build nativo, retirar `transavic.vercel.app` de `allowNavigation`.
6. ✅ **Auditoría pre-redirect COMPLETADA** (6 jul, workflow con 3 auditores + síntesis). **Veredicto: CERO bloqueantes de código** — +50 fetch verificados todos relativos, logos/PDF/tickets con rutas relativas, next.config/middleware neutros, SUNAT/Brevo/apisperu/Gemini/crons sin dependencia de dominio, `seguimiento-nativo` usa `window.location.origin` (dinámico, correcto). Riesgos operativos y mitigaciones:
   - **Cola offline** (`transavic_offline_queue` + fotos base64): se pierde AL ACTUALIZAR la app (cambio de origin), no al activar el redirect → mitigado con el protocolo del punto 1.
   - **Asesoras en PC** el día del redirect: re-login una vez + pierden favoritos del POS y último proveedor de compras (cosmético, se regenera). Avisar por WhatsApp.
   - **No deployar a main el día que se active el redirect** (evita un race teórico del VersionChecker con reload).
   - Activar el redirect de madrugada (~6:00 AM), sin emisiones SUNAT/GRE en curso, y vigilar el mapa de despacho la primera hora (los 6 GPS deben seguir transmitiendo).
   - NO agregar google.com/waze/whatsapp a `allowNavigation`: que abran fuera del WebView es el comportamiento actual y correcto (el GPS de fondo sigue corriendo).
   - Mejora opcional recomendada antes del redirect: persistir el `host` del request en `rider_locations` (columna aditiva + 1 línea en `/api/repartidor/ubicacion`) para confirmar v1.0.1 vs v1.0.2 por rider con un SELECT, sin depender de logs de Vercel/Play Console.

**Reglas permanentes post-migración:** NO re-crear `AUTH_URL` en Vercel (fijaría un solo dominio y rompería el otro). La raíz `transavic.com` queda RESERVADA para la futura web pública — no conectarla al ERP.

## 2026-07-07 — Módulo "Clientes Avícola" (venta en campo del GG) + panel post-venta del POS

**Origen:** Antonio/Nelita mandaron por WhatsApp el docx "Requerimiento de Implementación — Módulo
Clientes Avícola" (14 puntos). Antonio además definió la **estructura de 3 operaciones de venta**:
(1) venta en campo con cobranza y guía inmediata — el módulo nuevo; (2) ejecutivas → negocios vía
CRM — ya existía; (3) venta rápida en planta (POS) que "debe permitir emitir la guía o comprobante"
— tenía una brecha que se cerró en esta misma tanda. Documento técnico completo del módulo:
[docs/arquitectura/21-clientes-avicola.md](./arquitectura/21-clientes-avicola.md).

**Qué se construyó (módulo 100% independiente — NO toca pedidos/clientes/facturas):**
- Migración `scripts/migrate-clientes-avicola-2026-07-07.sql` (aplicada en `dev-hugo` el 7 jul):
  `clientes_avicola` (con `saldo_anterior` = deuda pre-sistema y `empresa` para el logo),
  `ventas_avicola` (+`venta_avicola_items` peso×precio/kg) y `abonos_avicola` (medio de pago
  efectivo/transferencia/yape/plin/otro + foto webp base64). Anulación soft con motivo en ventas
  y abonos. PK de venta/abono la genera el FRONTEND (idempotencia contra doble-tap en campo:
  pre-check + catch 23505 → 200 con el mismo número de guía).
- Saldo SIEMPRE calculado al vuelo (`src/lib/avicola/saldos.ts`, única fuente):
  `saldo_anterior + Σ ventas − Σ abonos`. La guía reimprimible ancla su estado de cuenta al
  `created_at` de la venta (reimpresión estable, sin doble conteo de abonos del día).
- 11 endpoints admin-only bajo `/api/avicola/*` (clientes, ventas con `sql.transaction` patrón POS
  + correlativo nuevo `guia_avicola`, abonos con 409 blando de sobrepago, liquidación del día,
  dashboard gerencial con rankings y clientes sin comprar 7/15/30 días).
- UI mobile-first bajo `/dashboard/clientes-avicola`: lista con búsqueda client-side y botones
  Vender/Abonar por tarjeta; venta rápida con **último precio por cliente+producto** precargado;
  guía por WhatsApp como JPEG (`html-to-image` + `navigator.share`, clon de ticket-share-modal) con
  toggle "Con precio por kilo | Solo peso y total" (localStorage); ficha 360 con historial y
  reenviar guía; estado de cuenta con PDF (`pdf-estado-cuenta-avicola.ts`); liquidación y panel.
  Sidebar: entrada admin-only Primary+Beta en Ventas & CRM + guía `GuiaModulo`.
- **Decisiones con Hugo:** v1 sin descuento de inventario (confirmar con Antonio cómo carga el
  camión — los kg/día quedan registrados para activarlo luego); solo admin; empresa por cliente;
  sin SUNAT (guía interna); abonos no tocan caja/cuentas; "cotizaciones" del CRM NO se construyen
  hasta confirmar con Antonio.
- **POS planta (brecha op. 3):** el POST /api/pos ya devolvía `pedido_id` pero la UI lo descartaba.
  Ahora tras cobrar aparece un panel "Venta registrada" con: **Imprimir orden** (abre
  `/pedidos/{id}/guia`), **Emitir comprobante** (link a `/dashboard/comprobantes/nuevo?pedido={id}`,
  solo roles admin/asesor) y **Nueva venta**. El camino offline conserva el toast (sin id).
- Construcción orquestada con workflow de 11 agentes en 2 olas; `lint` y `build` limpios.

### Fase 1 de la separación de las 3 operaciones (7 jul, noche — feedback de Antonio probando)
Antonio precisó que el sistema debe reflejar **3 operaciones de venta separadas, cada una un sistema
propio** (🏪 Campo · 🛵 Ejecutivas · 🏭 Planta), **cada una con su propia base de clientes, cobranzas
y cierre**. Empresa: ambas opciones, **por defecto Avícola de Tony (RUC 10)**. Caja: campo sí, planta
sí (maneja efectivo/vuelto), ejecutivas no (cobran por transferencia/Yape). Detalle y fases en el plan.
Cambios de la Fase 1 (bajo riesgo, ya aplicados en `dev-hugo`):
- **Bug POS en celular:** `pos-planta/page.tsx` encerraba todo en `h-[calc(100vh-88px)] overflow-hidden`;
  en móvil el layout apilado recortaba el botón "Confirmar Cobro" sin scroll. Fix: la jaula de alto
  fijo + `overflow-hidden` + scrolls internos ahora aplican **solo en `lg:`+**; en celular la página
  fluye con scroll natural (`pos-client.tsx` líneas del contenedor, catálogo y carrito).
- **Empresa por defecto → Avícola de Tony** en el form de cliente de campo y en el POS (ambos mantienen
  el selector con las 2 empresas).
- **POS fuera de la Lista de Pedidos:** `src/lib/data.ts:fetchFilteredPedidos` excluye
  `COALESCE(origen,'asesor') <> 'pos_planta'` (Antonio vio una venta de planta figurar como "entregado"
  en la lista de ejecutivas). El tablero de Despacho ya lo excluía por estado/repartidor.
- **Proveedores** (`migrate-proveedores-tipo-ruc-opcional-2026-07-07.sql` + API + `proveedores-client.tsx`):
  solo **nombre y teléfono obligatorios**; **RUC opcional** (índice UNIQUE parcial `WHERE ruc IS NOT NULL
  AND ruc <> ''` para permitir varios informales sin RUC); columna **`tipo` (principal/secundario)** con
  selector en el form y badge en la tabla. Verificado en dev: dos sin RUC coexisten, mismo RUC choca.
- **Pendiente Fase 2** (refactor mayor): POS con su propia base de clientes + cobranzas separadas de
  ejecutivas + su caja; caja/cierre de campo; menú en 3 bloques. Y confirmar con Antonio si el cierre
  de campo necesita apertura/arqueo formal o basta el reporte de liquidación.

### E2E del módulo de campo en navegador (7 jul) — 2 bugs cazados y corregidos
Verificación E2E completa en `dev-hugo` con Chrome (sesión de Antonio/admin): crear cliente
(saldo 1250) → venta 2 ítems (960) → guía → abono 500 yape → anular → liquidación → panel. **Todo
cuadró** (saldo 2210 → 1710 → 2210; guía N.º 00000001 con "AVÍCOLA DE TONY" y estado de cuenta
correcto; toggle "Solo peso y total" oculta la columna Precio/kg; liquidación y panel exactos). Dos
bugs encontrados y arreglados en el acto:
1. **Crash en la pantalla de venta** (`[id]/venta/venta-client.tsx` + `page.tsx`): algunos productos
   tienen `precio_venta = NULL` → `(ultimo ?? producto.precio_venta).toFixed(2)` reventaba con
   "Cannot read properties of null". Fix: guardas `?? 0` en las dos lecturas del precio + tipo
   `precio_venta: number | null` + `COALESCE(precio_venta, 0)` en la query del server.
2. **Ticket "Mercado Mercado Central"** (`ticket-guia-avicola.tsx`): la etiqueta "Mercado " se
   anteponía al nombre del mercado, duplicando la palabra cuando el mercado ya se llama "Mercado X".
   Fix: mostrar el nombre del mercado directo, sin el prefijo.
Verificado también en el DOM servido que el fix del POS móvil quedó bien aplicado (el `<main>` del POS
usa `lg:h-[...] lg:overflow-hidden`, sin `overflow-hidden` incondicional). `build` limpio tras los fixes.

### Fase 2 — Separación real de las 3 operaciones (8 jul 2026)
Enfoque decidido tras 2 diseños en paralelo: el POS **sigue escribiendo la venta en `pedidos`** (conserva
GRATIS la orden imprimible y el comprobante SUNAT, que leen de `pedidos`/`pedido_items`) — NO se
reconstruyó como subsistema propio porque eso obligaría a bifurcar el motor SUNAT (gotchas #18-35) y
partir el histórico fiscal. Se separó SOLO lo que se mezclaba: **clientes y cobranzas de planta**
(tablas propias) + **caja por operación**.
- **Tablas nuevas** (`migrate-planta-clientes-cobranzas-2026-07-08.sql`, en `dev-hugo`): `clientes_planta`
  (directorio propio del POS, sin scoping de asesora), `cobranzas_planta` (deuda por venta a crédito,
  aislada de `facturas`), `abonos_planta` (pagos PARCIALES del "saldito"). Ids client-side (idempotencia),
  anulación soft. Saldo al vuelo en `src/lib/planta/saldos.ts`.
- **El POS a crédito** (`api/pos/route.ts`) dejó de escribir en `facturas`: ahora inserta en
  `cobranzas_planta`, con `pedidos.cliente_id=NULL` + `razon_social`/`ruc_dni` denormalizados desde
  `clientes_planta` (para el comprobante), e **idempotencia por `pedido_id` client-side** (la cola offline
  ya no duplica). Selector de cliente del POS → `/api/clientes-planta` con alta rápida inline.
  Como TODOS los consumidores de cobranzas leen de `facturas`, la deuda de planta desaparece de las
  cobranzas/reportes de ejecutivas **sin tocar sus 20+ consumidores**.
- **APIs nuevas**: `/api/clientes-planta` (+[id]), `/api/cobranzas-planta` (+[id]/abono, /anular,
  abonos/[id]/anular, abonos/[id]/comprobante). **Páginas nuevas**: `/dashboard/clientes-planta` y
  `/dashboard/cobranzas-planta` (clones del patrón campo). **Consolidado**: 2ª línea `carteraPlanta`
  separada de la cartera de ejecutivas.
- **Caja por operación** (`migrate-caja-operacion-2026-07-08.sql`): columna `operacion` (planta|campo) en
  `caja_diaria`; se reemplazaron los dos candados (`caja_diaria_fecha_key` + `ux_caja_diaria_unica_abierta`)
  por `ux_caja_diaria_fecha_operacion` + `ux_caja_diaria_unica_abierta_op` → planta y campo abren/cierran
  su propia caja el MISMO día. `api/caja-diaria` acepta `?operacion=` (default planta). **Decisión final de Antonio (8 jul): el CAMPO NO
  lleva caja formal** — su cierre es el REPORTE de liquidación del día (ya construido), no un arqueo de
  efectivo. Por eso el selector Planta/Campo se retiró del UI y `caja-diaria-client.tsx` queda fijo en
  'planta'. El esquema (`operacion` + índices por operación) y la API se conservan por si algún día se
  activa la caja de campo (bastaría reponer el selector). Ejecutivas tampoco tiene caja.
- **Navegación en 3 bloques** (`DashboardLayout.tsx`, rediseñada con la skill de diseño): 🛵 Ventas
  Ejecutivas · 🏪 Venta en Campo · 🏭 Venta en Planta + Producción/Compras + Finanzas + Reportes +
  Configuración. **Cada bloque de operación EMPIEZA con su acción de vender** (botón rojo "lead" DENTRO
  del bloque, ya no suelto arriba): Nuevo Pedido / **Vender en Campo** / Venta Rápida. Así los 3 sistemas
  quedan auto-contenidos y simétricos (`[Vender] → vistas de apoyo`), y queda obvio dónde registrar cada
  venta (antes "Vender en Campo" no existía como entrada). Cobranzas de ejecutivas se movió a su bloque
  (ya no en Finanzas). Los `isPrimary` se renderizan como primer ítem de su grupo, no en un bloque aparte.
- **POS en celular — menos scroll de productos** (`pos-client.tsx`, feedback Hugo 8 jul): la
  `TarjetaProducto` dejó de ser `aspect-square` (cuadrada/alta) y pasó a compacta (`min-h-[76px]`,
  padding/tipografía menores, nombre con `line-clamp-2`); los grids pasaron de `grid-cols-2 gap-4` a
  `grid-cols-3 gap-2` en celular → ~3× más productos por pantalla, mucho menos scroll (desktop igual o
  más denso). Solo estilos, sin tocar la lógica del POS.
- **POS en celular — barra de cobro + hoja del carrito** (`pos-client.tsx`, `/mejora-diseño para celular`,
  8 jul): la fricción real no era la densidad sino que en celular el carrito y el botón "Confirmar Cobro"
  quedaban SEPULTADOS debajo de todo el catálogo — se elegían productos sin ver el total y para cobrar
  había que scrollear toda la lista. Patrón mobile-first estándar de POS: (a) **barra de cobro fija abajo**
  (`lg:hidden fixed bottom-0`, solo cuando el carrito tiene ítems) con contador de productos + total en
  vivo + botón "Cobrar" — el total es visible en todo momento mientras se elige; (b) tocarla abre el
  carrito como **hoja deslizable** (bottom sheet: fondo oscuro, agarradera, "Venta Actual" + X "seguir
  agregando", ítems con scroll interno y checkout completo fijo al pie). **Un solo panel** reposicionado
  por breakpoint (las clases `lg:` lo fuerzan a la columna derecha en desktop; en celular es `hidden` o la
  hoja `fixed` según `carritoAbierto`) → cero duplicación de JSX y **desktop no cambia**. Detalles: padding
  inferior del catálogo (`pb-28 lg:pb-4`) para que la barra no tape productos; `safe-area-inset-bottom` en
  la barra y el botón de cobro (notch/home indicator); el chip de "ventas por enviar" sube a `bottom-24` en
  celular para no chocar con la barra. Solo UI, sin tocar lógica de venta/cobro/offline. Verificado con
  capturas reales a ancho de celular (barra + hoja) y desktop (dos columnas intactas); `tsc` limpio.
- **POS — ítems del carrito aplastados en desktop** (`pos-client.tsx`, `/mejora-diseño` + panel de jueces
  ultracode, 8 jul): al quitar el `min-h-[160px]` en el rediseño móvil, la lista de ítems colapsaba en
  desktop (solo se veía el título del 1er producto, cantidad/precio cortados) porque el checkout
  (`flex-shrink-0`, ~320px: cliente+método+cuenta+notas+total+botón) se comía la columna (altura tope =
  viewport). **Fix estructural (causa raíz):** el panel pasa a 3 zonas hermanas — header fijo · **un único
  scroll** (`flex-1 min-h-0`) que contiene la lista de ítems (sub-div con **piso** `min-h-[180px]`) **y** los
  ajustes (cliente/método/cuenta/notas, movidos aquí tal cual, sin tocar lógica) · **footer anclado**
  (`flex-shrink-0`, ~110px) con SOLO Total + Confirmar Cobro. Como el footer es hermano pequeño del scroll
  (no hijo), el botón **nunca** se aplasta ni se corta, ni en desktop con viewport corto ni en la hoja móvil
  (88vh) — el mismo apretón afectaba un poco al móvil. **Renglón de ítem** rediseñado (mejor propuesta del
  panel): tarjeta de dos pisos, nombre `line-clamp-2` (aguanta "Pechuga de pollo sin hueso deshuesada"),
  inputs `h-11` (44px táctil), y el **subtotal como número prominente** (`text-base font-black tabular-nums`);
  `tabular-nums` en cantidad/precio/subtotal/Total. Ganador = P1 (reparto de espacio) + renglón injertado de
  P2, elegido por un panel de 4 propuestas + juez. Solo UI. Verificado con capturas reales en desktop (ítems
  con aire + Confirmar siempre visible) y en la hoja móvil (mismo renglón, legible); `tsc`/`eslint` limpios.
- **Ejecutivas (op2) intactas**: `clientes`/`facturas`/comprobantes/despacho sin cambios; sin caja.
- **E2E verificado en `dev-hugo`** (navegador logueado): venta a crédito de planta → cobranza en
  `cobranzas_planta` (0 en facturas) → abono parcial S/10 → estado Parcial, saldo S/21.90 → **NO aparece
  en Cobranzas de ejecutivas** → consolidado con `carteraPlanta` separada → caja planta+campo abiertas el
  mismo día (dos de la misma operación siguen bloqueadas). Bug cazado y corregido: `date + unknown` en el
  INSERT de cobranza (faltaba `::int` al plazo). `build` limpio. Datos de prueba eliminados. Nada en producción.

### 🚀 Despliegue a PRODUCCIÓN — 8 jul 2026 (Clientes Avícola + separación 3 operaciones + fixes + rediseño POS)
Commit `5eb7398` a `main` (cuenta HugoHerreraCoach) → Vercel. Todo lo anterior (Fase 1 + Fase 2 + rediseño
POS) pasó de `dev-hugo` a **producción** en un solo lote, con la disciplina de gotcha #17 (migraciones por
psql ANTES del deploy). buildId prod resultante: `ePiVPwx-J1RWAF2uZL31c`.

**🔴 Bug bloqueante cazado ANTES de subir (revisión adversarial con agente Plan) — el más importante de
recordar:** al emitir un comprobante SUNAT **desde una venta del POS** (panel post-venta →
`/dashboard/comprobantes/nuevo?pedido=…` → `/api/comprobantes/emitir`), el endpoint creaba SIEMPRE una
cobranza en `facturas` (`emitir/route.ts:418 debeCrearCobranza`, sin filtrar `origen`; llama a
`vincularCobranzaAComprobante` → `crearFacturaStandalone` → INSERT en `facturas`, que acepta `cliente_id=NULL`).
Como el POS nuevo escribe su deuda en `cobranzas_planta`, esto **DUPLICABA** la deuda (planta + ejecutivas) y
la reinyectaba en la cartera de ejecutivas → rompía el objetivo mismo del deploy (para contado, además, creaba
una factura `Pendiente` fantasma de algo ya cobrado en caja). **Fix:** se añadió `origen` al SELECT
(`emitir/route.ts:116`) y `const esPos = pedido.origen === "pos_planta"` → `debeCrearCobranza = … && !esPos`
(`:423-424`). El comprobante SUNAT se sigue emitiendo; solo se omite la cobranza-fantasma. **Invariante a
preservar (ver gotcha #42):** ningún camino debe crear cobranza en `facturas` para un pedido `origen='pos_planta'`.
Follow-up opcional pendiente: enlazar el `comprobante_id` emitido a la fila de `cobranzas_planta` (la columna ya
existe) para trazar comprobante↔deuda de planta.

**Runbook ejecutado (plantilla para el próximo deploy grande):**
1. **Fix bloqueante** aplicado + `tsc` limpio.
2. **Gate de build:** se detuvo el dev/preview server (comparten `.next`) y `npm run build` en verde (TS strict
   + ESLint; Vercel falla el deploy ante cualquier error, y la working copy combinada nunca se había compilado
   junta). Se reinició el dev después.
3. **Pre-flight solo lectura en prod** (`psql "$DATABASE_URL_UNPOOLED"` desde **`.env.production.local`** —
   host `ep-cool-sound-adxrsjt5`; OJO: `.env.local` apunta a dev-hugo `ep-super-violet`, NO usarla):
   - Confirmado que estábamos en prod (`neondb`) y que `clientes_avicola`/`clientes_planta` NO existían aún.
   - `proveedores`: el UNIQUE de `ruc` se llamaba `proveedores_ruc_key` (lo que la migración esperaba dropear).
   - `caja_diaria`: 0 duplicados por fecha, 0 abiertas, sin columna `operacion` → swap de índices seguro.
   - `facturas WHERE numero_comprobante='POS-CREDITO'` = **0 filas** → NO hubo data-op (mejor caso; si hubiera
     habido crédito POS viejo vivo, se DEJA en `facturas` y la asesora lo cobra por ejecutivas — migrarlo exige
     mapear a `clientes_planta`, trabajo frágil que no va en la ventana del deploy).
4. **Migraciones a prod** con `psql "$PROD_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f …` (cada archivo en UNA
   transacción → el swap de índices de caja es atómico), en orden: `migrate-clientes-avicola-2026-07-07` →
   `migrate-proveedores-tipo-ruc-opcional-2026-07-07` → `migrate-planta-clientes-cobranzas-2026-07-08` →
   `migrate-caja-operacion-2026-07-08`. Las 4 son idempotentes/aditivas y **inertes para el código viejo**
   (tablas nuevas que no toca; `proveedores`/`caja_diaria` con defaults; la caja no usa `ON CONFLICT` por
   nombre, así que dropear `caja_diaria_fecha_key`/`ux_caja_diaria_unica_abierta` y recrear los índices por
   operación preserva el invariante mientras el código viejo escribe siempre `operacion='planta'`).
5. **Verificación de esquema** (con el código viejo aún activo, debe seguir sano): 7 tablas nuevas presentes;
   `proveedores.ruc` nullable + columna `tipo` + `ux_proveedores_ruc` (viejo `proveedores_ruc_key` fuera);
   `caja_diaria.operacion` default 'planta' + `ux_caja_diaria_fecha_operacion`/`ux_caja_diaria_unica_abierta_op`
   (viejos fuera).
6. **Push** `2aea7a1..5eb7398` (70 archivos; verificado que NO se stageó ningún `.env`/credencial) → Vercel.
7. **Verificación post-deploy (automatizada, sin crear datos):** rutas nuevas 401 (existen, protegidas, no
   404); páginas nuevas 307 (redirigen a login, no 404/500); `/api/version` 200 con buildId nuevo. El deploy
   quedó vivo ~32 s tras el push.

**Rollback disponible:** Vercel → Redeploy del deployment previo (`2aea7a1`). La BD **NO se revierte** (todo
aditivo; dropear perdería datos de planta/avícola creados post-deploy) — las migraciones son inertes para el
código viejo, así que revertir SOLO código funciona sobre la BD ya migrada.

**Pendiente de validar por Hugo con una transacción REAL en prod** (no se hizo automáticamente porque crea
datos reales / emite comprobantes SUNAT de verdad): (1) 🔴 venta POS a crédito + emitir comprobante → deuda
SOLO en Cobranzas Planta, 0 filas en `facturas` por ese `pedido_id` (prueba del fix); (2) POS contado + panel
post-venta; (3) Clientes Avícola alta→venta→abono→estado de cuenta; (4) proveedor sin RUC; (5) regresión
ejecutivas: emitir comprobante de pedido normal SÍ crea su cobranza en `facturas`. Si alguna falla, el punto de
partida para depurar es el guard `esPos` en `emitir/route.ts` y las tablas `cobranzas_planta`/`clientes_planta`.

### 🚀 Clientes Avícola — editar peso/precio + fecha retroactiva + rediseño (9 jul 2026, EN PRODUCCIÓN)
Commit `dab54a8` (buildId `cNSO_hKWPG-4Y6IHvqszS`). Pedido de Antonio por video (8 jul): en la mañana Ariana
(producción) sube los pesos; en la tarde el GG cobra EN CAMPO y necesita (1) cambiar el **peso** real, (2)
cambiar el **precio** (él maneja el precio en campo), y (3) registrar ventas de **días pasados** (domingos,
feriados, o cuando la asistente no cargó). Hugo lo implementó con otra IA (sin commitear); yo revisé,
corregí, optimicé el diseño, probé E2E y desplegué.

**Qué se agregó (funciona):** PATCH `/api/avicola/ventas/[id]` edita ítems (peso/precio), observaciones y
fecha de una venta ya creada — recalcula el total en server, transacción atómica (DELETE items → re-INSERT →
UPDATE cabecera), **se bloquea si la venta está anulada** (409), y **audita** `modificada_por`/`modificada_at`.
El GET del mismo route devuelve los ítems crudos para poblar el form. `venta/page.tsx` entra en modo edición
con `?edit=<uuid>` (scoped a `NOT anulada AND cliente_id`). `venta-client.tsx` reusa el MISMO formulario para
crear y editar; el selector de fecha permite retroceder (`max=hoy`, futura NO). El saldo se calcula al vuelo,
así que editar una venta actualiza el saldo solo (sin persistir nada). Esto **cambia la regla original**
"jamás edición" de la gotcha #41 (era una decisión, ahora Antonio pidió lo contrario).

**Revisión del trabajo de la otra IA (para el futuro):** (a) 🔴 un `payload: Record<string, any>` en
`venta-client.tsx` disparaba un **ESLint error que rompía el build de Vercel** — cambiado a `unknown`; (b) 🔴
la migración de auditoría se aplicó como **`.mjs` y contra PRODUCCIÓN** (no dev), porque el `.mjs` usa
`process.env.DATABASE_URL`; reemplazada por `scripts/migrate-ventas-avicola-edit-2026-07-09.sql` (idempotente,
`ADD COLUMN IF NOT EXISTS`), aplicada a dev-hugo para poder probar, y el `.mjs` eliminado (una sola fuente,
convención psql — gotcha #13); (c) 🐛 la proyección de saldo en modo edición **contaba la venta dos veces**
(`saldo_actual + total` sin descontar el total original) → corregido descontando `totalOriginal`.

**Optimización de diseño (skill mejora-diseño):** la fecha dejó de ser una **tarjeta grande** arriba de los
productos y pasó a un **chip compacto en el header** ("Hoy" gris por defecto; ámbar con el día si es
retroactiva) → los productos vuelven a ser lo primero (el 95% de las ventas son de hoy, el caso raro no
estorba al común); **banner de modo edición** ("Editando la guía N.º … · al guardar se reenvía la guía
corregida", ámbar) para no confundir con un alta; en la **ficha**, las 3 acciones por venta pasaron de 3
botones iguales a jerarquía: **Editar = primaria (rojo)**, Reenviar guía secundaria, **Anular discreto**
(fantasma, rojo solo al tocar — la acción peligrosa deja de estar a un toque); números tabulares.

**Prueba E2E real (dev-hugo, navegador logueado):** con un cliente+venta sembrados, se editó por la Ut peso
10→12 kg, precio 10.40→11.50, fecha hoy→8 jul → total 104→**138**, guía regenerada con "Miércoles, 8 de julio
de 2026", y **verificado en la BD**: `total=138`, `fecha=2026-07-08`, `modificada_por/at` seteados, ítem
`peso=12`/`precio=11.5`. Datos de prueba borrados. `tsc`/`eslint`/`build` limpios. Prod ya tenía las columnas
(las aplicó el `.mjs` de la otra IA); el deploy fue solo código. Rollback: Redeploy del deployment previo
(`a18d450`) en Vercel; BD aditiva, no se toca.

### 🐛 El logo no salía en la guía/ticket EN iPHONE — `crossOrigin` sobre un `data:` URL (9 jul 2026)
**Síntoma:** Hugo abre en su **iPhone** la guía de venta avícola (N.º 35, producción) y el ticket sale con un
**hueco blanco** donde va el logo (el resto del ticket se ve perfecto). Sospecha inicial: caché.

**Por qué NO era caché** (descartado con evidencia, no por intuición):
- Los logos existen y se sirven: `public/avicola.jpg` (29 KB), `public/transavic.jpg` (17 KB).
- `guia-avicola-modal.tsx` YA hace cache-bust (`/avicola.jpg?v=${timestamp}`), lo pasa a `dataURL` y lo precarga
  en un `new Image()`. Si esa carga fallara, el modal **se cierra solo** (`onClose()` en el `catch` y en
  `img.onerror`). El modal se abrió → el dataURL cargó bien. **No hay 404 ni caché rancia.**
- El hueco blanco tiene el **tamaño exacto del contenedor** (140×140, `aspectRatio: 1/1`) → el contenedor midió;
  el vacío es el `<img>` de adentro.
- **El mismo modal en Chrome de escritorio SÍ muestra el logo** (verificado en captura). Es específico de WebKit.

**Causa raíz:** el `<img>` del logo llevaba **`crossOrigin="anonymous"` con un `src` que es un `data:` URL**. En
WebKit (iOS: Safari, Chrome, todos) ese atributo fuerza una petición en modo CORS que **falla para `data:` URLs**
→ la imagen nunca carga → `html-to-image` fotografía el hueco. Chrome de escritorio lo tolera. El atributo era
además **inútil**: un `data:` URL es del mismo origen (ni CORS ni *tainted canvas*); quedó de cuando el `<img>`
apuntaba directo a `/avicola.jpg`. Estaba en las 2 únicas apariciones del repo:
`ticket-guia-avicola.tsx:103` y `TicketPedido.tsx:46` → **el ticket de PEDIDOS tenía el mismo bug** (mismo
síntoma en iPhone, nadie lo había reportado).

**Fix:** (a) quitar `crossOrigin` de ambos `<img>` (con comentario para que nadie lo re-agregue); (b) endurecer
la captura: antes de `toJpeg`, `await img.decode()` de las imágenes del ticket, en vez de confiar en un solo
`requestAnimationFrame` + el precargado off-screen (`html-to-image` en iOS es conocido por omitir imágenes no
decodificadas). Aplicado en `guia-avicola-modal.tsx` y `ticket-share-modal.tsx`.
Nota: `ticket-share-modal.tsx:159` pasa un `onLogoReady={() => {}}` **no-op** — el candado de `TicketPedido`
nunca se usó; el `decode()` lo reemplaza de verdad.

**Verificación:** regresión en Chrome de escritorio → la guía se genera con el logo visible (captura). `tsc`,
`eslint` y `build` limpios. **La prueba definitiva (iPhone) la hace Hugo**; si aún fallara, la contingencia es
llamar `toJpeg` dos veces y usar el segundo resultado (workaround conocido de la librería en Safari).
Gotcha #43 en CLAUDE.md.

### 🔎 Buscador de productos en la venta de campo (9 jul 2026, EN PRODUCCIÓN)
Commit `b69de73`. Observación de Hugo mirando la pantalla real: el catálogo tiene **~90 productos** y encontrar
uno era puro scroll — va justo contra la meta del módulo (registrar una venta en **<1 minuto**).
**Fix:** buscador **fijo en el header** (2ª fila del `<header>` sticky, así sigue visible al scrollear la lista
larga) que filtra el catálogo en vivo **por nombre O categoría**: escribir "pollo" trae todos los productos de
pollo (matchea la categoría), "alas" trae solo Alas. Estado "No se encontró …" con botón para limpiar.
Solo UI (`venta-client.tsx`); `tsc`/`eslint`/`build` limpios; verificado E2E en el navegador (al escribir
"pollo" la grilla se reduce a los productos de pollo).

### ⭐ "Lo de siempre", fijados y "Repetir última venta" (9 jul 2026, EN PRODUCCIÓN)
Commit `233b5c8`. **Pedido de Antonio** (WhatsApp, 2:40 a. m.), en dos mensajes que describen el MISMO dolor:
(1) *"marcar productos como favoritos para que los que más vendo aparezcan primero"* **o** (2) *"que al cobrar o
registrar una venta aparezcan rápido los productos vendidos al cliente"*.

**Decisión (Hugo):** hacer **las dos**, pero poniendo primero lo **automático** — el historial por cliente es más
preciso que una lista global (doña Rosa compra alas; el chifa, pechuga) y **no le cuesta mantenimiento**. Orden
elegido: **por frecuencia** (desempate por recencia).

**Lo que se construyó:**
- `venta/page.tsx` — 3 consultas nuevas (la vieja de "último precio" se reemplazó por una agregada):
  (c) historial de ESE cliente agrupado por producto → `COUNT(DISTINCT v.id) AS veces` + último precio vía
  `(ARRAY_AGG(precio_kg ORDER BY created_at DESC))[1]`, `ORDER BY veces DESC, MAX(created_at) DESC`;
  (d) top global del módulo (LIMIT 8) — **solo se usa si el cliente no tiene historial**; (e) ítems de la última
  venta no anulada del cliente.
- `venta-client.tsx` — la grilla se corta en secciones: **Fijados ⭐** → **Lo de siempre** → **Más vendidos**
  (solo clientes nuevos) → **Todo el catálogo**. Cada producto aparece **una sola vez** (un `Set` de "usados").
  Al **buscar**, las secciones se aplanan en una lista filtrada. La **estrella** por tarjeta fija a mano
  (`localStorage` `transavic_avicola_favoritos`, por dispositivo; sin tope, él la controla). Botón **"Repetir
  última venta"**: siembra los productos de la última venta con su precio, **pesos vacíos** y el **foco en el
  primer peso**; solo aparece con el **carrito vacío** (nunca pisa lo ya cargado) y no en modo edición.
- Mobile-first: encabezados de sección de una línea, tarjetas grandes, buscador fijo. La estrella va en la
  esquina de la tarjeta (`pr-9` en el botón para que el nombre no quede debajo).

**Evidencia E2E** (dev-hugo, cliente sembrado con 3 ventas: Alas×3, Pollo entero×2, Pechuga×1):
"Lo de siempre" ordenó **Alas → Pollo entero → Pechuga** (frecuencia correcta, con su último precio);
"Repetir última venta (2 productos)" cargó Alas + Pollo entero con precio, pesos vacíos y foco puesto, y el botón
desapareció al haber carrito; la estrella creó la sección **FIJADOS** y **sobrevivió a recargar la página**;
ningún producto se duplicó entre secciones. `tsc`/`eslint`/`build` limpios. Datos de prueba borrados.
Reglas 8 y 9 del [doc 21](./arquitectura/21-clientes-avicola.md).

**Pendiente de negocio:** que Antonio confirme si el orden **por frecuencia** le cuadra con su realidad de campo
(la alternativa —ordenar por lo más reciente— es un cambio de una línea en la consulta (c)).

**Refinamiento (mismo día, pedido de Hugo): el botón ahora dice QUÉ trae.** Antes solo mostraba el conteo
("Repetir última venta (1 producto)") y había que tocarlo a ciegas. Ahora es un botón de **dos líneas**: la acción
arriba y, debajo, hasta **2 nombres de producto truncados** + una **píldora con el TOTAL** ("3 productos"). Sin
consultas nuevas (`producto_nombre` ya venía en `ultimaVentaItems`). Dos decisiones no obvias, que salieron de
**mirar el caso peor** en pantalla (nombres del catálogo larguísimos, ej. "Corazón de res para anticucho por
entero (peso aprox 1 kg)"): (a) la píldora va con `shrink-0` para que **nunca** se recorte —si se truncara, el
usuario no sabría que hay más productos—; (b) se muestra el **total** y NO "+N restantes", porque con el texto
truncado un "+1 más" haría creer que son 2 cuando son 3 — **el total nunca miente**. Con 1 solo producto no se
pinta la píldora (sería ruido). `aria-label` lleva la lista completa, porque la línea visible va truncada.
Verificado a ancho de celular en los dos extremos (3 nombres largos y 1 solo): el botón mantiene su alto y nada
se desborda; el clic sigue cargando los productos con precio, pesos vacíos y foco en el primero.

### 🛒 Compras: devoluciones al proveedor, ítems de servicio y saldo anterior (9-10 jul 2026 — pedidos de Nelita)
**Pedido de Nelita** (registra el ingreso de mercadería en planta; WhatsApp con foto de la pantalla): (1) un ítem
"pelada de pollo" en el selector de productos; (2) un ítem de **devoluciones** por proveedor "que reste el monto
de la guía al agregar fila"; (3) dónde ingresar los **saldos anteriores** de cada proveedor ("no veo en qué parte
pueda hacer eso" — no existía). Decisiones de Hugo: pelada = **servicio que cobra el proveedor** (suma a la
deuda, SIN inventario); devolución = **resta deuda + inventario**.

**Diseño** (detalle en [doc 09 §3.1b y §3.2b](./arquitectura/09-compras-inventario-mermas.md)):
- **Devoluciones**: columna `compra_items.tipo` (`ingreso`|`devolucion`, CHECK) + toggle por fila en la UI (fila
  tinteada roja, total con signo −, footer con desglose Ingresos/Devoluciones). El subtotal se guarda NEGATIVO
  pero los **pesos siempre positivos** (el signo vive en `tipo`). Inventario `−neto` con kardex nuevo
  **`devolucion_compra`**. Guardas: total de guía < 0 → 400; total == 0 → compra sin cuenta por pagar.
- **Servicios**: se detectan por **categoría `/servicio/i`** del producto (server-side autoritativo; cubre la
  categoría existente "SERVICIO DE ENVIO"). En la fila: jabas/tara deshabilitados, el bruto actúa como
  CANTIDAD ("Cant.", neto en `uni`), nota índigo explicativa. NO tocan stock/kardex ni `precio_compra`.
  **"Pelada de pollo"** se siembra en la migración (categoría `Servicios`, unidad `uni`, código SRV001).
- **Saldo anterior de proveedor**: fila de `cuentas_por_pagar` con `compra_id NULL` + columna nueva
  **`concepto`**. Botón "＋ Deuda anterior" en CxP (admin-only, coherente con los pagos) → modal proveedor/monto/
  vencimiento opcional/concepto (`POST /api/cuentas-por-pagar/deuda`). Se paga con el flujo normal SIN tocarlo
  (esa es la gracia del modelo). Badge índigo con el concepto en la lista, y `DELETE /api/cuentas-por-pagar/[id]`
  solo para manuales sin pagos (409 en el resto). Se activó el fallback "Carga Manual / Sin Doc" que era código
  muerto. Fix colateral: vencimiento NULL mostraba "01/01/1970" → ahora "—".
- Migración **`migrate-compras-mejoras-2026-07-09.sql`** (idempotente: tipo + CHECK, concepto, seed pelada).
  Aplicada a dev-hugo; **a prod por psql ANTES del deploy**. Guías de módulo actualizadas (compras y CxP).

**Verificación E2E en dev-hugo** (navegador logueado, guía QA-DEV-001 con las 3 clases de fila a la vez):
pollo 100kg/10 tara × S/5 (+450) + pelada 90 uni × S/0.50 (+45) + devolución 10kg × S/5 (−50) → UI mostró
Ingresos 495 / Devoluciones −50 / **Total 445** y en DB: `compras.total=445`, ítems con tipos y subtotal −50,
deuda 445 Pendiente, stock pollo 40+90−10=**120**, kardex `compra +90` y `devolucion_compra −10`, **cero
movimientos de la pelada**. Guarda probada: guía solo-devolución → 400 con mensaje claro. CxP: deuda manual
S/1000 → pago parcial S/20 (estado **Parcial**, restante 980; validación de fondos activa) → DELETE con pagos →
**409**; DELETE de manual sin pagos → OK. Datos de prueba revertidos (stock, caja, precio_compra).
`tsc`/`eslint`/`build` limpios. **Aún NO desplegado a producción** (pendiente OK de Hugo: psql + push).


## 2026-07-10 — Flexibilización v1: el admin gestiona datos maestros y parámetros sin programador

**Pedido de Hugo**: tras ver que los productos "por defecto" no se podían tocar, pidió auditar TODO el sistema
(sobre todo los módulos Beta) para que desde el frontend se pueda crear/editar/eliminar y mover parámetros del
negocio. Auditoría con 7 agentes (matriz CRUD de 20+ entidades, 11 hardcodeos, 2 bugs, 1 hueco de seguridad).
Alcance elegido: **bugs + seguridad + página Configuración + 12 quick wins**; lo grande (editar/anular compras,
etapas CRM) quedó para una sesión con Antonio.

### Bugs corregidos (los 2 de la auditoría + 1 cazado por el E2E)
1. **`fechaPago` descartada** (`api/cuentas-por-pagar/route.ts`): el usuario elegía la fecha del pago y el CTE
   registraba "hoy". Fix: columna `transacciones.fecha DATE` (migración) + INSERT con
   `COALESCE(fechaPago::date, hoy Lima)` + zod `regex(YYYY-MM-DD)`. Verificado E2E: pago retro del 05/07 →
   `transacciones.fecha = 2026-07-05`.
2. **POS no descontaba stock si el producto no tenía fila de lote** (`api/pos/route.ts` hacía `UPDATE` a secas
   → 0 filas afectadas en silencio). Fix: upsert `INSERT … ON CONFLICT (producto_id) DO UPDATE` (igual que
   compras). Verificado E2E: venta de producto sin fila → fila creada con `-2.00` + kardex `venta_pos`.
3. **`POST /api/transacciones` devolvía 500 SIEMPRE** (cazado por el E2E de "Ajustar saldo"): el
   `CASE WHEN ${tipo}='ingreso' THEN ${monto} ELSE -${monto}` sobre parámetros rompía la inferencia de tipos
   del driver HTTP de Neon (mismo mal que el batch de compras, ver crónica 9-10 jul). Fix: el signo se decide
   en JS (`delta`) y va un solo parámetro con `::numeric`. Regla de la casa reafirmada: **nunca CASE/comparación
   sobre parámetros en SQL de Neon — decidir en JS**.

### Seguridad — B1: usuarios se DESACTIVAN, jamás DELETE
- Migración: `users.activo BOOLEAN NOT NULL DEFAULT TRUE`.
- `src/auth.ts:authorize`: `if (user.activo === false) return null` → login bloqueado (el `SELECT *` de
  `getUser` ya trae la columna).
- `GET /api/users`: oculta inactivos por default; `?incluir_inactivos=1` (solo admin) los muestra.
- `PATCH /api/users/[id]`: acepta `activo`; **auto-desactivación bloqueada** (400 "No puedes desactivar tu
  propio usuario", verificado E2E). El DELETE con historial (409) ahora sugiere desactivar.
- UI `/dashboard/users`: botón Desactivar (ámbar, con confirm) / Reactivar (esmeralda), fila atenuada + badge.
- E2E: crear usuario → desactivar → oculto sin flag → guard self → reactivar. El bloqueo de login se verificó
  a nivel de código+columna (no hay endpoint HTTP de credenciales: el login va por server action).

### B2 — `/dashboard/configuracion` + `src/lib/parametros-negocio.ts` (nuevo patrón)
Los parámetros del negocio viven en **`settings.parametros_negocio`** (whitelist en `api/settings`) con
**fallback a los valores históricos hardcodeados** — sin la clave, todo se comporta EXACTO igual que antes.
Fuente única `src/lib/parametros-negocio.ts`: `leerParametrosNegocio(sql)` (server), `fetchParametrosNegocio()`
(cliente), `normalizarParametros` (nunca lanza). Página admin-only con chips (listas) y números (umbrales).
Parámetros v1 y sus consumidores recableados:
| Parámetro | Default (histórico) | Consumidor |
|---|---|---|
| `categorias_gasto` | Almuerzo…Otros | Caja Diaria (select de gasto) + página Gastos (filtro) |
| `tipos_doc_compra` | Guia/Factura/Boleta/Recibo | Compras (select Tipo Documento) |
| `margen_bueno_pct` / `margen_regular_pct` | 25 / 15 | semáforo del Catálogo |
| `merma_alta_pct` | 10 | alerta en Calculadora de Mermas |
| `rendimiento_fallback_pct` | 80 | Rentabilidad sin mermas registradas |
| `cortes_deuda_avicola` | 7/15/30 | buckets de antigüedad del panel Campo |
E2E: guardar con categoría "PRUEBA FLEX" + umbrales cambiados → persiste, la página los recarga, el filtro de
Gastos muestra la categoría nueva, rentabilidad/panel avícola responden 200. (La clave se removió al final para
dejar dev en fallback puro.)

### Tanda A — los 12 quick wins
- **A2 Reactivar producto**: `GET /api/productos?incluir_inactivos=1` (admin) + toggle "Ver productos
  desactivados" + botón Reactivar en el Catálogo. E2E: 85 activos / 93 con inactivos.
- **A3 Inventario**: `JOIN → LEFT JOIN productos` — un producto nuevo aparece con stock 0 para ponerle stock
  inicial con el ajuste ± existente. E2E: 85 filas (= todos los activos).
- **A4 Página Gastos** (`/dashboard/gastos`, admin+produccion, sidebar Finanzas): KPIs hoy/mes, filtro por
  categoría (dinámicas de settings ∪ presentes) y rango de fechas (server-side), tabla+tarjetas, "Registrado
  por". El `GET /api/gastos` (huérfano) ganó `?desde/hasta`, campo `fecha` ISO y límite 500.
- **A5 Desactivar proveedor y cuenta bancaria**: `proveedores.activo` (migración) + badge/atenuado + selects
  filtran activos; `PATCH /api/cuentas` (rename + activa) con **guards de nombres reservados de Caja Diaria**
  ("Caja Efectivo Planta"/"Campo": ni renombrar, ni renombrar-hacia, ni desactivar — 409; E2E verificado).
- **A6 Plazo de pago POR proveedor**: `proveedores.plazo_pago_dias` (default 30) + campo en la ficha; el
  vencimiento de la compra ya no es +30 fijo. E2E: plazo 12 → compra del 10/07 vence 22/07.
- **A7 Ajustar saldo bancario**: `POST /api/transacciones` ganó guard admin-only y alimenta el modal "Ajustar
  saldo" en Cuentas (Sumar/Restar + motivo obligatorio, concepto "Ajuste manual: …"). E2E: +55.5/−5.5 → saldo 50.
- **A8 Mermas con fecha retroactiva**: input date (max hoy) en la calculadora; el backend ya aceptaba `fecha`.
- **A9 Corregir deuda manual CxP**: `PATCH /api/cuentas-por-pagar/[id]` (monto/vencimiento/concepto — el
  vencimiento acepta NULL explícito) con los MISMOS guards del DELETE (solo `compra_id NULL` y sin pagos, 409
  si no); lápiz en la fila reusa el modal "Deuda anterior" en modo edición (proveedor fijo: si está mal, se
  borra y se re-registra). E2E completo incluido el 409 sobre deuda de compra.
- **A11 Corregir préstamo (contra-asiento)**: botón en el kardex del modal Historial que registra el movimiento
  INVERSO (mapa `TIPO_INVERSO` verificado contra la aritmética del route: OTORGADO↔DEV_RECIBIDA,
  RECIBIDO↔DEV_OTORGADA) con las mismas cantidades y nota "Corrección del movimiento del …". El kardex es
  inmutable: NUNCA editar filas. E2E: +7 jabas → corrección → saldo neto 0.
- **A12a Nueva categoría al EDITAR producto**: el modal de edición ganó la opción "➕ Nueva categoría…" (solo
  existía al crear).
- **A12b Corregir abonos**: `PATCH /api/avicola/abonos/[id]` y `PATCH /api/cobranzas-planta/abonos/[id]`
  (monto/medio_pago/observaciones; 409 si el abono —o su cobranza— está anulado; planta re-deriva el estado
  con `recalcularEstadoCobranza`). UI: botón "Corregir" en el historial de la ficha avícola (planta no lista
  abonos individuales — API en paridad con su `anular`, UI cuando exista esa vista). E2E ambos: saldos
  recalculados al centavo + 409 sobre anulado.
- Guías de módulo nuevas/actualizadas (`guias-modulos.ts`): gastos, configuracion, cuentas (+ajustar saldo),
  compras y CxP ya actualizadas el 9-10 jul.

### Migración
**`scripts/migrate-flexibilizacion-2026-07-10.sql`** (idempotente/aditiva, inerte para el código viejo):
`users.activo` · `proveedores.activo` · `proveedores.plazo_pago_dias` · `transacciones.fecha`. Aplicada a
dev-hugo; **a prod por psql ANTES del deploy** (junto con `migrate-compras-mejoras-2026-07-09.sql` de Nelita).

### Verificación
E2E por API con sesión real (navegador logueado, patrón de la casa) + aserciones psql en dev-hugo para TODO lo
anterior; páginas Configuración y Gastos verificadas renderizando en el navegador. **Datos de prueba 100%
revertidos** (query de restos = 0; cuentas/lotes/saldos/plazo restaurados). `tsc` + `eslint` + `npm run build`
limpios. **Deliberadamente NO tocado**: empresas fijas, roles, tipos de movimiento de préstamos, estados, IGV,
kardex/transacciones inmutables (corregir = contra-asiento), defaults de empresa por módulo.

**Aún NO desplegado a producción** — sale TODO JUNTO con el changeset de Nelita (decisión de Hugo): psql de las
2 migraciones → commit → push, con su OK.

## 2026-07-10 — Videos de Antonio: reprogramar pedidos + venta de campo v2

Dos videos del 9 jul analizados con frames (ffmpeg) + transcripción local (Whisper).

### Video 1 — Reprogramar pedidos (con Ariana, desde /dashboard/produccion)
**Pedido**: cuando un pedido no se puede entregar, reprogramarlo al día siguiente o marcar "se
enviará más tarde" desde la Lista de Pedidos, con la marca VISIBLE para producción y asesoras.
**Implementado** (detalle en [doc 04 §5](./arquitectura/04-maquina-estados.md)):
- Migración `migrate-reprogramar-2026-07-10.sql`: `pedidos.reprogramado_de/at/motivo` (aditiva).
- `POST /api/pedidos/[id]/reprogramar` (admin o asesora dueña; Entregado → 409; fecha pasada/misma
  → 400; refine "exactamente uno" de nueva_fecha|mas_tarde). Con `nueva_fecha` y estado
  Asignado/En_Camino/Fallido → reset COMPLETO a Pendiente (12 columnas de reparto limpias) para
  que salga de la ruta de hoy; con `mas_tarde` no toca fecha/estado/reparto. Auditoría en
  `pedido_ediciones` + notificación `pedido_reprogramado` a la asesora (tipo nuevo en
  `lib/notificaciones.ts`).
- UI: ítem "Reprogramar" en el menú ⋮ de la Lista (modal: Para mañana / Elegir fecha / Más tarde
  + motivo), badges naranja "Reprogramado · era DD/MM" y ámbar "Se envía más tarde" en Lista
  (tarjeta+tabla, `EstadoBadge`) y en Producción (SELECT del GET + tarjeta). Resumen/Despacho sin
  cambios (filtran por fecha; el reset saca el pedido del kanban).
- E2E dev-hugo: Pendiente→mañana (badge+motivo en producción de mañana ✅), Asignado→mañana
  (12 columnas verificadas NULL/FALSE por psql y fuera del kanban ✅), más tarde (fecha intacta ✅),
  guards 400/409 ✅, auditoría (3) y notificaciones (3) ✅, modal y badges verificados en navegador.
  Hallazgo colateral (no bug): con la pestaña OCULTA el dashboard queda en "Cargando dashboard…"
  — es `usePollingVisible` pausando el fetch, comportamiento esperado del ahorro de cómputo Neon.

### Video 2 — Venta de campo v2
**Pedidos**: (1) "Guardar" separado de "enviar guía" (en la mañana solo registran peso);
(2) la venta del día visible al llegar a cobrar para ajustar peso/precio rápido; (3) favoritos /
productos del cliente primero — **ya estaba desplegado** (233b5c8, 21:30 del 9 jul; el video es de
las 20:22); (4) botón "Actualizar" sin obligar a enviar.
**Implementado** (detalle en [doc 21 §5b](./arquitectura/21-clientes-avicola.md)): footer con dos
botones (Guardar/Actualizar primario; "… y enviar guía" secundario), destinos por modo (crear →
lista para encadenar clientes; editar → ficha del cliente), banner de edición "enviar la guía
corregida es opcional", tarjeta "Venta de HOY" en la ficha con "Ajustar peso/precio" y "Enviar
guía", y "Reintentar" que repite el modo exacto del último intento.
- E2E dev-hugo en navegador: Guardar → sin modal, a la lista, venta en DB ✅; ficha muestra la
  tarjeta con la guía y los 2 botones ✅; editar → dos botones "Actualizar"/"Actualizar y enviar
  guía", banner nuevo, secciones Fijados/Lo de siempre TAMBIÉN en edición, tacho por ítem ✅;
  Actualizar → vuelve a la ficha sin modal con el total corregido ✅; "Enviar guía" de la tarjeta
  abre el modal ✅. Datos de prueba revertidos (restos = 0). `tsc`/`eslint`/`build` limpios.

**Deploy**: migración aplicada a prod por psql ANTES del push (columnas inertes para el código viejo).

## 2026-07-11 — Fix: la guía de campo no reflejaba abonos hechos otro día (caso Vicki)

**Reporte de Antonio** (audio): cargó un abono de S/1,300 a Vicki (Mdo Lobatón) en la madrugada,
pero la guía seguía mostrando el saldo anterior; "ayer sí se actualizaba al instante".

**Diagnóstico (datos reales de prod, solo lectura):** el abono SÍ se guardó (`fecha=2026-07-10`,
02:36 a.m. Lima). El saldo REAL del cliente (`estadoCuentaCliente`) siempre estuvo bien. El bug
estaba SOLO en el número que imprimía la guía: `estadoCuentaParaGuia` (`src/lib/avicola/saldos.ts`)
partía los abonos en `saldo_previo` (`created_at < venta`) y `abonos_del_dia` (`fecha = v.fecha AND
created_at >= venta`). Un abono hecho un día POSTERIOR a la venta no caía en ninguno de los dos → se
volvía invisible en esa guía. A la hora del reporte, la última venta de Vicki era la N.º 54 (09/07);
su guía mostraba **S/15,197.80** en vez de **S/13,897.80** (diferencia = los S/1,300 exactos). "Ayer
funcionaba" porque el abono y la venta eran del mismo día.

**Fix (solo código, sin migración — el saldo se calcula al vuelo, corrige todas las guías al
re-render):** `abonos_del_dia` → **`abonos_aplicados`**, ahora una ventana por `created_at`: abonos
posteriores a la venta y anteriores a la SIGUIENTE venta no anulada del cliente (sin filtrar por
`fecha`). Las dos ventanas (`saldo_previo` <, `abonos_aplicados` >=) se parten sin solaparse — el
`fecha` era una sobre-restricción que nunca hizo falta para evitar el doble conteo. Etiqueta del
ticket "Abonos de hoy" → "Abonos". Archivos: `saldos.ts`, `types.ts` (EstadoCuentaGuia), 
`ticket-guia-avicola.tsx`.

**Verificado:** simulación contra los 3 registros reales de Vicki (venta 54: 15,197.80 → 13,897.80;
ventas 20 y 83 sin cambio) y reproducción en dev con seed (última venta 2,000 → 1,700 = saldo real;
caso mismo-día 1,300 sin regresión; las guías encadenan: saldo_actualizado de una venta ==
saldo_previo de la siguiente). La última venta siempre queda == `estadoCuentaCliente`. tsc/eslint/
build limpios. (La confirmación por la API en vivo quedó pendiente por caída de la extensión del
navegador; la query probada por psql es idéntica a la del código.)

## 2026-07-11 — Compras: insumos (arcos/oferta/mandil) + "Nuevo producto" autoservicio

**Pedido de Nelita (admin):** en Compras faltaban ítems que usa seguido — **arcos, oferta, mandil**;
"lo demás" lo mete en el genérico "producto adicional". El form de Compras obliga a elegir un
producto del catálogo (sin texto libre) y crear uno la mandaba a otro menú (Catálogo) → fricción.

**Implementado:**
- **Helper compartido `src/lib/compras-lineas.ts:esLineaSinPeso`** — extrae y generaliza el
  `esCategoriaServicio` que estaba DUPLICADO en `compras-client.tsx` y `api/compras/route.ts`. Ahora
  matchea `/servicio|insumo|adicional/i`: además de los servicios (Pelada/ENVIO), los **Insumos** y
  el "producto adicional" se cargan cantidad × precio, sin pesar ni tocar inventario/kardex/
  precio_compra. (Solo afecta compras futuras — las filas guardadas no cambian.)
- **Botón "➕ Nuevo producto" en el form de Compras** (solo admin — `esAdmin` desde el server;
  `POST /api/productos` es admin-only y Nelita es admin): mini-modal nombre/categoría(default
  Insumos, con "➕ Nueva categoría…")/unidad → crea el producto, lo agrega al selector y lo
  auto-selecciona en la fila. Reusa `SearchableSelect` sin tocarlo. Autoservicio: no vuelve a
  pedírnoslo. `POST /api/productos`: categoría "Insumos" → prefijo de código `INS`.
- **Seed `scripts/seed-insumos-compras-2026-07-11.sql`** (idempotente, solo data): Arcos/Oferta/
  Mandil, categoría "Insumos", unidad "uni", códigos INS001-003. Aplicado a dev y prod por psql.

**Verificado:** unit test del helper (9/9 categorías); simulación fiel del loop de ítems del backend
para una compra mixta (mandil Insumos → sin inventario/precio_compra, subtotal 96 = 12×8; pollo →
con inventario, 46×10 = 460; total 556); seed en dev y prod (INS001-003). tsc/eslint/build limpios.
(La confirmación por click en el navegador quedó pendiente por caída de la extensión de Chrome; el
comportamiento del backend es idéntico al de los servicios ya probados —gotcha #44— y el helper está
unit-verificado.) Sin cambio de esquema. Detalle: gotcha #44 (ampliado).

## 2026-07-11 — Clientes Avícola: 3 mejoras (Enviar estado de cuenta · rediseño Estado de Cuenta · una guía por día)

Pedido del equipo (venta de campo). Mapa con 4 lectores; sin cambio de esquema.

**C1 — Botón "Enviar" en la fila del abono** (`ficha-client.tsx`): junto a Corregir/Anular, un botón
"Enviar" que abre el Estado de Cuenta ya actualizado (la ficha se recarga tras el abono) para
compartirlo por WhatsApp. Prop `onEnviarEstado` en `MovimientoRow` → `setModalEstado(true)`.

**C2 — Rediseño del Estado de Cuenta** (`estado-cuenta-modal.tsx`, `pdf-estado-cuenta-avicola.ts`,
nuevo helper `src/lib/avicola/estado-cuenta.ts`): libro mayor POR DÍA con **filtro por período
(Desde–Hasta)**, columnas Fecha · Venta del día · Peso/Producto · Monto del día · Saldo anterior ·
Abonos · Saldo actual, **totales del período** (vendido, abonado, saldo pendiente final) y **toggle
Con precio / Sin precio**. El helper `construirEstadoCuenta` es la fuente ÚNICA (modal↔PDF) y calcula
el saldo de arranque del período como `saldo_anterior + Σ(fecha<desde)` → un "hasta" en el pasado da
el saldo correcto al cierre (el PDF viejo lo anclaba a `saldo_actual` all-time). Verificado: unit
test contra los datos reales de Melissa (vendido 462.28, abonado 656.00, saldo 479.98; "hasta 08/07"
→ 502.58) y **render headless del PDF revisado visualmente** (7 columnas alineadas, montos a la
derecha, bloque de totales).

**C3 — Una guía por día + tarjeta "guía del día"** (`venta/page.tsx`, `ficha-client.tsx`,
`historial.ts`, `types.ts`): decisión de Hugo = **una sola guía por día, estricto**. En el server,
si no viene `?edit=` y existe una venta de HOY no anulada del cliente, se carga ESA venta en modo
edición (cubre TODAS las entradas a "Vender"); se agregan/editan/eliminan productos con el PATCH
existente (reemplaza ítems, recalcula total, conserva `numero_guia`). Sin tocar el POST (idempotencia
por `id` intacta) ni el esquema. La tarjeta "Venta de hoy" ahora muestra **productos + pesos, hora
(HH:mm Lima) y usuario creador** (nuevo `creado_por_nombre` en `historial.ts` vía JOIN users +
`MovimientoAvicola`); el botón "Vender" del héroe se rotula "Agregar a la guía" cuando ya hay venta.
Verificado en dev: la query detecta la venta del día y el historial trae el usuario. Datos verificados
en prod: 99% ya era una venta/día (1 de 86 con 2). tsc/eslint/build limpios.

### Addendum C3 — la guía del día también en la pantalla de VENDER (11 jul 2026)
El equipo entra a vender por el botón "Vender" de la lista (`lista-client.tsx:250` → `/[id]/venta`
directo, no a la ficha). Se agregó el panel "Guía de hoy" al TOPE de esa pantalla cuando ya hay una
venta de hoy: N.º de guía, fecha, **hora de creación** y **usuario que la creó** (el `page.tsx` ahora
trae `created_at` + `creado_por_nombre` vía JOIN users en `ventaExistente`); los productos/pesos ya se
precargan y el total está en el footer. Si se edita una venta de un día pasado (`?edit` del
historial), el copy sigue siendo "Editando la guía … del DD/MM". Verificado por psql (detección +
hora/usuario/items). La ficha ya tenía la tarjeta; esto cubre el camino de "Vender".

## 2026-07-12 — Cierre de facturación de Campo y vistas generales

El pase que notas anteriores describían como “solo `dev-hugo`” quedó cerrado el 12
de julio. Se aplicaron por `psql`, antes del código, las migraciones de facturación
de Campo, reemisión de CPE rechazado y NC con reintento único. Después se desplegaron
las vistas separadas/general de ventas y facturación. Campo no crea deuda en
`facturas`; conserva su cartera y sus abonos propios.

Esta adenda actualiza el **estado de despliegue** sin borrar la cronología de diseño,
pruebas y decisiones de las entradas anteriores.

## 2026-07-13 — Paquete operativo: implementación y validación en desarrollo

Se preparó la rama `codex/cambios-operativos-julio` con cuatro bloques:

1. **Ventas de Ejecutivas:** total confirmado desde pedidos del canal asesor,
   completamente valorizados con `subtotal_real`; detalle conciliable e idempotencia
   por UUID. La auditoría reprodujo el 12/07 (27/23/4, S/9,662.39) y el corte de
   la captura del 13/07 (36/10/26, S/3,237.08). Una lectura final del día 13 ya
   mostraba 46/10/36 y el mismo total confirmado: los diez posteriores seguían
   pendientes de peso.
2. **Proveedores:** libro de pagos y aplicaciones, pagos múltiples separados,
   distribución FIFO, anticipos, consumo en deudas futuras, anulación por
   contraasiento, ficha financiera y PDF A4.
3. **POS Planta:** costo de compra histórico capturado por el servidor, detalle por
   producto/peso/precio/costo, tipo de pago original y totales redondeados por línea.
4. **Producción:** reprogramación exclusiva para mañana, con auditoría y notificación
   emergente idempotentes a la ejecutiva responsable.

Las migraciones de Proveedores y costo POS se aplicaron y reejecutaron únicamente en
`dev-hugo`; el verificador financiero quedó en `0/0/0/0`. Se probaron concurrencia,
anticipos, pago de S/18,500, replay de UUID, costo POS inmutable, reprogramación,
typecheck, lint y suite dirigida. El PDF de proveedores se renderizó en dos páginas
A4 y se revisó visualmente sin cortes. **Producción no fue modificada.**

Correcciones de estado a notas históricas:

- el CDR vigente se descarga como **ZIP crudo de SUNAT**, no como XML extraído;
- RawBT ya forma parte del código desplegado; solo queda pendiente la validación
  física con el celular y la ticketera real;
- los mensajes listos para soporte viven en
  [`soporte/cambios-2026-07-13.md`](./soporte/cambios-2026-07-13.md) y no deben
  enviarse antes del despliegue autorizado.

## 2026-07-20 — Reconciliación SUNAT 01/03: incidente, recuperación y producción

**Origen del cambio:** la factura F002-412 recibió primero el Fault 0140, “Existe un
Documento igual en Proceso”. La aplicación lo mostró como rechazo definitivo y se
generó F002-413. La verificación posterior, de solo lectura, confirmó que SUNAT había
aceptado **ambas** facturas. El XML, la firma y los totales no eran la causa: faltaba
distinguir una respuesta temporal de un rechazo tributario y consultar el mismo número.

Se implementó una corrección acotada al postenvío de factura `01` y boleta `03`:

- 0140, fallos de transporte/HTTP 5xx, respuesta vacía y CDR ilegible quedan
  `por_confirmar`, con un mensaje explícito de **no emitir otro comprobante**;
- para factura `01` serie F, `billConsultService.getStatus` consulta el
  RUC/tipo/serie/número ya guardado y `getStatusCdr` recupera después la constancia;
- para boleta `03` serie B, la API REST Consulta Integrada busca por
  RUC/tipo/serie/número + fecha de emisión + monto exacto; `estadoCp=1` confirma
  aceptación, `2` anulación y `0` exige otra consulta independiente;
- el cron `/api/cron/reconciliar-cpe-sunat` corre cada 5 minutos en lotes pequeños y
  el botón **Verificar ahora** usa la misma lógica y el mismo claim de consulta;
- la lista refresca pendientes visibles y diferencia claramente Por confirmar,
  Aceptado/Observado y Rechazado;
- un claim por pedido impide consumir otro correlativo mientras el primer CPE está
  `emitiendo` o `por_confirmar`; la aceptación tardía aplica una sola vez los efectos
  internos de Ejecutivas/Planta y no crea `facturas` para Campo;
- dos respuestas `0011` SOAP (01) o dos `estadoCp=0` normalizados a `0011` (03),
  separadas después de la espera, llevan a `no_registrado`; solo ese resultado
  habilita reenviar la misma fila, XML y número;
- Consulta Integrada no entrega CDR ni estado de rechazo. Una boleta confirmada por
  esa vía queda aceptada sin CDR; sin credenciales queda `por_confirmar`, requiere
  revisión y sigue bloqueando un segundo correlativo.

La consulta REST exige credenciales OAuth nuevas y separadas por emisor:
`SUNAT_TRA_CONSULTA_CLIENT_ID/SECRET` y `SUNAT_AVI_CONSULTA_CLIENT_ID/SECRET`.
No hacen fallback a `SUNAT_TRA_CLIENT_ID/SECRET` ni `SUNAT_AVI_CLIENT_ID/SECRET`, que
son de GRE. **Nunca se reutilizan ni rotan las credenciales GRE para este fin.**

La migración aditiva
`scripts/migrate-reconciliacion-cpe-sunat-2026-07-20.sql` agrega exactamente **15
columnas** de metadatos/claims/postproceso en `comprobantes`, **2 columnas** de claim
en `pedidos` y **6 índices**. Dos de esos índices son UNIQUE defensivos en
`facturas`: uno por `comprobante_id` y otro por pedido + serie-número
(`pedido_id`, `numero_comprobante`); si encuentra deuda histórica duplicada, la
migración falla para exigir auditoría en vez de borrar datos. La **reclasificación
de estado** se limita al caso histórico exacto 0140; los CDR ya presentes solo
reciben su marca de legibilidad. El rollback es
`scripts/rollback-reconciliacion-cpe-sunat-2026-07-20.sql` y aborta si detecta
actividad que haría inseguro retirar el esquema.

**Límite de riesgo:** no se modificaron XML UBL, firma, ítems, IGV, redondeos,
totales, correlativos, NC `07`, Resumen Diario ni GRE `09` REST/OAuth/tickets.
La prueba `npm run test:reconciliacion-sunat` usa respuestas SOAP 01 y REST 03
simuladas más contratos backend/UI; no llama a SUNAT ni a una base real.

**Límite oficial:** `billConsultService` solo acepta factura/NC/ND con serie F; una
boleta B se verifica por Consulta Integrada REST. Ambos clientes están deshabilitados
fuera de producción. La validación en `dev-hugo` fue de migración/esquema y los
contratos se cubrieron con mocks. No hubo E2E de consulta en BETA ni cruce desde
desarrollo hacia producción.

### Incidente de despliegue y recuperación

El primer despliegue de la mejora llegó a producción **antes de ejecutar su
migración**. `/api/comprobantes` empezó a fallar con PostgreSQL `42703` porque el
código ya leía `sunat_siguiente_consulta_at` y `sunat_codigo_consulta`, pero esas
columnas todavía no existían. La pantalla mostró totales en cero y el banner
"No pude cargar los comprobantes"; esos ceros eran el estado inicial del frontend,
no una pérdida de información. La lectura directa confirmó que los **1,585
comprobantes seguían intactos**.

La recuperación se hizo sin emitir CPE de prueba:

1. Se detuvo temporalmente la emisión y se aplicó la migración completa en una sola
   transacción con `psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f ...`.
2. Se verificaron las 15 columnas de `comprobantes`, las 2 de `pedidos` y los 6
   índices, incluidos los 2 UNIQUE de protección financiera.
3. El backfill estricto reclasificó los seis CPE históricos con 0140: F002-204,
   F002-412 y cuatro boletas. Las facturas quedaron consultables automáticamente;
   las boletas permanecen protegidas en revisión hasta configurar Consulta Integrada.
4. Los módulos, endpoints, migración, rollback y prueba que habían quedado fuera de
   Git se versionaron en `4974e92` (`fix(sunat): completar reconciliación y migración
   CPE`). Vercel construyó ese commit desde `main` y quedó `Ready`; el despliegue
   vigente también lo contiene.
5. `/api/comprobantes` volvió a responder correctamente, la lista recuperó sus
   totales reales y el cron de cinco minutos quedó desplegado.

**Regla operativa incorporada:** una migración de esquema se ejecuta y verifica en
producción **antes** de activar código que lea sus columnas. El build final debe
provenir de un clon limpio de Git; nunca de un workspace con módulos locales sin
versionar. Para este cambio se comprueban explícitamente `15 + 2 + 6` antes de mover
el despliegue.

### Resolución de F002-412/F002-413

- `getStatus` devolvió `0001` para **F002-412**: SUNAT sí la había aceptado. La
  ausencia de ZIP CDR descargable no convierte una aceptación confirmada en rechazo;
  el sistema conserva `tieneCdr=false` y no ofrece una descarga vacía.
- **F002-413** también estaba aceptada y sí tenía CDR válido. Era el comprobante que
  debía permanecer vigente para el cliente.
- Se emitió contra F002-412 la NC total **FC02-00000028**, motivo `01` (anulación de
  la operación), por **S/ 1,593.27**. SUNAT la aceptó con código `0`; su CDR es un ZIP
  válido, sin observaciones, y sus tres líneas coinciden con la factura base.
- F002-413 quedó aceptada e intacta, y es la **única deuda vigente**. F002-412 quedó
  neutralizada tributariamente por la NC; que SUNAT conserve la factura original como
  "aceptada" en su historial es normal. La reconciliación no generó correlativos ni
  deudas adicionales.
- La lista ahora muestra F002-412 como **Corregida con FC02-00000028**, permite saltar
  a esa NC y oculta la acción de emitir otra; el 409 del backend permanece como defensa.
- La revisión adversarial descartó subir un parche puntual de relink para Planta: no
  convergía si la NC se aceptaba antes que el CPE hermano y no distinguía anulaciones
  manuales de automáticas. La solución futura debe abarcar Ejecutivas/Campo/Planta con
  procedencia estructurada y serialización por venta; este cierre no alteró carteras.

Quedan pendientes únicamente las cuatro credenciales OAuth separadas
`SUNAT_*_CONSULTA_CLIENT_*` para resolver automáticamente boletas `03`; no son ni
deben sustituir las credenciales GRE existentes. Mientras falten, una boleta ambigua
permanece `por_confirmar` + revisión y bloquea duplicados.

---

## 6 ago 2026 — Categorías que crea quien carga el gasto, y el arqueo que por fin significa algo

**Pedido:** en su video Marianela pide "Delivery" como categoría de gasto. Hugo hace la pregunta correcta:
*"¿y cómo agrega ella más opciones? Tiene que ser flexible."*

### Lo que ya era flexible, pero estaba escondido

`categorias_gasto` y `tipos_doc_compra` viven en `settings.parametros_negocio` desde la flexibilización de
julio, y se editan con chips en `/dashboard/configuracion`. Marianela y Ariana son `admin`, o sea que
**podían hacerlo desde siempre**. El problema era puro descubrimiento: nada en la pantalla del gasto
insinuaba que esa lista existía, y había que abandonar la carga para ir a cambiarla.

Dos hallazgos que abarataron el trabajo:

- **`settings.parametros_negocio` no existía en producción** (0 filas): las 7 categorías que veía eran los
  DEFAULT del código. Agregar "Delivery" ahí se lo mostró sin tocar datos.
- **Una categoría nueva ya funcionaba sola de punta a punta**: el servidor no valida la categoría contra
  la lista, el color del chip sale de un hash del texto y el filtro une las configuradas con las usadas.
  No había nada que cablear aguas abajo.

Lo único que faltaba era **agregar UN elemento**. El único escritor era `POST /api/settings`: admin-only y
reescribe la clave entera, así que mandar el objeto completo desde el formulario habría pisado los
umbrales que otro admin estuviera editando.

### Lo que se construyó

- **`POST /api/parametros-negocio/lista`** — read-modify-write en el servidor, para `categorias_gasto` y
  `tipos_doc_compra`. Permiso: **admin + produccion**, los mismos que registran el gasto o la compra
  (crear la categoría que falta no es "cambiar la configuración del negocio", es destrabar el trabajo).
- **`agregarALista`** (`src/lib/parametros-negocio.ts`, puro, 16 tests): recorta y colapsa espacios,
  capitaliza la inicial, deduplica ignorando tildes y mayúsculas, topes de 40 opciones y 30 caracteres.
  **Si ya existe no es error**: devuelve la que hay y la UI la selecciona — quien la escribió quiere
  usarla, no leer un cartel rojo.
- **Centinela "➕ Nueva categoría…"** en el `<select>` del gasto (Gastos y Caja Diaria) y **"➕ Nuevo
  tipo…"** en el de documento de Compras. Patrón inline, no modal: los modales del repo están reservados
  para crear filas de base de datos, y esto es una palabra en una lista.
- **Enlace "Administrar categorías"** (solo admin) al lado del select: crear en el momento resuelve hoy;
  el enlace enseña dónde ordenar y quitar cuando quiera.
- **Anti-*last-write-wins*:** `configuracion-client.tsx` re-lee los parámetros antes de guardar y conserva
  las opciones que aparecieron mientras su pantalla estaba abierta — pero **solo esas**: las que el admin
  quitó a propósito siguen quitadas (se comparan contra las listas tal como estaban al abrir).
- **Corregir y borrar un gasto desde la lista**: `PATCH`/`DELETE /api/gastos/[id]` existían desde la tanda
  anterior pero ningún componente los llamaba. Ahora hay ✏️ y 🗑️ por fila.

**Bug cazado al verificar:** la pantalla de Gastos inicializaba las categorías en `[]`, así que durante la
carga el `<select>` se quedaba sin opciones y mostraba **"➕ Nueva categoría…" como si fuera la categoría
elegida** — y el default terminaba siendo "Otros" en vez de "Almuerzo". Se inicializa con
`PARAMETROS_NEGOCIO_DEFAULT`, igual que Caja Diaria.

### El arqueo: los gastos eran la punta, los pagos eran el iceberg

Se aplicaron los **14 gastos** que tenían la fecha metida en la descripción (3–16 de julio). Al verificar
la caja después, apareció el problema de verdad: **167 pagos a proveedor** (S/ 454 754.14) cargados en 8
jornadas con la `fecha` correcta pero el `created_at` del día de digitación. Como el arqueo filtra por
`created_at`, **S/ 11 982.62 en pagos de julio descontaban del efectivo esperado de la caja abierta** —
frente a S/ 181 de gastos. La caja de Marianela pasó de S/ 12 862.62 en egresos a **S/ 880**, que es lo
que de verdad salió desde el 5 de agosto.

`scripts/alinear-created-at-pagos-proveedor.mjs` hace ese alineado (dry-run por defecto, respaldo CSV).
Su filtro exige **las dos** condiciones —concepto de pago a proveedor **y** `created_at` posterior a la
`fecha`— porque hay 6 movimientos del POS con el desfase invertido, que son otro bug (fecha calculada en
UTC, un día adelantada) y que esta regla empeoraría. Antes de aplicar se verificó que **no existía ninguna
caja cerrada**: no había ningún arqueo firmado al que meterle movimientos por detrás.

**Verificado end-to-end en `dev-hugo`** con el dev server: crear "peaje  y   estacionamiento" → queda
"Peaje y estacionamiento" (espacios colapsados, capitalizada, seleccionada y persistida); reescribirla en
mayúsculas → *"ya estaba en tus categorías: la dejamos seleccionada"*, sin duplicar; registrar un gasto
con ella; corregirle la fecha a 20/07 → gasto, transacción y `created_at` los tres en 20/07; eliminarlo →
el saldo pasa de 68.06 a **80.40** (exactamente los 12.34) y no quedan filas huérfanas. 83/83 tests.

**Quedan 2 gastos** sin fecha en el texto que Marianela tiene que ubicar: `DESAYUNO ACOPIO` (S/ 248.00) y
`DESAYUNO KAREN` (S/ 232.00). Ya se corrigen desde la propia lista.

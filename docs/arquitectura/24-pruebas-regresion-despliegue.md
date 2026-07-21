# 24 — Pruebas de Regresión y Despliegue de Cambios Transversales

> **Última verificación:** 2026-07-20
> **Alcance actual:** core y reconciliación de respuestas indeterminadas SUNAT 01/03 desplegados en producción; esquema, cron y resultado fiscal/financiero de F002-412/413 verificados. La limpieza UX post-NC está implementada; solo siguen pendientes las credenciales de Consulta Integrada de boletas. La conciliación genérica de cartera entre CPE hermanos queda separada por requerir procedencia estructurada de anulación.

Este runbook convierte los invariantes de los docs [11](./11-comprobantes-sunat.md),
[13](./13-cobranzas-facturas.md), [21](./21-clientes-avicola.md),
[22](./22-operaciones-ventas-facturacion.md),
[23](./23-mapa-dependencias-impacto.md),
[26](./26-proveedores-cuentas-por-pagar.md) y
[27](./27-conciliacion-ventas-ejecutivas.md) en verificaciones repetibles.

---

## 1. Separación de entornos

Antes de ejecutar SQL, confirma de forma explícita:

- rama Neon objetivo;
- host/database de la URL;
- `SUNAT_ENVIRONMENT`;
- que `.env.local` apunta a `dev-hugo` para pruebas locales;
- que no se está heredando por accidente una `DATABASE_URL` de producción desde el proceso.

SUNAT publica `billConsultService` únicamente para producción y solo para factura/NC/ND con serie F; una boleta B no se consulta allí. La boleta 03 usa la API REST Consulta Integrada, también deshabilitada por el código fuera de producción. Una prueba local/BETA nunca debe llamar ninguno de esos endpoints productivos con un CPE de `dev-hugo`. En desarrollo se valida el esquema con Postgres y los contratos SOAP 01/REST 03 con mocks; los ambientes no se mezclan.

No imprimas credenciales en consola ni las copies a la documentación. Para scripts locales, carga la URL correcta de `.env.local` de forma controlada; no asumas que `source .env.local` pisa una variable ya exportada.

---

## 2. Validación estática

Ejecuta desde la raíz:

```bash
npx tsc --noEmit
npm run lint
git diff --check
npm run test:reconciliacion-sunat
npm run test:observaciones
npm run test:estado-cuenta-avicola
npm run test:operaciones-facturacion
npm run test:pos-detalle-costos
npm run test:ventas-ejecutivas
npm run test:pagos-proveedores
npm run test:reprogramacion-produccion
```

Reglas:

- No uses `npm run build` para comprobar tipos mientras pueda existir un `npm run dev`: puede interferir con el caché de Webpack.
- Distingue warnings preexistentes de nuevos warnings en archivos tocados.
- `test:estado-cuenta-avicola` cubre una venta, tres abonos del mismo día y un abono anulado; si cambia el libro mayor o PDF, amplía esa prueba.
- `test:operaciones-facturacion` cubre la clasificación Ejecutivas/Campo/Planta y que solo los
  códigos de NC total `01`, `02`, `06` retiren una cartera completa.
- `test:reconciliacion-sunat` usa SOAP 01 y REST 03 simulados más contratos de código/UI; no llama a SUNAT ni a la base de datos real. También falla si los módulos, endpoints o migración requeridos no están registrados en Git.

---

## 3. Migración de facturación de Campo

Aplicar en desarrollo:

```bash
DB_DEV_URL="$(sed -n 's/^DATABASE_URL_UNPOOLED=//p' .env.local | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
test -n "$DB_DEV_URL"
psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-facturacion-campo-2026-07-12.sql
psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-reemision-cpe-campo-rechazado-2026-07-12.sql
psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-nc-error-reintento-unico-2026-07-12.sql
unset DB_DEV_URL
```

La variable temporal se carga de `.env.local` para no confundirla con una URL de producción
exportada en el shell. Confirma host/rama antes del SQL sin mostrar credenciales.

Verificar:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'comprobantes' AND column_name IN
      ('venta_avicola_id','nota_credito_claim_token','nota_credito_claim_at','reemplaza_comprobante_id'))
    OR (table_name = 'ventas_avicola' AND column_name IN
      ('facturacion_claim_token','facturacion_claim_at'))
    OR (table_name = 'clientes_avicola' AND column_name = 'ruc_dni')
  )
ORDER BY table_name, column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'ux_comprobantes_venta_avicola_cpe',
    'ux_comprobantes_reemplaza_cpe',
    'ux_comprobantes_nc_referencia_activa',
    'idx_comprobantes_nc_claim',
    'idx_ventas_avicola_facturacion_claim'
  );

SELECT pg_get_viewdef('ventas_facturadas'::regclass, true);
```

La vista debe excluir tanto `c.venta_avicola_id` como `cref.venta_avicola_id`.

### Rollback

El rollback se evalúa en orden inverso: primero
`rollback-nc-error-reintento-unico-2026-07-12.sql`, luego
`rollback-reemision-cpe-campo-rechazado-2026-07-12.sql` y finalmente
`rollback-facturacion-campo-2026-07-12.sql`. El segundo aborta si ya hay una cadena de reemplazo; el
último solo es seguro si **no existe ningún CPE de Campo que deba conservar su clasificación**.

Antes de considerarlo:

```sql
SELECT COUNT(*) AS comprobantes_campo
FROM comprobantes
WHERE venta_avicola_id IS NOT NULL;
```

Si el conteo es mayor que cero, no ejecutar sin un plan de migración de datos aprobado.

---

## 4. Matriz funcional de las tres operaciones

Prepara una venta controlada de cada operación para la misma fecha:

| Caso | Resultado esperado |
|---|---|
| Pedido de Ejecutiva | aparece en Ventas Generales/Ejecutivas y en Lista de Pedidos; no aparece como Campo/Planta |
| Venta de Campo | aparece en Ventas Generales/Campo y Ventas en Campo; no suma a metas de asesoras |
| POS de Planta | aparece en Ventas Generales/Planta; no suma a metas de asesoras |

Verifica que:

- el total general sea la suma de las tres tarjetas;
- Consolidado use los mismos montos por operación;
- Hoy/Ayer de Rentabilidad use la misma fuente, aunque el cálculo de margen por pollo sea un bloque distinto;
- una venta fallida/anulada se excluya conforme a [22 §6](./22-operaciones-ventas-facturacion.md).

---

## 5. Facturación y concurrencia

### 5.1 Campo

1. Abrir la misma venta en dos pestañas.
2. Emitir simultáneamente.
3. Confirmar un solo `comprobantes.id`, serie y correlativo.
4. La segunda solicitud debe recibir conflicto 409 y no llamar a SUNAT.
5. Durante el claim, PATCH/anulación de la venta deben quedar bloqueados.
6. Después de respuesta SUNAT, el claim debe estar libre.
7. Confirmar que **no existe fila en `facturas`** para ese CPE.

### 5.2 Nota de Crédito

1. Abrir el mismo CPE base en dos pestañas.
2. Solicitar NC a la vez.
3. Confirmar una sola NC activa por `referencia_comprobante_id`.
4. Una NC en `error` con XML firmado obliga a reintentar la misma fila/correlativo; un error sin XML o
   un rechazo puede liberar una emisión corregida. Una aceptada/observada bloquea otra NC total.
5. La NC debe heredar la operación del CPE base en lista, filtro y Excel.
6. Si es total (`01`, `02` o `06`) y queda aceptada, debe anular automáticamente la venta de Campo;
   la operación manual posterior debe ser idempotente.
7. Para dos CPE del mismo pedido confirmados como aceptados, elegir el que permanecerá vigente y
   emitir una sola NC total `01` contra el duplicado; nunca cambiar artificialmente el CPE base a
   `rechazado`.
8. La NC debe repetir referencia, receptor, todas las líneas/totales del XML base y quedar con CDR
   legible antes de considerarla resuelta.
9. Post-NC, la UI debe mostrar `Corregida con <NC>`, enlazar la NC con su base, ofrecer CDR solo en
   la NC que realmente lo tiene y ocultar la opción de emitir otra NC. El backend 409 sigue siendo
   la barrera final ante cualquier doble clic o interfaz desactualizada.
10. Confirmar que el comprobante vigente conserva una sola deuda y el acreditado ninguna deuda
    activa. Una NC no puede borrar ni duplicar la cartera del CPE que se decidió conservar.

El caso real FC02-00000028 cumplió referencia, tres líneas, neto/IGV/total, CDR y
cartera. El pendiente de interfaz quedó cerrado: F002-412 ahora muestra la corrección
con el número exacto de la NC y el menú ya no ofrece emitir otra. La protección 409
del backend se mantiene como segunda barrera.

No se debe convertir ese resultado puntual en un relink automático por texto o solo
para una operación. El diseño futuro necesita `anulacion_origen`, referencia a la NC y
estado previo, serialización por pedido/venta y pruebas de ambos órdenes de aceptación,
anulación manual, deuda con abonos e idempotencia. Hasta entonces, un duplicado legal
confirmado exige revisar la deuda que se conservará antes de emitir la NC.

### 5.3 Factura/boleta con respuesta indeterminada

Probar con dobles controlados: SOAP para el envío y la consulta de factura 01; REST para la consulta de boleta 03. No usar una emisión real solo para provocar una caída ni llamar endpoints productivos desde `dev-hugo`:

1. Hacer que `sendBill` de una factura `01` y una boleta `03` devuelva, por separado, Fault 0140, timeout, HTTP 5xx, respuesta vacía y CDR ilegible.
2. En todos esos casos debe conservarse un solo `comprobantes.id`, XML y correlativo en `por_confirmar`; no debe decir `rechazado`, crear cartera todavía ni habilitar otra emisión.
3. Repetir la solicitud del mismo pedido mientras está `emitiendo`/`por_confirmar`: debe responder 409 antes de consumir correlativo o llamar a SUNAT. `confirmarDuplicado` no puede saltar el bloqueo.
4. Verificar que el formulario muestre **POR CONFIRMAR CON SUNAT**, oculte acciones de nueva emisión/PDF prematuro, indique que no se emita otro y permita **Verificar ahora**.
5. **Factura 01/F:** probar `getStatus`: `0001` → aceptado; `0002` → rechazado; `0003` → anulado; primer `0011` → sigue `por_confirmar`. Tras `0001`, `getStatusCdr` con CDR legible lo deja descargable; si falta, la factura queda aceptada y solo se reprograma la constancia.
6. **Boleta 03/B:** el mock REST debe enviar RUC/tipo/serie/número + fecha de emisión `DD/MM/YYYY` + monto a dos decimales. `estadoCp=1` → aceptado sin CDR; `2` → anulado; `0` → sigue `por_confirmar`. La API no puede producir `rechazado` ni entregar CDR.
7. Después de la espera inicial, dos `0011` SOAP separados (01) o dos `estadoCp=0` separados normalizados a `0011` (03) deben producir `no_registrado`; el único reintento permitido reutiliza la misma fila, XML y número.
8. Quitar `SUNAT_TRA_CONSULTA_CLIENT_ID/SECRET` y luego `SUNAT_AVI_CONSULTA_CLIENT_ID/SECRET`: cada boleta debe quedar `por_confirmar`, con revisión/configuración visible y el duplicado bloqueado. No debe intentar `SUNAT_*_CLIENT_ID/SECRET` de GRE.
9. Disparar cron y **Verificar ahora** a la vez: el claim de consulta debe permitir una sola consulta efectiva y ambos caminos deben converger en el mismo estado.
10. La aceptación tardía debe crear/enlazar una sola vez la cartera de Ejecutivas o Planta; Campo no debe crear `facturas`. Repetir cron/botón no puede duplicar el efecto.
11. Intentar dos veces el postproceso y confirmar que los índices únicos impiden otra deuda por `comprobante_id` o por pedido + `numero_comprobante`.
12. Con la lista abierta y visible, confirmar que refresca los pendientes cada 60 segundos. El cron debe ejecutar `/api/cron/reconciliar-cpe-sunat` cada 5 minutos y procesar lotes pequeños sin `sendBill`.
13. Probar que un XML firmado sin CDR no se presenta como prueba de aceptación. Si `getStatus=0001`
    confirma el CPE pero `getStatusCdr` no devuelve archivo, la UI debe decir aceptado/constancia
    pendiente, ocultar la descarga y mantener `sunat_cdr_legible=false`.
14. Un CDR solo es válido si el ZIP se descomprime, contiene `ApplicationResponse` y expone un
    `ResponseCode` interpretable. Base64 no vacío o un ZIP sin respuesta no pueden activar la descarga
    ni clasificar como aceptado por defecto.

### 5.4 Reserva atascada

Simular una fila `emitiendo` o claim con más de 15 minutos en desarrollo. Una factura/boleta debe pasar a `por_confirmar` y consultar el mismo número; no debe pasar directamente a `error` ni reenviarse. La NC conserva su recuperación propia. Un claim vencido sí puede liberarse, sin consumir un correlativo nuevo.

---

## 6. Reintentos

Por operación, fuerza un error controlado antes/después de reservar la fila y verifica:

- se reutiliza el mismo `comprobantes.id` y correlativo;
- no aparece un segundo CPE activo;
- `items_json`/XML representan los ítems originales;
- Ejecutivas crea su cobranza solo una vez cuando corresponde;
- Campo nunca crea `facturas`;
- Planta conserva su cartera propia y nunca crea `facturas` por un reintento;
- el estado final y el mensaje SUNAT quedan auditables.

En 01/03, `por_confirmar` nunca es un estado reintentable por envío. El preflight de un `error` histórico con XML debe consultar primero; si SUNAT no responde, vuelve a `por_confirmar`. Solo `no_registrado`, obtenido después de las consultas previstas, permite reenviar el mismo XML y número.

Un rechazo por datos no debe tratarse como una simple caída de red: requiere corregir los datos fiscales/XML mediante un flujo que preserve la auditoría y la exclusión concurrente.

---

## 7. GRE, filtros y exportación

Para un CPE de cada operación:

- abrir el modal de GRE y verificar que toma el receptor/dirección correctos;
- emitir o validar el payload en BETA;
- confirmar que la GRE aparece asociada al CPE;
- filtrar `/api/comprobantes?operacion=...`;
- abrir las vistas fijas de Ejecutivas y Campo;
- exportar XLSX y comprobar que CPE y NC conservan la operación del documento base.

La operación se deriva del CPE; la empresa emisora sigue siendo una dimensión independiente.

Regresión de aislamiento obligatoria para la reconciliación:

- una NC `07` sigue usando su claim, clasificación y reintento actual; aunque `billConsultService` oficialmente admite NC serie F, este cambio no la incorpora al cron ni al endpoint **Verificar ahora** de 01/03;
- una GRE `09` sigue usando sus credenciales REST/OAuth/ticket y `comprobantes_guias`; nunca se reutilizan ni rotan esas credenciales para Consulta Integrada;
- el Resumen Diario de boletas conserva su propio ticket/cron y no se confunde con la consulta REST individual de validez de la boleta.

---

## 8. Estado de cuenta de Campo y PDF

Caso de regresión obligatorio:

1. crear una venta;
2. registrar tres abonos válidos el mismo día, con horas/medios/notas distintas;
3. registrar y anular un cuarto abono;
4. abrir el modal y generar el PDF.

Debe observarse:

- tres movimientos separados, no un total diario colapsado;
- orden cronológico estable;
- hora Lima, medio, monto, nota y saldo posterior;
- el abono anulado no reduce el saldo;
- suma de movimientos igual al resumen del estado de cuenta;
- PDF sin cortes, montos legibles y datos del cliente correctos.

La verificación visual es obligatoria porque typecheck no detecta desbordes o filas ocultas.

---

## 9. Permisos

| Prueba | Resultado |
|---|---|
| admin → Campo/Ventas Generales | permitido |
| asesor → Comprobantes Ejecutivas | permitido y scopeado |
| asesor → Campo/Ventas Generales | redirección/403 |
| produccion → POS y cartera Planta | permitido |
| repartidor → cualquier API financiera | 403 |

Prueba la URL directa y la API; no basta con mirar el sidebar.

---

## 10. Migración de reconciliación 01/03

La migración es aditiva y no modifica XML, firma, ítems, IGV, totales, correlativos, NC ni GRE. Ya fue aplicada en `dev-hugo` y producción; esta es la receta reproducible para una branch de desarrollo nueva o una reejecución idempotente:

```bash
DB_DEV_URL="$(sed -n 's/^DATABASE_URL_UNPOOLED=//p' .env.local | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
test -n "$DB_DEV_URL"
psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-reconciliacion-cpe-sunat-2026-07-20.sql
unset DB_DEV_URL
```

Antes de ejecutarla, confirma que la URL sea la branch `dev-hugo` sin imprimir la credencial. Después verifica:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'comprobantes' AND column_name IN (
      'sunat_codigo_envio', 'sunat_mensaje_envio',
      'sunat_codigo_consulta', 'sunat_cdr_legible',
      'sunat_ultima_consulta_at',
      'sunat_siguiente_consulta_at', 'sunat_consultas_count',
      'sunat_no_existe_consecutivos', 'sunat_consulta_claim_at',
      'sunat_requiere_revision', 'sunat_revision_motivo',
      'sunat_postproceso_estado', 'sunat_postproceso_at',
      'sunat_postproceso_error'
    ))
    OR (table_name = 'pedidos' AND column_name IN (
      'facturacion_cpe_claim_token', 'facturacion_cpe_claim_at'
    ))
  )
ORDER BY table_name, column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_comprobantes_sunat_por_confirmar',
    'idx_comprobantes_sunat_cdr_pendiente',
    'idx_comprobantes_sunat_postproceso',
    'idx_pedidos_facturacion_cpe_claim',
    'uq_facturas_comprobante_id_cpe',
    'uq_facturas_pedido_serie_cpe'
  );

SELECT tipo, estado, COUNT(*)
FROM comprobantes
WHERE estado IN ('por_confirmar', 'no_registrado')
GROUP BY tipo, estado
ORDER BY tipo, estado;
```

El backfill de estado es deliberadamente estricto: solo reclasifica a `por_confirmar` filas 01/03 con XML cuyo mensaje histórico contiene exactamente “Documento igual en Proceso”. No reinterpreta en masa otros rechazos o errores históricos. Por separado, marca `sunat_cdr_legible=TRUE` en CPE históricos aceptados/observados/rechazados que ya tienen `cdr_base64`, para que la disponibilidad de la constancia siga siendo retrocompatible.

Antes de confiar en los índices únicos defensivos, el entorno debe quedar sin resultados en ambas consultas:

```sql
SELECT comprobante_id, COUNT(*)
FROM facturas
WHERE comprobante_id IS NOT NULL
GROUP BY comprobante_id
HAVING COUNT(*) > 1;

SELECT pedido_id, numero_comprobante, COUNT(*)
FROM facturas
WHERE pedido_id IS NOT NULL
  AND COALESCE(numero_comprobante, '') <> ''
GROUP BY pedido_id, numero_comprobante
HAVING COUNT(*) > 1;
```

La migración falla si hay duplicados; no los borra ni elige una deuda “ganadora” automáticamente.

### Rollback

`scripts/rollback-reconciliacion-cpe-sunat-2026-07-20.sql` se ejecuta únicamente después de retirar el código que usa las columnas. Aborta si existe cualquier claim de facturación/consulta, postproceso `pendiente`/`aplicando`, CPE 01/03 `emitiendo`/`por_confirmar`/`no_registrado` o fila marcada para revisión. Solo con el sistema drenado traduce los estados nuevos a `error`, elimina los dos índices únicos defensivos y después retira índices/columnas. No lo ejecutes como reacción automática ante una intermitencia de SUNAT.

**Estado al 20 de julio de 2026:** después de validarse en `dev-hugo`, la migración se aplicó en producción con 1,585 CPE preservados, 15+2 columnas, 6 índices, 1,554 CDR históricos marcados y 6 filas exactas 0140 reclasificadas. El cron ejecutó con HTTP 200 y sin `42703`; la UI autenticada volvió a mostrar los totales reales. Los contratos SOAP 01/REST 03 se prueban con mocks. Aún no existen las cuatro credenciales nuevas de Consulta Integrada y no hay E2E REST 03 con ambos emisores.

---

## 11. Pase a producción

1. Congelar y revisar el diff.
2. Confirmar que migración, rollback, módulos, endpoints y pruebas estén registrados en Git; construir y probar el commit desde `git archive` o un clon limpio.
3. Respaldar/consultar conteos clave.
4. Aplicar migraciones por `psql -1 -v ON_ERROR_STOP=1` en el orden documentado en [20](./20-migracion-produccion.md). Para reconciliación 01/03, la migración debe quedar activa **antes** del código que lee sus columnas.
5. Ejecutar consultas de verificación.
6. Solo entonces activar el despliegue construido desde Git; no promover un workspace local sucio.
7. Realizar smoke test de lectura antes de emitir documentos reales.
8. Validar con CPE existentes: lista/totales, detalle, XML, CDR, cron, ausencia de correlativos nuevos y deuda no duplicada.
9. Para un caso post-NC, comprobar en la UI la relación base↔NC, estado aceptado, CDR real y que no se ofrezca repetir la corrección.
10. Crear una aplicación **Consulta de Validez de Comprobantes** por RUC y cargar `SUNAT_TRA_CONSULTA_CLIENT_ID/SECRET` y `SUNAT_AVI_CONSULTA_CLIENT_ID/SECRET`. No modificar `SUNAT_TRA_CLIENT_ID/SECRET` ni `SUNAT_AVI_CLIENT_ID/SECRET` de GRE.
11. Confirmar `CRON_SECRET`, el registro `*/5 * * * *` de `/api/cron/reconciliar-cpe-sunat` y una ejecución autorizada del cron.
12. Revisar logs, CDR, cobranzas y Ventas Generales; una consulta transitoria nunca debe disparar `sendBill`.
13. Conservar el rollback solo como plan de contingencia evaluado, no automático.

Registra en el historial qué migración se aplicó, a qué rama/base y con qué verificación. No anotes secretos.

## 12. Matriz de regresión del 13 jul 2026

### Proveedores

- tres pagos del mismo día conservan tres IDs/filas y el PDF no los agrupa;
- S/18,500 contra una guía de S/3,636.81 requiere confirmar el excedente, cubre
  deudas FIFO y deja el resto como anticipo;
- una deuda futura consume el anticipo sin crear otro movimiento bancario;
- retry/doble clic/concurrencia descuenta la cuenta una sola vez;
- pago de otro proveedor y fecha futura se rechazan;
- anular crea contraasiento, revierte aplicaciones y reabre las deudas;
- pantalla, PDF, aplicaciones y `monto_pagado` coinciden al céntimo.

### POS

- detalle de kg y unidades con precio, subtotal, costo snapshot y subtotal de costo;
- efectivo/Yape/banco/crédito muestran tipo y cuenta originales;
- costo faltante produce `costo_total=null`, nunca S/0 ni costo actual;
- cambiar `productos.precio_compra` no altera una venta anterior;
- `admin`/`produccion` pueden verlo y `asesor` recibe 403.

### Reprogramación

- Producción solo puede mañana y los tres estados productivos;
- pesos, unidades, precios, ítems y estado se conservan;
- pedido desaparece de hoy y aparece mañana;
- cambio, auditoría y notificación son atómicos;
- doble clic deja una sola auditoría/notificación;
- popup aparece antes de 30 s, se cierra por sesión y sigue en la campana.

### Ventas de Ejecutivas

- ejecutar los casos del [doc 27 §9](./27-conciliacion-ventas-ejecutivas.md);
- validar los cortes del 12 y 13 de julio;
- comparar API, tarjeta, detalle, Consolidado y Rentabilidad;
- confirmar que Metas/Incentivos no cambiaron.

### QA visual y documental

- renderizar el PDF A4 a PNG con Poppler e inspeccionar todas las páginas;
- probar interfaces a 320, 640, 768 y 1024 px, teclado, foco y zoom 200%;
- ejecutar `npx tsc --noEmit`, lint, pruebas existentes y nuevas;
- ejecutar `npm run test:pagos-proveedores:db` y
  `npm run test:operaciones-julio:db` contra `.env.local`/`dev-hugo`;
- comprobar enlaces Markdown y ausencia de estados “pendiente de main” ya obsoletos.

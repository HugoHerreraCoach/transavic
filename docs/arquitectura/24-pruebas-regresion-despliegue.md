# 24 — Pruebas de Regresión y Despliegue de Cambios Transversales

> **Última verificación:** 2026-07-12
> **Alcance actual:** separación Ejecutivas/Campo/Planta, CPE de Campo, NC/GRE, vistas generales y abonos individuales en PDF.

Este runbook convierte los invariantes de los docs [11](./11-comprobantes-sunat.md), [13](./13-cobranzas-facturas.md), [21](./21-clientes-avicola.md), [22](./22-operaciones-ventas-facturacion.md) y [23](./23-mapa-dependencias-impacto.md) en verificaciones repetibles.

---

## 1. Separación de entornos

Antes de ejecutar SQL, confirma de forma explícita:

- rama Neon objetivo;
- host/database de la URL;
- `SUNAT_ENVIRONMENT`;
- que `.env.local` apunta a `dev-hugo` para pruebas locales;
- que no se está heredando por accidente una `DATABASE_URL` de producción desde el proceso.

No imprimas credenciales en consola ni las copies a la documentación. Para scripts locales, carga la URL correcta de `.env.local` de forma controlada; no asumas que `source .env.local` pisa una variable ya exportada.

---

## 2. Validación estática

Ejecuta desde la raíz:

```bash
npx tsc --noEmit
npm run lint
git diff --check
npm run test:observaciones
npm run test:estado-cuenta-avicola
npm run test:operaciones-facturacion
```

Reglas:

- No uses `npm run build` para comprobar tipos mientras pueda existir un `npm run dev`: puede interferir con el caché de Webpack.
- Distingue warnings preexistentes de nuevos warnings en archivos tocados.
- `test:estado-cuenta-avicola` cubre una venta, tres abonos del mismo día y un abono anulado; si cambia el libro mayor o PDF, amplía esa prueba.
- `test:operaciones-facturacion` cubre la clasificación Ejecutivas/Campo/Planta y que solo los
  códigos de NC total `01`, `02`, `06` retiren una cartera completa.

---

## 3. Migración de facturación de Campo

Aplicar en desarrollo:

```bash
DB_DEV_URL="$(sed -n 's/^DATABASE_URL_UNPOOLED=//p' .env.local | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
test -n "$DB_DEV_URL"
psql "$DB_DEV_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-facturacion-campo-2026-07-12.sql
psql "$DB_DEV_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-reemision-cpe-campo-rechazado-2026-07-12.sql
psql "$DB_DEV_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-nc-error-reintento-unico-2026-07-12.sql
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

### 5.3 Reserva atascada

Simular una fila `emitiendo` o claim con más de 15 minutos en desarrollo. Al listar/reintentar, debe pasar a `error` o liberar el claim según el flujo, sin consumir un correlativo nuevo.

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

## 10. Pase a producción

1. Congelar y revisar el diff.
2. Respaldar/consultar conteos clave.
3. Aplicar migraciones por `psql -v ON_ERROR_STOP=1` en el orden documentado en [20](./20-migracion-produccion.md).
4. Ejecutar consultas de verificación.
5. Solo entonces activar el deploy del código.
6. Realizar smoke test de lectura antes de emitir documentos reales.
7. Emitir un caso real controlado por operación aplicable.
8. Revisar logs, CDR, cobranzas y Ventas Generales.
9. Conservar el rollback solo como plan de contingencia evaluado, no automático.

Registra en el historial qué migración se aplicó, a qué rama/base y con qué verificación. No anotes secretos.

# 20 — Migraciones y Despliegue Seguro a Producción

> **Última actualización:** 2026-07-13
> **Producción:** Vercel `hugoherrerateam/transavic` + Neon `ep-cool-sound`
> **Desarrollo:** `.env.local` + Neon `dev-hugo`; SUNAT BETA

Este es el runbook operativo para cambios de esquema. La regla innegociable es: **migrar y verificar la base antes de que el código nuevo quede activo**.

---

## 1. Por qué se usa `psql`

Los scripts Node `.mjs` que conectan con `@neondatabase/serverless` fallan en el entorno local con Node 26 (`TypeError: fetch failed`). Las migraciones de producción se aplican como SQL directo:

```bash
psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-<feature>.sql
```

`ON_ERROR_STOP=1` impide continuar después de una sentencia fallida. No imprimas la URL ni la guardes en archivos versionados.

---

## 2. Historial de pases de esquema

| Fecha | Estado | Migraciones principales |
|---|---|---|
| 30 may 2026 | ✅ producción | `migrate-produccion-2026-05-29.sql`: base de comprobantes, cobranzas, metas y columnas del lanzamiento |
| 5 jul 2026 | ✅ producción | ERP/CRM: consolidado F2-3, CRM/extensiones/rotación, caja única, kardex, seed de inventario |
| 8 jul 2026 | ✅ producción | Clientes Avícola, clientes/cobranzas de Planta, caja por operación y proveedores |
| 12 jul 2026 | ✅ producción | facturación de Campo, claims/NC, vistas generales y corrección auditada de CPE rechazados |
| 13 jul 2026 | 🧪 `dev-hugo` | pagos/anticipos de proveedores y costo histórico POS probados; producción intacta |

La fuente histórica detallada de cada pase es `docs/historial-cambios-2026.md`. No confundas "código local verificado" con "producción migrada".

---

## 3. Procedimiento general

### Paso 1: preflight

1. Confirmar rama, commit/diff y archivos SQL exactos.
2. Confirmar host/base de desarrollo y producción sin revelar secretos.
3. Revisar si el script es idempotente y aditivo.
4. Revisar rollback y si pierde datos o trazabilidad.
5. Ejecutar primero en `dev-hugo`.
6. Ejecutar `npx tsc --noEmit`, lint, pruebas dirigidas y `git diff --check`.

### Paso 2: aplicar SQL en desarrollo

```bash
DB_DEV_URL="$(sed -n 's/^DATABASE_URL_UNPOOLED=//p' .env.local | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
test -n "$DB_DEV_URL"
psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-<feature>.sql
unset DB_DEV_URL
```

`DB_DEV_URL` es una variable temporal del shell, no una variable del proyecto. Esta forma lee
explícitamente `.env.local` y evita depender de un `DATABASE_URL_UNPOOLED` de producción que pudiera
estar exportado en la sesión. Antes del SQL, confirma el host/rama sin imprimir la URL completa.

Validar columnas, FKs, constraints, índices y vistas mediante `information_schema`, `pg_indexes` y `pg_get_viewdef`.

### Paso 3: smoke test funcional en desarrollo

Probar el camino feliz, permisos, concurrencia/reintento y al menos un consumidor indirecto. Para facturación usar SUNAT BETA y el runbook [24](./24-pruebas-regresion-despliegue.md).

### Paso 4: aplicar en producción

Con ventana controlada y antes del deploy:

```bash
psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-<feature>.sql
```

Repetir las consultas de verificación. Solo después se hace push/merge a `main` o se habilita el deploy.

### Paso 5: post-deploy

- comprobar `/api/version` y recarga del cliente;
- abrir vistas nuevas con roles permitidos/prohibidos;
- revisar logs de Vercel;
- validar datos reales controlados;
- confirmar que no aparecieron deudas, correlativos o movimientos duplicados.

---

## 4. Cierre del pase de facturación de Campo (12 jul)

Orden aplicado y conservado como referencia de auditoría:

1. `scripts/migrate-facturacion-campo-2026-07-12.sql`
2. `scripts/migrate-reemision-cpe-campo-rechazado-2026-07-12.sql`
3. `scripts/migrate-nc-error-reintento-unico-2026-07-12.sql`
4. deploy del código que consume las nuevas columnas/índices

La primera migración agrega:

- `comprobantes.venta_avicola_id`;
- claims de NC en `comprobantes`;
- `clientes_avicola.ruc_dni`;
- claims de facturación en `ventas_avicola`;
- guard de CPE Campo y NC activa;
- exclusión de Campo y su NC en `ventas_facturadas`.

La segunda migración agrega la cadena `reemplaza_comprobante_id` para conservar el CPE rechazado y
emitir la corrección con otro correlativo. La tercera endurece la unicidad de NC: un estado `error`
con XML firmado sigue ocupando el cupo y solo puede reintentarse con la misma fila/correlativo.

El esquema y el código quedaron desplegados el 12 jul. Verificación exacta y casos
de doble pestaña: [24 §3–6](./24-pruebas-regresion-despliegue.md).

---

## 5. Rollback: criterio de decisión

Un rollback de esquema no es automáticamente seguro:

- quitar una columna de origen puede dejar comprobantes legales sin clasificación;
- quitar un índice de unicidad puede reabrir dobles emisiones;
- restaurar una vista anterior puede contaminar metas/reportes;
- borrar una FK de reemplazo puede romper la cadena de auditoría.

Si aún fuera seguro revertir, el orden es inverso: primero
`rollback-nc-error-reintento-unico-2026-07-12.sql`, después
`rollback-reemision-cpe-campo-rechazado-2026-07-12.sql` y al final
`rollback-facturacion-campo-2026-07-12.sql`. El rollback de reemisión aborta si ya existen hijos de
reemplazo; el rollback base no debe ejecutarse si existen CPE de Campo sin un plan de datos. Antes de cualquier rollback:

1. contar filas afectadas;
2. respaldar IDs y vínculos;
3. decidir si se revierte solo el código manteniendo columnas aditivas;
4. obtener aprobación si se pierde trazabilidad;
5. verificar vistas e índices después.

En la mayoría de incidentes, es más seguro desactivar/retirar el código nuevo y conservar el esquema aditivo que ejecutar un rollback destructivo.

---

## 6. Consultas base de verificación

```sql
-- Columnas recientes
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('comprobantes','ventas_avicola','clientes_avicola')
ORDER BY table_name, ordinal_position;

-- Índices de negocio y concurrencia
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname LIKE '%venta_avicola%'
    OR indexname LIKE '%nc_%'
    OR indexname LIKE '%caja_diaria%'
  )
ORDER BY tablename, indexname;

-- Definición real de la vista de facturación
SELECT pg_get_viewdef('ventas_facturadas'::regclass, true);
```

Las consultas prueban estructura; no sustituyen las pruebas de negocio.

---

## 7. Archivos que deben actualizarse con cada migración

- migración nueva y rollback evaluado;
- `docs/arquitectura/02-modelo-datos.md`;
- documento temático;
- este runbook si cambia el orden;
- `docs/historial-cambios-2026.md`;
- `CLAUDE.md`/`AGENTS.md` solo para invariantes que futuros cambios no deben romper.

La matriz general está en [23 §3.1](./23-mapa-dependencias-impacto.md).

## 8. Lote del 13 jul 2026

Orden obligatorio. En `dev-hugo`, usar exclusivamente la URL temporal obtenida de
`.env.local` como en el paso 2:

```bash
psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 \
  -f scripts/migrate-pagos-proveedores-estado-cuenta-2026-07-13.sql

psql "$DB_DEV_URL" -1 -v ON_ERROR_STOP=1 \
  -f scripts/migrate-pos-costo-snapshot-2026-07-13.sql
```

Ambas ya se ejecutaron y reejecutaron correctamente en `dev-hugo`. Solo con
autorización, repetir el mismo orden en producción sustituyendo `DB_DEV_URL` por
`DATABASE_URL_UNPOOLED`, siempre con `-1 -v ON_ERROR_STOP=1` y antes del deploy.

Verificar antes del deploy:

- backfill de pagos sin diferencias mayores a S/0.01;
- caché `monto_pagado` igual a aplicaciones activas;
- FKs compuestas impiden aplicar un pago a otro proveedor;
- índice único de movimiento/reverso por pago;
- columna `pedido_items.costo_unitario_snapshot` nullable y sin backfill inventado;
- venta POS nueva conserva su costo aunque cambie el catálogo.

La reprogramación y la conciliación de Ejecutivas no agregan columnas. Rollbacks:
`rollback-pagos-proveedores-estado-cuenta-2026-07-13.sql` y
`rollback-pos-costo-snapshot-2026-07-13.sql`; deben evaluarse, no ejecutarse
automáticamente después de que existan datos nuevos.

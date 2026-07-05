# 20 — Guía de Migración a Producción (Fases 2 y 3)

> **Fecha:** 2026-06-28
> **Estado:** Listo para aplicar antes de desplegar código de Fase 2 y Fase 3 en Vercel.
> **Script Asociado:** [migrate-produccion-fase-2-3-consolidado.sql](file:///Users/hugoherrera/Programación/proyectos/transavic/scripts/migrate-produccion-fase-2-3-consolidado.sql)

Este documento detalla el procedimiento operativo para aplicar las alteraciones de base de datos a la base de datos de producción de Neon. 

---

## 🛠️ Procedimiento de Despliegue (Paso a Paso)

> [!CAUTION]
> **ORDEN CRÍTICO:** Se debe ejecutar el script SQL en la base de datos de producción **antes** de que el nuevo código de producción compilado quede activo en Vercel. Si el código nuevo corre con la base de datos anterior, fallarán las consultas a endpoints como `/api/pos`, `/api/compras` o `/api/rentabilidad` debido a que no existen las tablas o columnas asociadas.

### Paso 1: Ejecutar el Script SQL
El script SQL consolidado se encuentra en:
`scripts/migrate-produccion-fase-2-3-consolidado.sql`

Debido al **Gotcha #13** (Node 26 DNS issue que rompe scripts `.mjs` de conexión), la forma recomendada es aplicar el SQL directamente. Tienes dos opciones seguras:

*   **Opción A (Recomendada - Consola de Neon)**:
    1. Abre la consola de tu base de datos en [Neon Console](https://console.neon.tech).
    2. Selecciona la rama de producción (`main` o la activa).
    3. Dirígete a la sección **SQL Editor**.
    4. Copia el contenido completo de `scripts/migrate-produccion-fase-2-3-consolidado.sql` y ejecútalo.
    
*   **Opción B (Línea de comandos psql)**:
    Si tienes configurada tu variable `DATABASE_URL_UNPOOLED` de producción en tu terminal, ejecuta:
    ```bash
    psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-produccion-fase-2-3-consolidado.sql
    ```

### Paso 2: Verificar la Creación de Tablas
Para comprobar que la estructura se aplicó correctamente, puedes ejecutar una consulta rápida en la consola de Neon:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('proveedores', 'compras', 'inventario_lotes', 'cuentas_bancarias', 'facturas');
```
Debe retornar la lista completa de estas tablas.

### Paso 3: Desplegar el Código en Vercel
Una vez que el paso anterior finalizó exitosamente:
1. Haz push de tus cambios a la rama `main` de GitHub.
2. Vercel comenzará automáticamente el build y despliegue.
3. El VersionChecker forzará la recarga de las pestañas activas de las asesoras y repartidores para que tomen el nuevo bundle de JS.

---

## 🔒 Preservación e Integridad de Datos

*   **Sin Modificación de Datos Reales**: Las sentencias SQL usan `ADD COLUMN IF NOT EXISTS` y `CREATE TABLE IF NOT EXISTS`. No alteran ni reescriben información existente en `pedidos`, `clientes` o `productos`.
*   **Backfill de Inventario**: El script inicializa automáticamente un registro de stock en `0` en la tabla `inventario_lotes` para todos los productos existentes, garantizando que el POS de planta y los reportes de inventario no den errores de nulos al iniciar.
*   **Cuentas Bancarias por Defecto**: Se crean automáticamente las 4 cuentas por defecto (`Caja Efectivo Planta`, `Yape Antonio`, `BCP Antonio`, `BBVA Antonio`) con saldo `0`, listas para recibir dinero de las ventas del POS de planta.

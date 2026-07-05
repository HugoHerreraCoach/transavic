# 02 — Modelo de Datos (Esquema y Relaciones)

> **Última verificación contra código:** 2026-07-05
> **Commit del proyecto:** `9f29f5a` (+ cambios locales de la expansión ERP)
> **Archivos clave:** `src/lib/types.ts`, `scripts/migrate-produccion-2026-05-29.sql` (esquema consolidado original), `scripts/migrate-produccion-fase-2-3-consolidado.sql` (expansión ERP 2026)

Este documento define la estructura física de la base de datos Neon Postgres del proyecto Transavic.

---

## 1. Diagrama de Relaciones (ER)

```mermaid
erDiagram
    users ||--o{ pedidos : "asesor_id / repartidor_id / pesado_por"
    users ||--o{ clientes : "asesor_id"
    clientes ||--o{ pedidos : "cliente_id"
    pedidos ||--o{ pedido_items : "pedido_id (CASCADE)"
    productos ||--o{ pedido_items : "producto_id"
    comprobantes ||--o{ comprobantes_guias : "comprobante_id"
    pedidos ||--o{ comprobantes_guias : "pedido_id"
    comprobantes ||--o{ facturas : "comprobante_id"
    pedidos ||--o{ facturas : "pedido_id"
    users ||--o{ metas_asesoras : "asesor_id"
    users ||--o{ notificaciones : "user_id"
    users ||--o{ rider_locations : "repartidor_id"
```

---

## 2. Diccionario de las 17 Tablas Activas

1. **`users`**: Directorio de usuarios y credenciales (admin, asesor, repartidor, produccion).
2. **`clientes`**: Cartera de clientes recurrentes (RUC/DNI, dirección, plazo de pago, asesor responsable).
3. **`pedidos`**: Tabla central que almacena la cabecera del pedido (datos denormalizados del cliente al momento de la venta).
4. **`pedido_items`**: Detalle de productos solicitados por pedido, precios estimados y pesos reales.
5. **`productos`**: Catálogo de productos (Pollo, Gallina, Res, Cerdo, Huevos) con precios base.
6. **`settings`**: Parámetros JSONB del sistema (ubicación del almacén, configuración de incentivos).
7. **`comprobantes`**: Comprobantes de pago electrónicos emitidos ante SUNAT (Boletas, Facturas, Notas de Crédito).
8. **`comprobantes_contador`**: Contadores atómicos correlativos por serie de comprobante (ej: F001, B001, T001).
9. **`correlativos`**: Contador de la orden de pedido interna (correlativo único no legal).
10. **`facturas`**: Cuentas por cobrar (cobranzas) generadas por cada comprobante emitido.
11. **`metas_asesoras`**: Overrides mensuales de metas de ventas individuales y bonos.
12. **`notificaciones`**: Mensajería in-app para alertas automáticas entre áreas.
13. **`precios_productos`**: Historial de cambios de precio base de productos (precio_compra y precio_venta).
14. **`resumenes_diarios`**: Paquetes de envío diario SUNAT (RC-) de boletas y resúmenes de baja (RA-).
15. **`pedido_ediciones`**: Log de auditoría de modificaciones de pedidos por parte de las asesoras.
16. **`rider_locations`**: Última ubicación GPS conocida y estado del sensor de los repartidores activos.
17. **`ia_insights_cache`**: Caché en Postgres de los reportes e insights comerciales generados por Gemini/Groq.

> **Nota:** estas 17 tablas son las que existen en **producción**. La expansión ERP 2026 agrega **15 tablas más** que hoy solo existen en la rama de desarrollo `dev-hugo` — ver §5.

---

## 3. Esquema DDL Consolidado (Producción)

A continuación se detalla el esquema actual completo de la base de datos, incluyendo tipos de datos y restricciones:

```sql
-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Usuarios
CREATE TABLE users (
    id        UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name      VARCHAR(255) NOT NULL UNIQUE,          -- TRIM de espacios al consultar (gotcha #11)
    password  TEXT NOT NULL,                         -- hash bcrypt
    role      VARCHAR(50) NOT NULL                   -- 'admin' | 'asesor' | 'repartidor' | 'produccion'
);

-- 2. Clientes
CREATE TABLE clientes (
    id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nombre           VARCHAR(255) NOT NULL,
    whatsapp         VARCHAR(50),
    direccion        TEXT NOT NULL,
    distrito         VARCHAR(100) NOT NULL,
    tipo_cliente     VARCHAR(50) DEFAULT 'Nuevo',    -- 'Nuevo' | 'Frecuente'
    razon_social     VARCHAR(255),
    ruc_dni          VARCHAR(20),
    notas            TEXT,
    asesor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    plazo_pago_dias  INTEGER DEFAULT 0,              -- 0 = Contado, >0 = Crédito
    rubro            VARCHAR(50)                     -- Giro de negocio (Restaurante, Chifa, etc.)
);

-- 3. Productos
CREATE TABLE productos (
    id             UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nombre         VARCHAR(255) NOT NULL,
    categoria      VARCHAR(100),
    unidad         VARCHAR(50) NOT NULL,             -- 'kg' | 'uni'
    activo         BOOLEAN DEFAULT TRUE,             -- soft delete
    precio_compra  NUMERIC(10, 2),
    precio_venta   NUMERIC(10, 2),                   -- CON IGV incluido
    codigo         VARCHAR(50)                       -- Código SUNAT o SKU
);

-- 4. Pedidos
CREATE TABLE pedidos (
    id                     UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    cliente                VARCHAR(255) NOT NULL,        -- denormalizado
    cliente_id             UUID REFERENCES clientes(id) ON DELETE SET NULL,
    whatsapp               VARCHAR(50),
    direccion              TEXT NOT NULL,
    direccion_mapa         TEXT,
    distrito               VARCHAR(100) NOT NULL,
    tipo_cliente           VARCHAR(50) DEFAULT 'Nuevo',
    detalle                TEXT,                         -- descripción original
    hora_entrega           VARCHAR(100),                 -- rango horario
    razon_social           VARCHAR(255),
    ruc_dni                VARCHAR(20),
    notas                  TEXT,
    empresa                VARCHAR(100) NOT NULL,        -- 'Transavic' | 'Avícola de Tony'
    fecha_pedido           DATE NOT NULL,                -- fecha de entrega
    latitude               DECIMAL(10, 8),
    longitude              DECIMAL(11, 8),
    estado                 VARCHAR(50) DEFAULT 'Pendiente', -- máquina de estados (§4)
    entregado              BOOLEAN DEFAULT FALSE,        -- legacy sync
    entregado_por          VARCHAR(255),                 -- legacy sync
    entregado_at           TIMESTAMP WITH TIME ZONE,     -- legacy sync
    repartidor_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    orden_ruta             INTEGER DEFAULT 0,
    distancia_km           NUMERIC(6, 2),                -- congelada al asignar
    duracion_estimada_min  INTEGER,
    inicio_viaje_at        TIMESTAMP WITH TIME ZONE,
    hora_llegada_estimada  TIMESTAMP WITH TIME ZONE,
    razon_fallo            TEXT,
    numero_guia            VARCHAR(50),                  -- correlativo de orden interna
    guia_firmada_data      TEXT,                         -- base64 de foto firmada
    guia_firmada_mime      VARCHAR(100),
    guia_firmada_at        TIMESTAMP WITH TIME ZONE,
    pesado_por             VARCHAR(255),
    pesado_at              TIMESTAMP WITH TIME ZONE,
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, -- fecha de preventa
    asesor_id              UUID REFERENCES users(id) ON DELETE SET NULL,
    notificado_por_llegar  BOOLEAN DEFAULT FALSE,
    notificado_llegada     BOOLEAN DEFAULT FALSE
);

-- 5. Items de Pedido
CREATE TABLE pedido_items (
    id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pedido_id        UUID REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id      UUID REFERENCES productos(id) ON DELETE SET NULL,
    producto_nombre  VARCHAR(255) NOT NULL,
    cantidad         DECIMAL(10, 2) NOT NULL,
    unidad           VARCHAR(50) NOT NULL,           -- unidad de venta final
    unidad_pedido    VARCHAR(50),                    -- unidad original de preventa
    precio_unitario  NUMERIC(10, 2),                 -- CON IGV
    subtotal         NUMERIC(10, 2),
    cantidad_real    NUMERIC(10, 2),                 -- peso real balanza
    subtotal_real    NUMERIC(10, 2),                 -- total cobrado final
    notas            TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Configuración Key/Value
CREATE TABLE settings (
    key         VARCHAR(255) PRIMARY KEY,            -- 'base_location' | 'incentivos_config'
    value       JSONB NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Comprobantes (SUNAT)
CREATE TABLE comprobantes (
    id                      UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pedido_id               UUID REFERENCES pedidos(id) ON DELETE SET NULL,
    empresa                 VARCHAR(100) NOT NULL,
    ruc_emisor              VARCHAR(20) NOT NULL,
    tipo_comprobante        VARCHAR(2) NOT NULL,         -- '01' factura, '03' boleta, '07' NC
    serie                   VARCHAR(4) NOT NULL,         -- ej: B001, F001
    correlativo             INTEGER NOT NULL,
    fecha_emision           DATE NOT NULL,
    cliente_doc_tipo        VARCHAR(1) NOT NULL,
    cliente_doc_num         VARCHAR(20) NOT NULL,
    cliente_nombre          VARCHAR(255) NOT NULL,
    cliente_direccion       TEXT,
    monto_subtotal          NUMERIC(12, 2) NOT NULL,     -- Neto sin IGV
    monto_igv               NUMERIC(12, 2) NOT NULL,
    monto_total             NUMERIC(12, 2) NOT NULL,     -- Con IGV
    estado_sunat            VARCHAR(50) NOT NULL,        -- 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR'
    mensaje_sunat           TEXT,
    xml_firmado_base64      TEXT,
    cdr_base64              TEXT,
    pdf_base64              TEXT,
    items_json              JSONB,                       -- resguardo fiel de líneas de venta
    comprobante_referencia  VARCHAR(20),                 -- para notas de crédito (documento que modifica)
    codigo_referencia       VARCHAR(2),                  -- catálogo SUNAT 09
    motivo_referencia       TEXT,
    observacion_comprobante TEXT,                        -- nota libre opcional
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    emitido_por             UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT unique_comprobante UNIQUE (ruc_emisor, tipo_comprobante, serie, correlativo)
);

-- 8. Contadores SUNAT
CREATE TABLE comprobantes_contador (
    empresa           VARCHAR(100) NOT NULL,
    tipo_comprobante  VARCHAR(2) NOT NULL,
    serie             VARCHAR(4) NOT NULL,
    ultimo_correlativo INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (empresa, tipo_comprobante, serie)
);

-- 9. Correlativos Internos
CREATE TABLE correlativos (
    key       VARCHAR(50) PRIMARY KEY,               -- 'orden_pedido'
    ultimo_val INTEGER NOT NULL DEFAULT 0
);

-- 10. Facturas (Cobranzas)
CREATE TABLE facturas (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pedido_id       UUID REFERENCES pedidos(id) ON DELETE SET NULL,
    comprobante_id  UUID REFERENCES comprobantes(id) ON DELETE SET NULL,
    numero_factura  VARCHAR(50) NOT NULL,            -- ej: F001-00000101
    cliente         VARCHAR(255) NOT NULL,
    cliente_id      UUID REFERENCES clientes(id) ON DELETE SET NULL,
    monto           NUMERIC(12, 2) NOT NULL,
    estado          VARCHAR(50) DEFAULT 'Pendiente', -- 'Pendiente' | 'Vencida' | 'Pagada' | 'Anulada'
    fecha_emision   DATE NOT NULL,
    fecha_vence     DATE NOT NULL,
    fecha_pago      TIMESTAMP WITH TIME ZONE,
    metodo_pago     VARCHAR(50),                     -- 'Transferencia' | 'Efectivo' | 'Yape'
    pago_detalle    TEXT,                            -- N° operación o glosa
    pago_img_base64 TEXT,                            -- Evidencia fotográfica
    pago_img_mime   VARCHAR(100),
    anulada_por     UUID REFERENCES users(id) ON DELETE SET NULL,
    anulada_at      TIMESTAMP WITH TIME ZONE,
    anulada_motivo  TEXT,
    asesor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Metas Mensuales
CREATE TABLE metas_asesoras (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    asesor_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    mes         DATE NOT NULL,                       -- primer día del mes
    monto_meta  NUMERIC(12, 2),                      -- meta manual (NULL = usa meta automática)
    bono        TEXT,                                -- descripción del premio/bono
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_asesor_mes UNIQUE (asesor_id, mes)
);

-- 12. Notificaciones In-App
CREATE TABLE notificaciones (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    tipo        VARCHAR(50) NOT NULL,
    titulo      TEXT NOT NULL,
    mensaje     TEXT NOT NULL,
    link        TEXT,
    pedido_id   UUID,
    leida       BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. Precios Históricos
CREATE TABLE precios_productos (
    id             UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    producto_id    UUID REFERENCES productos(id) ON DELETE CASCADE,
    precio_compra  NUMERIC(10, 2) NOT NULL,
    precio_venta   NUMERIC(10, 2) NOT NULL,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. Resúmenes SUNAT
CREATE TABLE resumenes_diarios (
    id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    empresa           VARCHAR(100) NOT NULL,
    ruc               VARCHAR(20) NOT NULL,
    fecha_referencia  DATE NOT NULL,
    correlativo       INTEGER NOT NULL,
    nombre_archivo    VARCHAR(100) NOT NULL,
    ticket            TEXT,
    estado            VARCHAR(50) NOT NULL,          -- 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO' | 'ERROR'
    boletas_incluidas INTEGER NOT NULL,
    mensaje_sunat     TEXT,
    xml_firmado_base64 TEXT,
    cdr_base64        TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_resumen UNIQUE (ruc, fecha_referencia, correlativo)
);

-- 15. Auditoría de Edición de Pedidos
CREATE TABLE pedido_ediciones (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pedido_id       UUID REFERENCES pedidos(id) ON DELETE CASCADE,
    usuario_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    usuario_nombre  VARCHAR(255) NOT NULL,
    usuario_rol     VARCHAR(50) NOT NULL,
    cambios         JSONB NOT NULL,                  -- diff estructurado {columna: {old, new}}
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. Ubicaciones Repartidores
CREATE TABLE rider_locations (
    repartidor_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude              DECIMAL(10, 8) NOT NULL,
    longitude             DECIMAL(11, 8) NOT NULL,
    accuracy              NUMERIC(10, 2),
    heading               NUMERIC(6, 2),
    speed                 NUMERIC(6, 2),
    captured_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    simulated             BOOLEAN DEFAULT FALSE,
    gps_status            VARCHAR(24) DEFAULT 'activo', -- 'activo' | 'permiso_revocado' | 'mock' | 'sin_senal'
    gps_status_changed_at TIMESTAMP WITH TIME ZONE
);

-- 17. Caché de Reportes IA
CREATE TABLE ia_insights_cache (
    cache_key   VARCHAR(255) PRIMARY KEY,            -- 'admin-mes-YYYY-MM' | 'asesor-{id}-mes-YYYY-MM'
    insight     TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Historial de Migraciones (`scripts/`)

El esquema se actualiza aplicando manualmente los siguientes scripts mediante **psql**:

| Script | Propósito |
|---|---|
| `migrate-products.mjs` | Crea `productos` y `pedido_items` base. |
| `migrate-estados.mjs` | Agrega `pedidos.estado` e inicializa transiciones de la máquina de estados. |
| `migrate-direccion-mapa.mjs` | Agrega `pedidos.direccion_mapa` para geocodificación. |
| `migrate-entregado-por.mjs` | Agrega `pedidos.entregado_por` para auditoría de entrega. |
| `migrate-despacho-v2.mjs` | Agrega `pedidos.orden_ruta` y variables para Google Directions. |
| `run-migration.mjs` | Script de backfill para agregar `asesor_id` a clientes existentes. |
| `migrate-produccion-2026-05-29.sql` | **Consolidación mayor en producción:** Agrega las tablas de comprobantes, facturas, correlativos, metas, precios de productos e inicializa sus campos. |
| `migrate-pedido-ediciones.sql` | Crea la tabla de auditoría `pedido_ediciones`. |
| `migrate-meta-bono.sql` | Agrega la columna de `bono` a la tabla `metas_asesoras`. |
| `migrate-cobranza-pago.sql` | Agrega los campos de métodos de pago y foto de depósito a `facturas`. |
| `migrate-ia-insights-cache.sql` | Crea la tabla `ia_insights_cache` para mitigar el error 429 de Gemini. |
| `migrate-rider-locations.sql` | Crea `rider_locations` para el tracking de los repartidores. |
| `migrate-unidad-pedido.sql` | Agrega `pedido_items.unidad_pedido` para la preventa vs pesaje físico. |
| `migrate-rider-gps-enforcement.sql` | Agrega `simulated`, `gps_status` y `gps_status_changed_at` a `rider_locations`. |
| `migrate-observacion-comprobante.sql` | Agrega `observacion_comprobante` en facturas y guías. |
| `migrate-produccion-fase-2-3-consolidado.sql` | **Expansión ERP 2026 (solo dev-hugo por ahora):** crea las 13 tablas de compras/tesorería/inventario del §5 y las extensiones a `pedidos` y `pedido_items`. |
| `migrate-crm.sql` / `migrate-crm-extensions.sql` / `migrate-crm-rotacion.mjs` | **Expansión ERP 2026 (solo dev-hugo):** crean `leads` y `lead_mensajes`, sus extensiones (`tags`, `unread_count`) y las columnas de rotación en `users`. |

---

## 5. Tablas de la expansión ERP 2026 (Fases 2-5 — en desarrollo, solo dev-hugo)

> [!WARNING]
> **Estas 15 tablas NO existen en producción** (verificado por SQL el 5 jul 2026: existen en la rama Neon `dev-hugo` / `ep-super-violet`, no en `ep-cool-sound`). Las crea la migración consolidada **`scripts/migrate-produccion-fase-2-3-consolidado.sql`** (13 tablas + extensiones) junto con **`scripts/migrate-crm.sql`** (las 2 del CRM). Se aplican por **psql ANTES del deploy del código nuevo** — NUNCA con scripts `.mjs` (bug DNS de Node 26, gotcha #13 de CLAUDE.md). Guía de despliegue: [20-migracion-produccion.md](./20-migracion-produccion.md).

### 5.1 Compras / Proveedores

| Tabla | Propósito y FKs clave |
|---|---|
| **`proveedores`** | Directorio de proveedores (granjas): `ruc` UNIQUE, razón social, dirección, teléfono. |
| **`compras`** | Cabecera de la compra de mercadería: `proveedor_id` → proveedores (RESTRICT), fecha, tipo/nro de documento, subtotal/IGV/total, `created_by` → users. |
| **`compra_items`** | Detalle del pesaje de la compra: `compra_id` → compras (CASCADE), `producto_id` → productos (RESTRICT); jabas, peso bruto/tara/neto, costo unitario, subtotal. |
| **`cuentas_por_pagar`** | Deudas con proveedores: `proveedor_id` y `compra_id`; monto de deuda vs pagado, estado (`Pendiente`/`Parcial`/`Pagado`), fecha de vencimiento. |
| **`prestamos_saldos`** | Saldo NETO de préstamos de mercadería por proveedor+producto (UNIQUE): jabas y kg prestados/adeudados — siempre en especie, nunca dinero. |
| **`prestamos_transacciones`** | Historial de movimientos de préstamo: `tipo_movimiento` (`PRESTAMO_RECIBIDO`/`PRESTAMO_OTORGADO`/`DEVOLUCION_RECIBIDA`/`DEVOLUCION_OTORGADA`), jabas, kg, fecha; FKs a proveedores y productos. |

### 5.2 Tesorería

| Tabla | Propósito y FKs clave |
|---|---|
| **`gastos`** | Egresos operativos (gasolina, viáticos, etc.): fecha, categoría, monto, método de pago, `created_by` → users. |
| **`caja_diaria`** | Apertura/cierre de la caja del día (`fecha` UNIQUE): montos de apertura, ingresos, egresos, cierre calculado vs real; `abierta_por`/`cerrada_por` → users. |
| **`cuentas_bancarias`** | Cuentas de tesorería dinámicas (`nombre` UNIQUE, tipo `efectivo`/`banco`/`billetera`, saldo). El seed crea 4: Caja Efectivo Planta, Yape/BCP/BBVA Antonio. |
| **`transacciones`** | Movimientos de dinero por cuenta: `cuenta_id` → cuentas_bancarias (CASCADE), `usuario_id` → users, tipo `ingreso`/`egreso`, `referencia_id` libre (pedido, gasto, etc.). |

### 5.3 Inventario / Producción

| Tabla | Propósito y FKs clave |
|---|---|
| **`inventario_lotes`** | Stock actual por producto (`producto_id` UNIQUE → productos, CASCADE). Modelo **flexible**: permite cantidades negativas (se vende sin stock registrado y se regulariza después). |
| **`mermas_diarias`** | Registro diario de mermas de producción: peso bruto, limpio, menudencia, merma y % de merma; `usuario_id` → users (RESTRICT). |

### 5.4 CRM (Leads WhatsApp)

| Tabla | Propósito y FKs clave |
|---|---|
| **`leads`** | Prospectos del CRM: `telefono` UNIQUE, negocio, estado del kanban, `vendedor_id` → users (rotación de asesoras), `chatbot_activo`, `tags`, `unread_count`. |
| **`lead_mensajes`** | Historial del chat por lead: `lead_id` → leads (CASCADE), `sender` (`cliente`/`bot`/asesora), cuerpo y tipo del mensaje. |

### 5.5 Auditoría

| Tabla | Propósito y FKs clave |
|---|---|
| **`precios_audit_log`** | Log silencioso de cada cambio de precio: `producto_id` → productos, precio anterior/nuevo, tipo (`venta`/`compra`), `modificado_por` → users. |

### 5.6 Extensiones a tablas existentes

| Tabla | Columna nueva | Propósito |
|---|---|---|
| `pedidos` | `origen VARCHAR(20) DEFAULT 'asesor'` | Distingue la venta de asesora del POS de planta (`'pos_planta'`). Las ventas POS se **excluyen** de metas/bonos (doc 14). |
| `pedidos` | `cliente_id UUID → clientes` | Vínculo vivo al cliente (la migración lo asegura con `IF NOT EXISTS`; en producción ya existía). |
| `pedido_items` | `notas TEXT` | Notas libres por línea de pedido (asegurada con `IF NOT EXISTS`). |
| `users` | `activo_rotacion BOOLEAN DEFAULT TRUE` | Si la asesora participa en la rotación de leads del CRM. |
| `users` | `orden_rotacion INT DEFAULT 1` | Posición en la rueda de asignación de leads. |
| `users` | `leads_recibidos_hoy INT DEFAULT 0` | Contador diario para balancear la rotación. |
| `leads` | `tags TEXT[]`, `unread_count INT` | Etiquetas del kanban y contador de mensajes sin leer (`migrate-crm-extensions.sql`). |

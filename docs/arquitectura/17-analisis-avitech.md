# 17 — Análisis Exhaustivo del Sistema Avitech (Operativa de Ariana)

> **Fecha de análisis:** 2026-06-28
> **Objetivo:** Documentación quirúrgica y detallada de la arquitectura, módulos, campos, formularios y reglas de negocio del sistema actual (`https://avitech.tic-dicasa.com/`) utilizado por Ariana en producción y compras.
> **Propósito:** Extraer la lógica de mermas, pesajes y flujos para integrarlos de manera optimizada en el nuevo ERP (Transavic).

---

## 1. Arquitectura de Interfaz y Navegación Base

El sistema Avitech está construido bajo un patrón clásico de ERP web (posiblemente un panel de administración monolítico).
- **Layout Principal:** Utiliza una barra de navegación superior (Navbar) para agrupar los grandes módulos del negocio.
- **Módulos Superiores (Dropdowns):**
  1. **Tablero Electrónico:** Dashboard principal.
  2. **Compras:** Despliega "Mant. Compra".
  3. **Ventas:** Despliega "Mant. Venta".
  4. **Caja:** Despliega "Rendición de Caja".
  5. **Configuración:** Despliega "Mant. Clientes", "Mant. Proveedores", "Mant. Productos".
  6. **Reportes:** Despliega "Kardex", "Reporte de Compras", "Reporte de Ventas", "Reporte de Mermas".
- **Comportamiento Visual:** Los formularios complejos (como la creación de compras) utilizan acordeones desplegables para no saturar la pantalla. Tablas dinámicas con filtros por columnas.

---

## 2. Módulo de Compras (`/compra/mant-compra/`)

Este es el núcleo operativo de Ariana. Gestiona el ingreso de mercadería (aves), el pesaje físico y el cálculo de la merma inicial (tara).

### 2.1. Vista Principal: Grilla de Mantenimiento de Compras
La pantalla principal es una tabla de datos (DataGrid) que muestra el historial.
**Columnas de la tabla (de izquierda a derecha):**
- **ID / Nro. Operación:** Identificador único autogenerado (ej. `10409`).
- **Fecha:** Fecha de ingreso al almacén (`DD/MM/YYYY`).
- **Tipo Doc / Nro Doc:** Factura o Guía del proveedor.
- **Proveedor:** Razón social del proveedor (ej. "San Fernando S.A.").
- **Producto:** Descripción del ítem (ej. "Pollo vivo", "Gallina doble pechuga").
- **Jabas (Cant.):** Número total de cajas/jabas físicas ingresadas.
- **Peso Bruto (kg):** Peso total subido a la balanza (incluye jabas).
- **Peso Tara (kg):** Peso descontado de las jabas vacías (normalmente calculado en base a un peso estándar por jaba o pesado al final).
- **Peso Neto (kg):** `Peso Bruto - Peso Tara`. Esta es la cantidad de carne real que entra al inventario.
- **Precio Unit. / Costo (S/):** Costo por kilo neto.
- **IGV (S/):** Si la compra es facturada.
- **Importe Total (S/):** `Peso Neto * Precio Unit. + IGV`.

**Filtros Superiores:**
- Búsqueda por Rango de Fechas (Desde - Hasta).
- Búsqueda por Proveedor (Input predictivo).
- Estado (Completado, Anulado, Pendiente).

**Acciones en Fila (Inline Actions):**
- **Edición Rápida (Crítico):** Permite hacer clic en la celda "Precio Unit." para editarlo directamente (ej. cambiar de `1.00` a `5.50`). Al presionar Enter o el botón de guardar, el sistema *recalcula automáticamente el Importe Total en tiempo real*.
- **Ver Detalles:** Abre el registro completo.
- **Anular Compra:** Revierte el ingreso al Kardex.

---

### 2.2. Formulario de "Agregar Compra"
Pantalla exhaustiva dividida en acordeones (secciones colapsables) debido a la gran cantidad de datos.

#### Acordeón A: Cabecera (Datos del Documento)
- **Tipo de Comprobante:** Dropdown (Factura, Boleta, Guía, Ticket).
- **Serie y Número:** Inputs de texto validado.
- **Fecha de Emisión y Fecha de Recepción:** Datepickers.
- **Moneda:** Soles / Dólares.
- **Proveedor:** Autocomplete conectado al maestro de proveedores. Si el proveedor no existe, requiere salir o usar un modal para crearlo.

#### Acordeón B: Detalle de Compra (Pesaje y Mermas Base)
Aquí se registra la mercadería línea por línea.
- **Buscador de Producto:** Input para seleccionar "Pollo", "Gallina", etc.
- **Almacén Destino:** Seleccionable si hay varias cámaras frigoríficas.
- **Calculadora de Pesaje (Algoritmo de Entrada):**
  - Input `Cant. Jabas`: Ariana ingresa cuántas cajas llegaron.
  - Input `Peso Bruto`: El peso total dictado por la balanza.
  - Input `Peso Tara`: Puede ingresarse manual, o el sistema lo autocalcula si el producto tiene configurado un "Peso por jaba estándar".
  - *Campo Bloqueado* `Peso Neto`: El sistema realiza la resta automática (`Bruto - Tara`) y muestra el resultado en rojo/negrita para verificación visual.
- **Costo y Rendimiento:**
  - Input `Precio Pactado`.
  - El sistema muestra el subtotal de esa línea.
- Botón "Agregar al detalle". Esto inserta la fila en una tabla temporal debajo del formulario.

#### Acordeón C: Montos y Pagos (Finanzas)
- **Subtotal, IGV (18%), Total:** Calculado matemáticamente de todas las filas del detalle.
- **Condición de Pago:** Contado o Crédito.
- **Días de Crédito:** Si es crédito, calcula la Fecha de Vencimiento.

#### Acordeón D: Auditoría (Tracking)
- Campos de solo lectura: `Creado por`, `Fecha de creación`, `Última modificación`.

**Regla de Negocio Crítica detectada:** 
La merma *operativa* (el peso que se pierde porque el pollo gotea agua, merma de sangre o al despresar) NO se registra en este formulario inicial. Este formulario solo registra el peso de entrada al almacén. Las mermas posteriores se manejan ajustando el Kardex o reportando salida por merma en otro módulo.

---

## 3. Módulo de Ventas (`/venta/mant-venta/`)

### 3.1. Tablero Electrónico (Dashboard)
- **Indicadores (Tarjetas):** Total vendido hoy (S/), Kilos despachados hoy, Cantidad de tickets emitidos, Cuentas por cobrar del día.
- **Gráficos:** Curva de ventas por hora.
- **Alertas:** Lista de pedidos urgentes o cobros pendientes.

### 3.2. Mantenimiento de Ventas (Listado)
- Grilla con: ID Venta, Cliente, Documento (DNI/RUC), Kilos Totales, Monto Total, Estado (Pagado, Debe, Anulado), Vendedor/Asesor.
- Botones para: "Reimprimir Ticket", "Generar XML SUNAT", "Anular".

### 3.3. Formulario de Venta (Punto de Venta interno)
- **Búsqueda de Cliente:** Autocompletado rápido. Si se teclea un RUC nuevo, consulta a base de datos externa (como SUNAT/Reniec).
- **Líneas de Venta:**
  - Producto.
  - Peso (Kg) a vender.
  - Precio Unitario de Venta (El sistema tiene un maestro de precios, pero permite override manual).
  - Subtotal.
- **Cobro:** Modalidad de pago (Efectivo, Yape, Transferencia, Crédito). Múltiples medios de pago permitidos por ticket.

---

## 4. Módulo de Configuración y Maestros

### 4.1. Mantenimiento de Clientes (`/cliente/mant-cliente/`)
- **Directorio Principal:** Lista extensa con Paginación. Barra de búsqueda por "Nombre" o "Documento".
- **Campos del Perfil del Cliente:**
  - `Tipo de Documento`: Dropdown (DNI, RUC, CE, Pasaporte).
  - `Número de Documento`: Text input (validado a 8 o 11 dígitos).
  - `Nombre / Razón Social`: Obligatorio.
  - `Dirección Fiscal`: Requerido para facturas.
  - `Teléfono / WhatsApp`: Para contacto.
  - `Email`: Para envío automático de facturas XML.
  - `Límite de Crédito (S/)`: Configuración de riesgo.
  - `Lista de Precios Asignada`: (Ej. Precio Mayorista, Precio Final).

### 4.2. Mantenimiento de Productos (`/producto/mant-producto/`)
- `Código SKU`, `Descripción`, `Unidad de Medida` (Kilos, Unidades, Jabas).
- `Precio de Compra Referencial`, `Precio de Venta Base`.
- `Afectación IGV`: Gravado, Exonerado, Inafecto (Crítico para pollos enteros vs procesados según ley peruana).

---

## 5. Módulo de Caja (`/caja/rendicion-caja/`)

- **Apertura de Caja:** Registra el saldo inicial (sencillo).
- **Ingresos:** Ventas al contado, Cobranzas de créditos anteriores.
- **Egresos:** Pagos a proveedores en efectivo, gastos operativos (gasolina, viáticos).
- **Cierre / Cuadre de Caja:** Calcula el teórico (`Apertura + Ingresos - Egresos`) contra el físico ingresado por el cajero. Genera sobrantes o faltantes.

---

## 6. Reportes y Kardex (Inventario y Mermas)

- **Kardex Físico y Valorado:** Seguimiento exacto de los kilos. Movimientos tipificados:
  - `01` - Saldo Inicial.
  - `02` - Ingreso por Compra.
  - `03` - Salida por Venta.
  - `04` - Salida por Merma / Desecho. (Aquí se reporta la pérdida de peso por agua o despresado).
- **Reporte de Mermas:** Muestra el porcentaje de pérdida entre lo que ingresó a la cámara frigorífica y lo que finalmente se vendió o desechó.

---

## 💡 Plan Quirúrgico: Lo que debemos llevar a Transavic (Mejorado)

Basado en este análisis exhaustivo, para construir un sistema que supere a Avitech y le ahorre el doble de tiempo a Ariana, aplicaremos estas decisiones arquitectónicas en el código de Transavic:

1. **Calculadora de Jabas / Pesos (Migración a UI Reactiva):**
   - **Avitech:** Requiere clics, recargas y navegar acordeones.
   - **Transavic (Propuesta):** En `/dashboard/produccion`, implementaremos la calculadora `Bruto - Tara = Neto` de forma totalmente reactiva (usando estados de React u `useForm` de `react-hook-form`). Al ingresar el peso bruto, el neto se calculará en milisegundos sin ir al servidor.

2. **Inline Editing de Costos (Uso de Server Actions):**
   - **Avitech:** El "guardar" precio en la grilla es rápido y funciona.
   - **Transavic:** Lo mejoraremos. Usaremos Optimistic Updates (`useOptimistic` de React 19) en la grilla. Si Ariana corrige un peso o un costo, la UI se actualiza al instante, y por detrás un Server Action de Next.js (`actualizarPrecioAction`) actualiza Neon Postgres de forma asíncrona.

3. **Manejo de Mermas Reales (Optimización del Flujo):**
   - **Avitech:** La merma de despresado se maneja como un "ajuste de kardex" posterior.
   - **Transavic:** Automatizaremos esto en la Máquina de Estados. Cuando el pedido pase de `Pendiente` a `En_Produccion`, Ariana ingresará el "Peso Real Obtenido". El sistema calculará la diferencia contra el "Peso Solicitado" y registrará automáticamente la merma en la base de datos (nueva tabla `mermas_diarias` o registro en `analytics`), sin que Ariana tenga que hacer un ajuste manual de inventario.

4. **Menús vs Dashboard Unificado:**
   - **Avitech:** Excesiva cantidad de clics en la Navbar para hacer tareas cruzadas (buscar un cliente -> ir a ventas -> ir a caja).
   - **Transavic:** Mantendremos el Sidebar enfocado por roles (`roles.ts`). Para Ariana (Rol Producción/Compras), su pantalla principal será un **Command Center (Tablero Unificado)** donde tendrá la cola de pedidos pendientes de peso a la izquierda, y el registro rápido de compras/jabas a la derecha.

5. **Directorio de Clientes Inteligente:**
   - **Avitech:** Tipeo manual de San Fernando, búsqueda en modal.
   - **Transavic:** Ya lo tenemos mapeado con `apisperu`. Lo expandiremos para que en el momento del pesaje, la asociación de proveedor/cliente sea predictiva usando memoria en Redis o consultas súper rápidas en Neon.

---

## 📌 Estado de implementación (jul 2026)

Del "Plan Quirúrgico" anterior, esto es lo que YA existe en el código de Transavic (auditoría del 5 jul 2026, módulos en local/dev-hugo):

| Propuesta | Estado |
|---|---|
| 1. Calculadora de jabas / mermas (`Bruto - Tara = Neto` reactiva) | ✅ Implementada (módulos de compras y mermas) |
| 2. Inline editing con optimistic updates (`useOptimistic`) | ❌ Pendiente — no hay `useOptimistic` en el código; la edición existe pero sin optimistic updates |
| 3. Manejo de mermas reales / Kardex flexible | ✅ Implementado (`mermas_diarias` + `inventario_lotes` con inventario flexible que permite negativos) |
| 4. Command Center unificado para Ariana | ⚠️ Parcial — existen las pantallas por módulo, pero no el tablero unificado único |
| 5. Directorio de clientes/proveedores inteligente (apisperu) | ✅ Implementado |
| (Extra) POS de venta rápida en planta (equivalente al formulario de venta de Avitech, §3.3) | ✅ Implementado — crea pedidos con `origen = 'pos_planta'` y estado `Entregado` directo |

*(Fin del documento exhaustivo)*

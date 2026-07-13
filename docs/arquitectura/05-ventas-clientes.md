# 05 — Ventas y Directorio de Clientes

> **Última verificación contra código:** 2026-07-12
> **Estado del proyecto:** `main` + cambios locales pendientes
> **Archivos clave:** `src/components/PedidoForm.tsx`, `src/components/ClienteAutocomplete.tsx`, `src/lib/clientes-duplicados.ts`, `src/lib/parse-detalle-pedido.ts`, `src/app/api/clientes/verificar/route.ts`

Este documento describe la vista de preventa de pedidos, la lógica de autocompletado del directorio de clientes y los mecanismos de prevención de duplicados de carteras comerciales.

> [!IMPORTANT]
> Este documento cubre **Ventas Ejecutivas**. Campo usa `clientes_avicola`/`ventas_avicola`
> ([doc 21](./21-clientes-avicola.md)) y Planta usa POS + clientes/cartera propios
> ([docs 10](./10-pos-caja-tesoreria.md) y [25](./25-clientes-cobranzas-planta.md)). Las tres
> se unen solo en vistas/reportes y motor CPE conforme al [mapa 22](./22-operaciones-ventas-facturacion.md).

---

## 1. El Formulario de Venta (`PedidoForm.tsx`)

Ubicado en `/dashboard/nuevo-pedido`, es el componente React principal que las asesoras utilizan para registrar las órdenes de compra diarias.

- **Estructura del formulario:**
  - **Identificación:** RUC/DNI del cliente con botón de consulta SUNAT.
  - **Datos del Pedido:** Cliente (nombre), WhatsApp, Dirección de entrega, Distrito (selector de los 18 autorizados), Tipo (Frecuente/Nuevo), Empresa emisora (Transavic / Avícola de Tony) y Rango horario de entrega.
  - **Detalle de Venta:** Cuadro de texto libre `detalle` (para notas del pedido) y el componente `ProductSelector` para armar el carrito estructurado.
- **Acciones y Render:**
  - Al completar la edición, el formulario pasa a estado `'preview'` renderizando el ticket como se verá en formato de impresión.
  - La asesora confirma, se llama a `POST /api/pedidos` y, tras una respuesta exitosa, se utiliza `html-to-image` para exportar la previsualización a un archivo JPEG descargable que se comparte directamente por WhatsApp.

---

## 2. Autocompletado e Integración SUNAT

Para acelerar el registro, `ClienteAutocomplete.tsx` permite escribir el nombre o RUC/DNI de un cliente registrado.

- **Consulta en Vivo SUNAT/RENIEC:** Si el cliente es nuevo, la asesora escribe el número de documento y presiona el ícono de consulta. Llama a `/api/consulta-documento` que utiliza el API de **apisperu.com** con el token `APISPERU_TOKEN`.
- **Salida:** Autocompleta el nombre (razón social) y la dirección fiscal estructurada de la SUNAT, guardando además el ubigeo y distrito.

---

## 3. Captura Geográfica (`MapInput.tsx`)

Usa `@react-google-maps/api` para georreferenciar la dirección de entrega del cliente. Soporta tres modos de captura de coordenadas:
1. **Buscar dirección:** Utiliza el buscador autocompletado de Google Places.
2. **Ubicación actual:** Solicita la posición GPS del navegador/móvil.
3. **Marker manual:** Permite arrastrar el pin directamente en el mapa sobre la calle exacta.

---

## 4. Control de Duplicados de Clientes (`lib/clientes-duplicados.ts`)

Para evitar conflictos de comisiones y robo de carteras entre asesoras, se implementa una validación estricta de clientes duplicados en base a **RUC/DNI** o **WhatsApp**.

- **Endpoint Global:** `GET /api/clientes/verificar?documento=X&whatsapp=Y` es un endpoint público del servidor (exento de scoping de asesora). Devuelve si el cliente existe y qué asesora es su propietaria actual, pero **no** muestra datos de contacto ni dirección si pertenece a una cartera ajena.
- **Lógica de Validación (`lib/clientes-duplicados.ts`):**
  - Si una asesora intenta crear o modificar un cliente que tiene el mismo RUC/DNI o WhatsApp de un cliente de **otra asesora**, el sistema responde un **error 409 (Conflicto)** duro impidiendo el guardado.
  - Si el cliente duplicado es de su **propia cartera**, se emite un aviso (alerta blanda) con opción a confirmación forzada (`permitir_duplicado: true`).
  - **Exención del Administrador:** El admin recibe un aviso blando con opción de forzar el guardado (`puede_forzar: true`) y sugerencia de confirmación.
  - **No bloqueo del pedido:** Si una asesora registra un pedido suelto escribiendo el RUC de un cliente de cartera ajena, **el pedido nunca se bloquea** (decisión de negocio de Antonio: "una venta bloqueada es peor que un conflicto administrativo").

---

## 5. Derivación de Ítems por Texto (`parse-detalle-pedido.ts`)

Si por algún motivo (como el uso de la cola offline) un pedido ingresa desde el celular sin ítems estructurados pero contiene texto en la caja de `detalle`, el backend ejecuta un parseo automático en el `POST` antes del insert:

- **Fórmula de análisis:** Escanea líneas del texto buscando patrones como `[cantidad] [unidad] - [nombre_producto]` (ej: `"3 pollos enteros"`, `"5 kg chuleta de cerdo"`).
- **Match de catálogo:** Intenta buscar por prefijo o coincidencia aproximada de palabras contra el catálogo de `productos`. Si encuentra el producto, inserta automáticamente el registro en `pedido_items` con el precio de venta del catálogo, garantizando que el pedido nunca nazca vacío de ítems (requisito clave para Producción).

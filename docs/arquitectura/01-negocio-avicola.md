# 01 — El Negocio Avícola y su Operativa

> **Última verificación contra código:** 2026-07-13
> **Estado del proyecto:** base operativa en `main`; mejoras de proveedores, POS, Producción y conciliación en `codex/cambios-operativos-julio`, aún no desplegadas
> **Archivos clave:** `src/components/PedidoForm.tsx`, `src/app/dashboard/produccion/produccion-client.tsx`, `src/app/dashboard/despacho/despacho-content.tsx`, `src/app/dashboard/mi-ruta/mi-ruta-content.tsx`

Este documento describe el **funcionamiento real del negocio avícola de Antonio Resurrección** en Lima, Perú, y cómo se traduce este flujo comercial y operativo en el sistema Transavic.

---

## 1. Contexto Comercial

### 1.1 El Cliente y las Marcas
El dueño y cliente final del sistema es **Antonio Resurrección**. Su empresa opera dos marcas comerciales distintas que comparten el mismo flujo operativo pero se diferencian a nivel de facturación, emisión SUNAT y logotipos:
- **Transavic** — Marca principal (pollo, gallinas, menudencia).
- **Avícola de Tony** — Segunda marca comercial.

En el sistema, `empresa` puede ser `"Transavic"` o `"Avícola de Tony"`; determina RUC/serie/certificado y presentación visual. **No determina la cartera.** La operación de venta (Ejecutivas, Campo o Planta) determina clientes, deuda y pagos.

### 1.2 Catálogo de Productos y Precios Dinámicos
El negocio vende pollo (entero, despresado, filetes), carnes (res, cerdo) y huevos.
- **Volatilidad de precios:** Los precios de las aves y carnes frescas en Lima fluctúan diariamente según la escasez del mercado mayorista y los acuerdos específicos con cada cliente.
- **Unidades de Medida:** Coexisten unidades de conteo (`uni` o `NIU` para SUNAT) y unidades de peso (`kg` o `KGM` para SUNAT). La asesora vende de forma estimada (ej. "3 pollos enteros" o "12 chuletas de cerdo"), pero el cobro final se realiza en función del **peso real obtenido en balanza**.

### 1.3 Las tres operaciones de venta

| Operación | Quién vende | Ciclo operativo | Cartera |
|---|---|---|---|
| Ejecutivas | asesoras por WhatsApp | pedido → producción → despacho → reparto | `facturas` |
| Campo | Antonio visitando mercados/avícolas | venta por peso → guía interna → abonos | saldo derivado + `abonos_avicola` |
| Planta | admin/producción en mostrador | POS → inventario/caja o crédito | `cobranzas_planta` + `abonos_planta` |

Las tres comparten catálogo y motor SUNAT, pero no deben compartir clientes ni deuda por accidente. Ver [22-operaciones-ventas-facturacion.md](./22-operaciones-ventas-facturacion.md).

---

## 2. Las 5 Áreas Operativas

La operación diaria de Transavic se divide en cinco etapas interconectadas, denominadas el **"lazo del dinero"**:

```
[ Asesora ] ── WhatsApp ──> [ Registro Pedido (Estimado) ]
                                    │
                                    ▼
[ Producción ] ─────────────> [ Pesa Balanza e Ingresa Peso Real ]
                                    │
                                    ▼
[ Admin (Antonio) ] ────────> [ Asigna Ruta a Motorizado + Optimiza ]
                                    │
                                    ▼
[ Repartidor ] ─────────────> [ Viaje GPS Obligatorio ──> Entrega con Firma/Foto ]
                                    │
                                    ▼
[ Facturación/SUNAT ] ──────> [ Emisión CPE + actualiza la cartera de la operación ]
```

### 2.1 Preventa y Registro (Asesoras)
Las asesoras (Leslie, Jhoselyn, Sarai, Yesica) manejan la relación directa con los clientes (restaurantes, chifas, mayoristas y consumidores de 18 distritos de Lima) vía WhatsApp.
- **Acción:** Crean los clientes en el directorio (con scoping de propiedad exclusivo por asesora para evitar conflictos de cartera) y registran los pedidos con cantidades estimadas.
- **Salida:** Generan un ticket JPEG del pedido y lo comparten por WhatsApp al cliente como presupuesto estimado de entrega.

### 2.2 Preparación y Pesaje (Producción)
La planta de producción y pesaje físico opera temprano en la madrugada.
- **El reto físico:** No es posible despachar exactamente 10 kg de filete de pollo sin variaciones de gramos. Tampoco 64 chuletas de cerdo pesan siempre lo mismo.
- **Acción:** El personal de producción pesa los productos en balanzas digitales y registra en el panel de `/dashboard/produccion` los **pesos y cantidades reales** (`cantidad_real` y `subtotal_real`).
- **Conversión de Unidades:** Si un producto se vendió en unidades (`uni`), Producción puede pesar el bloque y cambiar la unidad de venta a kilogramos (`kg`) en el select correspondiente para poder cobrar el importe exacto. El pedido no puede salir del local sin haber sido pesado y marcado como `Listo_Para_Despacho`.

### 2.3 Logística y Despacho (Administrador)
Antonio gestiona la flota de 6 motorizados desde el panel de `/dashboard/despacho`.
- **Acción:** Arrastra los pedidos listos a las columnas de cada motorizado, utiliza la API de Google Directions para ordenar la secuencia de entrega (`orden_ruta`) minimizando el tiempo y kilómetros de ruta, bloquea las columnas para evitar reordenamientos accidentales y emite la orden de pedido impresa (ticket físico de 80mm o A4).

### 2.4 Reparto y Confirmación (Repartidores)
Los motorizados cargan los pedidos físicos en sus vehículos y abren la aplicación móvil (envuelta en **Capacitor** para Android).
- **Acción:** Inician la ruta. El sistema activa el tracking de GPS de forma obligatoria durante el reparto para que el admin vea la ubicación en tiempo real en la central y estime el ETA de arribo del pedido.
- **Salida:** En el destino, el motorizado cobra (si es pago contra entrega), hace firmar la orden impresa y sube una foto de la orden firmada desde la cámara del celular. El pedido pasa a `Entregado`.

### 2.5 Facturación y Conciliación (Cobranzas)
Una vez definida la venta, se puede emitir el comprobante legal a SUNAT.
- **Ejecutivas:** el CPE crea/enlaza la cuenta por cobrar en `facturas`.
- **Campo:** el CPE no crea deuda nueva; el saldo ya proviene de ventas y abonos.
- **Planta:** el contado ya movió caja/cuenta y el crédito vive en `cobranzas_planta`; emitir o reintentar no debe duplicarlo en `facturas`.
- **Salida:** cada operación concilia en su propio circuito, aunque PDF/XML/CDR/NC/GRE reutilicen infraestructura tributaria.

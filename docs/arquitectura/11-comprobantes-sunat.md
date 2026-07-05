# 11 — Módulo de Facturación y SUNAT (CPE)

> **Última verificación contra código:** 2026-06-28
> **Commit del proyecto:** `9f29f5a`
> **Archivos clave:** `src/lib/sunat/index.ts`, `src/lib/sunat/xml-builder.ts`, `src/lib/sunat/xml-signer.ts`, `src/lib/sunat/soap-client.ts`, `src/lib/sunat/parse-cpe-items.ts`, `src/lib/sunat/fechas.ts`

Este documento describe la arquitectura y el flujo de integración tributaria con SUNAT para la emisión de Comprobantes de Pago Electrónicos (CPE).

---

## 1. Configuración Multi-Empresa

El sistema soporta dos empresas emisoras mediante variables de entorno configuradas directamente en Vercel (Producción):
- **Transavic** (`20612806901` - RUC 20) $\rightarrow$ Usa credenciales de usuario SOL secundario `APIFACTU`.
- **Avícola de Tony** (`10710548841` - RUC 10) $\rightarrow$ Mismo usuario SOL `APIFACTU`.

La clase `getSunatConfig(empresa)` en `config-transavic.ts` retorna de forma dinámica las contraseñas, claves SOL y certificados en base64 según el emisor seleccionado en el pedido.

---

## 2. El Flujo de Emisión de un CPE

La emisión de una Boleta (03) o Factura (01) en `src/lib/sunat/index.ts` sigue una secuencia atómica de 6 pasos:

```
[Datos Pedido] 
      │
      ▼
1. Construir XML UBL 2.1 (xml-builder.ts)
      │
      ▼
2. Firmar XML (xml-signer.ts usando cert .p12 y xml-crypto)
      │
      ▼
3. Comprimir XML firmado en PKZip (.zip)
      │
      ▼
4. Enviar a Webservice SOAP de SUNAT (soap-client.ts)
      │
      ▼
5. Recibir y persistir respuesta (CDR en base64)
      │
      ▼
6. Descomprimir CDR y clasificar estado (fflate)
```

---

## 3. Manejo y Clasificación de Respuestas SUNAT (Constancia de Recepción - CDR)

Para evitar clasificar erróneamente comprobantes que fueron rechazados u observados:

- **Descompresión en Servidor (`soap-client.ts`):** SUNAT responde con un archivo ZIP que contiene la constancia CDR. El helper `descomprimirCDR` utiliza **`fflate.unzipSync`** para extraer y parsear el XML del CDR.
- **Clasificación Fail-Safe (Segura):**
  - Si el CDR es ilegible o el código SOAP no es entero, el estado se clasifica como **`ERROR`** (nunca `ACEPTADA` por defecto).
  - Códigos entre `100` y `3999` definen un **`RECHAZADA`** duro.
  - El mensaje de estado oficial de SUNAT se persiste en `mensaje_sunat` (útil para auditoría si contiene observaciones como la 4095/4260).

---

## 4. Redondeo de Totales e IGV (Anclaje al Precio con IGV)

Por convención de negocio, los precios se teclean e ingresan **CON IGV** (ej: S/100.00). El método estándar de cálculo tributario (dividir entre 1.18 y aplicar 18%) generaba descuadres de céntimos en el total (S/100.01) rechazados por SUNAT o rechazados por clientes en cobranza.

**La solución (`xml-builder.ts:calcularTotales`):**
- Por cada línea se calcula el importe bruto con IGV: `bruto = r2(precioConIgv * cantidad)`.
- Se deriva el valor de venta neto: `valorVenta = r2(bruto / 1.18)`.
- El IGV se obtiene restando directamente el valor de venta del bruto: **`IGV = bruto - valorVenta`** (en lugar de calcular `r2(base * 0.18)`).
- Esto asegura que el total cuadre exactamente con el bruto ingresado por el usuario (100.00) y se mantenga dentro de la tolerancia de redondeo exigida por SUNAT.

---

## 5. El PDF y Correo como Representaciones Fieles (`parse-cpe-items.ts`)

Para evitar inconsistencias visuales en el PDF del comprobante o en el reporte de facturación Excel:
- **Regla de Oro:** El generador de PDF (`pdf-comprobante.ts`) y el envío de correo **no leen los ítems de las tablas de pedidos de la base de datos**.
- **Fuente de verdad única:** Utilizan el helper `parseCpeItems(xml_firmado_base64)` para deserializar directamente el XML enviado y firmado. Esto garantiza que lo que visualiza el cliente sea exactamente lo que la SUNAT validó y aprobó legalmente.

---

## 6. Operaciones Secundarias

### 6.1 Reintentar Envío (`/[id]/reintentar`)
Si un comprobante queda en estado `ERROR` (caída del web service de SUNAT, etc.), el admin o la asesora dueña de la venta pueden reintentar la emisión. El endpoint lee la columna `comprobantes.items_json` (una copia estructurada de seguridad creada durante el intento original) y reconstruye el XML sin fabricar datos nuevos, utilizando el **mismo número correlativo**.

### 6.2 Notas de Crédito (07)
Modifican facturas o boletas para anulación o corrección. Copian las líneas de ítem de forma exacta desde el XML de la factura original usando el parser, recalculando el IGV de forma anclada para evitar descuadres.

### 6.3 Comunicación de Baja (RA-) y Resumen Diario (RC-)
- **Baja:** Se genera para anulación de facturas (01) dentro del plazo legal. Envía un XML especial y genera un ticket de consulta de estado.
- **Resumen Diario (RC-):** Proceso automático que agrupa todas las boletas de venta (03) del día anterior y las envía a SUNAT en un lote consolidado. Se ejecuta mediante el cron `/api/cron/resumen-diario-sunat` a las 02:00 Lima.
- **Fechas tributarias:** La fecha oficial de los comprobantes se calcula utilizando `fechaHoyLima()` de `fechas.ts` (evitando desajustes horarias de Vercel UTC que generaban el error de fecha futura 2329).

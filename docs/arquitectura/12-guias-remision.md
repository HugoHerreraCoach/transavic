# 12 — Guías de Remisión Electrónicas (GRE REST)

> **Última verificación contra código:** 2026-07-12
> **Estado del proyecto:** `main` + cambios locales pendientes
> **Archivos clave:**
> - `src/lib/sunat/xml-builder-guia.ts`
> - `src/lib/sunat/rest-client.ts`
> - `src/app/api/guias/emitir/route.ts`
> - `src/app/dashboard/guias/emitir-guia-modal.tsx`
> - `src/app/api/sunat/entorno/route.ts`

Este documento detalla la integración con la API REST de la SUNAT para la emisión de Guías de Remisión Electrónicas (GRE Remitente, tipo de comprobante "09").

---

## 1. Contexto Operativo y Tecnológico

La SUNAT exige el uso de la **API REST de Guías de Remisión Electrónicas (GRE 2.0)** para la emisión de Guías de Remisión Remitente (CPE tipo "09"). Esto difiere del canal SOAP utilizado para boletas, facturas y notas de crédito.

En este proyecto, se implementó el flujo REST completo:
- Genera el XML en base al estándar UBL 2.1.
- Firma digitalmente el XML usando el certificado `.p12` del emisor.
- Comprime el archivo en ZIP y calcula su hash SHA-256 en hexadecimal.
- Transmite el archivo a la pasarela REST de SUNAT, realiza polling de consulta del `ticket` de respuesta y descarga el CDR (Constancia de Recepción) final.

---

## 2. Flujo de Transmisión REST (`rest-client.ts`)

- **OAuth2 Dinámico:** Se conecta con `api-seguridad.sunat.gob.pe` usando las credenciales SOL secundarias y las llaves de aplicación registradas ante SUNAT (una dupla por empresa, guardadas como `SUNAT_TRA_CLIENT_ID/SECRET` y `SUNAT_AVI_CLIENT_ID/SECRET` en Vercel) para obtener un token de acceso JWT temporal.
- **Transmisión y Polling:** Envía el ZIP comprimido al endpoint de recepción REST de SUNAT (`api-cpe.sunat.gob.pe` en producción y `api-cpe-test.sunat.gob.pe` en beta). SUNAT responde con un identificador de ticket. El cliente realiza consultas periódicas de estado del ticket (`consultarTicket`) hasta descargar el CDR que aprueba el envío.

---

## 3. Reglas Estrictas del Validador XML (SUNAT)

| Error SUNAT | Mensaje de Error | Diagnóstico / Causa Raíz | Solución Implementada |
|---|---|---|---|
| **3418** | El tag cbc:Information no es permitido para el motivo de traslado "01" (Venta). | Se intentaba enviar el nodo `<cbc:Information>` con detalles adicionales cuando el motivo era "Venta". SUNAT solo lo permite para los motivos 08, 09 y 19. | Se condicionó la generación del elemento `<cbc:Information>` en `xml-builder-guia.ts` para que solo se agregue si el código de traslado es 08, 09 o 19. |
| **2566** | El XML no contiene el tag de Placa del vehículo de transporte privado. | Se omitía el número de placa cuando la guía se configuraba para transporte privado o repartidor interno. | Se añade la placa del vehículo (`cac:LicensePlateID` en `cac:RoadTransport`). Con el indicador M1/L activo, este tag se omite legítimamente. |
| **3360** | El XML no contiene el tag cbc:FirstName o cbc:FamilyName en DriverPerson. | El validador espera que el nombre del conductor esté estructurado formalmente en campos de nombres y apellidos separados, en lugar de un campo de nombre completo. | Se modificó la interfaz `DatosGuia` para reemplazar el campo `repartidor.nombre` por `repartidor.nombres` y `repartidor.apellidos`, mapeándolos al XML en `<cbc:FirstName>` y `<cbc:FamilyName>`. |
| **2574** | El XML no contiene el tag o no existe información de dirección detallada de punto de llegada. | Se utilizaba `<cbc:StreetName>` para definir la dirección del cliente en el punto de llegada, pero el esquema estricto de la GRE exige estructurarla con `<cac:AddressLine><cbc:Line>`. | Se reemplazó el uso de `<cbc:StreetName>` por `<cac:AddressLine><cbc:Line>` en el bloque del punto de llegada de `xml-builder-guia.ts`. |

---

## 4. Vehículos de Categoría M1/L (Motos y Autos Ligeros)

Esta regla es fundamental para Transavic, ya que la mayoría de los repartos se realizan mediante **motorizados externos (motos)** de los cuales no siempre se tiene DNI, licencia o número de placa.

- **Exención de datos:** En la modalidad de transporte privado (`02`), si se activa el indicador de traslado en vehículo de categoría M1 o L (motos = categoría L), SUNAT permite **OMITIR la placa del vehículo y todos los datos del conductor** (documento, nombres, apellidos y licencia).
- **Emisión XML:** El indicador se emite como `<cbc:SpecialInstructions>SUNAT_Envio_IndicadorTrasladoVehiculoM1L</cbc:SpecialInstructions>` dentro de `cac:Shipment` (`xml-builder-guia.ts:166-168`).
- **Lógica de validación compartida:** Las validaciones de obligatoriedad del chofer se unificaron en `src/lib/guia-form-shared.ts` (método `validarChofer`). Si el checkbox "Vehículo M1/L (Motos/Ligeros)" está activo, los campos del conductor se vuelven opcionales en el formulario y la API omite los nodos del XML.

---

## 5. Diferencia entre Orden Interna y GRE Legal

Es crucial distinguir las dos numeraciones:
- **Orden de Pedido Interna:** Se genera para control de almacén en `/pedidos/[id]/guia` (imprimible en tiquetera de 80mm). Su número correlativo es autogestionado por la tabla `correlativos.orden_pedido` (ej: `0004523`). Históricamente se le llamaba "Guía", pero **no** tiene validez SUNAT.
- **Guía de Remisión Electrónica (GRE):** Es el documento tributario oficial. Utiliza una serie legal de 4 caracteres (ej: `T001` o `T002`) y correlativos atómicos administrados en la tabla `comprobantes_contador` al momento de la transmisión REST exitosa.

---

## 6. Operación de origen: Ejecutivas, Campo o Planta

La GRE se asocia al CPE mediante `comprobantes_guias.comprobante_id`. Su operación no se decide
por empresa ni por la presencia de un pedido aislado, sino por el **CPE de referencia**:

1. `comprobantes.venta_avicola_id` → Campo.
2. En otro caso, pedido con `origen='pos_planta'` → Planta.
3. El resto → Ejecutivas.

Para Campo, la dirección del receptor se obtiene del XML firmado del comprobante, porque no existe
un `pedido_id`. Esta misma herencia debe conservarse en filtros, listado y exportación. Si se cambia
la clasificación de operaciones, revisar también [22 §3–5](./22-operaciones-ventas-facturacion.md).

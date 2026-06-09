# 06 — Integración de Guías de Remisión Electrónicas (GRE 2.0 REST)

> **Última verificación contra código:** 2026-06-08
> **Commit del proyecto:** desplegado en `main` (GRE en producción; ver gotcha #28 del CLAUDE.md)
> **Archivos clave:** 
> - [src/lib/sunat/xml-builder-guia.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/lib/sunat/xml-builder-guia.ts)
> - [src/lib/sunat/rest-client.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/lib/sunat/rest-client.ts)
> - [src/app/api/guias/emitir/route.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/app/api/guias/emitir/route.ts)
> - [src/app/dashboard/guias/emitir-guia-modal.tsx](file:///Users/hugoherrera/Programación/proyectos/transavic/src/app/dashboard/guias/emitir-guia-modal.tsx)
> - [src/app/api/sunat/entorno/route.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/app/api/sunat/entorno/route.ts)

---

## 1. Contexto Operativo y Tecnológico

La SUNAT exige de forma obligatoria el uso de la **API REST de Guías de Remisión Electrónicas (GRE 2.0)** para la emisión de Guías de Remisión Remitente (CPE tipo "09"). Esto reemplaza el antiguo canal de comunicación basado en SOAP utilizado para boletas, facturas y notas de crédito.

En este proyecto, se implementó el flujo REST completo desde cero, logrando firmar digitalmente el XML de la guía (usando el certificado `.p12` del emisor), comprimirlo en formato ZIP, calcular su hash SHA-256 en hexadecimal, y transmitirlo a la pasarela REST de SUNAT.

---

## 2. Avances en el Desarrollo

1. **Cliente de Conexión REST (`rest-client.ts`)**:
   - Implementa el flujo OAuth2 de SUNAT (`api-seguridad.sunat.gob.pe`) para obtener tokens JWT dinámicos de acceso usando las credenciales del usuario secundario SOL y el Client ID/Secret del ERP.
   - Procesa y empaqueta en ZIP el XML generado.
   - Envía el documento al endpoint de recepción REST de SUNAT y obtiene un número de `ticket`.
   - Realiza polling (bucle de consulta de ticket) hasta obtener la confirmación y descargar el archivo CDR (Constancia de Recepción) del servidor de SUNAT.

2. **Estructuración del XML (`xml-builder-guia.ts`)**:
   - Genera el XML en base al estándar UBL 2.1 para Guías de Remisión Electrónica.
   - Aplica namespaces oficiales y estructuras válidas para los puntos de partida, llegada, conductor y vehículo.

3. **Verificación Exitosa en Entorno de Pruebas (Beta)**:
   - Se creó el script de pruebas `test_gre_produccion.ts` que permite firmar y enviar guías en modo Beta utilizando las firmas y credenciales reales del negocio.
   - Tras corregir múltiples restricciones del validador de SUNAT (ver sección de Aprendizajes), la SUNAT devolvió un CDR de **Éxito (Código 0 - Guía Aceptada sin observaciones)** para la guía de pruebas `T001-00814091`.

---

## 3. Lo que Hemos Aprendido (Lecciones Clave de SUNAT)

Durante la fase de integración y depuración en local, chocamos con varias reglas estrictas y a menudo indocumentadas del validador de la SUNAT. A continuación, se detallan las lecciones y cómo solucionamos cada error:

### A. Autenticación y Conectividad
- **Client ID y Scopes**: Las credenciales de la API de SUNAT deben generarse en el portal SOL bajo la categoría de aplicación "Desktop" y se les debe otorgar expresamente el scope de **GRE Emisión de Comprobantes** (`/v1/contribuyente/gem`). De lo contrario, SUNAT responde con error `unauthorized_client` al solicitar el token.
- **Servidor de Pruebas y Certificado SSL**: La URL del servidor de pruebas REST es `api-cpe-test.sunat.gob.pe`. Dicho servidor utiliza un certificado SSL autofirmado que causa un error `DEPTH_ZERO_SELF_SIGNED_CERT` en Node.js. Para solucionarlo en desarrollo, se configuró dinámicamente `NODE_TLS_REJECT_UNAUTHORIZED="0"` cuando `SUNAT_ENVIRONMENT === "beta"`.
- **Propagación**: Las credenciales recién creadas tardan entre 15 minutos y 2 horas en propagarse en los servidores de SUNAT.

### B. Errores del Validador XML Corregidos

| Error SUNAT | Mensaje de Error | Diagnóstico / Causa Raíz | Solución Implementada |
|---|---|---|---|
| **3418** | El tag cbc:Information no es permitido para el motivo de traslado "01" (Venta). | Se intentaba enviar el nodo `<cbc:Information>` con detalles adicionales cuando el motivo era "Venta". SUNAT solo lo permite para los motivos 08, 09 y 19. | Se condicionó la generación del elemento `<cbc:Information>` en `xml-builder-guia.ts` para que solo se agregue si el código de traslado es 08, 09 o 19. |
| **2566** | El XML no contiene el tag de Placa del vehículo de transporte privado. | Se omitía el número de placa cuando la guía se configuraba para transporte privado o repartidor interno. | Se añadió la placa del vehículo (`cac:LicensePlateID` en `cac:RoadTransport`). **Matiz (jun 2026):** la placa es obligatoria **solo cuando NO se usa el indicador M1/L**; con M1/L se OMITE legítimamente (ver sección C). |
| **3360** | El XML no contiene el tag cbc:FirstName o cbc:FamilyName en DriverPerson. | El validador espera que el nombre del conductor esté estructurado formalmente en campos separados de nombres y apellidos, en lugar de un campo de nombre completo (`cbc:Name`). | Se modificó la interfaz `DatosGuia` para reemplazar el campo `repartidor.nombre: string` por `repartidor.nombres: string` y `repartidor.apellidos: string`, mapeándolos al XML en `<cbc:FirstName>` y `<cbc:FamilyName>`. |
| **2574** | El XML no contiene el tag o no existe información de dirección detallada de punto de llegada. | Se utilizaba `<cbc:StreetName>` para definir la dirección del cliente en el punto de llegada, pero el esquema estricto de la GRE exige estructurarla con `<cac:AddressLine><cbc:Line>` (igual que el punto de partida). | Se reemplazó el uso de `<cbc:StreetName>` por `<cac:AddressLine><cbc:Line>` en el bloque del punto de llegada de `xml-builder-guia.ts`. |

### C. Vehículos categoría M1/L — placa y conductor OPCIONALES (jun 2026)

Regla **central** para el caso de Transavic (muchas entregas las hace un **delivery externo en moto** y no se tiene DNI/placa/licencia del chofer).

- En la **GRE-Remitente con transporte privado** (modalidad `02`), si se marca el **indicador de traslado en vehículo de categoría M1 o L** (autos ligeros / **motos = categoría L**), SUNAT permite **OMITIR la placa del vehículo y TODOS los datos del conductor** (tipo/número de documento, nombres, apellidos y licencia). Confirmado en fuentes oficiales y tutoriales de proveedores ("GRE Remitente con vehículo M1 o L sin especificar placa o licencia"). Sin el indicador, esos datos son obligatorios (errores 2566 y 3360).
- En el XML, el indicador se emite como `<cbc:SpecialInstructions>SUNAT_Envio_IndicadorTrasladoVehiculoM1L</cbc:SpecialInstructions>` dentro de `cac:Shipment` (`xml-builder-guia.ts:166-168`).
- El **builder ya estaba bien**: emite la placa (`cac:RoadTransport/cbc:LicensePlateID`) solo si `repartidor?.placa` no está vacío, y el bloque `cac:DriverPerson` solo si `repartidor.docNum` no está vacío. Es decir, **omite ambos automáticamente** cuando llegan vacíos. Lo que bloqueaba el caso era únicamente la **validación demasiado estricta** del modal y de la API.
- **Fix (jun 2026):** la validación del modal (`emitir-guia-modal.tsx`, `handleSubmit`) y de la API (`api/guias/emitir/route.ts`) exige DNI/placa/licencia **solo cuando NO es M1/L**. Con M1/L (checkbox activo por defecto), esos campos quedan opcionales en el form (`required={!indicadorM1L}`) y la API pasa `docNum`/`placa` como `""` (vacío = omitir). El flujo con datos completos del chofer (cuando NO es M1/L) sigue igual.
- **Transporte público** (modalidad `01`, un courier tercero con RUC) **no está implementado** — no se necesita: el delivery externo de Transavic es moto informal, cubierto por M1/L. Si en el futuro usan un courier con RUC, habría que agregar la modalidad pública (declarar el RUC del transportista, sin datos del conductor).

---

## 4. Estado Actual

> [!IMPORTANT]
> La GRE está **desplegada en producción** (`main` → Vercel). El motor de firma + envío REST está validado contra SUNAT beta (guía `T001-00814091`, CDR código 0). La integración de UI/API del conductor (`nombres`/`apellidos` separados) y la regla M1/L (sección C) **ya están hechas**. **Pendiente: la 1ª emisión REAL en producción** (la valida Hugo; al 8 jun 2026 la tabla `comprobantes_guias` está vacía — 0 GRE emitidas).

### Entorno (Beta vs Producción)

- El entorno lo controla `SUNAT_ENVIRONMENT` (compartido con boletas/facturas SOAP). En Vercel = `production`; en `.env.local` = `beta`.
- **Endpoints REST** (`rest-client.ts`): envío a `api-cpe-test.sunat.gob.pe` (beta) o `api-cpe.sunat.gob.pe` (producción); OAuth2 en `api-seguridad.sunat.gob.pe` (fijo).
- **Credenciales OAuth2** en Vercel producción: `SUNAT_TRA_CLIENT_ID/SECRET` y `SUNAT_AVI_CLIENT_ID/SECRET` (cargadas; una por empresa).
- ⚠️ **Mock de beta (cuidado al validar):** en `api/guias/emitir/route.ts`, **solo cuando `environment === "beta"`**, un fallo de SUNAT (401, red, etc.) se **simula como éxito** (`descripcion` con `[SIMULADO BETA]`, CDR `<MockCDR>`). En producción NO simula: el error se propaga. Por eso una prueba en beta **no es concluyente** si la respuesta trae `[SIMULADO BETA]` — para validar de verdad hace falta una aceptación real (sin ese marcador) o emitir en producción.

### Banner del modal (jun 2026)
El banner del modal **ya no está hardcodeado a "Beta"**. Lo alimenta `GET /api/sunat/entorno` (`{environment, esProduccion}`, dato no sensible): en producción muestra una nota **verde "Producción (SUNAT real)"**, en beta el aviso ámbar. El modal se abre desde `table.tsx` y `comprobantes-client.tsx` (client components), por eso el entorno se expone por endpoint y no por props.

### Auto-búsqueda del destinatario (jun 2026)
En el modal, al tipear un DNI(8)/RUC(11) en el destinatario se consulta apisperu (`POST /api/consulta-documento`) y se autocompletan los "Nombres o Razón Social" (mismo patrón que el form de comprobantes).

### Representación impresa (`gre-printable-client.tsx`) — jun 2026
La GRE se imprime desde la página HTML `src/app/pedidos/[id]/gre/gre-printable-client.tsx` (con
`window.print()`, no jsPDF), modelada sobre el formato oficial SUNAT (`recursos/10710548841-09-EG07-432.pdf`).
- **Limpieza visual (jun 2026):** se quitaron las líneas divisorias de sección, la cebra de la tabla
  y la caja del vehículo; las secciones se separan con espacio (como el modelo). El peso/bultos van
  como texto plano bajo la tabla.
- **Indicador M1/L:** el imprimible lo muestra leyéndolo del **XML firmado** en `page.tsx`
  (`xml_firmado_base64.includes("SUNAT_Envio_IndicadorTrasladoVehiculoM1L")`) — antes estaba
  hardcodeado a "NO".
- **Documento relacionado (factura):** `api/guias/emitir/route.ts` ahora **resuelve el `comprobante_id`
  desde el pedido** cuando no viene explícito (factura/boleta `aceptado`/`observado` del pedido) → la
  guía SIEMPRE muestra "Documentos Relacionados: Factura …". ⚠️ Esto es solo para la representación
  PROPIA; el XML que va a SUNAT **aún no** declara `cac:AdditionalDocumentReference` (pendiente, ver abajo).

### Pendiente
- **Emitir la 1ª GRE real en producción** (Hugo), idealmente con **M1/L y sin datos del chofer** (caso delivery externo en moto). Si SUNAT la acepta (serie + CDR), queda validado end-to-end; si la rechaza, revisar el código de error y ajustar el XML.
- **Declarar la factura relacionada en el XML SUNAT** (`cac:AdditionalDocumentReference`) para que la representación PROPIA de SUNAT también muestre "Documentos Relacionados". Toca el XML legal → validar contra SUNAT antes.

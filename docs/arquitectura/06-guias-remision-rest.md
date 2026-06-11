# 06 — Integración de Guías de Remisión Electrónicas (GRE 2.0 REST)

> **Última verificación contra código:** 2026-06-10
> **Commit del proyecto:** desplegado en `main` (GRE en producción; ver gotchas #28 y #29 del CLAUDE.md)
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
> La GRE está **desplegada en producción y VALIDADA END-TO-END contra SUNAT real**: la
> **`T002-00000010` fue ACEPTADA (código 0, sin observaciones, CDR guardado) el 10 jun 2026 22:35**
> — primera GRE real aceptada (Avícola de Tony), con los 5 ítems en KGM y peso 280.75 exactos a su
> factura. Nota operativa: esa factura (F002-62) se anuló con NC esa misma mañana, así que la guía
> se dio de baja después en el portal SOL — pero la aceptación demostró el flujo completo
> (token OAuth2 + envío + polling + CDR + persistencia), de día y de noche.

### Entorno (Beta vs Producción)

- El entorno lo controla `SUNAT_ENVIRONMENT` (compartido con boletas/facturas SOAP). En Vercel = `production`; en `.env.local` = `beta`.
- **Endpoints REST** (`rest-client.ts`): envío a `api-cpe-test.sunat.gob.pe` (beta) o `api-cpe.sunat.gob.pe` (producción); OAuth2 en `api-seguridad.sunat.gob.pe` (fijo).
- **Credenciales OAuth2** en Vercel producción: `SUNAT_TRA_CLIENT_ID/SECRET` y `SUNAT_AVI_CLIENT_ID/SECRET` (cargadas; una por empresa).
- ⚠️ **Mock de beta (cuidado al validar):** en `api/guias/emitir/route.ts`, **solo cuando `environment === "beta"`**, un fallo de SUNAT (401, red, etc.) se **simula como éxito** (`descripcion` con `[SIMULADO BETA]`, CDR `<MockCDR>`). En producción NO simula: el error se propaga. Por eso una prueba en beta **no es concluyente** si la respuesta trae `[SIMULADO BETA]` — para validar de verdad hace falta una aceptación real (sin ese marcador) o emitir en producción.

### Banner del modal (jun 2026)
El banner del modal **ya no está hardcodeado a "Beta"**. Lo alimenta `GET /api/sunat/entorno` (`{environment, esProduccion}`, dato no sensible): en producción muestra una nota **verde "Producción (SUNAT real)"**, en beta el aviso ámbar. El modal se abre desde `table.tsx` y `comprobantes-client.tsx` (client components), por eso el entorno se expone por endpoint y no por props.

### DOS modales de emisión + módulo compartido `guia-form-shared.ts` (9 jun 2026)
Hay **dos modales** de emisión de GRE: `emitir-guia-modal.tsx` (desde un pedido/comprobante) y
`emitir-guia-directa-modal.tsx` (GRE directa/standalone, botón "Emitir GRE" en Comprobantes). Se
**desincronizaron** (el directo siguió exigiendo chofer con M1/L y tenía el banner "Beta"
hardcodeado), así que las reglas/constantes compartidas se extrajeron a
**`src/lib/guia-form-shared.ts`**: `DISTRITOS_LIMA`, `dividirNombreLocal`, `MotorizadoUser`,
`datosChoferDesdeMotorizado`, **`validarChofer`** (LA regla del chofer: con M1/L todo opcional; sin
M1/L exige DNI+licencia+nombres+apellidos+placa — espejo del backend), `consultarDocumento`
(apisperu) y `fetchEntornoSunat`. **Regla de mantenimiento: cambios a reglas del chofer/M1L,
distritos o consultas compartidas se hacen en ese módulo, NUNCA en un solo modal.** Ambos modales
hoy tienen paridad: banner dinámico, auto-búsqueda del destinatario, M1/L exime y oculta el bloque
del chofer ("+ Agregar datos del chofer (opcional)").

### Auto-búsqueda del destinatario + dirección + distrito (jun 2026)
En ambos modales, al tipear un DNI(8)/RUC(11) se consulta apisperu (`POST /api/consulta-documento`).
Con **RUC** se autocompletan razón social, **dirección** y **distrito** (con DNI solo el nombre —
RENIEC no da dirección). La regla de qué pisar vive en `decidirAutollenadoDestino`
(`guia-form-shared.ts`): si el **usuario tipeó** el doc, la dirección fiscal REEMPLAZA lo precargado
(tipear un RUC = redefinir destinatario); las consultas **automáticas** (al abrir, o al elegir
cliente frecuente) solo llenan vacíos. El distrito se resuelve con `matchDistritoLima` (alias:
lima→Cercado, surco→Santiago de Surco, sjl, smp) + `detectarDistritoEnDireccion` (solo coincidencia
inequívoca en el texto). Todo distrito entrante (pedido/ficha) se NORMALIZA contra el `<select>` —
un valor coloquial que no matchea dejaba el select mudo. El bloque destinatario del modal por
pedido/factura está **SIEMPRE visible** y prellenado (cascada FACTURA → pedido, editable); el peso
bruto se autocompleta con la **suma exacta solo si TODOS los ítems están en KGM** (ítems desde la
factura vinculada), y con unidades mixtas queda en blanco con un mensaje que pide pesar la carga.

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
- **Destinatario = el de la factura (9 jun 2026):** al emitir desde un pedido, el destinatario
  (razón social + tipo/num doc) se toma de la **factura asociada**, NO del nombre informal del
  pedido — así la guía y su factura **coinciden** (ej. "CONEXIPEMA S.A.C.", no "Victor Hugo").
  Solo se sobrescribe si el usuario no mandó override explícito y la factura tiene receptor
  identificado (`esReceptorIdentificado`); una boleta sin DNI mantiene el flujo de override. La
  **dirección (punto de llegada)** NO se fuerza a la fiscal: queda la de **entrega** del pedido
  (editable en el modal), porque el punto de llegada es el lugar físico real de entrega.
- **Ítems = los de la factura (9 jun 2026):** en el mismo bloque, los **bienes por transportar**
  (descripción, cantidad y **unidad kg/unidad**) se toman del **XML firmado de la factura vinculada**
  (fallback `items_json`; si nada parsea, quedan los `pedido_items`) — como en las guías reales de
  SUNAT, donde guía y factura listan lo mismo. La línea de servicio **"ENVIO" se excluye** (es flete
  facturable, no un bien transportable).
- **PDF descargable (9 jun 2026):** la guía ahora se **descarga como archivo PDF** (jsPDF, igual que
  boletas/facturas) con `src/lib/sunat/pdf-guia.ts` + `descargarPdfGuia()` en `lib/descargar-guia.ts`,
  alimentado por `GET /api/guias/[id]` (que ahora acepta id de guía **o** pedido_id y devuelve
  `impresion`: ítems, punto de llegada, M1/L y comprobante relacionado). Botón "PDF" rojo en
  `/dashboard/guias`, en la lista de comprobantes (tipo 09) y en el dropdown de guías del dashboard;
  la página imprimible `/pedidos/[id]/gre` sigue disponible ("Imprimir guía").

### 🔴 Rechazo real por ORDEN XSD del indicador M1/L (9 jun 2026 — RESUELTO)
Las 2 primeras GRE reales (`T002-00000008/9`) fueron **RECHAZADAS** por SUNAT con
`Error al ValidarEsquema … Invalid content was found starting with element 'cbc:GrossWeightMeasure'`.
- **Causa raíz:** en UBL 2.1 `cac:Shipment` es una **secuencia XSD estricta** (`ID → HandlingCode →
  Information → GrossWeightMeasure → TotalTransportHandlingUnitQuantity → SpecialInstructions →
  ShipmentStage → Delivery → TransportHandlingUnit`). El indicador M1/L (`cbc:SpecialInstructions`,
  pos. 18) se emitía ANTES de `GrossWeightMeasure` (pos. 6) → el validador rechaza al retroceder.
- **Fix** (`xml-builder-guia.ts`): el indicador M1/L se emite después de
  `TotalTransportHandlingUnitQuantity`. **Verificado con el XSD oficial OASIS UBL 2.1 + xmllint**
  (`xmllint --schema UBL-DespatchAdvice-2.1.xsd`): el XML rechazado reproduce el error exacto; los 3
  casos generados con el fix (M1/L sin chofer · sin M1/L · M1/L con chofer) → "validates".
- **Por qué llegó a producción:** la única aceptación real de beta fue SIN M1/L; todas las pruebas
  M1/L pasaron por el **mock de beta** (401 → éxito simulado), que enmascaró el rechazo de esquema.
  **Regla:** cualquier cambio al orden/estructura del XML de la guía se valida contra el XSD oficial
  con xmllint (es la misma `ValidarEsquema` de SUNAT), NUNCA solo contra beta.
- **De paso:** los guards anti doble-emisión usaban `NOT IN ('anulado','RECHAZADA','ERROR')` pero los
  estados se guardan en minúscula → una guía `rechazado` bloqueaba reemitir. Corregido a
  `('anulado','rechazado','error')`. Las T002-8/9 quedan como registro y ya no bloquean.

### 🔢 Numeración SEPARADA de la orden de pedido interna (10 jun 2026)
Hasta el 10 jun, la **orden de pedido interna** (`/pedidos/[id]/guia`, NO fiscal) y la **GRE legal**
(T001/T002) compartían el correlativo `correlativos.guia_remision`. Como la orden reserva un número con
**solo ABRIR la página**, cada orden impresa **gastaba un número de la numeración LEGAL** → las guías
SUNAT saltaban de número (prod: `guia_remision=9`, de los cuales 1..7 eran órdenes internas y 8..9 las
T002 rechazadas). **El contador SUNAT no debe saltar.**
- **Orden interna** → correlativo propio `correlativos.orden_pedido` (`page.tsx`; `TipoCorrelativo` en
  `correlativos.ts`).
- **GRE legal** → contador **POR SERIE** en `comprobantes_contador` (T001/T002, la misma tabla que
  boletas/facturas), reservado con un **CTE atómico** en `api/guias/emitir/route.ts` (bump del contador
  + fila `'emitiendo'` en un solo statement → si algo falla después, el catch la pasa a `'error'` y el
  número NO queda "fantasma"). Una `'emitiendo'` con >15 min ya no bloquea re-emitir.
- La GRE **ya NO escribe `pedidos.numero_guia`** (ese campo es solo de la orden interna; el número legal
  vive en `comprobantes_guias`). Evita chocar con el `UNIQUE idx_pedidos_numero_guia` al separar.
- El **badge "GRE" de despacho** pasó a `EXISTS(comprobantes_guias aceptado/observado) AS tiene_gre`
  (`api/despacho/route.ts` + `despacho-content.tsx`), no `numero_guia`.
- El **mock de beta** (que enmascaró el rechazo XSD) ahora está **APAGADO por defecto**; solo se activa
  con `SUNAT_GRE_MOCK_BETA=1`.
- **Migración** `scripts/migrate-guias-numeracion-2026-06-10.sql` (dev-hugo + prod, ANTES del deploy):
  `orden_pedido` sembrado desde `guia_remision`; `comprobantes_contador` T001=0 (próx=1), T002=9
  (próx=10, sin reusar las rechazadas). `guia_remision` queda **congelado** (DEPRECATED). Ver CLAUDE.md #29.

### 🔴 Incidente del 10 jun 2026 — guía atascada en "emitiendo" → 3 causas raíz (TODAS RESUELTAS)
La primera guía real (T002-10, 09:14) quedó horas en `'emitiendo'`. La autopsia destapó **tres** bugs
encadenados (detalle completo en CLAUDE.md gotcha #30):
1. **`comprobantes_guias` no tenía columna `updated_at`** pero el flujo de reserva hacía
   `UPDATE … SET updated_at = NOW()` → el UPDATE post-SUNAT **y el catch** fallaban → la fila quedaba
   `'emitiendo'` para siempre y el resultado de SUNAT se perdía. Fix: migración
   `scripts/migrate-guias-reintento-2026-06-10.sql` (agrega `updated_at` + persiste
   `direccion_llegada`, `distrito_llegada`, `indicador_m1l`, `chofer_nombres/apellidos`, `items_json`
   en la reserva).
2. **Timeout de Vercel**: el flujo REST (token + envío + polling 6×2s) supera los ~15s default →
   `export const maxDuration = 60` en `emitir` y `reintentar`.
3. **Fecha de emisión en UTC** (`new Date().toISOString()`): desde las **~19:00 hora Lima** la fecha
   UTC ya es "mañana" → SUNAT rechaza **2329 "fecha de emisión fuera del límite permitido"**. Fix:
   `src/lib/sunat/fechas.ts` (`fechaHoyLima`/`horaActualLima`) — **NUNCA `toISOString()` para fechas
   de documentos SUNAT**. (Las facturas/boletas no sufrían esto: `lib/sunat/index.ts` ya usaba Lima.)
   Bonus: el driver Neon devuelve `DATE` como objeto `Date` — `String(date)` produce "Wed Jun 10" →
   SUNAT 0306; formatear con `toISOString().slice(0,10)` si es `instanceof Date`.

### Reintentar emisión (mismo número) — `POST /api/guias/[id]/reintentar`
Para guías en `error`, `pendiente`, `rechazado` o atascadas en `emitiendo` >15 min. Reconstruye el
XML (ítems: `items_json` propio → XML de la factura vinculada → pedido_items), **reusa el MISMO
serie-número**, firma y reenvía. Si SUNAT responde "ya registrada" (1032/1033) la marca `aceptado`.
**Las rechazadas SÍ se reintentan**: un rechazo NO registra el documento en SUNAT (verificado: la
T002-10 fue rechazada 2 veces y aceptada a la 3.ª con el mismo número). La fecha de inicio de
traslado se ajusta para no quedar anterior a la emisión. UI: menú "⋯" → "Reintentar emisión (mismo
número)" (admin + asesora dueña). El GET `/api/comprobantes` sanea filas `'emitiendo'` >15 min →
`'error'` con instrucciones.

### Baja (anulación) de una GRE aceptada
- SUNAT **no expone baja de GRE por API**: se hace en el **portal SOL** (clave SOL → Comprobantes de
  pago → GRE → dar de baja). Después, en el sistema, menú "⋯" → "Dar de Baja" (registra la baja local).
- **Plazos SUNAT**: por **error en la emisión** → la baja procede mientras **no se haya iniciado el
  traslado** (sin plazo en días). Si el traslado **ya inició** y cambia el destinatario antes de llegar
  → baja dentro de **10 días calendario** desde el día siguiente al inicio del traslado. Fuente:
  cpe.sunat.gob.pe/node/118 ("No conformidad y baja de una GRE").

### Pendiente
- ~~Emitir la 1.ª GRE real con éxito~~ ✅ **HECHO 10 jun 2026** (T002-00000010 ACEPTADA; luego dada
  de baja en SOL porque su factura se anuló con NC — la validación end-to-end quedó completa igual).
- **Declarar la factura relacionada en el XML SUNAT** (`cac:AdditionalDocumentReference`) para que la representación PROPIA de SUNAT también muestre "Documentos Relacionados". Toca el XML legal → validar contra SUNAT antes.
- **Ubigeos fuera de Lima/Callao**: el `<select>` de distrito solo cubre Lima/Callao; un traslado a
  provincia (ej. cliente con domicilio en Cajamarca) hoy no puede expresar su ubigeo real.
- **Credenciales SUNAT beta dan 401** → la validación local de guías contra beta se simula (mock). Para validar de verdad en local: arreglar esas credenciales o validar por XSD (xmllint), que es lo que ahora se hace.

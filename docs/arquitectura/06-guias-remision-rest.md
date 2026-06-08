# 06 — Integración de Guías de Remisión Electrónicas (GRE 2.0 REST)

> **Última verificación contra código:** 2026-06-07
> **Commit del proyecto:** n/a (cambios de integración local)
> **Archivos clave:** 
> - [src/lib/sunat/xml-builder-guia.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/lib/sunat/xml-builder-guia.ts)
> - [src/lib/sunat/rest-client.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/lib/sunat/rest-client.ts)
> - [scratch/test_gre_produccion.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/scratch/test_gre_produccion.ts)
> - [src/app/api/guias/emitir/route.ts](file:///Users/hugoherrera/Programación/proyectos/transavic/src/app/api/guias/emitir/route.ts)

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
| **2566** | El XML no contiene el tag de Placa del vehículo de transporte privado. | Se omitía el número de placa cuando la guía se configuraba para transporte privado o repartidor interno. | Se añadió la validación para asegurar la presencia de la placa del vehículo (`cac:LicensePlateID` en `cac:RoadTransport`) en el XML. |
| **3360** | El XML no contiene el tag cbc:FirstName o cbc:FamilyName en DriverPerson. | El validador espera que el nombre del conductor esté estructurado formalmente en campos separados de nombres y apellidos, en lugar de un campo de nombre completo (`cbc:Name`). | Se modificó la interfaz `DatosGuia` para reemplazar el campo `repartidor.nombre: string` por `repartidor.nombres: string` y `repartidor.apellidos: string`, mapeándolos al XML en `<cbc:FirstName>` y `<cbc:FamilyName>`. |
| **2574** | El XML no contiene el tag o no existe información de dirección detallada de punto de llegada. | Se utilizaba `<cbc:StreetName>` para definir la dirección del cliente en el punto de llegada, pero el esquema estricto de la GRE exige estructurarla con `<cac:AddressLine><cbc:Line>` (igual que el punto de partida). | Se reemplazó el uso de `<cbc:StreetName>` por `<cac:AddressLine><cbc:Line>` en el bloque del punto de llegada de `xml-builder-guia.ts`. |

---

## 4. Estado Actual y Pendientes de Integración

> [!IMPORTANT]
> El motor de firma y envío de la GRE ya funciona al 100% contra el validador de SUNAT. La guía de prueba es aceptada. Sin embargo, no se ha completado la integración del cambio de los campos del conductor en la UI y la base de datos de producción.

### Tareas Pendientes para Continuar:

1. **Actualizar API de Emisión de Guías (`/api/guias/emitir/route.ts`)**:
   - Actualmente, el route handler lee la información del repartidor e intenta llamar a `generarXMLGuia` con la firma anterior (la cual requería `nombre: string`).
   - Se debe adaptar el handler para que extraiga o divida el nombre del motorizado asignado (por ejemplo, dividiendo `repartidor.nombre` por espacios en blanco, o usando campos específicos si se añaden a la base de datos).
   - Validar el payload de entrada contra el nuevo esquema adaptado.

2. **Adaptar Formulario de UI (`emitir-guia-modal.tsx` u otros)**:
   - Asegurarse de que el frontend pase los datos correctos del repartidor (`nombres` y `apellidos` por separado) al endpoint `/api/guias/emitir`.

3. **Verificación en Producción**:
   - Una vez integrados los cambios en la ruta y la interfaz, y validados localmente en Beta, el sistema estará listo para emitir guías reales.
   - Para producción, Vercel requiere tener configurados `SUNAT_TRA_CLIENT_ID` y `SUNAT_TRA_CLIENT_SECRET` (y sus contrapartes `SUNAT_AVI_*`) correspondientes a las credenciales reales del portal SOL del RUC de producción.

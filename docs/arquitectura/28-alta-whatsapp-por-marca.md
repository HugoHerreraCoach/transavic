# 28 · Alta de WhatsApp Cloud API para una marca

> **Cuándo leerlo:** vas a conectar (o reconectar) el número de WhatsApp de una marca al CRM.
> **Estado de la verificación:** todo lo marcado **[PANTALLA]** se comprobó entrando a la cuenta real de
> Meta el **20 jul 2026**; lo marcado **[OFICIAL]** viene de la documentación de Meta (32 agentes,
> 20 afirmaciones confirmadas / 4 refutadas); lo marcado **[OBSERVADO]** es comportamiento visto en el
> alta de Transavic pero que Meta no documenta.
> Relacionado: [15 · Asistente IA §5](./15-asistente-ia.md) (arquitectura del CRM) y la crónica del
> 19–20 jul en [historial-cambios-2026.md](../historial-cambios-2026.md).

---

## 0. La regla de oro: UNA APP DE META POR PORTFOLIO

**No se puede reusar la app "Transavic CRM" para la cuenta de WhatsApp de otra marca.**

Una app de Meta pertenece a **un solo Business Portfolio**. Para que una app opere WABAs que no son de
su propio negocio, Meta exige **Advanced access** del permiso `whatsapp_business_management` (App Review
dentro del programa Tech Provider, pensado para quien atiende negocios ajenos). Sin ese acceso, **toda
llamada devuelve error 200**. Dos portfolios del mismo dueño humano son "negocios distintos" para Meta.
**[OFICIAL]** `developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts`

Consecuencias directas:

| Recurso | ¿Se comparte entre marcas? |
|---|---|
| Business Portfolio | ❌ uno por marca |
| Cuenta de WhatsApp (WABA) | ❌ una por marca — **no se migra entre portfolios, es irreversible** |
| Número | ❌ uno por WABA |
| App de Meta for Developers | ❌ **una por portfolio** |
| System User + token | ❌ uno por portfolio (los system users son un activo del portfolio) |
| App Secret | ❌ uno por app → el webhook valida contra **todos** (ver §12) |
| URL del webhook | ✅ **una sola**, compartida |
| `META_VERIFY_TOKEN` | ✅ **uno solo** — lo elegimos nosotros, solo interviene en el handshake GET |
| Cupos de mensajería | ❌ **son por portfolio**: una marca no hereda el tier de la otra **[OFICIAL]** |

> **Alternativa descartada a propósito:** crear la WABA de la 2ª marca dentro del portfolio de la 1ª
> funcionaría con una sola app y un solo secret, pero mezcla las dos personas jurídicas, desaprovecha la
> verificación del otro RUC, ata display name y facturación al RUC equivocado, y **no tiene vuelta atrás**.

---

## 1. Estado por marca (al 20 jul 2026)

### 🛵 Transavic — RUC 20 — portfolio **TONIO DAT** `1324982862317136` ✅ OPERANDO
App *Transavic CRM* `1043268678158460` · WABA `883642441471852` · número **+51 960 666 114**
(`phone_number_id 1181655271701439`) · System User *CRM Transavic* `61591800645031` · webhook verificado
y suscrito a `messages`. Probado end-to-end el 19 jul.

### 🏪 La Avícola de Tony — RUC 10 — portfolio **TONIO LADT** `2200578807071141` ⏳ EN PROCESO

| Punto | Estado **[PANTALLA]** |
|---|---|
| Verificación de la empresa | ✅ **Verificada** (19 jul, confirmada 20 jul) — `RESURRECCION GAMARRA TONIO`, RUC `10710548841`, web `laavicoladetony.com` |
| Método de pago | ✅ Ya cargado a nivel portfolio: cuenta de pagos *LA AVICOLA DE TONY 2025* (`1410201126951666`), una Visa activa, divisa **PEN**; aparece también en la pestaña *Cuentas de WhatsApp Business* del Centro de facturación |
| Cuenta de WhatsApp (WABA) | ❌ **Ninguna** — botón "+ Añadir" habilitado |
| Número | ❌ Ninguno. El chip **+51 936 303 850** es **nuevo y nunca tuvo WhatsApp** (no hay cuenta que eliminar) |
| App de Meta propia | ❌ No creada |
| System User propio | ❌ No creado |
| Página de Facebook | ❌ Ninguna (*Página principal: ninguna*) — hace falta **solo para Click-to-WhatsApp** |
| Aviso *"WhatsApp needs more information"* | Pendiente **no accionable todavía**: el selector de caso de uso solo ofrece "aumentar límite de gasto". Meta pedirá esos datos cuando exista la cuenta de WhatsApp |
| Admins del portfolio | 2 personas; 2FA obligatoria pero **0 de 2** la tienen activada |
| Deuda de anuncios | S/ 225,29 pendientes (se cobran al llegar a S/ 251 o el 4 ago) |
| ⚠️ Identificación fiscal de la cuenta de pagos | **`20612806901` (RUC de Transavic)** en la cuenta de la Avícola → las facturas de Meta salen con el RUC equivocado. Corregir con Antonio |

---

## 2. Quién hace qué (importante)

**El alta NO se puede automatizar.** El asistente *Crea una cuenta de WhatsApp Business* lanza un
**reCAPTCHA de imágenes** en el primer paso **[PANTALLA]**, y los CAPTCHAs no se resuelven por agente.

| Tarea | Quién |
|---|---|
| Auditar estado, leer pantallas, confirmar rutas y labels | Claude (navegador) |
| Clics del alta, CAPTCHA, contraseñas, tarjeta, código SMS | Hugo / Antonio |
| `POST /register`, `subscribed_apps`, `debug_token`, env vars, deploy | Claude |
| Aceptar los Términos de WhatsApp Business y Meta Hosting | El titular (Antonio) — aparece al pulsar *Continuar* en el asistente |

> Rellenar formularios de Meta por coordenadas es frágil: en la prueba del 20 jul un clic desviado
> seleccionó la categoría *"Apuestas y juegos de azar"* y el texto tecleado perdió una mayúscula.
> Si hay que llenar algo, **verificar con zoom antes de continuar**.

---

## 3. Prechequeos

1. **El chip**: que NO tenga WhatsApp ni WhatsApp Business activos. Si los tiene → *Ajustes → Cuenta →
   Eliminar mi cuenta*, esperar 3 min; el historial **no se puede restaurar** en Cloud API. *(Para
   +51 936 303 850 esto ya está resuelto: es nuevo.)*
2. **Línea móvil activa** que reciba SMS **o** llamada (el OTP puede llegar por voz si el SMS falla).
3. **Tarjeta** con consumos internacionales (o ya cargada, como en LADT).
4. **PIN de 6 dígitos** decidido de antemano y anotado en `CREDENCIALES-PRODUCCION.local.md`
   (gitignored). **No es** el OTP del SMS: es el de verificación en dos pasos, el que se manda en
   `POST /register` y el que Meta pedirá si algún día hay que re-registrar la línea.
5. **La web de la marca** debe mostrar la razón social exacta (fue el motivo del rechazo de verificación
   del RUC 10 en el primer intento).
6. **Estar en el portfolio correcto**: verificar el `business_id` en pantalla antes de cada acción.
   En TONIO DAT vive la WABA *coexistence* **"Transavic20"** (`591728093936452`) del **número personal de
   Antonio** (+51 936 889 205): **NO TOCAR**.

---

## 4. Runbook (rutas reales, tomadas de la propia interfaz)

Todas aceptan `?business_id=<ID>`; **igual hay que confirmar arriba a la izquierda que dice el portfolio
correcto** — Meta suele abrir el último portfolio usado. **[PANTALLA]**

| Paso | Dónde | Notas |
|---|---|---|
| **4.1** Crear la WABA | `business.facebook.com/latest/settings/whatsapp_account?business_id=…` → **+ Añadir** → **"Crea una cuenta de WhatsApp Business nueva"** | El menú ofrece 3 opciones; las otras dos (*"para un cliente"* y *"Vincula una cuenta"*) **no** son la nuestra. Asistente de 3 pasos: **Detalles → Número de teléfono → Verificación telefónica**. Aquí aparece el CAPTCHA |
| **4.2** Detalles | mismo asistente | Nombre para mostrar, categoría, foto de perfil, y *Mostrar más opciones* (descripción, correo, web, dirección). Ver §5 |
| **4.3** Número | mismo asistente | +51 y el número sin prefijo; verificación por **SMS o llamada**. No martillar reintentos |
| **4.4** Método de pago | `business.facebook.com/latest/billing_hub?business_id=…` (pestaña *Cuentas de WhatsApp Business*) | La tarjeta del portfolio **no basta**: hay que designarla como fondeo de la WABA (`primary_funding_id`; estado `PENDING_VALID_PAYMENT_METHOD`). **Solo se puede después de crear la cuenta** **[OFICIAL]**. Lo que el pago condiciona es **enviar mensajes**, no dar de alta el número |
| **4.5** App propia | `developers.facebook.com` → **Crear app** → elegir **el portfolio de la marca** → *Añadir producto* → **WhatsApp** → *Configuración de la API* | Ese vínculo define el permiso: **elegirlo mal es el error caro**. Guardar el **App Secret** (Configuración → Básica) |
| **4.6** System User | `business.facebook.com/latest/settings/system_users?business_id=…` → Añadir → rol **Administrador** | Asignarle **la app** y **la WABA** con *Control total*. Recargar y confirmar antes de generar el token (la asignación tarda) |
| **4.7** Token | mismo panel → *Generar nuevo token* | App de la marca · caducidad **Nunca** · permisos `whatsapp_business_messaging` + `whatsapp_business_management`. **Se muestra una sola vez** |
| **4.8** Registrar el número | por API (§6) | La UI deja el número en `PENDING`; **el registro solo existe por API** |
| **4.9** Webhook | App → WhatsApp → Configuración → Webhooks | URL `https://app.transavic.com/api/webhooks/meta`, **el mismo `META_VERIFY_TOKEN`**, campo `messages` (+ `message_template_status_update` si se usarán plantillas). **Hacerlo DESPUÉS del deploy con el secret nuevo** |
| **4.10** Variables y deploy | Vercel (§9) | Sin redeploy la marca queda en modo mock **sin avisar** |

**Otras rutas útiles [PANTALLA]:** WhatsApp Manager `business.facebook.com/wa/manage/home/?business_id=…` ·
Apps del portfolio `/latest/settings/apps?business_id=…` · Info del negocio `/latest/settings/business_info/?business_id=…` ·
Centro de seguridad (verificación) `/latest/settings/security_center?business_id=…`.
⚠️ `…/settings/whatsapp_accounts` (en plural) **no existe** y redirige a un activo cualquiera.

---

## 5. Datos del perfil — La Avícola de Tony

| Campo | Valor |
|---|---|
| Nombre para mostrar | `La Avícola de Tony` |
| Categoría | **Alimentación y bebidas** (jamás dejar la primera de la lista) |
| Foto de perfil | `public/avicola.jpg` del repo (600×600, cuadrado) |
| Descripción (máx. 256) | `Distribuidora avícola en Lima. Pollo fresco entero, despresado y en filetes, gallina, menudencia, huevos de granja y cortes de res y cerdo. Procesamos de madrugada y cobramos por peso real en balanza. Reparto en 18 distritos, de lunes a sábado.` (244) |
| "Acerca de" (máx. 139) | `Pollo, huevos y carnes frescas del día en Lima. Peso real en balanza.` |
| Correo | `contacto@laavicoladetony.com` |
| Sitio web | `https://www.laavicoladetony.com` |
| Dirección | `Cal. Las Esmeraldas 624, Urb. Balconcillo, Lima` |

> La web publica hoy como contacto comercial el **+51 936 889 205** (el personal de Antonio). Cuando el
> número nuevo opere, actualizar ese dato para que los clientes escriban al que sí atiende el CRM.

---

## 6. Registro del número por API

Meta es explícito: *"You can only register a number via the API — you cannot register a number through
WhatsApp Manager (WAM) or the App Dashboard"* **[OFICIAL]**. Es el paso que la gente olvida y deja el
número en `PENDING` para siempre.

```bash
# 1) Obtener el phone_number_id
GET https://graph.facebook.com/v25.0/<WABA_ID>/phone_numbers
    Authorization: Bearer <TOKEN>

# 2) Registrar (esto lo pasa a CONNECTED)
POST https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>/register
     Content-Type: application/json
     {"messaging_product":"whatsapp","pin":"<6 dígitos>"}
# → {"success": true}

# 3) Confirmar
GET https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>?fields=id,display_phone_number,verified_name,status,name_status,quality_rating
GET https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>?fields=health_status   # AVAILABLE / LIMITED / BLOCKED

# 4) Suscribir la app a la WABA (NO es automático: sin esto no llegan webhooks)
POST https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps
GET  https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps   # debe listar la app de la marca
```

**Semántica del `pin`:** si el número ya tiene 2FA (el asistente suele pedirlo en el alta), hay que mandar
**ese** PIN; si no la tiene, el valor enviado **queda** como PIN permanente.
**Límite duro:** 10 llamadas a `/register` por número en 72 h → superarlo devuelve **133016** y bloquea el
registro 72 horas. PIN equivocado → **133005**. **No probar a ciegas.** No hay endpoint para desactivar la
2FA: solo se cambia desde WhatsApp Manager → el número → Verificación en dos pasos.

---

## 7. Verificación end-to-end

**Capa Meta**
1. `GET /debug_token?input_token=<TOKEN>&access_token=<APP_ID>|<APP_SECRET>` → `type: SYSTEM_USER`,
   `is_valid: true`, `expires_at: 0`, y la WABA de la marca en `granular_scopes`.
2. `GET /<PHONE_NUMBER_ID>?fields=status,health_status` → **CONNECTED** + **AVAILABLE**.
3. `GET /<WABA_ID>/subscribed_apps` → lista la app de la marca.

**Capa CRM**
4. WhatsApp real desde un celular al número nuevo → logs de Vercel: **POST 200**, sin `Invalid signature`
   y sin `phone_number_id desconocido`.
5. `/dashboard/crm-leads` → pestaña de la marca → el lead aparece con su color.
   `SELECT telefono, empresa, vendedor_id FROM leads WHERE empresa='<marca>' ORDER BY created_at DESC LIMIT 5;`
6. El bot responde **desde el número de esa marca** y **sin nombrar a la otra** (valida `PERFIL_MARCA`).
7. `SELECT estado, whatsapp_message_id FROM lead_mensajes WHERE lead_id=…` → saliente en `enviado`
   (`fallido` = token mal; el sender **nunca lanza**, degrada en silencio).

**Capa aislamiento (la más importante)**
8. Mandar un WhatsApp al número de la otra marca en el mismo minuto: debe seguir creando su lead y
   respondiendo. Las dos marcas tienen que convivir.

---

## 8. Síntomas y errores conocidos

| Síntoma | Causa | Salida |
|---|---|---|
| reCAPTCHA en el asistente | Antiautomatización de Meta | Lo resuelve una persona. No insistir por agente |
| "Añadir número" en gris | Falta método de pago en la WABA **[OBSERVADO en TONIO DAT]** | Cargar/designar la tarjeta. Si sigue gris, revisar que la verificación se haya propagado. El tope de 2 números por portfolio **[OFICIAL]** no aplica con cero números |
| Error **200** en cualquier llamada | (a) token de otro portfolio, (b) activo no asignado al system user, (c) la app no es dueña de la WABA | `debug_token` y revisar §4.6 |
| Webhook verificado pero no llega nada | La WABA no está suscrita a la app | `POST /<WABA_ID>/subscribed_apps` |
| **401 Invalid signature** en los logs | Falta el App Secret de esa marca en el backend | Agregar `META_APP_SECRET_<MARCA>` (§9) y **redeploy** |
| POST 200 pero no aparece el lead, log dice "phone_number_id desconocido" | La env var quedó con espacios o mal pegada | `empresaDesdePhoneNumberId` compara **exacto y sin `trim`** (`src/lib/whatsapp/config.ts:56-63`) |
| El lead entra con la marca equivocada | Se pegó el phone id de la otra marca | `config.ts:60` evalúa Transavic primero y gana |
| Plantilla falla con **132001** | La plantilla no existe en la WABA de esa marca | Las plantillas viven **por WABA**: crearla ahí con el mismo nombre e idioma |
| `name_status` = `EXPIRED` o `NONE` | Son estados del **certificado**, y **sí bloquean** | Rehacer el alta del display name. `PENDING_REVIEW` **no** bloquea: ya se puede recibir y responder |
| **133005** / **133016** en `/register` | PIN incorrecto / 10 intentos en 72 h | Ver §6 |

---

## 9. Variables de entorno

Ya en Vercel producción: `META_VERIFY_TOKEN`, `META_APP_SECRET` (Transavic), `WHATSAPP_API_VERSION`,
`WHATSAPP_TRA_PHONE_NUMBER_ID/TOKEN/WABA_ID`.

Se **agregan** por marca nueva (nunca se reemplazan las existentes):

```
META_APP_SECRET_AVI            ← App Secret de la app de esa marca (si falta, sus mensajes dan 401)
WHATSAPP_AVI_PHONE_NUMBER_ID   ← obligatoria para salir del modo mock
WHATSAPP_AVI_TOKEN             ← obligatoria
WHATSAPP_AVI_WABA_ID           ← documental (hoy ningún código la consume)
```

Pegar **sin espacios ni saltos de línea**. **Orden:** deploy del código → cargar variables → **redeploy** →
recién entonces configurar el webhook en Meta. Al revés, Meta reintenta hasta 7 días y puede desactivar el
webhook de la app nueva.

---

## 10. Qué ya está resuelto en el código

Nada de esto hay que volver a hacerlo (commits `dff5710` y `a5341ed`, 20 jul 2026):

- **Webhook multi-secret** — `appSecretsConfigurados()` / `firmaValida()` en
  `src/app/api/webhooks/meta/route.ts`: valida el HMAC del body crudo contra **todos** los secrets
  conocidos. Al sumar una marca, agregar su secret ahí y en Vercel.
- **Ruteo por marca** — `empresaDesdePhoneNumberId` (`src/lib/whatsapp/config.ts`); un `phone_number_id`
  desconocido se ignora como tráfico ajeno.
- **Prompt del bot por marca** — `PERFIL_MARCA` en `src/lib/chatbot/bot-orchestrator.ts` ("representas
  ÚNICAMENTE a …").
- **Rotación de asesoras por marca** — `porMarca.tra` / `porMarca.avi` dentro de
  `settings.crm_lead_distribution`; el patrón y la hora de reset siguen compartidos.
- **Idempotencia por `message.id`** — índice único parcial `ux_lead_mensajes_wamid` + `ON CONFLICT`.
- **Plantillas y respuestas rápidas filtradas por marca** — campo `empresa` opcional (ausente = las dos).
- **Lead único por `(telefono, empresa)`** — un mismo cliente puede escribir a las dos marcas.

---

## 11. Pendientes relacionados

1. **Página de Facebook** dentro del portfolio de la marca: obligatoria para Click-to-WhatsApp
   (`page_id` es campo del creativo) **[OFICIAL]**. No bloquea el CRM.
2. **RUC de la cuenta de pagos** de la Avícola: hoy tiene el de Transavic (§1).
3. **Rotar `WHATSAPP_TRA_TOKEN`**: se compartió en texto plano el 19 jul y no caduca.
4. **2FA de los administradores** del portfolio: 0 de 2.
5. **RNPD** (`sipdp.minjus.gob.pe`): inscribir los bancos de datos personales, uno por RUC. Gratuito y
   automático; la política publicada cubre el requisito de Meta, no la obligación ante la ANPD.
6. **Publicar la app de Meta** (no bloquea los mensajes).

---

## 12. Correcciones a creencias que circulaban

- ❌ *"Las plantillas proactivas exigen verificación desde ene-2026"* → **no confirmable** en doc oficial.
  Lo verificable: la verificación sube **cupos** (250 → 2 000 destinatarios únicos/24 h). Lo único
  oficial fechado el 1-ene-2026 es un ajuste **tarifario** por país.
- ❌ *"La ventana de 72 h del CTWA permite texto libre"* → **no**: la de 72 h es de **gratuidad**; la de
  **24 h** sigue gobernando *qué* se puede enviar (*"if the customer service window closes, you will only
  be able to send template messages"*) **[OFICIAL]**. El 409 "fuera de ventana" del CRM debe seguir atado
  a las 24 h.
- ❌ *"Los cupos se heredan entre marcas"* → son **por portfolio** desde el 7-oct-2025: una marca nueva
  arranca en 250 destinatarios únicos/24 h aunque la otra esté escalada **[OFICIAL]**.
- ❌ *"Con la tarjeta en el portfolio ya está el pago resuelto"* → falta designarla como fondeo de la
  WABA, y eso **solo se puede después de crearla** (§4.4).

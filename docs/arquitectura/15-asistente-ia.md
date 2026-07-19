# 15 — Módulo del Asistente de IA Comercial

> **Última verificación contra código:** 2026-07-12
> **Estado del proyecto:** caché persistente y fallback en producción; WhatsApp saliente sigue pendiente
> **Archivos clave:** `src/lib/gemini.ts`, `src/lib/insights.ts`, `src/app/api/asistente-ia/route.ts`, `src/app/dashboard/asistente-ia/asistente-ia-client.tsx`

Este documento describe el funcionamiento de la inteligencia artificial de análisis comercial, la anonimización de datos de clientes, el mecanismo de caché persistente y el respaldo de API ante caídas de cuotas.

---

## 1. El Asistente IA Comercial (`asistente-ia-client.tsx`)

Ubicado en `/dashboard/asistente-ia`, proporciona reportes comerciales dinámicos a las asesoras e insights agregados al administrador.

- **Vistas Scoped:**
  - **Asesoras:** Genera análisis de desempeño de su cartera (clientes inactivos, ranking de sus clientes top por facturación, alerta de deudas por cobrar de sus cuentas). Las consultas SQL filtran estrictamente por `asesor_id = session.user.id`, preservando el privacy boundary.
  - **Administrador:** Vista global de rendimiento de ventas, facturación de marcas y metas consolidadas del equipo.

---

## 2. Motor de IA y Respaldo Multi-Provider (`gemini.ts`)

- **Modelo Principal:** Utiliza **Gemini Flash Latest** (`gemini-flash-latest`, constante `GEMINI_MODEL`) alimentado por `GEMINI_API_KEY` (cuenta de Google Cloud dedicada `transavicdev@gmail.com`).
- **Gotcha de Thinking Tokens:** El modelo implementa "thinking tokens" internos que consumen `maxOutputTokens`. Para evitar que las respuestas se trunquen a pocos caracteres, se configura explícitamente `thinkingConfig: { thinkingBudget: 0 }` en la inicialización del cliente de Google Gen AI (`gemini.ts:64`).
- **Respaldo con Groq (Llama 3.3 70B):** Para mitigar bloqueos de cuota gratuita (Error 429), el método `callIA()` implementa un try/catch: si Gemini falla, reintenta automáticamente con **Groq** (`callGroq`, API compatible con OpenAI usando el modelo `llama-3.3-70b-versatile`) si existe `GROQ_API_KEY` en el entorno.

---

## 3. Anonimización y Privacidad (`ClienteAnonymizer`)

Antes de transmitir cualquier historial de ventas a los servidores de Google o Groq, se aplica la clase **`ClienteAnonymizer`** en `lib/gemini.ts` para enmascarar los nombres reales:

- **Funcionamiento:** Mapea de forma atómica los nombres a identificadores anónimos (`"Cliente A"`, `"Cliente B"`, etc.) durante la preparación del prompt.
- **Instrucción al modelo:** Se le prohíbe explícitamente a la IA en el system prompt repetir los códigos de anonimización en su respuesta (debe referirse a ellos como "tu principal comprador" o "el restaurante con mayor retraso de pago").

---

## 4. Caché Persistente en Base de Datos (`ia_insights_cache`)

Para evitar llamadas innecesarias que tardan entre 7 y 10 segundos y agotan las cuotas de API de los tiers gratuitos:

- **Estructura de caché:** La generación de reportes comerciales utiliza el helper `cached()` de `insights.ts`, el cual lee y escribe en la tabla `ia_insights_cache` usando una clave de caché (`cache_key`) por scope:
  - `admin-mes-YYYY-MM` $\rightarrow$ Caché global del admin.
  - `asesor-{uuid}-mes-YYYY-MM` $\rightarrow$ Caché privado de la asesora.
- **TTL (Tiempo de Vida):** Los insights se almacenan con una vigencia de **1 hora**. Si un usuario recarga la página dentro de la misma hora, el sistema responde desde base de datos en menos de **150ms** (cero consumo de API).
- **Recuperación fail-safe:** Si la generación de un insight nuevo falla debido a rate limits pero existe un reporte válido previo guardado en caché (incluso si expiró su TTL), el sistema sirve el reporte antiguo marcándolo como degradado (`esInsightDegradado`), garantizando que la UI nunca quede vacía.

---

## 5. CRM WhatsApp para dos marcas — cableado con Meta Cloud API (19 jul 2026)

El chatbot del CRM de leads reutiliza el motor Gemini/Groq de este módulo y se conecta a **Meta Cloud API** por webhook. El **envío saliente real ya está implementado** (antes era mock) y el sistema rutea DOS marcas (Transavic RUC 20 / Avícola de Tony RUC 10) sobre un mismo webhook.

**Arquitectura (deep research verificado contra Meta 2025-2026, workflow `w2upuo65t`):**
- Dos marcas = **dos Business Portfolios = dos WABAs = dos números** (una WABA no cruza portfolios). El webhook es COMPARTIDO; se ruteá por `value.metadata.phone_number_id`.
- **NO hace falta verificar la empresa para operar/publicitar** (recibir + responder en ventana 24h/72h + hasta 250 destinatarios únicos/día). La verificación solo se necesita para escalar el tope y para **plantillas proactivas** (desde ene-2026). El RUC 10 (persona natural) SÍ se verifica: nombre legal = persona (Ficha RUC), marca = nombre comercial.

**Piezas de código:**
- `src/lib/whatsapp/config.ts` — credenciales por marca (`WHATSAPP_TRA_*` / `WHATSAPP_AVI_*`), `empresaDesdePhoneNumberId()`, `isWhatsAppConfigured()`.
- `src/lib/whatsapp/sender.ts` — `enviarTexto/enviarMedia/enviarPlantilla`, subida/descarga de media, detecta error 131047 (fuera de ventana). Nunca lanza.
- `src/app/api/webhooks/meta/route.ts` — rutea por `phone_number_id`, maneja texto+media+`referral` (CTWA `ctwa_clid`), **idempotencia por `message.id`**, procesa `statuses[]` (estado de entrega).
- `src/lib/chatbot/bot-orchestrator.ts` — lead scoped por `(telefono, empresa)`, envía la respuesta del bot de verdad.
- `src/app/api/crm/leads/[id]/mensajes/route.ts` — envío de la asesora (texto/media/plantilla) con **gate de ventana 24h** (409 si está cerrada; solo plantilla la reabre).

**Checklist ANTES de conectar cada número real (por marca):**
1. **`META_VERIFY_TOKEN`** en Vercel (webhook compartido). Sin ella el webhook GET responde **503**.
2. **`META_APP_SECRET`** en Vercel — verifica la firma `X-Hub-Signature-256` de los POST.
3. **`WHATSAPP_TRA_PHONE_NUMBER_ID` + `WHATSAPP_TRA_TOKEN`** (y `WHATSAPP_AVI_*` para la 2ª marca). Sin las credenciales de una marca, esa marca queda en **modo mock** (registra en el CRM, no manda a Meta) — no rompe nada.
4. Suscribir el webhook al campo **`messages`** y activar **"Ads Attribution"** para recibir `referral.ctwa_clid` de los anuncios.
5. **Prompt injection:** el prompt del bot ya **trunca y delimita** el mensaje del cliente — mantener esa protección.

> El test `scripts/test-crm-flow.mjs` NO corre localmente en esta Mac (Node 26 rompe `@neondatabase/serverless` — gotcha #13). Validar ejerciendo el webhook con un POST simulado contra el dev server (su runtime no está afectado).

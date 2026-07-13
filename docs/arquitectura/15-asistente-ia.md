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

## 5. Checklist de seguridad ANTES de conectar el número real de WhatsApp (CRM/chatbot)

El chatbot del CRM de leads (Fase 4 de la expansión ERP) reutiliza el motor Gemini/Groq de este módulo, pero se conecta a **Meta Cloud API** mediante un webhook. Antes de apuntar el número real de WhatsApp del negocio al webhook, verifica TODOS estos puntos:

1. **`META_VERIFY_TOKEN` configurada en Vercel.** El código ya NO tiene fallback hardcodeado: sin esta variable, el webhook responde **503** y Meta no podrá verificar la suscripción.
2. **`META_APP_SECRET` configurada.** Sin ella, los POST entrantes se aceptan **sin verificar la firma** `X-Hub-Signature-256` — eso solo es aceptable en pruebas, nunca con el número real.
3. **Implementar el envío real de mensajes salientes.** Hoy el envío de WhatsApp saliente es **MOCK** (`console.log`) tanto en el webhook como en `/api/crm/leads/[id]/mensajes` — el bot "responde" solo en la base de datos, el cliente no recibe nada.
4. **Probar el flujo completo** con `node scripts/test-crm-flow.mjs` (simula la entrada de un lead, la rotación de asesoras y la conversación con el bot).
5. **Prompt injection:** el prompt del bot ya **trunca y delimita** el mensaje del cliente antes de enviarlo al modelo — mantener esa protección en cualquier cambio del prompt.

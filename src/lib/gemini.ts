// src/lib/gemini.ts
// Helper para llamar a Gemini Flash Latest (cuenta dedicada transavicdev@gmail.com).
// Costo: free tier — 1,500 requests/día, 1M tokens/min de input, 32K tokens/min de output.
//
// 🔒 DATOS PERSONALES: lo mínimo indispensable.
//   - Los INSIGHTS del asistente comercial anonimizan los nombres con `ClienteAnonymizer`
//     (ver más abajo): ahí nunca viaja un nombre real.
//   - El CHATBOT de WhatsApp sí manda el PRIMER NOMBRE del cliente (para saludarlo) y
//     nombres de producto (catálogo público). NUNCA apellidos, RUC/DNI, dirección,
//     montos, saldos ni teléfono. Esa frontera se decide en
//     `src/lib/chatbot/contexto-negocio.ts`, no acá.
//
// Dos familias de funciones:
//   - callGemini/callGroq/callMistral/callIA → prompt simple (compatibilidad, insights).
//   - *Chat(...)                            → conversación multi-turno con systemInstruction.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

/** Mínimo de tiempo que vale la pena darle a un proveedor. Por debajo, ni se intenta. */
const MIN_MS_POR_PROVEEDOR = 4000;

export type ProveedorIA = "gemini" | "groq" | "mistral";

/**
 * Por qué se detuvo el modelo.
 * `length` = topó `maxOutputTokens` → la respuesta está CORTADA. Es la señal
 * determinista de truncamiento (mucho mejor que adivinarlo mirando el texto).
 */
export type FinishReason = "stop" | "length" | "other";

/** Un turno de la conversación, en el vocabulario del sistema (no el del proveedor). */
export interface MensajeChat {
  rol: "usuario" | "asistente";
  texto: string;
}

export interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  /** Timeout en ms de UNA llamada (default 15s) */
  timeoutMs?: number;
  /** Instrucciones de sistema. Solo la usan las variantes *Chat. */
  systemInstruction?: string;
  /**
   * Presupuesto TOTAL en ms para toda la cadena de respaldo (Gemini → Groq → Mistral).
   * Sin esto, el peor caso son 3 × timeoutMs = 45s, que no entra en el webhook.
   */
  presupuestoMs?: number;
}

export interface GeminiResult {
  text: string;
  promptTokens: number;
  responseTokens: number;
  /** Quién respondió realmente (para telemetría y para saber si Gemini está caído). */
  proveedor?: ProveedorIA;
  /** `length` ⇒ la respuesta quedó cortada por tokens. */
  finishReason?: FinishReason;
}

/** Error de un proveedor de IA, con el detalle que necesita quien decide el fallback. */
export class ErrorIA extends Error {
  readonly proveedor: ProveedorIA;
  readonly status?: number;
  readonly esTimeout: boolean;

  constructor(
    proveedor: ProveedorIA,
    mensaje: string,
    opts: { status?: number; esTimeout?: boolean } = {}
  ) {
    super(mensaje);
    this.name = "ErrorIA";
    this.proveedor = proveedor;
    this.status = opts.status;
    this.esTimeout = opts.esTimeout ?? false;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Normalización de la razón de corte (cada proveedor la nombra distinto)
// ════════════════════════════════════════════════════════════════════════

function finishDesdeGemini(valor: unknown): FinishReason {
  const v = String(valor ?? "").toUpperCase();
  if (v === "STOP") return "stop";
  if (v === "MAX_TOKENS") return "length";
  return "other";
}

function finishDesdeOpenAI(valor: unknown): FinishReason {
  const v = String(valor ?? "").toLowerCase();
  if (v === "stop") return "stop";
  if (v === "length") return "length";
  return "other";
}

/**
 * Turnos → formato OpenAI (Groq y Mistral).
 * ⚠️ Mistral rechaza con 400 si hay dos mensajes del mismo rol seguidos o si el
 * último no es `user`. La normalización de esos invariantes vive en
 * `src/lib/chatbot/prompt-antonella.ts:construirTurnos` — acá solo se traduce.
 */
function turnosParaOpenAI(mensajes: MensajeChat[], system?: string) {
  const out: Array<{ role: string; content: string }> = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of mensajes) {
    out.push({ role: m.rol === "usuario" ? "user" : "assistant", content: m.texto });
  }
  return out;
}

/** Turnos → formato Gemini (`contents[]` con roles user/model). */
function turnosParaGemini(mensajes: MensajeChat[]) {
  return mensajes.map((m) => ({
    role: m.rol === "usuario" ? "user" : "model",
    parts: [{ text: m.texto }],
  }));
}

// ════════════════════════════════════════════════════════════════════════
// Gemini
// ════════════════════════════════════════════════════════════════════════

export async function callGeminiChat(
  mensajes: MensajeChat[],
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ErrorIA("gemini", "GEMINI_API_KEY no está definida en el entorno");
  }

  const {
    temperature = 0.4, // 0.4 = balance entre creatividad y consistencia para insights
    maxOutputTokens = 600, // suficiente para 2-3 párrafos
    timeoutMs = 15000,
    systemInstruction,
  } = opts;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        ...(systemInstruction
          ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
          : {}),
        contents: turnosParaGemini(mensajes),
        generationConfig: {
          temperature,
          maxOutputTokens,
          // 🧠 Gemini 2.5 Flash usa "thinking tokens" internos antes de responder.
          // Sin esto, una respuesta de 3 oraciones consume 200+ tokens en thinking
          // y devuelve solo basura porque agota el budget. Desactivamos el thinking
          // para respuestas simples (no requieren razonamiento complejo).
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      // Errores comunes:
      // 400 → request mal formado
      // 403 → API key inválida o restricción de region
      // 429 → rate limit excedido (vuelve a intentar en 1 minuto)
      // 503 → Gemini sobrecargado, retry con backoff
      throw new ErrorIA("gemini", `Gemini API ${res.status}: ${errBody.slice(0, 200)}`, {
        status: res.status,
      });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      // Gemini puede retornar candidates vacío si el prompt fue bloqueado por safety filters
      const blockReason = data?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new ErrorIA("gemini", `Gemini bloqueó el prompt: ${blockReason}`);
      }
      throw new ErrorIA("gemini", "Gemini no devolvió texto en la respuesta");
    }

    return {
      text: text.trim(),
      promptTokens: data?.usageMetadata?.promptTokenCount ?? 0,
      responseTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
      proveedor: "gemini",
      finishReason: finishDesdeGemini(data?.candidates?.[0]?.finishReason),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ErrorIA(
        "gemini",
        `Gemini timeout (>${timeoutMs}ms) — Gemini sobrecargado o sin red`,
        { esTimeout: true }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Llama a Gemini Flash Latest con un prompt simple. Devuelve texto.
 * Lanza Error con mensaje legible si falla.
 */
export async function callGemini(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  return callGeminiChat([{ rol: "usuario", texto: prompt }], opts);
}

// ════════════════════════════════════════════════════════════════════════
// Respaldo: Groq (free tier, sin tarjeta, API compatible con OpenAI).
// Se usa SOLO cuando Gemini falla (429 u otro error). Modelo configurable
// con GROQ_MODEL (default Llama 3.3 70B). Recibe los MISMOS prompts ya
// anonimizados que Gemini → no cambia la frontera de privacidad.
// ════════════════════════════════════════════════════════════════════════

export async function callGroqChat(
  mensajes: MensajeChat[],
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new ErrorIA("groq", "GROQ_API_KEY no está definida en el entorno");
  }

  const { temperature = 0.4, maxOutputTokens = 600, timeoutMs = 15000, systemInstruction } = opts;
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: turnosParaOpenAI(mensajes, systemInstruction),
        temperature,
        max_tokens: maxOutputTokens,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new ErrorIA("groq", `Groq API ${res.status}: ${errBody.slice(0, 200)}`, {
        status: res.status,
      });
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new ErrorIA("groq", "Groq no devolvió texto en la respuesta");
    }

    return {
      text: text.trim(),
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      responseTokens: data?.usage?.completion_tokens ?? 0,
      proveedor: "groq",
      finishReason: finishDesdeOpenAI(data?.choices?.[0]?.finish_reason),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ErrorIA("groq", `Groq timeout (>${timeoutMs}ms) — Groq sobrecargado o sin red`, {
        esTimeout: true,
      });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Llama a Groq (Chat Completions, OpenAI-compatible). Misma firma/retorno que
 * callGemini para que sea intercambiable. Lanza Error legible si falla.
 */
export async function callGroq(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  return callGroqChat([{ rol: "usuario", texto: prompt }], opts);
}

// ════════════════════════════════════════════════════════════════════════
// Respaldo adicional: Mistral (API compatible con OpenAI/Mistral).
// Se usa SOLO cuando Gemini y Groq fallan (o no están configurados).
// ════════════════════════════════════════════════════════════════════════

export async function callMistralChat(
  mensajes: MensajeChat[],
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new ErrorIA("mistral", "MISTRAL_API_KEY no está definida en el entorno");
  }

  const { temperature = 0.4, maxOutputTokens = 600, timeoutMs = 15000, systemInstruction } = opts;
  const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(MISTRAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: turnosParaOpenAI(mensajes, systemInstruction),
        temperature,
        max_tokens: maxOutputTokens,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new ErrorIA("mistral", `Mistral API ${res.status}: ${errBody.slice(0, 200)}`, {
        status: res.status,
      });
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new ErrorIA("mistral", "Mistral no devolvió texto en la respuesta");
    }

    return {
      text: text.trim(),
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      responseTokens: data?.usage?.completion_tokens ?? 0,
      proveedor: "mistral",
      finishReason: finishDesdeOpenAI(data?.choices?.[0]?.finish_reason),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ErrorIA(
        "mistral",
        `Mistral timeout (>${timeoutMs}ms) — Mistral sobrecargado o sin red`,
        { esTimeout: true }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Llama a Mistral (Chat Completions). Misma firma/retorno que
 * callGemini para que sea intercambiable. Lanza Error legible si falla.
 */
export async function callMistral(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  return callMistralChat([{ rol: "usuario", texto: prompt }], opts);
}

// ════════════════════════════════════════════════════════════════════════
// Orquestador con respaldo automático
// ════════════════════════════════════════════════════════════════════════

/**
 * Intenta Gemini y, si falla, reintenta con Groq y después con Mistral.
 * Si todos fallan o no están configurados, propaga el error original de Gemini.
 *
 * Con `presupuestoMs`, reparte el tiempo entre los proveedores y NO intenta uno
 * si quedan menos de 4s: el chatbot corre dentro de un webhook con `maxDuration`,
 * y una llamada que no alcanza a terminar es peor que un fallback a tiempo.
 */
export async function callIAChat(
  mensajes: MensajeChat[],
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const inicio = Date.now();
  const timeoutBase = opts.timeoutMs ?? 15000;

  const restanteMs = (): number =>
    opts.presupuestoMs === undefined
      ? Number.POSITIVE_INFINITY
      : opts.presupuestoMs - (Date.now() - inicio);

  const optsPara = (): GeminiOptions => {
    const restante = restanteMs();
    return {
      ...opts,
      timeoutMs: Number.isFinite(restante) ? Math.min(timeoutBase, restante) : timeoutBase,
    };
  };

  const hayTiempo = () => restanteMs() >= MIN_MS_POR_PROVEEDOR;

  try {
    return await callGeminiChat(mensajes, optsPara());
  } catch (geminiErr) {
    console.warn(
      `Gemini falló (${(geminiErr as Error).message.slice(0, 60)}); intentando respaldo…`
    );

    if (process.env.GROQ_API_KEY && hayTiempo()) {
      try {
        return await callGroqChat(mensajes, optsPara());
      } catch (groqErr) {
        console.warn(
          `Groq falló (${(groqErr as Error).message.slice(0, 60)}); intentando Mistral…`
        );
      }
    }

    if (process.env.MISTRAL_API_KEY && hayTiempo()) {
      try {
        return await callMistralChat(mensajes, optsPara());
      } catch (mistralErr) {
        console.warn(`Mistral falló (${(mistralErr as Error).message.slice(0, 60)})`);
      }
    }

    throw geminiErr;
  }
}

/** Versión de prompt simple del orquestador (la que usan los insights). */
export async function callIA(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  return callIAChat([{ rol: "usuario", texto: prompt }], opts);
}

/**
 * Anonimiza un nombre de cliente para mandar a Gemini.
 * Usa un mapping consistente dentro del mismo llamado.
 *
 * @example
 *   const a = new ClienteAnonymizer();
 *   a.anon("Restaurante La Esquina");  // → "Cliente A"
 *   a.anon("Pollería El Buen Sabor");  // → "Cliente B"
 *   a.anon("Restaurante La Esquina");  // → "Cliente A" (consistente)
 */
export class ClienteAnonymizer {
  private map = new Map<string, string>();
  private counter = 0;

  anon(realName: string): string {
    const existing = this.map.get(realName);
    if (existing) return existing;
    // 0 → A, 1 → B, ..., 25 → Z, 26 → AA, 27 → AB, ...
    let n = this.counter++;
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    const code = `Cliente ${label}`;
    this.map.set(realName, code);
    return code;
  }

  /** Reverso: mapea de "Cliente A" → "Restaurante La Esquina" para mostrar al admin */
  deanon(code: string): string | undefined {
    for (const [real, c] of this.map.entries()) {
      if (c === code) return real;
    }
    return undefined;
  }

  /** Para debugging: ver el mapping completo */
  toObject(): Record<string, string> {
    return Object.fromEntries(this.map);
  }
}

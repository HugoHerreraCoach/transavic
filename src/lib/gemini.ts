// src/lib/gemini.ts
// Helper para llamar a Gemini Flash Latest (cuenta dedicada transavicdev@gmail.com).
// Costo: free tier — 1,500 requests/día, 1M tokens/min de input, 32K tokens/min de output.
//
// 🔒 IMPORTANTE: NUNCA mandar nombres reales de clientes a Gemini.
//   Antes de llamar a esta función, anonimizá los nombres (ej: "Cliente A", "Cliente B").
//   Para detalles legales: Antonio NO firmó política de privacidad con Gemini.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  /** Timeout en ms (default 15s) */
  timeoutMs?: number;
}

export interface GeminiResult {
  text: string;
  promptTokens: number;
  responseTokens: number;
}

/**
 * Llama a Gemini Flash Latest con un prompt simple. Devuelve texto.
 * Lanza Error con mensaje legible si falla.
 *
 * Diseñado para insights del Asistente IA. NO para chat conversacional
 * (no maneja historial de mensajes — usar generateContent con array si hace falta).
 */
export async function callGemini(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no está definida en el entorno");
  }

  const {
    temperature = 0.4, // 0.4 = balance entre creatividad y consistencia para insights
    maxOutputTokens = 600, // suficiente para 2-3 párrafos
    timeoutMs = 15000,
  } = opts;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          // 🧠 Gemini 2.5 Flash usa "thinking tokens" internos antes de responder.
          // Sin esto, una respuesta de 3 oraciones consume 200+ tokens en thinking
          // y devuelve solo basura porque agota el budget. Desactivamos el thinking
          // para insights simples (no requieren razonamiento complejo).
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
      throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      // Gemini puede retornar candidates vacío si el prompt fue bloqueado por safety filters
      const blockReason = data?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Gemini bloqueó el prompt: ${blockReason}`);
      }
      throw new Error("Gemini no devolvió texto en la respuesta");
    }

    return {
      text: text.trim(),
      promptTokens: data?.usageMetadata?.promptTokenCount ?? 0,
      responseTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gemini timeout (>${timeoutMs}ms) — Gemini sobrecargado o sin red`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Respaldo: Groq (free tier, sin tarjeta, API compatible con OpenAI).
// Se usa SOLO cuando Gemini falla (429 u otro error). Modelo configurable
// con GROQ_MODEL (default Llama 3.3 70B). Recibe los MISMOS prompts ya
// anonimizados que Gemini → no cambia la frontera de privacidad.
// ════════════════════════════════════════════════════════════════════════

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Llama a Groq (Chat Completions, OpenAI-compatible). Misma firma/retorno que
 * callGemini para que sea intercambiable. Lanza Error legible si falla.
 */
export async function callGroq(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY no está definida en el entorno");
  }

  const {
    temperature = 0.4,
    maxOutputTokens = 600,
    timeoutMs = 15000,
  } = opts;
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
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxOutputTokens,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq API ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Groq no devolvió texto en la respuesta");
    }

    return {
      text: text.trim(),
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      responseTokens: data?.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Groq timeout (>${timeoutMs}ms) — Groq sobrecargado o sin red`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}


// ════════════════════════════════════════════════════════════════════════
// Respaldo adicional: Mistral (API compatible con OpenAI/Mistral).
// Se usa SOLO cuando Gemini y Groq fallan (o no están configurados).
// ════════════════════════════════════════════════════════════════════════

const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

/**
 * Llama a Mistral (Chat Completions). Misma firma/retorno que
 * callGemini para que sea intercambiable. Lanza Error legible si falla.
 */
export async function callMistral(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY no está definida en el entorno");
  }

  const {
    temperature = 0.4,
    maxOutputTokens = 600,
    timeoutMs = 15000,
  } = opts;
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
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxOutputTokens,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Mistral API ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Mistral no devolvió texto en la respuesta");
    }

    return {
      text: text.trim(),
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      responseTokens: data?.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Mistral timeout (>${timeoutMs}ms) — Mistral sobrecargado o sin red`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Orquestador con respaldo automático: intenta Gemini y, si falla,
 * reintenta con Groq (si tiene key), y si falla, reintenta con Mistral (si tiene key).
 * Si todos fallan o no están configurados, propaga el error original de Gemini.
 */
export async function callIA(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  try {
    return await callGemini(prompt, opts);
  } catch (geminiErr) {
    console.warn(
      `Gemini falló (${(geminiErr as Error).message.slice(0, 60)}); intentando respaldo…`
    );

    if (process.env.GROQ_API_KEY) {
      try {
        return await callGroq(prompt, opts);
      } catch (groqErr) {
        console.warn(
          `Groq falló (${(groqErr as Error).message.slice(0, 60)}); intentando Mistral…`
        );
      }
    }

    if (process.env.MISTRAL_API_KEY) {
      try {
        return await callMistral(prompt, opts);
      } catch (mistralErr) {
        console.warn(
          `Mistral falló (${(mistralErr as Error).message.slice(0, 60)})`
        );
      }
    }

    throw geminiErr;
  }
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

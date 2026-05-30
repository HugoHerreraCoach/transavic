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

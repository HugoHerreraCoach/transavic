// src/lib/chatbot/sanear-respuesta.ts
//
// Saneo de la salida del LLM ANTES de enviarla al cliente por WhatsApp.
//
// Por qué existe: el bot manda lo que devuelva Gemini/Groq firmado con el nombre
// de la marca. Sin revisar, un cliente puede recibir una frase cortada a la mitad
// ("Claro, te cotizo el pollo entero para") o basura estructural (el proveedor
// devolviendo solo "{" tras consumir todos los tokens). Estas funciones son
// PURAS y no dependen de la DB ni de Meta, así que se prueban sueltas
// (`src/lib/chatbot/sanear-respuesta.test.ts`).
//
// ⚠️ Historia que explica el diseño de `pareceTruncada`: la versión original
// miraba el final del TEXTO COMPLETO y exigía puntuación de cierre. Con eso, una
// cotización perfectamente válida que termina en "- Alitas: S/ 12.00 por kg" se
// descartaba y el cliente recibía "tengo un problema técnico". Ahora se mira la
// ÚLTIMA LÍNEA y las líneas de lista/precio tienen su propia regla de cierre.

/** Longitud mínima para considerar que el modelo dijo algo útil. */
const MIN_CARACTERES = 8;

/** Solo símbolos/puntuación/llaves sueltas: salida estructural rota, sin texto. */
const SOLO_SIMBOLOS = /^[\s{}[\]:,"'`\-–—.]+$/;

/** Cierre de frase razonable. */
const CIERRE_LIMPIO = /[.!?…:)\]"»]$/;

/** Conectores típicos de frase inconclusa. */
const CONECTOR_FINAL = /\b(y|o|de|del|para|con|en|que|the|a|al|por|un|una|los|las|si|pero)$/i;

/** Línea de lista ("- Alitas…", "1) Pollo…") o línea con precio ("… S/ 12.00"). */
const LINEA_LISTA_O_PRECIO = /^\s*(?:[-•*·—]|\d+[.)])\s+|S\/\s*\d/;

/** Final legítimo de una línea de precio: unidad o número. */
const FIN_DE_PRECIO = /(kg|kilo|kilos|uni|unidad|unidades|und|docena|plancha|paquete|\d)$/i;

/**
 * Variation selectors (U+FE0F), ZWJ (U+200D) y espacios finales: no cuentan como
 * "el último carácter". Sin esto, `✔️` y `☺️` fallaban el test de emoji final.
 */
const COLA_INVISIBLE = /[\uFE0F\u200D\s]+$/u;

/**
 * ¿La respuesta del modelo es usable para enviársela a un cliente?
 * Rechaza vacíos, textos ínfimos, salidas que son puro símbolo y salidas que
 * arrancan en JSON (el modelo devolviendo estructura en vez de conversación).
 */
export function esRespuestaUsable(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpio = texto.trim();
  if (limpio.length < MIN_CARACTERES) return false;
  if (SOLO_SIMBOLOS.test(limpio)) return false;
  if (limpio.startsWith("{") || limpio.startsWith("[{")) return false;
  return true;
}

/**
 * Heurística de truncamiento: detecta que el modelo se cortó a media frase
 * aunque el proveedor no lo reporte.
 *
 * ⚠️ La señal FIABLE de truncamiento es `finishReason === "length"` de
 * `src/lib/gemini.ts` — esto es la red de seguridad para cuando el proveedor no
 * lo reporta. Se evalúa la ÚLTIMA LÍNEA porque el bot manda listas de precios.
 */
export function pareceTruncada(texto: string): boolean {
  const limpio = texto.trim();
  if (!limpio) return true;

  const ultima = limpio
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!ultima) return true;

  // Una pregunta cierra bien aunque no lleve el signo final ("¿Te lo llevo mañana?").
  if (ultima.includes("?")) return false;

  const fin = ultima.replace(COLA_INVISIBLE, "");
  if (!fin) return false; // la línea era solo un emoji/espacio → cierra bien

  if (CIERRE_LIMPIO.test(fin)) return false;
  // Emoji final también cierra bien (el bot suele cerrar con uno).
  if (/\p{Extended_Pictographic}$/u.test(fin)) return false;

  // Línea de lista o de precio: termina legítimamente en unidad o número.
  if (LINEA_LISTA_O_PRECIO.test(ultima) && FIN_DE_PRECIO.test(fin)) return false;

  // Termina en coma o conector típico de frase inconclusa: ahí sí está cortada.
  if (/,$/.test(fin)) return true;
  if (CONECTOR_FINAL.test(fin)) return true;

  // ⚠️ Antes había una regla más: "sin puntuación final y con más de 3 palabras
  // ⇒ truncada". Descartaba respuestas perfectamente válidas ("Te lo dejo listo
  // para mañana temprano"): en WhatsApp nadie cierra con punto. Y ahora cada
  // falso positivo cuesta caro, porque dispara el fallback y despierta a una
  // asesora. La señal FIABLE de truncamiento es `finishReason === "length"`
  // (src/lib/gemini.ts); esto quedó solo para los cortes evidentes.
  return false;
}

/**
 * WhatsApp no entiende Markdown: usa *negrita*, _cursiva_ y ~tachado~.
 * Un `**texto**` del modelo le llega al cliente con los asteriscos a la vista.
 */
export function limpiarMarkdown(texto: string): string {
  return texto
    .replace(/\*\*\*(.+?)\*\*\*/g, "*$1*") // ***x*** → *x*
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **x**   → *x*
    .replace(/__(.+?)__/g, "*$1*") // __x__   → *x*
    .replace(/^#{1,6}\s+/gm, "") // títulos ### al inicio de línea
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Aplica el saneo completo. Devuelve el texto listo para enviar, o `null` si la
 * respuesta no sirve y hay que caer al camino de fallback.
 *
 * Además limpia SIEMPRE cualquier etiqueta [HANDOFF] residual (case-insensitive
 * y global): si el modelo la escribe dos veces, sin el flag /g la segunda le
 * llegaría VISIBLE al cliente.
 */
export function sanearRespuestaBot(texto: string | null | undefined): string | null {
  if (!esRespuestaUsable(texto)) return null;
  const sinEtiqueta = quitarEtiquetaHandoff(texto as string);
  const limpio = limpiarMarkdown(sinEtiqueta);
  if (!esRespuestaUsable(limpio)) return null;
  if (pareceTruncada(limpio)) return null;
  return limpio;
}

/**
 * Quita TODAS las variantes de la etiqueta de handoff, sin importar mayúsculas.
 *
 * ⚠️ Colapsa solo espacios HORIZONTALES. La versión vieja hacía `\s{2,}` → " ",
 * que se comía los saltos de línea y dejaba una lista de precios en un renglón.
 */
export function quitarEtiquetaHandoff(texto: string): string {
  return texto
    .replace(/\[\s*handoff\s*\]/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ¿El modelo pidió transferir a una asesora? Tolerante a mayúsculas y espacios. */
export function pideHandoff(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return /\[\s*handoff\s*\]/i.test(texto);
}

// src/lib/chatbot/sanear-respuesta.ts
//
// Saneo de la salida del LLM ANTES de enviarla al cliente por WhatsApp.
//
// Por qué existe: el bot manda lo que devuelva Gemini/Groq firmado con el nombre
// de la marca. Sin revisar, un cliente puede recibir una frase cortada a la mitad
// ("Claro, te cotizo el pollo entero para") o basura estructural (el proveedor
// devolviendo solo "{" tras consumir todos los tokens). Estas dos funciones son
// PURAS y no dependen de la DB ni de Meta, así que se pueden probar sueltas.

/** Longitud mínima para considerar que el modelo dijo algo útil. */
const MIN_CARACTERES = 8;

/** Solo símbolos/puntuación/llaves sueltas: salida estructural rota, sin texto. */
const SOLO_SIMBOLOS = /^[\s{}[\]:,"'`\-–—.]+$/;

/**
 * ¿La respuesta del modelo es usable para enviársela a un cliente?
 * Rechaza vacíos, textos ínfimos y salidas que son puro símbolo.
 */
export function esRespuestaUsable(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpio = texto.trim();
  if (limpio.length < MIN_CARACTERES) return false;
  if (SOLO_SIMBOLOS.test(limpio)) return false;
  return true;
}

/**
 * Heurística de truncamiento: detecta que el modelo se cortó a media frase
 * aunque el proveedor no lo reporte (pasa seguido al topar `maxOutputTokens`).
 *
 * Se considera truncada si NO termina en cierre razonable (. ! ? … : ) " » emoji)
 * y además el final parece frase inconclusa: termina en coma, en conector, o en
 * una palabra suelta sin puntuación.
 */
export function pareceTruncada(texto: string): boolean {
  const limpio = texto.trim();
  if (!limpio) return true;

  // Cierre claro → no está truncada.
  if (/[.!?…:)\]"»]$/.test(limpio)) return false;
  // Emoji o símbolo final también cierra bien (el bot suele cerrar con uno).
  if (/\p{Extended_Pictographic}$/u.test(limpio)) return false;

  // Termina en coma o conector típico de frase inconclusa.
  if (/,$/.test(limpio)) return true;
  if (/\b(y|o|de|del|para|con|en|que|the|a|al|por|un|una|los|las|si|pero)$/i.test(limpio)) return true;

  // Sin puntuación final y con varias palabras: probablemente cortada.
  const palabras = limpio.split(/\s+/);
  return palabras.length > 3;
}

/**
 * Aplica el saneo completo. Devuelve el texto listo para enviar, o `null` si la
 * respuesta no sirve y hay que caer al mensaje de respaldo.
 *
 * Además limpia SIEMPRE cualquier etiqueta [HANDOFF] residual (case-insensitive
 * y global): si el modelo la escribe dos veces, sin el flag /g la segunda le
 * llegaría VISIBLE al cliente.
 */
export function sanearRespuestaBot(texto: string | null | undefined): string | null {
  if (!esRespuestaUsable(texto)) return null;
  const limpio = quitarEtiquetaHandoff(texto as string);
  if (!esRespuestaUsable(limpio)) return null;
  if (pareceTruncada(limpio)) return null;
  return limpio;
}

/** Quita TODAS las variantes de la etiqueta de handoff, sin importar mayúsculas. */
export function quitarEtiquetaHandoff(texto: string): string {
  return texto.replace(/\[\s*handoff\s*\]/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** ¿El modelo pidió transferir a una asesora? Tolerante a mayúsculas y espacios. */
export function pideHandoff(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return /\[\s*handoff\s*\]/i.test(texto);
}

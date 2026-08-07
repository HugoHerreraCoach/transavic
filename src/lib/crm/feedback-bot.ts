// src/lib/crm/feedback-bot.ts
//
// Taxonomía de la calificación 👍/👎 sobre las respuestas del bot de ventas.
// PURO: sin DB, sin red. Es la FUENTE ÚNICA que consumen el zod del endpoint,
// los chips del chat, los filtros de la vista de calificaciones y el CHECK de
// `scripts/migrate-crm-feedback-bot-2026-08-06.sql`.
//
// Agregar un motivo cuesta una línea acá + una migración chica que amplíe el
// CHECK. Esa fricción es a propósito: una taxonomía de 20 categorías no la lee
// nadie, y el valor de este dato está justamente en que se pueda agrupar.
//
// Por qué se guarda el SLUG y no la etiqueta: cambiar el texto que ve la asesora
// no debe obligar a migrar filas históricas.

export const MOTIVOS_FEEDBACK_BOT = [
  { slug: "invento_dato", label: "inventó un dato" },
  { slug: "precio_malo", label: "precio equivocado" },
  { slug: "no_entendio", label: "no entendió" },
  { slug: "muy_largo", label: "muy largo" },
  { slug: "tono_raro", label: "tono raro" },
] as const;

export type FeedbackMotivo = (typeof MOTIVOS_FEEDBACK_BOT)[number]["slug"];

export const SLUGS_FEEDBACK_BOT = MOTIVOS_FEEDBACK_BOT.map((m) => m.slug) as [
  FeedbackMotivo,
  ...FeedbackMotivo[],
];

/** 1 = 👍 · -1 = 👎 · null = sin calificar. */
export type VeredictoFeedback = 1 | -1 | null;

/** Etiqueta legible de un slug; devuelve el propio slug si no lo conoce. */
export function etiquetaMotivo(slug: string | null | undefined): string {
  if (!slug) return "";
  return MOTIVOS_FEEDBACK_BOT.find((m) => m.slug === slug)?.label ?? slug;
}

/**
 * Regla de coherencia compartida por el endpoint y la UI: el motivo SOLO existe
 * cuando el veredicto es 👎. Quitar el voto o pasarlo a 👍 borra el motivo.
 */
export function normalizarFeedback(
  veredicto: VeredictoFeedback,
  motivo: string | null | undefined
): { feedback: VeredictoFeedback; motivo: FeedbackMotivo | null } {
  if (veredicto !== -1) return { feedback: veredicto, motivo: null };
  const valido = MOTIVOS_FEEDBACK_BOT.some((m) => m.slug === motivo);
  return { feedback: -1, motivo: valido ? (motivo as FeedbackMotivo) : null };
}

// src/lib/chatbot/equidad-leads.ts
// La REGLA de reparto parejo de leads, aislada del orquestador.
//
// Vive aparte porque `bot-orchestrator.ts` importa el driver de Neon en el top
// level, y ese import mata cualquier test bajo Node 26 (gotcha #13). Acá no hay
// I/O ni React: es una función pura y por lo tanto testeable.

export interface AsesoraRotacion {
  id: string;
  name: string;
  orden_rotacion: number | null;
  leads_recibidos_hoy: number | null;
  /** Último lead que recibió EN ESTA MARCA. Desempata el reparto parejo. */
  ultimo_lead_at?: string | Date | null;
}

/**
 * Reparto parejo: gana la que MENOS leads recibió hoy en esta marca; si empatan,
 * la que hace más tiempo que no recibe; si aún empatan, por nombre (determinista).
 *
 * Se auto-corrige solo: si alguien no atiende un día, al día siguiente arranca
 * abajo y recibe primero. No hace falta llevar cuentas a mano.
 *
 * ⚠️ El desempate por nombre es el ÚLTIMO recurso, y que se llegue a usar seguido
 * es señal de que algo anda mal: significa que las candidatas están todas en cero
 * y sin historial. Eso fue exactamente el bug de agosto 2026 — los leads escalaban
 * al admin, dejaban de contar para nadie, y el orden alfabético le ofrecía siempre
 * a la misma asesora mientras la otra no recibía nada.
 */
export function ordenarPorEquidad(a: AsesoraRotacion, b: AsesoraRotacion): number {
  const porCarga = (a.leads_recibidos_hoy ?? 0) - (b.leads_recibidos_hoy ?? 0);
  if (porCarga !== 0) return porCarga;
  const ta = a.ultimo_lead_at ? new Date(a.ultimo_lead_at).getTime() : 0;
  const tb = b.ultimo_lead_at ? new Date(b.ultimo_lead_at).getTime() : 0;
  if (ta !== tb) return ta - tb;
  return (a.name || "").localeCompare(b.name || "");
}

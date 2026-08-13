// src/lib/chatbot/fallback.ts
//
// Qué hacer cuando el bot NO puede responder: la IA se cayó, devolvió algo
// inservible, o el cliente mandó una foto sin texto.
//
// La regla que ordena este archivo:
//   el bot nunca deja al cliente sin respuesta,
//   y nunca promete una asesora sin haberla despertado.
//
// Antes esto estaba roto en los dos sentidos: se mandaba "una asesora se
// comunicará contigo" pero NO se apagaba el bot y NO se notificaba a nadie
// (y con el lead todavía en cola, `vendedor_id` es NULL, así que el `if` de la
// notificación ni siquiera entraba). El cliente esperaba a alguien que nunca se
// enteró. Una foto sin caption era peor: silencio absoluto.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { crearNotificacion } from "../notificaciones";
import { sendPushNotification } from "../push-service";
import type { ConfigBot } from "./config-bot";

export type MotivoFallback =
  | "ia_caida"
  | "respuesta_invalida"
  | "media_sin_texto"
  | "envio_fallido"
  | "turno_perdido";

/** Lo que ve la asesora en la notificación y en la nota del hilo. */
const DESCRIPCION_MOTIVO: Record<MotivoFallback, string> = {
  ia_caida: "El asistente no pudo responder (falla del proveedor de IA)",
  respuesta_invalida: "El asistente devolvió una respuesta inservible y se descartó",
  media_sin_texto: "El cliente envió un archivo sin texto",
  envio_fallido: "La respuesta NO se pudo entregar por WhatsApp",
  turno_perdido: "Quedó un mensaje del cliente sin responder (no alcanzó el tiempo)",
};

/**
 * ⚠️ REGLA: un fallback NO apaga el bot.
 *
 * La primera versión hacía `chatbot_activo = FALSE` en todos estos casos, y eso
 * era peor que el problema que resolvía: un 429 pasajero de Gemini, un falso
 * positivo del saneo o una simple foto sin caption dejaban al lead **sin bot para
 * siempre**. Lo único que apaga el bot es un `[HANDOFF]` explícito del modelo o
 * que una asesora tome la conversación. Acá solo se avisa a una humana.
 *
 * Anti-spam: si ya hay una nota del sistema reciente en el hilo, no se vuelve a
 * notificar (el cliente igual recibe su respuesta).
 */
const MINUTOS_ANTISPAM = 30;

/** "lunes a sábado" a partir de los días numéricos (1 = lunes … 7 = domingo). */
export function textoDias(dias: number[]): string {
  const nombres = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const orden = [...new Set(dias)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (orden.length === 0) return "todos los días";
  const consecutivos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1);
  if (orden.length === 1) return nombres[orden[0] - 1];
  if (consecutivos) return `${nombres[orden[0] - 1]} a ${nombres[orden[orden.length - 1] - 1]}`;
  return orden.map((d) => nombres[d - 1]).join(", ");
}

/** Horario legible para el cliente: "lunes a sábado de 8:00 a 20:00". */
export function textoHorario(cfg: ConfigBot): string {
  return `${textoDias(cfg.dias_atencion)} de ${cfg.atencion_hora_inicio}:00 a ${cfg.atencion_hora_fin}:00`;
}

/**
 * ¿Le toca hablar al bot? PURA.
 *
 * Decisión de Hugo (13 ago 2026): el bot **cubre el hueco**, no reemplaza a las
 * asesoras. Con `cuando_responde: "fuera_horario"` (el default) se queda callado
 * mientras ellas están, y atiende de noche y los días no laborables.
 *
 * `activo: false` lo apaga siempre, sin importar la hora.
 */
export function botDebeResponder(opts: {
  cfg: ConfigBot;
  dentroDeAtencion: boolean;
}): boolean {
  if (!opts.cfg.activo) return false;
  if (opts.cfg.cuando_responde === "siempre") return true;
  return !opts.dentroDeAtencion;
}

/**
 * Lo que se le dice al cliente cuando el bot pasa la conversación a una humana
 * FUERA del horario. Sin esto, el `[HANDOFF]` nocturno apagaba el bot y el
 * cliente quedaba escribiendo al vacío hasta que alguien entrara por la mañana.
 */
export function mensajeCierreFueraDeHorario(cfg: ConfigBot): string {
  return `¡Gracias por escribirnos! 🙌 Nuestro horario de atención es ${textoHorario(cfg)}. Una asesora retoma tu pedido apenas empecemos el día y te confirma todo por aquí 😊`;
}

/**
 * El texto que recibe el cliente. PURO: depende solo del motivo y del horario.
 * Nunca menciona "problema técnico": eso no es asunto del cliente y suena a
 * empresa rota.
 */
export function mensajeFallback(
  motivo: MotivoFallback,
  opts: { dentroDeAtencion: boolean; cfg: ConfigBot }
): string {
  const { dentroDeAtencion, cfg } = opts;
  const horario = textoHorario(cfg);

  if (motivo === "media_sin_texto") {
    return dentroDeAtencion
      ? "¡Gracias! Ya recibí tu archivo 📎 Se lo paso a una asesora para que lo revise y te escriba en unos minutos desde este mismo número. ¿Me adelantas qué necesitas?"
      : `¡Gracias! Ya recibí tu archivo 📎 Nuestro horario de atención es ${horario}. Una asesora lo revisa y te responde apenas empecemos el día. ¿Me adelantas qué necesitas?`;
  }

  return dentroDeAtencion
    ? "Dame un momentito, por favor 🙏 Le estoy pasando tu consulta a una asesora y en breve te escribe desde este mismo número."
    : `¡Gracias por escribirnos! Nuestro horario de atención es ${horario}. Una asesora te responde apenas empecemos el día 😊`;
}

/**
 * A quién avisarle. NUNCA devuelve vacío mientras exista un admin:
 *   1. la asesora dueña del lead;
 *   2. si el lead está en cola, los candidatos del turno;
 *   3. si no hay nadie, el admin.
 */
export async function resolverReceptores(
  sql: NeonQueryFunction<false, false>,
  lead: {
    vendedor_id?: string | null;
    candidato_actual?: string | null;
    candidatos_nivel?: string[] | null;
  }
): Promise<string[]> {
  const ids = new Set<string>();
  if (lead.vendedor_id) ids.add(lead.vendedor_id);
  if (ids.size === 0) {
    if (lead.candidato_actual) ids.add(lead.candidato_actual);
    for (const id of lead.candidatos_nivel ?? []) if (id) ids.add(id);
  }
  if (ids.size === 0) {
    try {
      // Mismo fallback final que usa escalateLead (bot-orchestrator.ts).
      const admins = await sql`
        SELECT id FROM public.users
        WHERE role = 'admin' AND COALESCE(activo, TRUE) = TRUE
        LIMIT 1
      `;
      if (admins[0]?.id) ids.add(admins[0].id as string);
    } catch (err) {
      console.error("⚠️ [bot] No se pudo resolver un admin para notificar:", err);
    }
  }
  return [...ids];
}

export interface ArgsDerivar {
  leadId: string;
  leadNombre: string;
  telefono: string;
  motivo: MotivoFallback;
  /** Lo último que dijo el cliente, para que la asesora entre con contexto. */
  ultimoMensajeCliente?: string | null;
  lead: {
    vendedor_id?: string | null;
    candidato_actual?: string | null;
    candidatos_nivel?: string[] | null;
  };
}

/**
 * Deja una nota en el hilo y DESPIERTA a una humana. **No apaga el bot** (ver la
 * regla de arriba). Nunca lanza: si falla la notificación, el cliente igual
 * recibió su mensaje.
 */
export async function derivarAHumano(
  sql: NeonQueryFunction<false, false>,
  args: ArgsDerivar
): Promise<void> {
  const descripcion = DESCRIPCION_MOTIVO[args.motivo];
  const nota = `⚠️ ${descripcion}. Conviene que una asesora revise esta conversación.`;

  // ¿Ya avisamos hace poco? Si la IA está caída, cada mensaje del cliente pasaría
  // por acá y la asesora recibiría una notificación por mensaje.
  let yaAvisado = false;
  try {
    const recientes = await sql`
      SELECT 1
      FROM public.lead_mensajes
      WHERE lead_id = ${args.leadId}
        AND sender = 'sistema'
        AND created_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `;
    yaAvisado = recientes.length > 0;
  } catch {
    /* si falla el chequeo, mejor avisar de más que de menos */
  }

  try {
    await sql`
      INSERT INTO public.lead_mensajes (lead_id, sender, body, type)
      VALUES (${args.leadId}, 'sistema', ${nota}, 'text')
    `;
  } catch (err) {
    console.error("❌ [bot] No se pudo dejar la nota del sistema:", err);
  }

  if (yaAvisado) {
    console.log(
      `🔕 [bot] Ya se avisó a una humana en los últimos ${MINUTOS_ANTISPAM} min (lead ${args.leadId}).`
    );
    return;
  }

  const receptores = await resolverReceptores(sql, args.lead);
  const resumen = (args.ultimoMensajeCliente ?? "").trim().slice(0, 90);
  const cuerpo = resumen
    ? `${args.leadNombre} (${args.telefono}): "${resumen}"`
    : `${args.leadNombre} (${args.telefono}) necesita atención.`;

  for (const userId of receptores) {
    try {
      await crearNotificacion({
        userId,
        tipo: "lead_handoff",
        titulo: "⚠️ El bot no pudo responder",
        mensaje: cuerpo,
        link: `/dashboard/crm-leads?leadId=${args.leadId}`,
      });
      await sendPushNotification(userId, {
        title: "⚠️ El bot no pudo responder",
        body: cuerpo,
        url: `/dashboard/crm-leads?leadId=${args.leadId}`,
        tag: `bot-fallback-${args.leadId}`,
        renotify: true,
      });
    } catch (err) {
      console.error("⚠️ [bot] No se pudo notificar el fallback:", err);
    }
  }
}

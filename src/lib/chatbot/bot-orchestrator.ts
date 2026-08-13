// src/lib/chatbot/bot-orchestrator.ts
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { callIAChat, type GeminiResult } from "../gemini";
import { crearNotificacion } from "../notificaciones";
import {
  type EmpresaWhatsApp,
  isWhatsAppConfigured,
  normalizarEmpresa,
} from "../whatsapp/config";
import { enviarTexto } from "../whatsapp/sender";
import { pideHandoff, sanearRespuestaBot } from "./sanear-respuesta";
import { ordenarPorEquidad, type AsesoraRotacion } from "./equidad-leads";
import { construirContextoNegocio, type ContextoNegocio } from "./contexto-negocio";
import {
  construirSystemPrompt,
  construirTurnos,
  type MensajeHistorial,
} from "./prompt-antonella";
import {
  botDebeResponder,
  derivarAHumano,
  mensajeCierreFueraDeHorario,
  mensajeFallback,
  resolverReceptores,
  type MotivoFallback,
} from "./fallback";
import { sendPushNotification } from "../push-service";
import { type Lead } from "../types";

/**
 * Nombre comercial de cada marca.
 *
 * ⚠️ El cliente escribió al número de UNA marca (el webhook lo rutea por
 * `phone_number_id`). El bot debe hablar SOLO de esa marca: mencionar la otra
 * confunde al cliente y revela que ambas son del mismo dueño. El resto del
 * conocimiento (carta con precios, distritos, horarios) lo arma
 * `contexto-negocio.ts` leyendo la DB — acá ya no hay datos hardcodeados.
 */
const NOMBRE_MARCA: Record<EmpresaWhatsApp, string> = {
  Transavic: "Transavic",
  "Avícola de Tony": "La Avícola de Tony",
};

/**
 * Config de rotación por defecto. El patrón de 20 pasos reparte los leads entre
 * niveles de asesoras con cuotas ~60/25/15.
 */
const CONFIG_ROTACION_DEFAULT = {
  sequenceIndex: 0,
  sequencePattern: [1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 3],
  lastResetDate: null as string | null,
  dailyResetHour: 8,
};

/**
 * Cuánto espera el bot antes de contestar. Sirve para DOS cosas:
 *   1. juntar la ráfaga ("20 kg" / "para mañana" / "en Surco" en 4 segundos) en
 *      una sola respuesta, en vez de tres encimadas;
 *   2. no parecer un robot: contestar en 2 segundos delata a la máquina.
 * Ajustable sin deploy con BOT_DEBOUNCE_MS.
 */
const DEBOUNCE_MS = Number(process.env.BOT_DEBOUNCE_MS ?? 7000);

/**
 * Presupuesto del turno. El webhook tiene maxDuration = 60s; dejamos 8s de
 * colchón para el envío a Meta y la liberación del lock.
 */
const LIMITE_TURNO_MS = 52_000;

/** TTL del lock: MAYOR que maxDuration, para que se libere solo si la lambda muere. */
const TTL_LOCK_SEG = 70;

/** Cuántos mensajes se leen para reconstruir historial + ráfaga pendiente. */
const MENSAJES_A_LEER = 18;

/** Tope de rondas extra cuando el cliente escribe mientras el bot responde. */
const MAX_RONDAS = 2;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Persiste la respuesta del bot en `lead_mensajes` y la ENVÍA por WhatsApp,
 * dejando registrado el estado de entrega.
 *
 * Está extraído en un helper a propósito: el camino normal y el de fallback
 * deben comportarse igual. Antes el catch devolvía el texto de disculpa y nadie
 * lo usaba, así que ante una caída de la IA el cliente se quedaba sin respuesta.
 */
async function persistirYEnviarBot(
  sql: NeonQueryFunction<false, false>,
  leadId: string,
  empresa: EmpresaWhatsApp,
  telefono: string,
  texto: string
): Promise<{ ok: boolean; error?: string; fueraDeVentana?: boolean }> {
  const insertBot = await sql`
    INSERT INTO public.lead_mensajes (lead_id, sender, body, type)
    VALUES (${leadId}, 'bot', ${texto}, 'text')
    RETURNING id
  `;
  const botMsgId = insertBot[0]?.id;
  if (!botMsgId || !isWhatsAppConfigured(empresa)) return { ok: true };

  const envio = await enviarTexto(empresa, telefono, texto);
  await sql`
    UPDATE public.lead_mensajes
    SET whatsapp_message_id = ${envio.whatsappMessageId ?? null},
        estado = ${envio.ok ? "enviado" : "fallido"},
        error_msg = ${envio.ok ? null : envio.error ?? null}
    WHERE id = ${botMsgId}
  `;
  return { ok: envio.ok, error: envio.error, fueraDeVentana: envio.fueraDeVentana };
}

/**
 * Avisa que llegó un mensaje que el bot no contestó.
 *
 * ⚠️ Usa `resolverReceptores` en cascada (asesora → candidatos en cola → admin).
 * Con `if (lead.vendedor_id)` a secas, un lead recién creado —que está EN COLA y
 * por definición tiene `vendedor_id = NULL`— no le llegaba a nadie.
 */
async function notificarMensajeAAsesora(
  sql: NeonQueryFunction<false, false>,
  lead: {
    id: string;
    nombre?: string | null;
    vendedor_id?: string | null;
    candidato_actual?: string | null;
    candidatos_nivel?: string[] | null;
  },
  mensaje: string
): Promise<void> {
  const corto = mensaje.length > 100 ? `${mensaje.slice(0, 100)}...` : mensaje;
  const receptores = await resolverReceptores(sql, lead);
  for (const userId of receptores) {
    try {
      await crearNotificacion({
        userId,
        tipo: "lead_mensaje",
        titulo: `💬 Mensaje de ${lead.nombre ?? "un prospecto"}`,
        mensaje: corto,
        link: `/dashboard/crm-leads?leadId=${lead.id}`,
      });
      await sendPushNotification(userId, {
        title: `💬 Mensaje de ${lead.nombre ?? "un prospecto"}`,
        body: corto,
        url: `/dashboard/crm-leads?leadId=${lead.id}`,
        tag: `lead-msg-${lead.id}`,
        renotify: true,
      });
    } catch (err) {
      console.error("⚠️ [bot] No se pudo notificar el mensaje a la asesora:", err);
    }
  }
}

/** Datos extra de un mensaje entrante (media ya descargada, atribución del anuncio, id de Meta). */
export interface InboundOpts {
  /** wamid del mensaje entrante — para idempotencia (Meta reintenta el webhook). */
  whatsappMessageId?: string;
  /** Tipo del mensaje entrante: 'text' | 'image' | 'audio' | 'video' | 'document' | ... */
  tipo?: string;
  /** Media entrante ya descargada como dataURL (para guardar/renderizar). */
  mediaDataUrl?: string | null;
  /** Atribución del anuncio Click-to-WhatsApp (objeto referral del webhook). */
  referral?: { ctwa_clid?: string; source_id?: string; headline?: string } | null;
}

/** Lo que el webhook necesita para disparar la respuesta DESPUÉS de responderle a Meta. */
export interface TareaTurno {
  leadId: string;
  empresa: EmpresaWhatsApp;
  telefono: string;
  leadNombre: string;
  /**
   * `Date.now()` del ARRANQUE de la invocación (fase síncrona incluida).
   * El presupuesto se mide desde acá y no desde `responderTurno`, porque el
   * `maxDuration` de 60 s cubre toda la invocación: descargar una foto de 3 MB
   * antes del ACK ya consumió parte del reloj.
   */
  iniciadoEn: number;
}

/**
 * FASE SÍNCRONA — se ejecuta con Meta esperando, así que tiene que ser corta:
 * crea/actualiza el lead, registra el mensaje entrante (idempotente) y decide si
 * hay que responder. NO llama a la IA ni envía nada.
 *
 * Devuelve la tarea para `responderTurno`, o `null` si no hay que responder
 * (reintento de Meta, bot apagado en este lead, o sin DB).
 */
export async function registrarEntrante(
  telefono: string,
  nombreCliente: string,
  mensajeCuerpo: string,
  empresaInput: EmpresaWhatsApp | string = "Transavic",
  opts: InboundOpts = {}
): Promise<TareaTurno | null> {
  const iniciadoEn = Date.now();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const sql = neon(connectionString);

  // Escalar leads pendientes que hayan expirado
  await checkAndEscalateLeads(sql);

  const empresa = normalizarEmpresa(empresaInput);

  // 1. Limpiar teléfono
  const limpioTelefono = telefono.replace(/\D/g, "");

  // Atribución del anuncio (primer toque)
  const ctwaClid = opts.referral?.ctwa_clid ?? null;
  const ctwaSourceId = opts.referral?.source_id ?? null;
  const ctwaHeadline = opts.referral?.headline ?? null;

  // 2. Buscar o crear el lead — SCOPED por (telefono, empresa): un mismo cliente
  //    puede escribir a las dos marcas y son leads distintos.
  let lead = null;
  const leadsRows = await sql`
    SELECT * FROM public.leads WHERE telefono = ${limpioTelefono} AND empresa = ${empresa}
  `;

  if (leadsRows.length === 0) {
    // Asignar mediante rotación dinámica (Golden Ticket)
    const rotationRes = await rotateAndSelectCandidate(sql, empresa);
    let insertLead;

    if (rotationRes && rotationRes.candidato_actual) {
      insertLead = await sql`
        INSERT INTO public.leads (
          nombre, telefono, origen, empresa, estado, chatbot_activo, vendedor_id,
          estado_asignacion, candidato_actual, candidatos_nivel, inicio_turno, timeout_nivel, golden_ticket_phase,
          last_inbound_at, ctwa_clid, ctwa_source_id, ctwa_headline
        )
        VALUES (
          ${nombreCliente}, ${limpioTelefono}, 'whatsapp', ${empresa}, 'Nuevo', TRUE, NULL,
          'en_cola', ${rotationRes.candidato_actual}, ${rotationRes.candidatos_nivel}, NOW(), 15, 'individual',
          NOW(), ${ctwaClid}, ${ctwaSourceId}, ${ctwaHeadline}
        )
        ON CONFLICT (telefono, empresa) DO NOTHING
        RETURNING *
      `;

      // Notificar al candidato del nuevo turno
      try {
        await crearNotificacion({
          userId: rotationRes.candidato_actual,
          tipo: "lead_mensaje",
          titulo: "🎫 ¡Nuevo Lead Recibido!",
          mensaje: `Tienes un prospecto en cola: ${nombreCliente}. Tienes 15s para atenderlo.`,
          link: `/dashboard/crm-leads?leadId=${insertLead[0].id}`,
        });

        await sendPushNotification(rotationRes.candidato_actual, {
          title: "🎫 ¡Nuevo Lead Recibido!",
          body: `El prospecto ${nombreCliente} está en tu cola. Reclámalo en 15s o pasará al grupo.`,
          url: `/dashboard/crm-leads?leadId=${insertLead[0].id}`,
          tag: `new-lead-claim-${insertLead[0].id}`,
          renotify: true,
        });
      } catch (err) {
        console.error("Error al notificar al candidato inicial:", err);
      }
    } else {
      // Fallback directo a administrador
      const adminId = rotationRes?.vendedorId || null;
      insertLead = await sql`
        INSERT INTO public.leads (
          nombre, telefono, origen, empresa, estado, chatbot_activo, vendedor_id,
          estado_asignacion, last_inbound_at, ctwa_clid, ctwa_source_id, ctwa_headline
        )
        VALUES (
          ${nombreCliente}, ${limpioTelefono}, 'whatsapp', ${empresa}, 'Nuevo', TRUE, ${adminId},
          'asignado', NOW(), ${ctwaClid}, ${ctwaSourceId}, ${ctwaHeadline}
        )
        ON CONFLICT (telefono, empresa) DO NOTHING
        RETURNING *
      `;
    }
    // Dos webhooks del mismo número a la vez: el que pierde la carrera recibe 0
    // filas por el ON CONFLICT (índice único (telefono, empresa) de
    // migrate-crm-whatsapp-2026-07-19.sql) y relee el lead que creó el otro.
    lead = insertLead[0];
    if (!lead) {
      const relectura = await sql`
        SELECT * FROM public.leads WHERE telefono = ${limpioTelefono} AND empresa = ${empresa}
      `;
      lead = relectura[0];
    }
    if (!lead) return null;
  } else {
    lead = leadsRows[0];
  }

  // 3. Registrar el mensaje entrante. Para media guardamos la dataURL en body (así la
  //    renderiza la UI igual que la saliente) y conservamos el tipo real.
  //
  //    IDEMPOTENCIA: Meta reintenta el webhook, y dos reintentos concurrentes pasarían
  //    ambos un SELECT previo (check-then-act) haciendo que el bot responda dos veces.
  //    La deduplicación la resuelve el índice único parcial ux_lead_mensajes_wamid:
  //    si el INSERT no devuelve fila, este wamid ya estaba registrado → no reprocesar.
  const esMedia = opts.tipo && opts.tipo !== "text" && !!opts.mediaDataUrl;
  const caption = (mensajeCuerpo ?? "").trim();
  const bodyGuardar = esMedia ? (opts.mediaDataUrl as string) : mensajeCuerpo;
  const tipoGuardar = esMedia ? (opts.tipo as string) : "text";

  // Un mensaje SIN texto y SIN media (reacción 👍, sticker, ubicación, contacto)
  // no es una consulta: se ignora, igual que antes. Si se registrara como texto
  // vacío, el turno lo leería como "archivo sin texto" y molestaría al cliente.
  if (!esMedia && !caption) {
    console.log(`↩️ [Meta Webhook] Mensaje sin texto ni media (${opts.tipo ?? "?"}) ignorado.`);
    return null;
  }

  const insertMensaje = await sql`
    INSERT INTO public.lead_mensajes (lead_id, sender, body, type, whatsapp_message_id)
    VALUES (${lead.id}, 'cliente', ${bodyGuardar}, ${tipoGuardar}, ${opts.whatsappMessageId ?? null})
    ON CONFLICT (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL DO NOTHING
    RETURNING id
  `;
  if (opts.whatsappMessageId && insertMensaje.length === 0) {
    console.log(`↩️ [Meta Webhook] Reintento de ${opts.whatsappMessageId} ignorado (ya registrado).`);
    return null;
  }

  // 3b. El CAPTION de una foto va en una fila de texto aparte.
  //     `body` guarda la dataURL de la imagen, así que sin esto el texto que el
  //     cliente escribió SOBRE la foto ("quiero 20 kg de esto para mañana") se
  //     perdía y el bot le contestaba "recibí tu archivo, ¿qué necesitas?".
  if (esMedia && caption) {
    await sql`
      INSERT INTO public.lead_mensajes (lead_id, sender, body, type, whatsapp_message_id)
      VALUES (${lead.id}, 'cliente', ${caption}, 'text', ${
        opts.whatsappMessageId ? `${opts.whatsappMessageId}#cap` : null
      })
      ON CONFLICT (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL DO NOTHING
    `;
  }

  // 4. Abrir/renovar la ventana de 24h, guardar la atribución del anuncio si es el
  //    primer toque (sin pisar una previa) y AVANZAR el contador del turno. Ese
  //    contador es lo que permite descartar una respuesta que quedó vieja porque
  //    el cliente escribió de nuevo mientras la IA pensaba.
  await sql`
    UPDATE public.leads
    SET last_inbound_at = NOW(),
        bot_turno_seq = bot_turno_seq + 1,
        ctwa_clid = COALESCE(ctwa_clid, ${ctwaClid}),
        ctwa_source_id = COALESCE(ctwa_source_id, ${ctwaSourceId}),
        ctwa_headline = COALESCE(ctwa_headline, ${ctwaHeadline}),
        updated_at = NOW()
    WHERE id = ${lead.id}
  `;

  // 5. Si el chatbot está inactivo en este lead, contesta una humana.
  if (!lead.chatbot_activo) {
    await notificarMensajeAAsesora(sql, lead as Lead, mensajeCuerpo || "(archivo adjunto)");
    return null;
  }

  return {
    leadId: lead.id as string,
    empresa,
    telefono: limpioTelefono,
    leadNombre: (lead.nombre as string) ?? "un prospecto",
    iniciadoEn,
  };
}

/** Separa el historial previo de la ráfaga pendiente de responder. */
function partirConversacion(mensajes: MensajeHistorial[]): {
  historial: MensajeHistorial[];
  nuevos: MensajeHistorial[];
} {
  let corte = mensajes.length;
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].sender !== "cliente") {
      corte = i + 1;
      break;
    }
    if (i === 0) corte = 0;
  }
  return { historial: mensajes.slice(0, corte), nuevos: mensajes.slice(corte) };
}

/** Libera el lock, pero solo si sigue siendo nuestro (otro pudo robárnoslo). */
async function liberarLock(
  sql: NeonQueryFunction<false, false>,
  leadId: string,
  token: string
): Promise<void> {
  try {
    await sql`
      UPDATE public.leads
      SET bot_lock_token = NULL, bot_lock_expira = NULL, bot_pensando_desde = NULL
      WHERE id = ${leadId} AND bot_lock_token::text = ${token}
    `;
  } catch (err) {
    console.error("⚠️ [bot] No se pudo liberar el lock del turno:", err);
  }
}

/**
 * FASE DIFERIDA — corre después de responderle 200 a Meta (`after()` del webhook).
 * Acá vive todo lo caro: debounce, contexto, IA, saneo y envío.
 *
 * Garantías:
 *   - UN solo respondedor por lead (lock optimista con TTL).
 *   - La ráfaga se responde UNA vez, con todos los mensajes juntos.
 *   - Si mientras la IA pensaba entró la asesora, la respuesta se DESCARTA.
 *   - Si la IA falla, el cliente igual recibe respuesta y una humana se entera.
 */
export async function responderTurno(tarea: TareaTurno, ronda = 0): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const sql = neon(connectionString);
  const t0 = tarea.iniciadoEn;
  const token = crypto.randomUUID();

  // 1. Tomar el turno. Una sola sentencia: sin check-then-act, sin carreras.
  //    Falla (0 filas) si ya hay otro turno en vuelo o si el bot está apagado.
  //
  //    ⚠️ El que PIERDE esta carrera se va sin hacer nada — su mensaje ya está
  //    guardado y con `bot_turno_seq` avanzado, así que el ganador lo va a leer
  //    (si llegó durante el debounce) o lo va a reencolar al soltar el lock.
  let lock;
  try {
    lock = await sql`
      UPDATE public.leads
      SET bot_lock_token = ${token},
          bot_lock_expira = NOW() + (${TTL_LOCK_SEG} || ' seconds')::interval,
          bot_pensando_desde = NOW()
      WHERE id = ${tarea.leadId}
        AND chatbot_activo = TRUE
        AND (bot_lock_expira IS NULL OR bot_lock_expira < NOW())
      RETURNING id
    `;
  } catch (err) {
    // Si ni el lock se puede tomar (DB caída, migración sin aplicar), el cliente
    // no puede quedarse mudo: se responde igual y se avisa a una humana.
    console.error("❌ [bot] No se pudo tomar el turno:", err);
    try {
      await responderConFallback(sql, tarea, "ia_caida", null);
    } catch (err2) {
      console.error("❌ [bot] Tampoco se pudo enviar el fallback:", err2);
    }
    return;
  }

  if (lock.length === 0) {
    console.log(`⏭️ [bot] Turno ya tomado (o bot apagado) para el lead ${tarea.leadId}.`);
    return;
  }

  try {
    // 2. Debounce: darle tiempo al cliente a terminar de escribir.
    if (DEBOUNCE_MS > 0) await esperar(DEBOUNCE_MS);
    await ejecutarTurno(sql, tarea, token, t0);
  } catch (err) {
    console.error("❌ [bot] Error en el turno:", err);
    try {
      await responderConFallback(sql, tarea, "ia_caida", null);
    } catch (err2) {
      console.error("❌ [bot] Tampoco se pudo enviar el fallback:", err2);
    }
  } finally {
    await liberarLock(sql, tarea.leadId, token);
  }

  // 3. ¿Quedó algún mensaje sin responder? Pasa cuando el cliente escribió
  //    mientras teníamos el lock: ese turno se fue sin hacer nada. Sin esto, su
  //    mensaje quedaba guardado en el CRM y el cliente NUNCA recibía respuesta.
  await reencolarSiQuedoPendiente(sql, tarea, t0, ronda);
}

/**
 * Vuelve a correr el turno si entraron mensajes nuevos mientras respondíamos.
 * Acotado por rondas y por el presupuesto de la invocación: si no alcanza el
 * tiempo, se le avisa a una humana en vez de dejar al cliente esperando.
 */
async function reencolarSiQuedoPendiente(
  sql: NeonQueryFunction<false, false>,
  tarea: TareaTurno,
  t0: number,
  ronda: number
): Promise<void> {
  try {
    const filas = await sql`
      SELECT bot_turno_seq, bot_turno_respondido, chatbot_activo,
             vendedor_id, candidato_actual, candidatos_nivel, nombre
      FROM public.leads WHERE id = ${tarea.leadId}
    `;
    const lead = filas[0];
    if (!lead || !lead.chatbot_activo) return;
    const pendiente =
      Number(lead.bot_turno_seq ?? 0) > Number(lead.bot_turno_respondido ?? 0);
    if (!pendiente) return;

    const alcanzaTiempo = LIMITE_TURNO_MS - (Date.now() - t0) > 20_000;
    if (ronda < MAX_RONDAS && alcanzaTiempo) {
      console.log(`🔁 [bot] Quedó un mensaje sin responder; nueva ronda (${ronda + 1}).`);
      await responderTurno(tarea, ronda + 1);
      return;
    }

    console.warn(`⚠️ [bot] Mensaje sin responder y sin presupuesto (lead ${tarea.leadId}).`);
    await derivarAHumano(sql, {
      leadId: tarea.leadId,
      leadNombre: (lead.nombre as string) ?? tarea.leadNombre,
      telefono: tarea.telefono,
      motivo: "turno_perdido",
      lead: {
        vendedor_id: (lead.vendedor_id as string | null) ?? null,
        candidato_actual: (lead.candidato_actual as string | null) ?? null,
        candidatos_nivel: (lead.candidatos_nivel as string[] | null) ?? null,
      },
    });
  } catch (err) {
    console.error("⚠️ [bot] No se pudo comprobar si quedaron mensajes pendientes:", err);
  }
}

/**
 * Marca hasta qué turno contestó el bot. Es lo que evita que
 * `reencolarSiQuedoPendiente` vuelva a disparar en bucle.
 */
async function marcarTurnoRespondido(
  sql: NeonQueryFunction<false, false>,
  leadId: string,
  hastaSeq: number | null
): Promise<void> {
  try {
    if (hastaSeq === null) {
      // Fallback: dimos por respondido todo lo que había.
      await sql`
        UPDATE public.leads SET bot_turno_respondido = bot_turno_seq WHERE id = ${leadId}
      `;
    } else {
      await sql`
        UPDATE public.leads
        SET bot_turno_respondido = GREATEST(bot_turno_respondido, ${hastaSeq}::bigint)
        WHERE id = ${leadId}
      `;
    }
  } catch (err) {
    console.error("⚠️ [bot] No se pudo marcar el turno como respondido:", err);
  }
}

/** Manda el mensaje de respaldo y despierta a una humana (NO apaga el bot). */
async function responderConFallback(
  sql: NeonQueryFunction<false, false>,
  tarea: TareaTurno,
  motivo: MotivoFallback,
  ctx: ContextoNegocio | null,
  ultimoMensajeCliente?: string | null
): Promise<void> {
  let contexto = ctx;
  if (!contexto) {
    contexto = await construirContextoNegocio(sql, {
      empresa: tarea.empresa,
      marcaNombre: NOMBRE_MARCA[tarea.empresa],
      telefono: tarea.telefono,
      lead: {},
    });
  }
  const texto = mensajeFallback(motivo, {
    dentroDeAtencion: contexto.momento.dentroDeAtencion,
    cfg: contexto.config,
  });
  await persistirYEnviarBot(sql, tarea.leadId, tarea.empresa, tarea.telefono, texto);
  await marcarTurnoRespondido(sql, tarea.leadId, null);

  const filas = await sql`
    SELECT id, nombre, vendedor_id, candidato_actual, candidatos_nivel
    FROM public.leads WHERE id = ${tarea.leadId}
  `;
  const lead = filas[0] ?? {};
  await derivarAHumano(sql, {
    leadId: tarea.leadId,
    leadNombre: (lead.nombre as string) ?? tarea.leadNombre,
    telefono: tarea.telefono,
    motivo,
    ultimoMensajeCliente,
    lead: {
      vendedor_id: (lead.vendedor_id as string | null) ?? null,
      candidato_actual: (lead.candidato_actual as string | null) ?? null,
      candidatos_nivel: (lead.candidatos_nivel as string[] | null) ?? null,
    },
  });
}

async function ejecutarTurno(
  sql: NeonQueryFunction<false, false>,
  tarea: TareaTurno,
  token: string,
  t0: number
): Promise<void> {
  const transcurrido = () => Date.now() - t0;
  let ctx: ContextoNegocio | null = null;
  let ultimoTextoCliente: string | null = null;

  for (let vuelta = 0; vuelta < 2; vuelta++) {
    // 3. Estado del lead + conversación, en un solo round-trip.
    //    El CASE evita traer el base64 de las fotos: son megabytes que además
    //    ensucian el prompt.
    const [estadoRows, mensajesRows] = await sql.transaction([
      sql`
        SELECT id, nombre, ciudad, negocio, chatbot_activo, bot_turno_seq,
               vendedor_id, candidato_actual, candidatos_nivel,
               (bot_lock_token::text = ${token}) AS lock_mio
        FROM public.leads WHERE id = ${tarea.leadId}
      `,
      sql`
        SELECT sender, type,
               CASE WHEN type = 'text' THEN body ELSE NULL END AS body
        FROM public.lead_mensajes
        WHERE lead_id = ${tarea.leadId}
        ORDER BY created_at DESC
        LIMIT ${MENSAJES_A_LEER}
      `,
    ]);

    const lead = estadoRows[0];
    if (!lead) return;
    // `!== true` y no `=== false`: si otro turno puso el token en NULL, la
    // comparación SQL devuelve NULL y `=== false` no dispararía.
    if (!lead.chatbot_activo || lead.lock_mio !== true) {
      console.log(`⏭️ [bot] Turno abandonado: la asesora tomó el lead ${tarea.leadId}.`);
      return;
    }
    const seqAlArmar = Number(lead.bot_turno_seq ?? 0);

    const cronologico = [...(mensajesRows as unknown as MensajeHistorial[])].reverse();
    const { historial, nuevos } = partirConversacion(cronologico);
    const textosNuevos = nuevos
      .map((m) => (m.type === "text" ? (m.body ?? "").trim() : ""))
      .filter(Boolean);
    ultimoTextoCliente = textosNuevos[textosNuevos.length - 1] ?? null;

    ctx = await construirContextoNegocio(sql, {
      empresa: tarea.empresa,
      marcaNombre: NOMBRE_MARCA[tarea.empresa],
      telefono: tarea.telefono,
      lead: {
        nombre: lead.nombre as string | null,
        ciudad: lead.ciudad as string | null,
        negocio: lead.negocio as string | null,
      },
    });

    // 3b. ¿Le toca hablar al bot?
    //
    // Con la config por defecto (`cuando_responde: "fuera_horario"`) el bot CUBRE
    // EL HUECO: se queda callado mientras las asesoras atienden y responde de
    // noche y los días no laborables. Antes hablaba las 24 h, encima de ellas.
    // El interruptor `activo` lo apaga siempre, sin importar la hora.
    if (!botDebeResponder({ cfg: ctx.config, dentroDeAtencion: ctx.momento.dentroDeAtencion })) {
      await notificarMensajeAAsesora(
        sql,
        lead as Lead,
        ultimoTextoCliente ?? "(archivo adjunto)"
      );
      return;
    }

    // 3c. Solo llegó media sin texto: no hay nada que preguntarle a la IA, pero
    //     el cliente NO puede quedarse sin respuesta (antes: silencio absoluto).
    if (textosNuevos.length === 0) {
      await responderConFallback(sql, tarea, "media_sin_texto", ctx, null);
      return;
    }

    // 4. La IA.
    const systemPrompt = construirSystemPrompt(ctx);
    const turnos = construirTurnos(historial, textosNuevos);
    if (turnos.length === 0) return;

    let resultado: GeminiResult | null = null;
    let motivo: MotivoFallback = "ia_caida";
    try {
      resultado = await callIAChat(turnos, {
        systemInstruction: systemPrompt,
        temperature: ctx.config.temperatura,
        maxOutputTokens: ctx.config.max_tokens,
        presupuestoMs: Math.max(0, LIMITE_TURNO_MS - transcurrido() - 8000),
      });
    } catch (err) {
      console.error("⚠️ [bot] La IA falló:", (err as Error).message.slice(0, 120));
    }

    let hayHandoff = false;
    let texto: string | null = null;
    if (resultado) {
      hayHandoff = pideHandoff(resultado.text);
      // `length` = el modelo topó el límite de tokens: la frase quedó cortada.
      texto = resultado.finishReason === "length" ? null : sanearRespuestaBot(resultado.text);
      if (!texto) {
        motivo = "respuesta_invalida";
        console.warn(
          `⚠️ [bot] Respuesta descartada (lead ${tarea.leadId}, finish=${resultado.finishReason}): "${resultado.text.slice(0, 90)}"`
        );
      }
    }

    // 4b. Un reintento corto: casi siempre el descarte es por tokens.
    if (!texto && LIMITE_TURNO_MS - transcurrido() > 14_000) {
      try {
        const corto = await callIAChat(turnos, {
          systemInstruction: `${systemPrompt}\n\n# AJUSTE PARA ESTA RESPUESTA\nResponde en máximo 2 oraciones completas y termina siempre la frase.`,
          temperature: ctx.config.temperatura,
          maxOutputTokens: 240,
          presupuestoMs: Math.max(0, LIMITE_TURNO_MS - transcurrido() - 6000),
        });
        hayHandoff = hayHandoff || pideHandoff(corto.text);
        texto = corto.finishReason === "length" ? null : sanearRespuestaBot(corto.text);
      } catch (err) {
        console.error("⚠️ [bot] El reintento corto también falló:", (err as Error).message.slice(0, 120));
      }
    }

    // 5. ¿Sigue siendo válida esta respuesta?
    const check = await sql`
      SELECT bot_turno_seq, chatbot_activo, (bot_lock_token::text = ${token}) AS lock_mio
      FROM public.leads WHERE id = ${tarea.leadId}
    `;
    const estado = check[0];
    if (!estado || !estado.chatbot_activo || estado.lock_mio !== true) {
      console.log(`🗑️ [bot] Respuesta descartada: la asesora entró (lead ${tarea.leadId}).`);
      return;
    }
    const seqAhora = Number(estado.bot_turno_seq ?? 0);
    if (seqAhora > seqAlArmar && vuelta === 0 && LIMITE_TURNO_MS - transcurrido() > 16_000) {
      // Llegó un mensaje nuevo mientras la IA pensaba y todavía hay tiempo:
      // se rehace el turno con la conversación completa.
      console.log(`🔁 [bot] Mensaje nuevo durante la respuesta; rehaciendo el turno.`);
      continue;
    }

    if (!texto) {
      await responderConFallback(sql, tarea, motivo, ctx, ultimoTextoCliente);
      return;
    }

    // 6. Handoff pedido por el modelo: apagar el bot y avisar.
    if (hayHandoff) {
      // Fuera de horario el handoff dejaba al cliente SIN bot y SIN humana: el
      // bot se apagaba y nadie entraba hasta la mañana, así que escribía al
      // vacío sin enterarse. Antes de apagar, se le dice cuándo lo atienden.
      if (!ctx.momento.dentroDeAtencion) {
        await persistirYEnviarBot(
          sql,
          tarea.leadId,
          tarea.empresa,
          tarea.telefono,
          mensajeCierreFueraDeHorario(ctx.config)
        );
      }
      await sql`
        UPDATE public.leads
        SET chatbot_activo = FALSE, estado = 'Contactado', updated_at = NOW()
        WHERE id = ${tarea.leadId}
      `;
      const receptor = (lead.vendedor_id as string | null) ?? null;
      const receptores = receptor
        ? [receptor]
        : [
            ...new Set(
              [
                (lead.candidato_actual as string | null) ?? null,
                ...(((lead.candidatos_nivel as string[] | null) ?? []) as string[]),
              ].filter(Boolean) as string[]
            ),
          ];
      for (const userId of receptores) {
        try {
          await crearNotificacion({
            userId,
            tipo: "lead_handoff",
            titulo: "🗣️ Transferencia de Prospecto",
            mensaje: `${tarea.leadNombre} (${tarea.telefono}) quiere avanzar: ${
              (ultimoTextoCliente ?? "").slice(0, 70) || "solicita atención humana"
            }`,
            link: `/dashboard/crm-leads?leadId=${tarea.leadId}`,
          });
          await sendPushNotification(userId, {
            title: "🗣️ Transferencia de Prospecto",
            body: `${tarea.leadNombre} (${tarea.telefono}) solicita atención humana.`,
            url: `/dashboard/crm-leads?leadId=${tarea.leadId}`,
            tag: `handoff-${tarea.leadId}`,
            renotify: true,
          });
        } catch (err) {
          console.error("⚠️ [bot] No se pudo notificar el handoff:", err);
        }
      }
    }

    // 7. Enviar. Si Meta lo rechaza, la asesora tiene que enterarse: el cliente
    //    NO recibió nada aunque en el CRM figure el mensaje.
    const envio = await persistirYEnviarBot(
      sql,
      tarea.leadId,
      tarea.empresa,
      tarea.telefono,
      texto
    );
    await marcarTurnoRespondido(sql, tarea.leadId, seqAlArmar);

    if (!envio.ok) {
      await derivarAHumano(sql, {
        leadId: tarea.leadId,
        leadNombre: tarea.leadNombre,
        telefono: tarea.telefono,
        motivo: "envio_fallido",
        ultimoMensajeCliente: envio.fueraDeVentana
          ? "Pasaron más de 24 h desde el último mensaje del cliente: hace falta una plantilla."
          : `WhatsApp devolvió: ${envio.error ?? "error desconocido"}.`,
        lead: {
          vendedor_id: (lead.vendedor_id as string | null) ?? null,
          candidato_actual: (lead.candidato_actual as string | null) ?? null,
          candidatos_nivel: (lead.candidatos_nivel as string[] | null) ?? null,
        },
      });
    }
    return;
  }
}

/**
 * Compatibilidad: hace las dos fases seguidas. La usan los scripts de prueba.
 * El webhook NO debe usar esto (deja a Meta esperando ~45s y dispara reintentos):
 * usa `registrarEntrante` + `after(() => responderTurno(tarea))`.
 */
export async function handleInboundMessage(
  telefono: string,
  nombreCliente: string,
  mensajeCuerpo: string,
  empresaInput: EmpresaWhatsApp | string = "Transavic",
  opts: InboundOpts = {}
): Promise<void> {
  const tarea = await registrarEntrante(telefono, nombreCliente, mensajeCuerpo, empresaInput, opts);
  if (tarea) await responderTurno(tarea);
}

interface RotationSelection {
  candidato_actual: string | null;
  candidatos_nivel: string[];
  actualTier: number;
  vendedorId?: string | null;
}

export async function checkAndEscalateLeads(sql: NeonQueryFunction<false, false>): Promise<void> {
  try {
    const expiredLeads = await sql`
      SELECT id, nombre, telefono, empresa, candidatos_nivel, candidato_actual, inicio_turno, timeout_nivel, golden_ticket_phase
      FROM public.leads
      WHERE estado_asignacion = 'en_cola'
        AND inicio_turno IS NOT NULL
        AND (inicio_turno + (timeout_nivel || ' seconds')::interval) < NOW()
    `;

    for (const lead of expiredLeads) {
      console.log(`⏰ Lead ${lead.nombre} (${lead.id}) ha expirado en la fase '${lead.golden_ticket_phase}'. Escalando...`);
      await escalateLead(sql, lead.id, lead);
    }
  } catch (error) {
    console.error("❌ Error en checkAndEscalateLeads:", error);
  }
}

export async function escalateLead(
  sql: NeonQueryFunction<false, false>,
  leadId: string,
  leadData: Partial<Lead>
): Promise<void> {
  try {
    const phase = leadData.golden_ticket_phase || "individual";
    // La marca del lead acota a quién se le puede escalar. Sin esto, un lead de
    // una marca sin atender terminaba ofrecido a las asesoras de la otra.
    // NULL = no sabemos la marca → no se filtra (mejor ofrecerlo a alguien).
    const marcaLead = (leadData.empresa as string | undefined) ?? null;

    if (phase === "individual") {
      // 1. Expandir al nivel/tier entero
      const prevCandidateId = leadData.candidato_actual;
      let tier = 1;
      if (prevCandidateId) {
        const u = await sql`SELECT orden_rotacion FROM public.users WHERE id = ${prevCandidateId}`;
        if (u.length > 0) tier = u[0].orden_rotacion || 1;
      }

      const tierAdvisors = await sql`
        SELECT id FROM public.users
        WHERE role = 'asesor' AND activo_rotacion = TRUE AND orden_rotacion = ${tier}
          AND COALESCE(activo, TRUE) = TRUE
          AND (
            ${marcaLead}::text IS NULL
            OR empresas IS NULL
            OR cardinality(empresas) = 0
            OR ${marcaLead}::text = ANY(empresas)
          )
      `;

      if (tierAdvisors.length > 0) {
        const ids = tierAdvisors.map((a) => String(a.id));
        await sql`
          UPDATE public.leads
          SET candidato_actual = NULL,
              candidatos_nivel = ${ids},
              inicio_turno = NOW(),
              timeout_nivel = 45,
              golden_ticket_phase = 'tier_expanded',
              updated_at = NOW()
          WHERE id = ${leadId}
        `;

        for (const advisor of tierAdvisors) {
          await sendPushNotification(advisor.id, {
            title: "👥 ¡Lead disponible para tu nivel!",
            body: `El prospecto ${leadData.nombre} está libre en tu Nivel ${tier}. ¡El primero en atenderlo se lo queda!`,
            url: `/dashboard/crm-leads?leadId=${leadId}`,
            tag: `lead-expanded-${leadId}`,
            renotify: true,
          });
        }
        console.log(`👥 Lead ${leadId} expandido a todos los asesores del Tier ${tier}`);
        return;
      } else {
        console.log(`⚠️ No hay asesores en el Tier ${tier}, saltando a rescate...`);
        leadData.golden_ticket_phase = "tier_expanded";
      }
    }

    if (leadData.golden_ticket_phase === "tier_expanded" || leadData.golden_ticket_phase === "individual") {
      // 2. Rescate: Escalar a Nivel 1 (Alta Prioridad)
      const nivel1Advisors = await sql`
        SELECT id FROM public.users
        WHERE role = 'asesor' AND activo_rotacion = TRUE AND orden_rotacion = 1
          AND COALESCE(activo, TRUE) = TRUE
          AND (
            ${marcaLead}::text IS NULL
            OR empresas IS NULL
            OR cardinality(empresas) = 0
            OR ${marcaLead}::text = ANY(empresas)
          )
      `;

      if (nivel1Advisors.length > 0) {
        const ids = nivel1Advisors.map((a) => String(a.id));
        await sql`
          UPDATE public.leads
          SET candidato_actual = NULL,
              candidatos_nivel = ${ids},
              inicio_turno = NOW(),
              timeout_nivel = 60,
              golden_ticket_phase = 'rescue',
              updated_at = NOW()
          WHERE id = ${leadId}
        `;

        for (const advisor of nivel1Advisors) {
          await sendPushNotification(advisor.id, {
            title: "🚨 ¡Rescate de Lead!",
            body: `El prospecto ${leadData.nombre} necesita atención urgente en Nivel 1. ¡Apoya a tu equipo!`,
            url: `/dashboard/crm-leads?leadId=${leadId}`,
            tag: `lead-rescue-${leadId}`,
            renotify: true,
          });
        }
        console.log(`🚨 Lead ${leadId} en fase de rescate (enviado a asesores de Nivel 1)`);
        return;
      } else {
        console.log(`⚠️ No hay asesores en Nivel 1, saltando a fallback...`);
      }
    }

    // 3. Fallback final: se lo queda una ASESORA de la marca, no el admin.
    //
    // Antes esto hacía `SELECT id FROM users WHERE role='admin' LIMIT 1` y le
    // colgaba el lead. Como nadie alcanza a tocar "Atender" en 2 minutos (15+45+60),
    // en la práctica TODOS los leads terminaban en el mismo admin: en producción los
    // 5 de Avícola eran de Mateo y las dos asesoras de esa marca tenían cero.
    //
    // Peor: al escalar se pone `candidato_actual = NULL`, y la equidad cuenta por
    // COALESCE(vendedor_id, candidato_actual). Un lead que escalaba dejaba de contar
    // para nadie, así que las asesoras quedaban empatadas en 0 para siempre y el
    // desempate alfabético le ofrecía SIEMPRE a la misma. Al asignar aquí a una
    // asesora real, el lead vuelve a contar y la rotación avanza sola.
    // Sin marca no se puede elegir por marca; ese lead cae en la red de abajo.
    const responsableId = marcaLead
      ? (await rotateAndSelectCandidate(sql, marcaLead as EmpresaWhatsApp)).candidato_actual
      : null;

    if (responsableId) {
      await sql`
        UPDATE public.leads
        SET vendedor_id = ${responsableId},
            estado_asignacion = 'asignado',
            candidato_actual = NULL,
            candidatos_nivel = '{}',
            inicio_turno = NULL,
            golden_ticket_phase = NULL,
            updated_at = NOW()
        WHERE id = ${leadId}
      `;

      await sendPushNotification(responsableId, {
        title: "⚠️ Lead sin atender",
        body: `El prospecto ${leadData.nombre} no fue atendido a tiempo y queda a tu cargo.`,
        url: `/dashboard/crm-leads?leadId=${leadId}`,
        tag: `lead-fallback-${leadId}`,
        renotify: true,
      });

      console.log(`⚠️ Lead ${leadId} asignado por timeout a la asesora de turno.`);
      return;
    }

    // Solo si la marca NO tiene ninguna asesora habilitada: red de seguridad para
    // que el lead no quede huérfano. Es un caso de configuración, no de operación.
    const fallbackAdmins = await sql`
      SELECT id FROM public.users
      WHERE role = 'admin' AND COALESCE(activo, TRUE) = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `;
    const adminId = fallbackAdmins.length > 0 ? fallbackAdmins[0].id : null;

    if (adminId) {
      await sql`
        UPDATE public.leads
        SET vendedor_id = ${adminId},
            estado_asignacion = 'asignado',
            candidato_actual = NULL,
            candidatos_nivel = '{}',
            inicio_turno = NULL,
            golden_ticket_phase = NULL,
            updated_at = NOW()
        WHERE id = ${leadId}
      `;

      await sendPushNotification(adminId, {
        title: "⚠️ Lead sin asesora disponible",
        body: `El prospecto ${leadData.nombre} no tiene ninguna asesora habilitada para su marca. Revisa el reparto.`,
        url: `/dashboard/crm-leads?leadId=${leadId}`,
        tag: `lead-fallback-${leadId}`,
        renotify: true,
      });

      console.warn(
        `⚠️ Lead ${leadId} (${leadData.empresa}) fue al admin: no hay asesoras habilitadas para esa marca.`
      );
    }
  } catch (error) {
    console.error("❌ Error en escalateLead:", error);
  }
}

/** Prefijo con el que se guarda el estado de rotación de cada marca en settings. */
function slugMarcaRotacion(empresa: EmpresaWhatsApp): "tra" | "avi" {
  return empresa === "Avícola de Tony" ? "avi" : "tra";
}

async function rotateAndSelectCandidate(
  sql: NeonQueryFunction<false, false>,
  empresa: EmpresaWhatsApp
): Promise<RotationSelection> {
  try {
    const slug = slugMarcaRotacion(empresa);

    // Carga del día POR MARCA: se deriva de los leads de hoy (zona Lima) en vez de
    // users.leads_recibidos_hoy, que es un contador GLOBAL compartido por las dos
    // marcas (ese se conserva intacto: lo muestra y edita la pantalla de rotación y
    // lo incrementa /api/crm/leads/[id]/atender).
    //
    // ⚠️ El pool se filtra POR MARCA (`users.empresas`). Antes se tomaban todas las
    // asesoras activas sin mirar la marca, así que un lead que escribía a una marca
    // podía caerle a alguien que atiende la otra. `empresas` NULL o vacío = atiende
    // todas (es el default, para que nadie quede fuera del reparto sin querer).
    //
    // `ultimo_lead_at` es el desempate del reparto parejo: entre dos que hoy tienen
    // la misma cantidad, va la que hace más tiempo que no recibe.
    const activeAdvisors = (await sql`
      SELECT u.id, u.name, u.orden_rotacion,
             (
               SELECT COUNT(*) FROM public.leads l
               WHERE COALESCE(l.vendedor_id, l.candidato_actual) = u.id
                 AND l.empresa = ${empresa}
                 AND (l.created_at AT TIME ZONE 'America/Lima')::date
                     = (NOW() AT TIME ZONE 'America/Lima')::date
             )::int AS leads_recibidos_hoy,
             (
               SELECT MAX(l2.created_at) FROM public.leads l2
               WHERE COALESCE(l2.vendedor_id, l2.candidato_actual) = u.id
                 AND l2.empresa = ${empresa}
             ) AS ultimo_lead_at
      FROM public.users u
      WHERE u.role = 'asesor'
        AND u.activo_rotacion = TRUE
        AND COALESCE(u.activo, TRUE) = TRUE
        AND (
          u.empresas IS NULL
          OR cardinality(u.empresas) = 0
          OR ${empresa}::text = ANY(u.empresas)
        )
    `) as AsesoraRotacion[];

    await sql`
      INSERT INTO public.settings (key, value, updated_at)
      VALUES ('crm_lead_distribution', ${JSON.stringify(CONFIG_ROTACION_DEFAULT)}::jsonb, NOW())
      ON CONFLICT (key) DO NOTHING
    `;
    const settingsRef = await sql`
      SELECT value FROM public.settings WHERE key = 'crm_lead_distribution'
    `;
    const config = settingsRef.length > 0 ? settingsRef[0].value : CONFIG_ROTACION_DEFAULT;

    const peruTime = new Date().toLocaleString("en-US", { timeZone: "America/Lima" });
    const peruDate = new Date(peruTime);
    const currentHour = peruDate.getHours();
    // La fecha se toma DIRECTO en zona Lima ("en-CA" ya formatea YYYY-MM-DD). Con
    // toISOString() sobre peruDate se volvía a aplicar el offset del servidor y de
    // noche guardaba la fecha de MAÑANA, con lo que el reset diario se saltaba un día.
    const todayDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    const dailyResetHour = config.dailyResetHour ?? 8;

    // 1) Reset del contador GLOBAL visible (users.leads_recibidos_hoy): una sola vez
    //    al día, lo dispare la marca que lo dispare. Su fecha vive en la raíz.
    const resetGlobal = currentHour >= dailyResetHour && config.lastResetDate !== todayDateStr;
    if (resetGlobal) {
      console.log(`🔄 [Rotación Leads] Reseteando contadores diarios a las ${dailyResetHour}:00.`);
      await sql`
        UPDATE public.users
        SET leads_recibidos_hoy = 0
        WHERE role = 'asesor'
      `;
      await sql`
        UPDATE public.settings
        SET value = jsonb_set(value, '{lastResetDate}', to_jsonb(${todayDateStr}::text)),
            updated_at = NOW()
        WHERE key = 'crm_lead_distribution'
      `;
    }

    // 2) Estado de la SECUENCIA por marca: cada marca avanza su propio turno para que
    //    los leads de una no consuman el patrón de la otra. El patrón y la hora de
    //    reset siguen siendo compartidos (es lo que administra la UI de rotación).
    //    Siembra: la primera vez, "tra" hereda el índice que venía en la raíz para no
    //    saltar de turno con el despliegue.
    const estadoMarca = config.porMarca?.[slug] as
      | { sequenceIndex?: number; lastResetDate?: string | null }
      | undefined;
    const semilla = {
      sequenceIndex: slug === "tra" ? (config.sequenceIndex ?? 0) : 0,
      lastResetDate: slug === "tra" ? (config.lastResetDate ?? null) : null,
    };
    if (!estadoMarca) {
      await sql`
        UPDATE public.settings
        SET value = jsonb_set(
              value,
              '{porMarca}',
              COALESCE(value->'porMarca', '{}'::jsonb)
                || jsonb_build_object(${slug}::text, ${JSON.stringify(semilla)}::jsonb)
            ),
            updated_at = NOW()
        WHERE key = 'crm_lead_distribution'
          AND value->'porMarca'->${slug}::text IS NULL
      `;
    }

    const resetMarca =
      currentHour >= dailyResetHour &&
      (estadoMarca?.lastResetDate ?? semilla.lastResetDate) !== todayDateStr;

    let currentIndex: number;
    if (resetMarca) {
      await sql`
        UPDATE public.settings
        SET value = jsonb_set(
              value,
              ARRAY['porMarca', ${slug}::text],
              jsonb_build_object('sequenceIndex', 1, 'lastResetDate', ${todayDateStr}::text)
            ),
            updated_at = NOW()
        WHERE key = 'crm_lead_distribution'
      `;
      currentIndex = 0;
    } else {
      // Reserva ATÓMICA del turno en UNA sola sentencia (gotcha #56b: con SELECT+UPDATE
      // separados, dos WhatsApp del mismo segundo consumen el mismo índice).
      const reserva = await sql`
        UPDATE public.settings
        SET value = jsonb_set(
              value,
              ARRAY['porMarca', ${slug}::text, 'sequenceIndex'],
              to_jsonb(COALESCE((value->'porMarca'->${slug}::text->>'sequenceIndex')::int, 0) + 1)
            ),
            updated_at = NOW()
        WHERE key = 'crm_lead_distribution'
        RETURNING COALESCE((value->'porMarca'->${slug}::text->>'sequenceIndex')::int, 1) - 1 AS indice
      `;
      currentIndex = reserva[0]?.indice ?? 0;
    }

    if (activeAdvisors.length === 0) {
      const fallbackAdmins = await sql`
        SELECT id FROM public.users WHERE role = 'admin' LIMIT 1
      `;
      const adminId = fallbackAdmins.length > 0 ? fallbackAdmins[0].id : null;
      return { candidato_actual: null, candidatos_nivel: [], actualTier: 1, vendedorId: adminId };
    }

    // MODO DE REPARTO. "equitativo" (default) ignora los niveles: dentro de la
    // marca gana la que menos leads recibió hoy. Los niveles quedan guardados por
    // si algún día se quiere premiar a la que más vende, pero con 2 asesoras por
    // marca el 60/25/15 solo hacía que una recibiera bastante menos que la otra.
    const modo = config.modo === "niveles" ? "niveles" : "equitativo";
    if (modo === "equitativo") {
      const elegida = [...activeAdvisors].sort(ordenarPorEquidad)[0];
      console.log(
        `⚖️ [Rotación ${empresa}] ${elegida.name} (${elegida.leads_recibidos_hoy ?? 0} hoy) de ${activeAdvisors.length} candidatas.`
      );
      return {
        candidato_actual: elegida.id,
        candidatos_nivel: [elegida.id],
        actualTier: elegida.orden_rotacion || 1,
      };
    }

    const pattern = config.sequencePattern || [1];
    const targetTier = pattern[currentIndex % pattern.length];

    const vendorsByTier: Record<number, AsesoraRotacion[]> = {};
    activeAdvisors.forEach((v) => {
      const tier = v.orden_rotacion || 1;
      if (!vendorsByTier[tier]) vendorsByTier[tier] = [];
      vendorsByTier[tier].push(v);
    });

    let actualTier = targetTier;
    if (!vendorsByTier[targetTier] || vendorsByTier[targetTier].length === 0) {
      const availableTiers = Object.keys(vendorsByTier)
        .map(Number)
        .sort((a, b) => a - b);
      
      if (availableTiers.length > 0) {
        const higherTiers = availableTiers.filter((t: number) => t > targetTier);
        actualTier = higherTiers.length > 0 ? higherTiers[0] : availableTiers[0];
      }
    }

    const candidates = vendorsByTier[actualTier] || [];
    if (candidates.length === 0) {
      const fallback = activeAdvisors[0];
      return { candidato_actual: fallback.id, candidatos_nivel: [fallback.id], actualTier };
    }

    candidates.sort(ordenarPorEquidad);

    const chosenAdvisor = candidates[0];
    return {
      candidato_actual: chosenAdvisor.id,
      candidatos_nivel: [chosenAdvisor.id],
      actualTier
    };
  } catch (error) {
    console.error("❌ Error en rotateAndSelectCandidate:", error);
    const fallback = await sql`
      SELECT id FROM public.users WHERE role = 'asesor' LIMIT 1
    `;
    const fallbackId = fallback.length > 0 ? fallback[0].id : null;
    return { candidato_actual: fallbackId, candidatos_nivel: fallbackId ? [fallbackId] : [], actualTier: 1 };
  }
}


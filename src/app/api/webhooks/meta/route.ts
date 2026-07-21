// src/app/api/webhooks/meta/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { neon } from "@neondatabase/serverless";
import { handleInboundMessage } from "@/lib/chatbot/bot-orchestrator";
import {
  type EmpresaWhatsApp,
  empresaDesdePhoneNumberId,
} from "@/lib/whatsapp/config";
import { descargarMediaComoDataUrl, estadoDesdeStatusMeta } from "@/lib/whatsapp/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // descarga de media + IA + envío pueden pasar los ~15s default

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // El token DEBE venir de la env var — nunca hardcodeado en el código.
  // Sin META_VERIFY_TOKEN el webhook queda deshabilitado (mismo patrón que CRON_SECRET).
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error("❌ [GET] META_VERIFY_TOKEN no configurada. Webhook Meta deshabilitado.");
    return new NextResponse("Service Unavailable", { status: 503 });
  }

  console.log("🔍 [GET] Webhook Meta Verification:");
  console.log("   Mode:", mode);

  if (mode && token) {
    if (mode === "subscribe" && token === verifyToken) {
      console.log("✅ [GET] WEBHOOK_VERIFIED");
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error("❌ [GET] Verification failed. Token mismatch.");
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return new NextResponse("Bad Request", { status: 400 });
}

/**
 * Secretos de app válidos para verificar la firma de los POST.
 *
 * Cada marca tiene su PROPIA app de Meta (una app pertenece a un solo Business
 * Portfolio y no puede operar WABAs de otro sin "Advanced access"), y Meta firma
 * cada evento con el secreto de la app que lo entrega. Por eso el webhook —que sí
 * es compartido— tiene que aceptar la firma de CUALQUIERA de las apps conocidas.
 * `META_VERIFY_TOKEN` en cambio sí es uno solo: lo elegimos nosotros.
 */
function appSecretsConfigurados(): string[] {
  return [process.env.META_APP_SECRET, process.env.META_APP_SECRET_AVI]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
}

/** True si la firma corresponde al body crudo con ALGUNO de los secretos conocidos. */
function firmaValida(rawBody: string, signature: string, secretos: string[]): boolean {
  const sigBuf = Buffer.from(signature);
  return secretos.some((secreto) => {
    const esperado = "sha256=" + createHmac("sha256", secreto).update(rawBody, "utf8").digest("hex");
    const espBuf = Buffer.from(esperado);
    return sigBuf.length === espBuf.length && timingSafeEqual(sigBuf, espBuf);
  });
}

/**
 * Resuelve la MARCA de un mensaje entrante a partir del phone_number_id.
 * - Si coincide con una marca configurada → esa marca.
 * - Si NINGUNA marca tiene phone id configurado (entorno de prueba/mock) → "Transavic"
 *   (para que el CRM y los tests funcionen sin credenciales reales).
 * - Si hay marcas configuradas pero el id no coincide con ninguna → null (tráfico ajeno, se ignora).
 */
function resolverEmpresa(phoneNumberId: string | undefined): EmpresaWhatsApp | null {
  const emp = empresaDesdePhoneNumberId(phoneNumberId);
  if (emp) return emp;
  const algunaConfigurada = !!(
    process.env.WHATSAPP_TRA_PHONE_NUMBER_ID || process.env.WHATSAPP_AVI_PHONE_NUMBER_ID
  );
  return algunaConfigurada ? null : "Transavic";
}

interface WaMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  audio?: { id?: string };
  document?: { id?: string; caption?: string; filename?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    ctwa_clid?: string;
  };
}

/** Extrae el tipo, el texto para la IA y el media id (si aplica) de un mensaje entrante. */
function extraerContenido(message: WaMessage): {
  tipo: string;
  textoParaBot: string;
  mediaId: string | null;
} {
  const tipo = message.type || "text";
  switch (tipo) {
    case "text":
      return { tipo, textoParaBot: message.text?.body || "", mediaId: null };
    case "image":
      return { tipo, textoParaBot: message.image?.caption || "", mediaId: message.image?.id || null };
    case "video":
      return { tipo, textoParaBot: message.video?.caption || "", mediaId: message.video?.id || null };
    case "document":
      return { tipo, textoParaBot: message.document?.caption || "", mediaId: message.document?.id || null };
    case "audio":
      return { tipo, textoParaBot: "", mediaId: message.audio?.id || null };
    case "button":
      return { tipo: "text", textoParaBot: message.button?.text || "", mediaId: null };
    case "interactive":
      return {
        tipo: "text",
        textoParaBot:
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          "",
        mediaId: null,
      };
    default:
      return { tipo, textoParaBot: "", mediaId: null };
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verificación de firma contra los secretos de TODAS las apps de Meta conocidas
    // (una por marca). Sin ninguna configurada los mensajes se aceptan SIN verificar
    // firma — solo aceptable en pruebas locales; configurarlas ANTES de conectar un
    // número real (ver checklist en docs/arquitectura/15-asistente-ia.md).
    const appSecrets = appSecretsConfigurados();
    if (appSecrets.length === 0) {
      console.warn("⚠️ [POST] Sin META_APP_SECRET*: webhook Meta SIN verificación de firma.");
    } else {
      const signature = request.headers.get("x-hub-signature-256") || "";
      if (!firmaValida(rawBody, signature, appSecrets)) {
        console.error(`❌ [POST] Firma Meta inválida (probada contra ${appSecrets.length} app secret(s)).`);
        return new NextResponse("Invalid signature", { status: 401 });
      }
    }

    const body = JSON.parse(rawBody);

    // Validar formato del webhook de WhatsApp Cloud API
    if (body.object === "whatsapp_business_account") {
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value || {};

          // Rutear a la MARCA según el número que recibió el mensaje.
          const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
          const empresa = resolverEmpresa(phoneNumberId);
          if (!empresa) {
            console.warn(`⚠️ [Meta Webhook] phone_number_id desconocido (${phoneNumberId}) — ignorado.`);
            continue;
          }

          // 1) Estados de entrega de nuestros mensajes salientes (sent/delivered/read/failed)
          const statuses = value.statuses || [];
          if (statuses.length > 0) {
            await procesarStatuses(statuses);
          }

          // 2) Mensajes entrantes
          const messages: WaMessage[] = value.messages || [];
          const contacts = value.contacts || [];

          for (const message of messages) {
            const from = message.from; // Teléfono del cliente
            if (!from) continue;

            const contact = contacts.find(
              (c: { wa_id?: string; profile?: { name?: string } }) => c.wa_id === from
            );
            const profileName = contact?.profile?.name || from;

            const { tipo, textoParaBot, mediaId } = extraerContenido(message);

            // Descargar la media entrante como dataURL (para guardarla/renderizarla).
            let mediaDataUrl: string | null = null;
            if (mediaId) {
              mediaDataUrl = await descargarMediaComoDataUrl(empresa, mediaId);
            }

            const referral = message.referral
              ? {
                  ctwa_clid: message.referral.ctwa_clid,
                  source_id: message.referral.source_id,
                  headline: message.referral.headline,
                }
              : null;

            console.log(
              `📥 [Meta Webhook] ${empresa} ← ${from} (${profileName}) [${tipo}]: "${textoParaBot || "(media)"}"`
            );

            // El orquestador crea/actualiza el lead, guarda el mensaje, corre el bot y
            // ENVÍA la respuesta por WhatsApp (si la marca está configurada).
            await handleInboundMessage(from, profileName, textoParaBot, empresa, {
              whatsappMessageId: message.id,
              tipo,
              mediaDataUrl,
              referral,
            });
          }
        }
      }
      return NextResponse.json({ success: true, status: "PROCESSED" });
    }

    return NextResponse.json({ success: true, status: "IGNORED" });
  } catch (error) {
    console.error("❌ [POST] Error en webhook Meta:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

interface WaStatus {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string }[];
}

/** Actualiza el estado de entrega de los mensajes salientes por su wamid. */
async function procesarStatuses(statuses: WaStatus[]): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  for (const st of statuses) {
    if (!st.id) continue;
    const nuevoEstado = estadoDesdeStatusMeta(st.status);
    if (!nuevoEstado) continue;
    const errMsg = st.errors?.[0]?.message || st.errors?.[0]?.title || null;
    // No degradar un 'leido' a un estado anterior (los statuses pueden llegar desordenados).
    await sql`
      UPDATE public.lead_mensajes
      SET estado = ${nuevoEstado},
          error_msg = ${errMsg}
      WHERE whatsapp_message_id = ${st.id}
        AND estado IS DISTINCT FROM 'leido'
    `;
  }
}

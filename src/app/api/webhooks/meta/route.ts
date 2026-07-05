// src/app/api/webhooks/meta/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleInboundMessage } from "@/lib/chatbot/bot-orchestrator";

export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verificación de firma. Sin META_APP_SECRET los mensajes se aceptan SIN verificar
    // firma — solo aceptable en pruebas locales; configurarla ANTES de conectar el
    // número real (ver checklist en docs/arquitectura/15-asistente-ia.md).
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      console.warn("⚠️ [POST] META_APP_SECRET no configurada: webhook Meta SIN verificación de firma.");
    }
    if (appSecret) {
      const signature = request.headers.get("x-hub-signature-256") || "";
      const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        console.error("❌ [POST] Firma Meta inválida.");
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
          const messages = value.messages || [];
          const contacts = value.contacts || [];

          for (const message of messages) {
            // Extraer datos del mensaje
            const from = message.from; // Teléfono
            const textBody = message.text?.body || "";
            
            // Buscar nombre de perfil de contacto si existe
            const contact = contacts.find(
              (c: { wa_id?: string; profile?: { name?: string } }) => c.wa_id === from
            );
            const profileName = contact?.profile?.name || from;

            if (from && textBody) {
              console.log(`📥 [Meta Webhook] Mensaje recibido de ${from} (${profileName}): "${textBody}"`);
              
              // Ejecutar lógica del orquestador del chatbot
              const reply = await handleInboundMessage(from, profileName, textBody);
              
              if (reply) {
                console.log(`📤 [Meta Webhook] Respuesta enviada automáticamente: "${reply}"`);
                // Aquí se realizaría la llamada HTTP de envío físico de WhatsApp a la API de Meta si
                // estuviera la llave configurada:
                // await sendWhatsAppTextMessage(from, reply);
              }
            }
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

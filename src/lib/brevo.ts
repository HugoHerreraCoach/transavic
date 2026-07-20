// src/lib/brevo.ts
// ════════════════════════════════════════════════════════════════════════════
// Cliente de correo transaccional Brevo (API v3).
// Docs: https://developers.brevo.com/reference/sendtransacemail
//
// Más simple y confiable que SMTP en Vercel (no abre conexiones SMTP). El token
// vive solo en el server (env BREVO_API_KEY). El remitente debe estar verificado
// en Brevo (BREVO_SENDER_EMAIL). Plan free: 300 correos/día POR CUENTA — las dos
// marcas comparten ese cupo (una sola cuenta Brevo admite ambos dominios).
//
// REMITENTE POR MARCA: mismo patrón per-empresa que SUNAT (SUNAT_TRA_*/SUNAT_AVI_*).
//   BREVO_TRA_SENDER_EMAIL / BREVO_TRA_SENDER_NAME  → Transavic        (@transavic.com)
//   BREVO_AVI_SENDER_EMAIL / BREVO_AVI_SENDER_NAME  → Avícola de Tony  (@laavicoladetony.com)
// Si no está la variante por marca, cae a BREVO_SENDER_* (comportamiento anterior).
// ════════════════════════════════════════════════════════════════════════════

import type { EmpresaId } from "./sunat/types";

/** Prefijos de env vars del remitente por empresa (espejo de ENV_PREFIX_MAP de SUNAT). */
const SENDER_ENV_PREFIX: Record<EmpresaId, string> = {
  transavic: "BREVO_TRA",
  avicola: "BREVO_AVI",
};

/**
 * Resuelve el remitente (email + nombre) de una marca, con fallback al remitente
 * único de siempre. Fuente ÚNICA — la usan tanto Brevo como la rama SMTP.
 */
export function resolverRemitente(empresa?: EmpresaId): { email: string; name: string } {
  const prefix = empresa ? SENDER_ENV_PREFIX[empresa] : undefined;
  const email =
    (prefix ? process.env[`${prefix}_SENDER_EMAIL`] : undefined) ||
    process.env.BREVO_SENDER_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    "transavicdev@gmail.com";
  const name =
    (prefix ? process.env[`${prefix}_SENDER_NAME`] : undefined) ||
    process.env.BREVO_SENDER_NAME ||
    process.env.SMTP_FROM_NAME ||
    "Transavic";
  return { email, name };
}

export interface BrevoAttachment {
  /** Contenido en base64 (sin el prefijo data:) */
  content: string;
  /** Nombre con extensión, ej. F001-00000001.pdf */
  name: string;
}

export interface BrevoSendOptions {
  to: { email: string; name?: string }[];
  cc?: { email: string }[];
  bcc?: { email: string }[];
  subject: string;
  htmlContent: string;
  attachments?: BrevoAttachment[];
  replyTo?: { email: string; name?: string };
  /** Marca emisora — define el remitente. Sin esto, usa el remitente único de siempre. */
  empresa?: EmpresaId;
}

export interface BrevoResult {
  messageId?: string;
  error?: string;
}

export function isBrevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

/** Envía un correo transaccional vía Brevo API v3. Nunca lanza: devuelve {error}. */
export async function sendBrevoEmail(options: BrevoSendOptions): Promise<BrevoResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const { email: senderEmail, name: senderName } = resolverRemitente(options.empresa);

  if (!apiKey) return { error: "BREVO_API_KEY no configurado" };

  const body = {
    sender: { email: senderEmail, name: senderName },
    to: options.to,
    ...(options.cc?.length ? { cc: options.cc } : {}),
    ...(options.bcc?.length ? { bcc: options.bcc } : {}),
    subject: options.subject,
    htmlContent: options.htmlContent,
    ...(options.attachments?.length ? { attachment: options.attachments } : {}),
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<string, string>;
      const errorMsg = errorData.message || `HTTP ${response.status}`;
      console.error("[Brevo] Error enviando correo:", errorMsg, errorData);
      return { error: errorMsg };
    }

    const data = (await response.json()) as { messageId?: string };
    console.log("[Brevo] Correo enviado:", data.messageId);
    return { messageId: data.messageId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

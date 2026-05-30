// src/lib/brevo.ts
// ════════════════════════════════════════════════════════════════════════════
// Cliente de correo transaccional Brevo (API v3).
// Docs: https://developers.brevo.com/reference/sendtransacemail
//
// Más simple y confiable que SMTP en Vercel (no abre conexiones SMTP). El token
// vive solo en el server (env BREVO_API_KEY). El remitente debe estar verificado
// en Brevo (BREVO_SENDER_EMAIL). Plan free: 300 correos/día.
// ════════════════════════════════════════════════════════════════════════════

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
  const senderEmail =
    process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM_EMAIL || "transavicdev@gmail.com";
  const senderName =
    process.env.BREVO_SENDER_NAME || process.env.SMTP_FROM_NAME || "Transavic";

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

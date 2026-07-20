// src/lib/email.ts
// Helper para enviar emails via SMTP (Gmail con app password, SendGrid, Mailgun, etc.).
//
// Configuración por env vars:
//   SMTP_HOST       (ej: smtp.gmail.com)
//   SMTP_PORT       (587 STARTTLS, 465 SSL, 25 plano)
//   SMTP_SECURE     (true para 465, false para 587)
//   SMTP_USER       (usuario / email completo en Gmail)
//   SMTP_PASS       (app password de Gmail, NO el password normal)
//   SMTP_FROM_NAME  (default "Transavic")
//   SMTP_FROM_EMAIL (default igual a SMTP_USER)
//
// Para Gmail:
// 1. Activar 2FA en la cuenta
// 2. Generar "Contraseña de aplicación" en https://myaccount.google.com/apppasswords
// 3. Usar esa contraseña en SMTP_PASS

import nodemailer from "nodemailer";
import { sendBrevoEmail, isBrevoConfigured, resolverRemitente } from "./brevo";
import type { EmpresaId } from "./sunat/types";

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  /** Si el content es base64 string, marcar como "base64" */
  encoding?: "base64";
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  cc?: string | string[];
  bcc?: string | string[];
  /** Reply-To (default: el FROM) */
  replyTo?: string;
  /**
   * Marca emisora. Define el remitente por marca (BREVO_TRA_* / BREVO_AVI_*).
   * Sin esto se usa el remitente único de siempre (BREVO_SENDER_* / SMTP_FROM_*).
   */
  empresa?: EmpresaId;
}

export interface EmailResult {
  exito: boolean;
  messageId?: string;
  preview?: string;
  error?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null; // SMTP no configurado

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
  return transporter;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

/** Convierte SendEmailOptions → formato Brevo y envía vía su API. */
async function sendViaBrevo(opts: SendEmailOptions): Promise<EmailResult> {
  const toList = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .filter(Boolean)
    .map((email) => ({ email }));
  const ccList = opts.cc
    ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]).filter(Boolean).map((email) => ({ email }))
    : undefined;
  const bccList = opts.bcc
    ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]).filter(Boolean).map((email) => ({ email }))
    : undefined;

  // Brevo exige htmlContent: si solo hay texto, lo envolvemos preservando saltos.
  const htmlContent =
    opts.html ||
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#171717;white-space:pre-wrap">${escapeHtml(
      opts.text || ""
    )}</div>`;

  const attachments = opts.attachments?.map((a) => ({
    name: a.filename,
    content:
      typeof a.content === "string"
        ? a.encoding === "base64"
          ? a.content
          : Buffer.from(a.content).toString("base64")
        : a.content.toString("base64"),
  }));

  const result = await sendBrevoEmail({
    to: toList,
    cc: ccList,
    bcc: bccList,
    subject: opts.subject,
    htmlContent,
    attachments,
    replyTo: opts.replyTo ? { email: opts.replyTo } : undefined,
    empresa: opts.empresa,
  });

  if (result.error) return { exito: false, error: result.error };
  return { exito: true, messageId: result.messageId };
}

export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  // Preferir Brevo API si está configurado (más simple/confiable en Vercel).
  if (isBrevoConfigured()) {
    return sendViaBrevo(opts);
  }

  const t = getTransporter();
  if (!t) {
    return {
      exito: false,
      error:
        "Email no configurado. Definí BREVO_API_KEY (recomendado) o SMTP_HOST/SMTP_USER/SMTP_PASS en .env.local.",
    };
  }

  // Mismo criterio de remitente por marca que Brevo (fuente única en brevo.ts).
  const remitente = resolverRemitente(opts.empresa);
  const fromName = remitente.name;
  const fromEmail = remitente.email || process.env.SMTP_USER;

  try {
    const info = await t.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        encoding: a.encoding,
      })),
    });

    return {
      exito: true,
      messageId: info.messageId,
    };
  } catch (err) {
    return {
      exito: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * ¿Está SMTP configurado? Útil para la UI (deshabilitar botón si no hay config).
 */
export function isEmailConfigured(): boolean {
  return (
    isBrevoConfigured() ||
    !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

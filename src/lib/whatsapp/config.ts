// src/lib/whatsapp/config.ts
//
// Credenciales de la WhatsApp Cloud API (Meta) POR MARCA/empresa.
// Convención de env por empresa, igual que SUNAT_TRA_* / SUNAT_AVI_*:
//   WHATSAPP_TRA_*  -> Transavic         (RUC 20, portfolio "TONIO DAT")
//   WHATSAPP_AVI_*  -> Avícola de Tony   (RUC 10, portfolio "Tonio LADT")
//
// El webhook es COMPARTIDO por ambas marcas (META_VERIFY_TOKEN + META_APP_SECRET);
// los mensajes entrantes se ruteán a la marca correcta por metadata.phone_number_id.
//
// Sin credenciales de una marca, esa marca queda en "modo mock" (no envía a Meta,
// solo registra en el CRM) — no rompe nada, igual que antes de conectar el número.

export type EmpresaWhatsApp = "Transavic" | "Avícola de Tony";

export interface WhatsAppConfig {
  empresa: EmpresaWhatsApp;
  /** Phone Number ID del número (de la API Setup de Meta), NO el número legible. */
  phoneNumberId: string;
  /** System User Access Token permanente del portfolio de esa marca. */
  token: string;
  wabaId?: string;
}

export const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
export const WHATSAPP_GRAPH_BASE = "https://graph.facebook.com";

/** Prefijo de env por empresa. */
function prefijo(empresa: EmpresaWhatsApp): "TRA" | "AVI" {
  return empresa === "Transavic" ? "TRA" : "AVI";
}

/** Devuelve la config de una marca, o null si no está configurada (modo mock). */
export function getWhatsAppConfig(empresa: EmpresaWhatsApp): WhatsAppConfig | null {
  const p = prefijo(empresa);
  const phoneNumberId = process.env[`WHATSAPP_${p}_PHONE_NUMBER_ID`];
  const token = process.env[`WHATSAPP_${p}_TOKEN`];
  if (!phoneNumberId || !token) return null;
  return {
    empresa,
    phoneNumberId,
    token,
    wabaId: process.env[`WHATSAPP_${p}_WABA_ID`] || undefined,
  };
}

export function isWhatsAppConfigured(empresa: EmpresaWhatsApp): boolean {
  return getWhatsAppConfig(empresa) !== null;
}

/**
 * Mapea el phone_number_id ENTRANTE (value.metadata.phone_number_id del webhook)
 * a la marca correspondiente. Devuelve null si no coincide con ninguna marca
 * conocida (tráfico ajeno o número no configurado) — el webhook lo ignora.
 */
export function empresaDesdePhoneNumberId(phoneNumberId: string | undefined | null): EmpresaWhatsApp | null {
  if (!phoneNumberId) return null;
  const tra = process.env.WHATSAPP_TRA_PHONE_NUMBER_ID;
  const avi = process.env.WHATSAPP_AVI_PHONE_NUMBER_ID;
  if (tra && phoneNumberId === tra) return "Transavic";
  if (avi && phoneNumberId === avi) return "Avícola de Tony";
  return null;
}

/** Normaliza un valor de `empresa` de la DB a una EmpresaWhatsApp válida. */
export function normalizarEmpresa(empresa: string | null | undefined): EmpresaWhatsApp {
  return empresa === "Avícola de Tony" ? "Avícola de Tony" : "Transavic";
}

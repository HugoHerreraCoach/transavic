// src/lib/whatsapp/sender.ts
//
// Envío/recepción de mensajes a la WhatsApp Cloud API (Meta), por marca.
// Nunca lanza: devuelve un resultado y loguea — el flujo del CRM jamás debe
// romperse por una falla de Meta (mismo criterio que lib/email.ts).

import {
  EmpresaWhatsApp,
  getWhatsAppConfig,
  WHATSAPP_API_VERSION,
  WHATSAPP_GRAPH_BASE,
} from "./config";

export type TipoMediaWhatsApp = "image" | "audio" | "video" | "document";

export interface EnvioResult {
  ok: boolean;
  whatsappMessageId?: string;
  error?: string;
  /** true si Meta rechazó por estar FUERA de la ventana de 24h (error 131047/131051/131026). */
  fueraDeVentana?: boolean;
  /** true si la marca no tiene credenciales (modo mock: se guarda en CRM, no se manda a Meta). */
  noConfigurado?: boolean;
}

// Códigos de error de Meta que significan "no se puede entregar fuera de la ventana
// de 24h / hace falta plantilla": 131047 (re-engagement), 131051 (unsupported), 131026 (undeliverable).
const CODIGOS_FUERA_DE_VENTANA = new Set([131047, 131051, 131026]);

/** Normaliza a solo dígitos (formato que espera la Graph API en `to`). */
function normalizarNumero(to: string): string {
  return (to || "").replace(/\D/g, "");
}

/** Separa el base64 crudo de un posible prefijo dataURL "data:mime;base64,". */
function separarDataUrl(base64: string): { raw: string; mime: string | null } {
  if (base64.startsWith("data:")) {
    const coma = base64.indexOf(",");
    const meta = base64.slice(5, coma); // "image/png;base64"
    const mime = meta.split(";")[0] || null;
    return { raw: coma >= 0 ? base64.slice(coma + 1) : base64, mime };
  }
  return { raw: base64, mime: null };
}

async function postMessage(
  empresa: EmpresaWhatsApp,
  payload: Record<string, unknown>
): Promise<EnvioResult> {
  const cfg = getWhatsAppConfig(empresa);
  if (!cfg) {
    console.warn(`⚠️ [WhatsApp] Marca "${empresa}" sin credenciales — envío omitido (mock).`);
    return { ok: false, noConfigurado: true, error: "WhatsApp no configurado para esta marca" };
  }
  const url = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${cfg.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const err = (data as { error?: { code?: number; message?: string } }).error;
      const code = err?.code;
      const msg = err?.message || `HTTP ${res.status}`;
      const fueraDeVentana = typeof code === "number" && CODIGOS_FUERA_DE_VENTANA.has(code);
      console.error(`❌ [WhatsApp] Error al enviar (${empresa}): ${code ?? "?"} ${msg}`);
      return { ok: false, error: msg, fueraDeVentana };
    }
    const id = (data as { messages?: { id?: string }[] }).messages?.[0]?.id;
    return { ok: true, whatsappMessageId: id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ [WhatsApp] Excepción al enviar (${empresa}): ${msg}`);
    return { ok: false, error: msg };
  }
}

/** Envía un mensaje de texto libre (solo válido dentro de la ventana de 24h). */
export async function enviarTexto(
  empresa: EmpresaWhatsApp,
  to: string,
  texto: string
): Promise<EnvioResult> {
  return postMessage(empresa, {
    to: normalizarNumero(to),
    type: "text",
    text: { preview_url: true, body: (texto || "").slice(0, 4096) },
  });
}

/**
 * Sube media (base64 o dataURL) al endpoint /media y devuelve el media id de Meta.
 * Se envía por id (no por link) para no exponer URLs.
 */
export async function subirMedia(
  empresa: EmpresaWhatsApp,
  base64: string,
  mimeExplicito?: string
): Promise<{ ok: boolean; mediaId?: string; error?: string; noConfigurado?: boolean }> {
  const cfg = getWhatsAppConfig(empresa);
  if (!cfg) return { ok: false, noConfigurado: true, error: "WhatsApp no configurado para esta marca" };

  const { raw, mime: mimeDetectado } = separarDataUrl(base64);
  const mime = mimeExplicito || mimeDetectado || "application/octet-stream";
  const buffer = Buffer.from(raw, "base64");

  const url = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${cfg.phoneNumberId}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buffer], { type: mime }), "archivo");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, mediaId: (data as { id?: string }).id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Envía media (imagen/audio/video/documento) subiéndola primero. */
export async function enviarMedia(
  empresa: EmpresaWhatsApp,
  to: string,
  base64: string,
  tipo: TipoMediaWhatsApp,
  caption?: string
): Promise<EnvioResult> {
  const up = await subirMedia(empresa, base64);
  if (!up.ok || !up.mediaId) {
    return { ok: false, error: up.error || "No se pudo subir la media", noConfigurado: up.noConfigurado };
  }
  const mediaObj: Record<string, unknown> = { id: up.mediaId };
  if (caption && (tipo === "image" || tipo === "video" || tipo === "document")) {
    mediaObj.caption = caption;
  }
  return postMessage(empresa, { to: normalizarNumero(to), type: tipo, [tipo]: mediaObj });
}

export interface PlantillaEnvio {
  name: string;
  language: string;
  /** Variables del BODY en orden ({{1}}, {{2}}, ...). */
  variables?: string[];
}

/**
 * Envía una plantilla (template) aprobada. Es la ÚNICA forma de escribir FUERA de
 * la ventana de 24h. Requiere que la marca esté verificada en Meta (desde ene-2026).
 */
export async function enviarPlantilla(
  empresa: EmpresaWhatsApp,
  to: string,
  plantilla: PlantillaEnvio
): Promise<EnvioResult> {
  const components =
    plantilla.variables && plantilla.variables.length > 0
      ? [
          {
            type: "body",
            parameters: plantilla.variables.map((v) => ({ type: "text", text: String(v ?? "") })),
          },
        ]
      : undefined;
  return postMessage(empresa, {
    to: normalizarNumero(to),
    type: "template",
    template: {
      name: plantilla.name,
      language: { code: plantilla.language || "es" },
      ...(components ? { components } : {}),
    },
  });
}

/**
 * Descarga una media ENTRANTE (por su media id) y la devuelve como dataURL para
 * guardarla/renderizarla igual que la media saliente. Devuelve null si falla o si
 * pesa más de `maxBytes` (para no inflar la DB con archivos grandes).
 */
export async function descargarMediaComoDataUrl(
  empresa: EmpresaWhatsApp,
  mediaId: string,
  maxBytes = 3_000_000
): Promise<string | null> {
  const cfg = getWhatsAppConfig(empresa);
  if (!cfg || !mediaId) return null;
  try {
    // 1) media id -> URL temporal + mime
    const metaRes = await fetch(`${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) return null;
    if (meta.file_size && meta.file_size > maxBytes) return null;

    // 2) descargar el binario (requiere el mismo Bearer)
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!binRes.ok) return null;
    const buf = Buffer.from(await binRes.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    const mime = meta.mime_type || "application/octet-stream";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (err) {
    console.error("❌ [WhatsApp] Error descargando media entrante:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Traduce el status de un webhook `statuses[]` de Meta a nuestro enum interno. */
export function estadoDesdeStatusMeta(status: string | undefined): string | null {
  switch (status) {
    case "sent":
      return "enviado";
    case "delivered":
      return "entregado";
    case "read":
      return "leido";
    case "failed":
      return "fallido";
    default:
      return null;
  }
}

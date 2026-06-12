// src/lib/sunat/mensajes-amigables.ts
// Traducción de mensajes técnicos de SUNAT a texto amigable para la UI.
//
// Contexto (11 jun 2026): la F001-78 quedó "rechazada" con el faultstring crudo
// "El sistema no puede responder su solicitud. (El servicio de autenticaci&#243;n
// no est&#225; disponible)" — entidades XML sin decodificar y un mensaje que en
// realidad significa "SUNAT está caído", no un rechazo de datos. Este módulo
// centraliza: (a) la decodificación de entidades y (b) el mapeo a mensajes
// claros que la asesora pueda entender, manteniendo el técnico para soporte.

/**
 * Decodifica entidades XML/HTML básicas y numéricas (`&#243;` → `ó`).
 * SUNAT devuelve los faultstring con los acentos escapados.
 */
export function decodeEntidadesXml(texto: string): string {
  if (!texto.includes("&")) return texto;
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** ¿El mensaje indica que SUNAT estaba caído / fuera de servicio (transitorio)? */
export function esMensajeSunatCaido(mensaje: string): boolean {
  const m = decodeEntidadesXml(mensaje).toLowerCase();
  return (
    m.includes("no puede responder su solicitud") ||
    m.includes("servicio de autenticaci") ||
    m.includes("rejected by policy") ||
    m.includes("service unavailable") ||
    m.includes("no está disponible") ||
    m.includes("no esta disponible") ||
    m.includes("no está respondiendo") ||
    m.includes("no esta respondiendo") ||
    m.includes("no se recibió respuesta") ||
    m.includes("no se recibio respuesta")
  );
}

/** ¿El mensaje es un rechazo por formato/esquema del XML (error del sistema emisor)? */
export function esMensajeErrorEsquema(mensaje: string): boolean {
  const m = decodeEntidadesXml(mensaje);
  return /ValidarEsquema|SAXException|cvc-/i.test(m);
}

export interface MensajeSunat {
  /** Texto corto y claro para mostrar a la asesora/admin. */
  amigable: string;
  /** Mensaje técnico original (decodificado) — para tooltip/soporte. */
  tecnico: string;
}

/**
 * Traduce un `mensaje_sunat` guardado en DB a su versión amigable.
 * Si no matchea ningún patrón conocido, devuelve el mensaje decodificado tal cual.
 */
export function mensajeSunatAmigable(mensaje: string): MensajeSunat {
  const tecnico = decodeEntidadesXml(mensaje).trim();

  if (esMensajeSunatCaido(tecnico)) {
    return {
      amigable:
        "SUNAT estuvo fuera de servicio en ese momento; el documento NO llegó a registrarse. Verifica si ya se emitió un reemplazo antes de reintentar.",
      tecnico,
    };
  }

  if (esMensajeErrorEsquema(tecnico)) {
    return {
      amigable:
        "SUNAT rechazó el archivo por un error de formato del sistema (ya corregido). El documento NO quedó registrado en SUNAT.",
      tecnico,
    };
  }

  return { amigable: tecnico, tecnico };
}

/**
 * Mensaje por defecto cuando un comprobante quedó con problema pero SIN
 * `mensaje_sunat` (filas históricas anteriores al fix que persiste el error
 * de conexión — caso F002-83, 12 jun 2026). La asesora necesita saber dos
 * cosas: si el documento vale y qué hacer.
 */
export function mensajeEstadoSinDetalle(estado: string): string | null {
  if (estado === "error") {
    // Corto a propósito: en móvil (360px) la card corta a ~3 líneas y la
    // garantía "no se duplica" debe entrar SÍ o SÍ.
    return 'Falló la conexión con SUNAT. NO quedó registrado — usa ⋯ → "Reintentar envío" (mismo número, no se duplica).';
  }
  if (estado === "rechazado") {
    return "SUNAT lo rechazó; NO quedó registrado. Si fue una caída de SUNAT, reintenta el envío; si es por datos, consulta al administrador.";
  }
  return null;
}

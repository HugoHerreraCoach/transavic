// src/lib/sunat/fechas.ts
// Fecha y hora actuales en zona LIMA para los documentos SUNAT.
//
// 🔴 NUNCA usar `new Date().toISOString()` para la fecha de emisión: Vercel corre
// en UTC, así que desde las ~19:00 hora Lima la fecha UTC ya es "mañana" y SUNAT
// (que vive en hora Perú) responde RECHAZADA 2329 "La fecha de emisión se
// encuentra fuera del límite permitido". Pasó con el reintento de la guía
// T002-00000010 (10 jun 2026, 22:40 Lima). Las facturas/boletas ya usaban
// su propio helper Lima en lib/sunat/index.ts; este es el equivalente para
// las guías (y cualquier flujo nuevo).

/** Hoy en Lima, formato YYYY-MM-DD. */
export function fechaHoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Hora actual en Lima, formato HH:mm:ss (24h). */
export function horaActualLima(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

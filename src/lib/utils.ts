// Archivo: src/lib/utils.ts

// ════════════════════════════════════════════════════════════
// 📅 UTILIDADES DE FECHA — TIMEZONE-SAFE
// ════════════════════════════════════════════════════════════
// NUNCA usar new Date().toISOString().split('T')[0] para obtener
// la fecha local. toISOString() devuelve UTC, y después de las
// 7 PM en Perú (UTC-5), muestra el día siguiente.
// Usar SIEMPRE estas funciones en su lugar.
// ════════════════════════════════════════════════════════════

/**
 * Convierte una Date a string YYYY-MM-DD en timezone local.
 * Reemplazo seguro de: date.toISOString().split('T')[0]
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Obtiene la fecha de hoy (o con offset de días) como YYYY-MM-DD en timezone local.
 * Ejemplos: getLocalDateString(0) = hoy, getLocalDateString(-1) = ayer, getLocalDateString(1) = mañana
 */
export function getLocalDateString(offset: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toLocalDateString(d);
}

export function formatFechaForTicket(dateInput: string | Date | null | undefined): string {
  if (!dateInput) {
    return 'Fecha no especificada';
  }

  let fechaObj: Date;
  const dateString = String(dateInput);

  // 1. Manejar el único formato ambiguo que encontramos ('DD/MM/YYYY') manualmente.
  if (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(dateString)) {
    const [day, month, year] = dateString.split('/').map(Number);
    // El mes en el constructor es 0-indexado, por eso restamos 1
    fechaObj = new Date(Date.UTC(year, month - 1, day));
  } else {
    // 2. Para TODOS los demás formatos ('YYYY-MM-DD', 'jul 27, 2025', y objetos Date),
    //    confiamos en el potente conversor nativo de JavaScript.
    fechaObj = new Date(dateInput);
  }

  // 3. Verificación final y crucial de validez.
  if (isNaN(fechaObj.getTime())) {
    console.error("Error de Parseo: Formato de fecha no reconocido. Valor:", dateInput);
    return 'Pedido para: Fecha Inválida';
  }

  // 4. Formatear la fecha para mostrarla, usando siempre UTC para consistencia.
  const fechaFormateada = fechaObj.toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return `Pedido para: ${fechaFormateada}`;
}
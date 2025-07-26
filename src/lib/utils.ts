// Archivo: src/lib/utils.ts

/**
 * Formatea una fecha para el ticket, aceptando múltiples formatos de
 * entrada (incluyendo el de iOS 'MMM DD, YYYY').
 */
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
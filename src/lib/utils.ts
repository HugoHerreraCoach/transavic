// src/lib/utils.ts

/**
 * Formatea una fecha para el ticket, aceptando múltiples formatos
 * de entrada ('DD/MM/YYYY', 'YYYY-MM-DD', u objeto Date).
 * Devuelve una cadena como "Pedido para: 27 de julio de 2025".
 */
export function formatFechaForTicket(dateInput: string | Date | null | undefined): string {
  if (!dateInput) {
    return 'Fecha no especificada';
  }

  let year: number, month: number, day: number;

  // Normalizamos la entrada a un string para trabajar con ella
  const dateString = String(dateInput).split('T')[0];

  // 1. Verificamos si el formato es DD/MM/YYYY
  if (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(dateString)) {
    const parts = dateString.split('/');
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }
  // 2. Si no, verificamos si el formato es YYYY-MM-DD
  else if (/^(\d{4})-(\d{1,2})-(\d{1,2})$/.test(dateString)) {
    const parts = dateString.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  }
  // 3. Si no es un formato de string conocido, lo tratamos como objeto Date
  else {
    const tempDate = new Date(dateInput);
    if (isNaN(tempDate.getTime())) {
      console.error("Error Final: Formato de fecha irreconocible. Valor:", dateInput);
      return 'Pedido para: Formato Desconocido';
    }
    // Si es un objeto Date válido, extraemos sus partes en UTC
    year = tempDate.getUTCFullYear();
    month = tempDate.getUTCMonth() + 1; // getUTCMonth() es 0-11
    day = tempDate.getUTCDate();
  }

  // Verificamos que los números extraídos sean válidos
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    console.error("Error de Parseo: No se pudieron extraer los números. Valor:", dateInput);
    return 'Pedido para: Fecha Inválida';
  }

  // Creamos el objeto Date final en UTC para evitar problemas de zona horaria
  // El mes en el constructor es 0-indexado, por eso restamos 1
  const fechaObj = new Date(Date.UTC(year, month - 1, day));

  // Formateamos la fecha para mostrarla
  const fechaFormateada = fechaObj.toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return `Pedido para: ${fechaFormateada}`;
}
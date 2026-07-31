// src/lib/ventana-operativa.ts
// Ventanas horarias (hora Lima) que se evalúan SIN tocar la base de datos. Módulo
// PURO: lo usan el cliente (mi-ruta) y el servidor (crons, beacon), así cada regla
// tiene una sola fuente.
//
// Hay DOS ventanas, INDEPENDIENTES entre sí (no las unifiques: responden a motivos
// distintos y mover una no debe mover la otra):
//
// 1. GPS del repartidor — franja en la que el motorizado DEBE transmitir su
//    ubicación. Fuera de ella NO se rastrea (privacidad: no seguir a nadie en su
//    casa si quedó un pedido sin cerrar) y el cron de "repartidor oscuro" no alerta.
//    Env NEXT_PUBLIC_GPS_VENTANA_INICIO / _FIN. Default 04:30–22:00.
//
// 2. Emisión de comprobantes — franja en la que tiene sentido correr el cron de
//    reconciliación CPE. Su razón es de COSTO: cada corrida despierta el cómputo de
//    Neon, y corriendo cada 5 min las 24 h la base NUNCA llegaba a auto-suspenderse
//    (~85% de la factura era estar prendida sin trabajo — jul 2026). Medido sobre 60
//    días de producción, el 99.7% de los comprobantes se emite entre las 07:00 y las
//    21:00, así que 05:00–23:00 va con margen de sobra. Lo que caiga fuera NO se
//    pierde: lo levanta la corrida de las 05:00 o el saneo lazy de
//    GET /api/comprobantes en cuanto alguien abre la pantalla.
//    Env SUNAT_VENTANA_INICIO / _FIN (server-only, sin NEXT_PUBLIC).

export const GPS_VENTANA_INICIO = process.env.NEXT_PUBLIC_GPS_VENTANA_INICIO || "04:30";
export const GPS_VENTANA_FIN = process.env.NEXT_PUBLIC_GPS_VENTANA_FIN || "22:00";

export const SUNAT_VENTANA_INICIO = process.env.SUNAT_VENTANA_INICIO || "05:00";
export const SUNAT_VENTANA_FIN = process.env.SUNAT_VENTANA_FIN || "23:00";

/** Hora actual en Lima como "HH:mm" (24h). */
export function horaLimaHHmm(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/**
 * Comparación lexicográfica de "HH:mm" (= cronológica). En el límite superior usa
 * `< fin` para que la hora de cierre en punto ya cuente como fuera de la ventana.
 */
function dentroDe(inicio: string, fin: string, ahora: string): boolean {
  return ahora >= inicio && ahora < fin;
}

/** ¿Estamos dentro del horario operativo de reparto (hora Lima)? */
export function dentroDeVentanaOperativa(ahora: string = horaLimaHHmm()): boolean {
  return dentroDe(GPS_VENTANA_INICIO, GPS_VENTANA_FIN, ahora);
}

/** ¿Estamos dentro del horario en que se emiten comprobantes (hora Lima)? */
export function dentroDeVentanaEmision(ahora: string = horaLimaHHmm()): boolean {
  return dentroDe(SUNAT_VENTANA_INICIO, SUNAT_VENTANA_FIN, ahora);
}

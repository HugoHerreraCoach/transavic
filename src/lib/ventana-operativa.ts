// src/lib/ventana-operativa.ts
// Ventana horaria (hora Lima) en la que el repartidor DEBE estar transmitiendo su
// ubicación. Fuera de ella NO se rastrea (privacidad: no seguir a nadie en su casa
// si quedó un pedido sin cerrar) y el cron de detección de "repartidor oscuro" NO
// alerta. Módulo PURO (sin DB): lo usan tanto el cliente (mi-ruta) como el servidor
// (cron / beacon), así la regla es una sola fuente.
//
// Configurable por env (con prefijo NEXT_PUBLIC para que el cliente también la lea):
//   NEXT_PUBLIC_GPS_VENTANA_INICIO / NEXT_PUBLIC_GPS_VENTANA_FIN  (formato "HH:mm").
// Default 04:30–22:00 (la distribuidora arranca muy temprano).

export const GPS_VENTANA_INICIO = process.env.NEXT_PUBLIC_GPS_VENTANA_INICIO || "04:30";
export const GPS_VENTANA_FIN = process.env.NEXT_PUBLIC_GPS_VENTANA_FIN || "22:00";

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
 * ¿Estamos dentro del horario operativo de reparto (hora Lima)?
 * Comparación lexicográfica de "HH:mm" (= cronológica). En el límite superior usa
 * `< FIN` para que a las 22:00 en punto ya se considere fuera de jornada.
 */
export function dentroDeVentanaOperativa(ahora: string = horaLimaHHmm()): boolean {
  return ahora >= GPS_VENTANA_INICIO && ahora < GPS_VENTANA_FIN;
}

// src/lib/eta-reparto.ts
// Modelo del ETA del reparto y decisión de las alertas de arribo
// ("Pedido por llegar" / "Pedido en destino") que recibe la asesora.
//
// Por qué existe: el modelo viejo (3 min/km EN LÍNEA RECTA, mensaje "5 minutos"
// hardcodeado que disparaba con 0-5 min restantes) producía avisos increíbles:
// "a unos 5 minutos" y 1 minuto después "ha llegado" (reporte de operación,
// 11 ago 2026). Acá vive la versión honesta: calibración por-viaje con el
// Google Directions que YA se paga al iniciar viaje, mensaje con los minutos
// reales, y exclusión mutua entre las dos alertas.
//
// PURO a propósito (no importa `neon`): corre en vitest (gotcha #13).
// Consumidores: /api/repartidor/ubicacion (por ping GPS) y
// /api/pedidos/[id]/iniciar-viaje (calibración + supresión de viaje corto).

/** A menos de 150 m en línea recta, el motorizado "ya está" en el destino. */
export const UMBRAL_LLEGADA_KM = 0.15;

/** La alerta "por llegar" dispara cuando el ETA cae dentro de [MIN, UMBRAL] min. */
export const UMBRAL_POR_LLEGAR_MIN = 5;
/** Con menos de 2 min restantes la alerta "por llegar" se SUPRIME: avisarla y que
 *  30-60 s después llegue "en destino" es exactamente el ruido que se reportó. */
export const MIN_POR_LLEGAR_MIN = 2;

/** Un viaje que entero dura ≤ 6 min no recibe "por llegar": la notificación
 *  "Pedido en camino" (que sale al iniciar el viaje) ya ES el aviso de inminencia. */
export const VIAJE_CORTO_MIN = 6;

/** Velocidad efectiva de moto en Lima SOBRE RUTA (no línea recta), fallback
 *  cuando el viaje no tiene calibración de Google Directions. */
export const VELOCIDAD_DEFAULT_KMH = 18;
/** Cuánto más larga es la ruta real que la línea recta (calles de Lima ≈ 1.3×). */
export const FACTOR_RUTA_DEFAULT = 1.3;

/** Un ping GPS con capturedAt a más de 2 min de "ahora" (cola offline, reloj roto)
 *  actualiza el mapa pero NO evalúa alertas/ETA: notificar con posición vieja es
 *  mentirle a la asesora. 120 s cubre el throttle de 12 s y el heartbeat de 90 s. */
export const MAX_DESFASE_PING_MS = 120_000;

/** Con accuracy peor a 150 m (celda/WiFi/interior) no se evalúan alertas. */
export const MAX_ACCURACY_M = 150;

// Clamps de la calibración: fuera de estos rangos el dato de Google es sospechoso
// (origen fallback lejano, ruta absurda) y preferimos acotar el daño.
const FACTOR_RUTA_MIN = 1.1;
const FACTOR_RUTA_MAX = 2.2;
const VELOCIDAD_MIN_KMH = 8;
const VELOCIDAD_MAX_KMH = 45;

/** La calibración por factor pierde sentido con viajes casi puntuales. */
const LINEA_RECTA_MIN_KM = 0.3;
/** Duraciones de Google menores a 1 min dan velocidades absurdas al dividir. */
const DURACION_MIN_SEG = 60;

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

export interface CalibracionViaje {
  /** distanciaRuta / lineaRecta — cuánto "serpentea" este viaje concreto. */
  factorRuta: number;
  /** Velocidad efectiva sobre ruta que Google estimó para este viaje. */
  velocidadKmh: number;
}

/**
 * Deriva la calibración del viaje a partir del Google Directions inicial.
 * Con datos faltantes o degenerados cae a los defaults (y los clamps acotan
 * cualquier valor raro). Propiedad clave: en el primer ping del viaje,
 * estimarEtaMin(lineaRecta, factor, velocidad) ≈ duración de Google — el
 * recálculo por ping es CONTINUO con el ETA inicial, no lo pisa con otro modelo.
 */
export function calibrarViaje(p: {
  distanciaRutaKm: number | null;
  duracionSeg: number | null;
  lineaRectaKm: number | null;
}): CalibracionViaje {
  let factorRuta = FACTOR_RUTA_DEFAULT;
  if (
    p.distanciaRutaKm != null &&
    p.distanciaRutaKm > 0 &&
    p.lineaRectaKm != null &&
    p.lineaRectaKm >= LINEA_RECTA_MIN_KM
  ) {
    factorRuta = clamp(p.distanciaRutaKm / p.lineaRectaKm, FACTOR_RUTA_MIN, FACTOR_RUTA_MAX);
  }

  let velocidadKmh = VELOCIDAD_DEFAULT_KMH;
  if (p.distanciaRutaKm != null && p.distanciaRutaKm > 0 && p.duracionSeg != null && p.duracionSeg >= DURACION_MIN_SEG) {
    velocidadKmh = clamp(p.distanciaRutaKm / (p.duracionSeg / 3600), VELOCIDAD_MIN_KMH, VELOCIDAD_MAX_KMH);
  }

  return { factorRuta, velocidadKmh };
}

/**
 * Minutos restantes estimados desde la distancia EN LÍNEA RECTA al destino.
 * SIN redondear (el redondeo es cosa del mensaje, no del modelo).
 * NULL en la calibración (viaje viejo / sin Directions) → defaults.
 */
export function estimarEtaMin(
  lineaRectaKm: number,
  factorRuta: number | null,
  velocidadKmh: number | null
): number {
  if (lineaRectaKm <= UMBRAL_LLEGADA_KM) return 0;
  const f = clamp(factorRuta ?? FACTOR_RUTA_DEFAULT, FACTOR_RUTA_MIN, FACTOR_RUTA_MAX);
  const v = clamp(velocidadKmh ?? VELOCIDAD_DEFAULT_KMH, VELOCIDAD_MIN_KMH, VELOCIDAD_MAX_KMH);
  return ((lineaRectaKm * f) / v) * 60;
}

/** ¿El ping trae una posición "de ahora"? ISO inválido = no fresca (fail-safe). */
export function esCapturaFresca(capturedAtIso: string, ahoraMs: number): boolean {
  const t = Date.parse(capturedAtIso);
  if (Number.isNaN(t)) return false;
  return Math.abs(ahoraMs - t) <= MAX_DESFASE_PING_MS;
}

export interface DecisionAlertasArribo {
  dispararLlegada: boolean;
  dispararPorLlegar: boolean;
  /** Minutos a mostrar en el mensaje de "por llegar" (2..5, entero). */
  minutosMensaje: number;
}

/**
 * Decide qué alerta (si alguna) corresponde a este ping. Invariantes:
 * - JAMÁS ambas true (exclusión mutua por construcción: llegado gana).
 * - "por llegar" nunca dispara después de "llegado" ni con < MIN_POR_LLEGAR_MIN
 *   minutos restantes (regresión del "a unos 5 minutos" faltando 1).
 */
export function decidirAlertasArribo(p: {
  etaMin: number;
  distanciaKm: number;
  notificadoPorLlegar: boolean;
  notificadoLlegada: boolean;
}): DecisionAlertasArribo {
  const llego = p.distanciaKm <= UMBRAL_LLEGADA_KM;
  return {
    dispararLlegada: llego && !p.notificadoLlegada,
    dispararPorLlegar:
      !llego &&
      !p.notificadoPorLlegar &&
      !p.notificadoLlegada &&
      p.etaMin >= MIN_POR_LLEGAR_MIN &&
      p.etaMin <= UMBRAL_POR_LLEGAR_MIN,
    minutosMensaje: Math.max(1, Math.min(UMBRAL_POR_LLEGAR_MIN, Math.ceil(p.etaMin))),
  };
}

/**
 * Cuánto tiempo un aviso de arribo sigue mereciendo interrumpir la pantalla.
 * Una hora cubre de sobra el caso "estaba atendiendo y volví"; más allá, el
 * motorizado ya entregó y el aviso solo confunde.
 */
export const VIGENCIA_POPUP_ARRIBO_MS = 60 * 60_000;

/**
 * ¿Este aviso de arribo todavía describe algo que está pasando?
 *
 * El popup interrumpe a pantalla completa, así que solo puede mostrar avisos
 * VIVOS. Una notificación no leída no caduca nunca en la base (es correcto: la
 * asesora debe poder verla en la campana), pero al día siguiente ya no debe
 * saltar sobre la pantalla — le pasó a Yesica con pedidos entregados hacía dos
 * días (20 ago 2026). Fecha inválida = no vigente (fail-safe: ante la duda, no
 * se interrumpe; la campana la sigue mostrando igual).
 */
export function avisoArriboVigente(createdAtIso: string, ahoraMs: number): boolean {
  const t = Date.parse(createdAtIso);
  if (Number.isNaN(t)) return false;
  return t <= ahoraMs && ahoraMs - t <= VIGENCIA_POPUP_ARRIBO_MS;
}

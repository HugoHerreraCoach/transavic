// src/lib/tiempo-relativo.ts
// Fuente ÚNICA del "hace X" en la UI. Antes había dos helpers divergentes:
// - NotificationBell.formatHora usaba Math.ROUND → a los 30 s ya decía
//   "hace 1 min" (parte del reporte "los tiempos no coinciden", 11 ago 2026).
// - mapa-despacho.haceCuanto usaba floor (correcto) pero vivía duplicado.
// Regla: SIEMPRE floor — "hace 1 min" recién cuando pasó 1 minuto entero.
//
// PURO (sin `neon`, sin React): corre en vitest (gotcha #13).

/**
 * Granularidad de segundos: "hace 15 s" / "hace 3 min" / "hace 2 h".
 * Devuelve también los segundos crudos (el mapa de despacho decide "en vivo"
 * con ellos). ISO inválido → { texto: "", segundos: Infinity } (nunca en vivo).
 * Skew negativo (reloj del dispositivo atrasado) se clampa a 0.
 */
export function haceCuanto(iso: string, ahoraMs: number = Date.now()): { texto: string; segundos: number } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { texto: "", segundos: Number.POSITIVE_INFINITY };
  const seg = Math.max(0, Math.floor((ahoraMs - t) / 1000));
  let texto: string;
  if (seg < 60) texto = `hace ${seg} s`;
  else if (seg < 3600) texto = `hace ${Math.floor(seg / 60)} min`;
  else texto = `hace ${Math.floor(seg / 3600)} h`;
  return { texto, segundos: seg };
}

/**
 * Granularidad de minutos para la campanita: "ahora" (< 1 min entero),
 * "hace X min", "hace X h", "hace X d". Siempre floor.
 */
export function tiempoRelativoNotificacion(iso: string, ahoraMs: number = Date.now()): string {
  const { segundos } = haceCuanto(iso, ahoraMs);
  if (!Number.isFinite(segundos)) return "";
  const min = Math.floor(segundos / 60);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / (60 * 24))} d`;
}

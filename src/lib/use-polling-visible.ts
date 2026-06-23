"use client";

import { useEffect, useRef } from "react";

interface OpcionesPolling {
  /** Si es false, el polling no se programa (útil para gatear por rol/viewport). Default: true. */
  enabled?: boolean;
  /** Si es true, ejecuta `callback` apenas monta (si la pestaña está visible). Default: true. */
  immediate?: boolean;
}

/**
 * Ejecuta `callback` en un intervalo, PERO solo mientras la pestaña está visible.
 *
 * - Al montar (si la pestaña está visible) hace una llamada inicial (salvo `immediate: false`).
 * - Cuando la pestaña pasa a oculta (`document.hidden`), detiene el intervalo → 0 consumo.
 * - Cuando vuelve a visible, dispara una llamada inmediata y reanuda el intervalo.
 *
 * Esto evita que pestañas en segundo plano sigan pegando a la base de datos, lo que
 * mantenía despierto el cómputo de Neon (ver docs: optimización de consumo, jun 2026).
 *
 * ⚠️ Usar SOLO para LECTURAS (refrescos de pantalla, notificaciones, metas). NUNCA para
 * escrituras que deban seguir corriendo en segundo plano — p. ej. el reporte de GPS del
 * repartidor (`navigator.geolocation.watchPosition` en mi-ruta-content): ese debe seguir
 * transmitiendo aunque la pestaña esté oculta.
 *
 * El `callback` se guarda en un ref, así que puede cerrar sobre estado cambiante sin
 * re-suscribir el intervalo (siempre se llama la versión más reciente).
 */
export function usePollingVisible(
  callback: () => void | Promise<void>,
  intervalMs: number,
  opciones?: OpcionesPolling
) {
  const { enabled = true, immediate = true } = opciones ?? {};
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      void callbackRef.current();
    };

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(run, intervalMs);
      }
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        run(); // fetch inmediato al volver, para no esperar al próximo tick
        start();
      } else {
        stop(); // pestaña oculta → dejar de consumir
      }
    };

    if (!document.hidden) {
      if (immediate) run();
      start();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, intervalMs, immediate]);
}

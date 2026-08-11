// Tests del modelo de ETA y la decisión de alertas de arribo.
// Regresiones que protegen: el "a unos 5 minutos" faltando 1, el doble disparo
// ("por llegar" + "llegado" en el mismo ping) y los pings rancios de la cola
// offline generando notificaciones "frescas". (Reporte de operación, 11 ago 2026.)
import { describe, expect, it } from "vitest";
import {
  FACTOR_RUTA_DEFAULT,
  MAX_DESFASE_PING_MS,
  VELOCIDAD_DEFAULT_KMH,
  calibrarViaje,
  decidirAlertasArribo,
  esCapturaFresca,
  estimarEtaMin,
} from "./eta-reparto";

describe("calibrarViaje", () => {
  it("deriva factor y velocidad de un Directions normal", () => {
    // Ruta de 4.2 km sobre 3.0 km en línea recta, 14 min de viaje.
    const c = calibrarViaje({ distanciaRutaKm: 4.2, duracionSeg: 14 * 60, lineaRectaKm: 3.0 });
    expect(c.factorRuta).toBeCloseTo(1.4, 5);
    expect(c.velocidadKmh).toBeCloseTo(18, 5); // 4.2 km / (14/60) h
  });

  it("sin Directions (falló la API) cae a los defaults", () => {
    const c = calibrarViaje({ distanciaRutaKm: null, duracionSeg: null, lineaRectaKm: 2.0 });
    expect(c.factorRuta).toBe(FACTOR_RUTA_DEFAULT);
    expect(c.velocidadKmh).toBe(VELOCIDAD_DEFAULT_KMH);
  });

  it("línea recta casi puntual (< 0.3 km) no calibra factor (ratio inestable)", () => {
    const c = calibrarViaje({ distanciaRutaKm: 1.0, duracionSeg: 300, lineaRectaKm: 0.2 });
    expect(c.factorRuta).toBe(FACTOR_RUTA_DEFAULT);
    // La velocidad sí se calibra: 1 km en 5 min = 12 km/h.
    expect(c.velocidadKmh).toBeCloseTo(12, 5);
  });

  it("clampa valores absurdos (origen fallback lejano, ruta rara)", () => {
    // Factor 10× y velocidad 120 km/h → clamps.
    const c = calibrarViaje({ distanciaRutaKm: 30, duracionSeg: 900, lineaRectaKm: 3 });
    expect(c.factorRuta).toBe(2.2);
    expect(c.velocidadKmh).toBe(45);
    // Velocidad ridículamente baja → clamp inferior.
    const lenta = calibrarViaje({ distanciaRutaKm: 0.5, duracionSeg: 3600, lineaRectaKm: 0.4 });
    expect(lenta.velocidadKmh).toBe(8);
  });

  it("duración < 60 s no calibra velocidad (división degenerada)", () => {
    const c = calibrarViaje({ distanciaRutaKm: 0.8, duracionSeg: 30, lineaRectaKm: 0.6 });
    expect(c.velocidadKmh).toBe(VELOCIDAD_DEFAULT_KMH);
  });
});

describe("estimarEtaMin", () => {
  it("CONTINUIDAD: en el primer ping reproduce la duración de Google (±1%)", () => {
    // El recálculo por ping no debe "pisar" el ETA inicial con otro modelo.
    const lineaRecta = 3.0;
    const duracionSeg = 14 * 60;
    const { factorRuta, velocidadKmh } = calibrarViaje({
      distanciaRutaKm: 4.2,
      duracionSeg,
      lineaRectaKm: lineaRecta,
    });
    const eta = estimarEtaMin(lineaRecta, factorRuta, velocidadKmh);
    expect(eta).toBeGreaterThan((duracionSeg / 60) * 0.99);
    expect(eta).toBeLessThan((duracionSeg / 60) * 1.01);
  });

  it("dentro del umbral de llegada devuelve 0", () => {
    expect(estimarEtaMin(0.15, null, null)).toBe(0);
    expect(estimarEtaMin(0.05, 1.5, 20)).toBe(0);
  });

  it("con calibración NULL (viaje viejo / sin Directions) usa defaults", () => {
    // 2 km × 1.3 / 18 km/h × 60 = 8.67 min
    expect(estimarEtaMin(2, null, null)).toBeCloseTo((2 * 1.3) / 18 * 60, 5);
  });

  it("clampa calibración corrupta que venga de la DB", () => {
    // factor 99 / velocidad 999 → clamps [1.1, 2.2] / [8, 45]
    expect(estimarEtaMin(2, 99, 999)).toBeCloseTo((2 * 2.2) / 45 * 60, 5);
  });
});

describe("esCapturaFresca", () => {
  const ahora = Date.parse("2026-08-11T12:00:00.000Z");

  it("acepta pings dentro de los 120 s (throttle 12 s + heartbeat 90 s)", () => {
    expect(esCapturaFresca("2026-08-11T11:58:01.000Z", ahora)).toBe(true); // 119 s
    expect(esCapturaFresca("2026-08-11T12:00:00.000Z", ahora)).toBe(true);
  });

  it("rechaza pings rancios (cola offline) y del futuro (reloj roto)", () => {
    expect(esCapturaFresca("2026-08-11T11:57:59.000Z", ahora)).toBe(false); // 121 s
    expect(esCapturaFresca("2026-08-11T11:50:00.000Z", ahora)).toBe(false); // 10 min
    expect(esCapturaFresca("2026-08-11T12:02:01.000Z", ahora)).toBe(false); // futuro
  });

  it("ISO inválido = no fresca (fail-safe)", () => {
    expect(esCapturaFresca("no-es-fecha", ahora)).toBe(false);
    expect(esCapturaFresca("", ahora)).toBe(false);
  });

  it("el umbral exportado es el que documentamos (120 s)", () => {
    expect(MAX_DESFASE_PING_MS).toBe(120_000);
  });
});

describe("decidirAlertasArribo", () => {
  const flagsLimpios = { notificadoPorLlegar: false, notificadoLlegada: false };

  it("REGRESIÓN doble disparo: a 100 m con flags limpios sale SOLO 'llegado'", () => {
    // Antes: d ≤ 0.15 → durationRemaining = 0 cumplía también "≤ 5" y salían
    // las DOS notificaciones en el mismo ping.
    const d = decidirAlertasArribo({ etaMin: 0, distanciaKm: 0.1, ...flagsLimpios });
    expect(d.dispararLlegada).toBe(true);
    expect(d.dispararPorLlegar).toBe(false);
  });

  it("REGRESIÓN '5 minutos faltando 1': con < 2 min restantes se suprime 'por llegar'", () => {
    const d = decidirAlertasArribo({ etaMin: 1.4, distanciaKm: 0.4, ...flagsLimpios });
    expect(d.dispararPorLlegar).toBe(false);
    expect(d.dispararLlegada).toBe(false); // aún no llegó: no sale nada
  });

  it("dispara 'por llegar' dentro de la ventana [2..5] min con el minuto real", () => {
    const d = decidirAlertasArribo({ etaMin: 4.2, distanciaKm: 1.5, ...flagsLimpios });
    expect(d.dispararPorLlegar).toBe(true);
    expect(d.dispararLlegada).toBe(false);
    expect(d.minutosMensaje).toBe(5); // ceil(4.2)

    const d2 = decidirAlertasArribo({ etaMin: 2.0, distanciaKm: 0.7, ...flagsLimpios });
    expect(d2.dispararPorLlegar).toBe(true);
    expect(d2.minutosMensaje).toBe(2);
  });

  it("lejos del destino (> 5 min) no dispara nada", () => {
    const d = decidirAlertasArribo({ etaMin: 9.8, distanciaKm: 3.4, ...flagsLimpios });
    expect(d.dispararLlegada).toBe(false);
    expect(d.dispararPorLlegar).toBe(false);
  });

  it("flags ya consumidos → nada (dedup)", () => {
    const llegado = decidirAlertasArribo({
      etaMin: 0, distanciaKm: 0.1, notificadoPorLlegar: true, notificadoLlegada: true,
    });
    expect(llegado.dispararLlegada).toBe(false);
    const porLlegar = decidirAlertasArribo({
      etaMin: 3, distanciaKm: 1.0, notificadoPorLlegar: true, notificadoLlegada: false,
    });
    expect(porLlegar.dispararPorLlegar).toBe(false);
  });

  it("'por llegar' JAMÁS después de 'llegado' (rebote de GPS hacia afuera)", () => {
    const d = decidirAlertasArribo({
      etaMin: 3, distanciaKm: 1.0, notificadoPorLlegar: false, notificadoLlegada: true,
    });
    expect(d.dispararPorLlegar).toBe(false);
  });

  it("invariante: nunca ambas true (fuzz ligero de la matriz)", () => {
    for (const etaMin of [0, 0.5, 1.9, 2, 3.7, 5, 5.1, 12]) {
      for (const distanciaKm of [0.01, 0.15, 0.16, 0.8, 2.5]) {
        for (const notificadoPorLlegar of [false, true]) {
          for (const notificadoLlegada of [false, true]) {
            const d = decidirAlertasArribo({ etaMin, distanciaKm, notificadoPorLlegar, notificadoLlegada });
            expect(d.dispararLlegada && d.dispararPorLlegar).toBe(false);
          }
        }
      }
    }
  });
});

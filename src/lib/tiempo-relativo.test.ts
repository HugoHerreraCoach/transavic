// Tests del "hace X" unificado de la UI.
// Regresión que protege: formatHora (campanita) usaba Math.ROUND y a los 30 s
// ya decía "hace 1 min" (parte del reporte "los tiempos no coinciden").
import { describe, expect, it } from "vitest";
import { haceCuanto, tiempoRelativoNotificacion } from "./tiempo-relativo";

const AHORA = Date.parse("2026-08-11T12:00:00.000Z");
const hace = (seg: number) => new Date(AHORA - seg * 1000).toISOString();

describe("tiempoRelativoNotificacion", () => {
  it("REGRESIÓN Math.round: 30 s y 59 s siguen siendo 'ahora'", () => {
    expect(tiempoRelativoNotificacion(hace(30), AHORA)).toBe("ahora");
    expect(tiempoRelativoNotificacion(hace(59), AHORA)).toBe("ahora");
  });

  it("60 s y 90 s → 'hace 1 min' (floor, nunca 'hace 2 min' a los 90 s)", () => {
    expect(tiempoRelativoNotificacion(hace(60), AHORA)).toBe("hace 1 min");
    expect(tiempoRelativoNotificacion(hace(90), AHORA)).toBe("hace 1 min");
    expect(tiempoRelativoNotificacion(hace(119), AHORA)).toBe("hace 1 min");
    expect(tiempoRelativoNotificacion(hace(120), AHORA)).toBe("hace 2 min");
  });

  it("escalera de horas y días", () => {
    expect(tiempoRelativoNotificacion(hace(59 * 60), AHORA)).toBe("hace 59 min");
    expect(tiempoRelativoNotificacion(hace(60 * 60), AHORA)).toBe("hace 1 h");
    expect(tiempoRelativoNotificacion(hace(23 * 3600), AHORA)).toBe("hace 23 h");
    expect(tiempoRelativoNotificacion(hace(24 * 3600), AHORA)).toBe("hace 1 d");
    expect(tiempoRelativoNotificacion(hace(3 * 24 * 3600), AHORA)).toBe("hace 3 d");
  });

  it("skew negativo (created_at 'del futuro' por reloj desajustado) → 'ahora'", () => {
    expect(tiempoRelativoNotificacion(hace(-45), AHORA)).toBe("ahora");
  });

  it("ISO inválido → cadena vacía (no revienta el render)", () => {
    expect(tiempoRelativoNotificacion("basura", AHORA)).toBe("");
  });
});

describe("haceCuanto", () => {
  it("granularidad de segundos con el formato del mapa de despacho", () => {
    expect(haceCuanto(hace(15), AHORA)).toEqual({ texto: "hace 15 s", segundos: 15 });
    expect(haceCuanto(hace(180), AHORA)).toEqual({ texto: "hace 3 min", segundos: 180 });
    expect(haceCuanto(hace(2 * 3600), AHORA)).toEqual({ texto: "hace 2 h", segundos: 7200 });
  });

  it("skew negativo se clampa a 0 s", () => {
    expect(haceCuanto(hace(-30), AHORA)).toEqual({ texto: "hace 0 s", segundos: 0 });
  });

  it("ISO inválido → segundos Infinity (el mapa nunca lo pinta 'en vivo')", () => {
    const r = haceCuanto("no-es-fecha", AHORA);
    expect(r.texto).toBe("");
    expect(r.segundos).toBe(Number.POSITIVE_INFINITY);
  });
});

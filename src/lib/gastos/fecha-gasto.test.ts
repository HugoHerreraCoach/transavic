import { describe, expect, it } from "vitest";
import {
  esFechaISO,
  fechaBonita,
  fechaChip,
  validarFechaGasto,
} from "./fecha-gasto";

describe("esFechaISO", () => {
  it("acepta una fecha real", () => {
    expect(esFechaISO("2026-07-13")).toBe(true);
    expect(esFechaISO("2024-02-29")).toBe(true); // 2024 sí fue bisiesto
  });

  it("rechaza formatos que no son AAAA-MM-DD", () => {
    expect(esFechaISO("13-07-2026")).toBe(false);
    expect(esFechaISO("2026/07/13")).toBe(false);
    expect(esFechaISO("ayer")).toBe(false);
    expect(esFechaISO("")).toBe(false);
    expect(esFechaISO(null)).toBe(false);
    expect(esFechaISO(20260713)).toBe(false);
  });

  it("rechaza días que no existen en el calendario", () => {
    expect(esFechaISO("2026-02-31")).toBe(false);
    expect(esFechaISO("2026-02-29")).toBe(false); // 2026 no es bisiesto
    expect(esFechaISO("2026-13-01")).toBe(false);
    expect(esFechaISO("2026-00-10")).toBe(false);
  });
});

describe("validarFechaGasto", () => {
  const HOY = "2026-08-06";

  it("acepta hoy", () => {
    expect(validarFechaGasto(HOY, HOY)).toEqual({ ok: true });
  });

  it("acepta cualquier fecha pasada: cargar julio en agosto es el caso real", () => {
    expect(validarFechaGasto("2026-07-13", HOY).ok).toBe(true);
    expect(validarFechaGasto("2025-01-02", HOY).ok).toBe(true);
  });

  it("rechaza el futuro con un mensaje que dice qué día es hoy", () => {
    const r = validarFechaGasto("2026-08-07", HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain("futura");
      expect(r.motivo).toContain("06/08/2026");
    }
  });

  it("rechaza basura antes de mirar el calendario", () => {
    const r = validarFechaGasto("mañana", HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("AAAA-MM-DD");
  });
});

describe("formato para la pantalla", () => {
  it("fechaBonita da el formato peruano", () => {
    expect(fechaBonita("2026-07-13")).toBe("13/07/2026");
  });

  it("fechaChip es corto para el selector", () => {
    expect(fechaChip("2026-07-13")).toBe("13 jul");
    expect(fechaChip("2026-01-05")).toBe("5 ene");
  });
});

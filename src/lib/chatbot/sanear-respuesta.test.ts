import { describe, expect, it } from "vitest";
import {
  esRespuestaUsable,
  limpiarMarkdown,
  pareceTruncada,
  pideHandoff,
  quitarEtiquetaHandoff,
  sanearRespuestaBot,
} from "./sanear-respuesta";

describe("esRespuestaUsable", () => {
  it("rechaza vacíos, textos ínfimos y basura estructural", () => {
    expect(esRespuestaUsable(null)).toBe(false);
    expect(esRespuestaUsable("   ")).toBe(false);
    expect(esRespuestaUsable("ok")).toBe(false);
    expect(esRespuestaUsable("{")).toBe(false);
    expect(esRespuestaUsable("[]:,")).toBe(false);
  });

  it("rechaza una respuesta que arranca en JSON", () => {
    expect(esRespuestaUsable('{"motivo":"pedido","kg":20}')).toBe(false);
  });

  it("acepta una frase normal", () => {
    expect(esRespuestaUsable("Claro que sí, ¿para cuántas personas?")).toBe(true);
  });
});

describe("pareceTruncada", () => {
  it("detecta una frase cortada a la mitad", () => {
    expect(pareceTruncada("Claro, te cotizo el pollo entero para")).toBe(true);
    expect(pareceTruncada("Te puedo llevar 10 kg de pechuga,")).toBe(true);
  });

  it("acepta cierres normales", () => {
    expect(pareceTruncada("Perfecto, te lo dejo listo.")).toBe(false);
    expect(pareceTruncada("¿Te lo llevo mañana?")).toBe(false);
    expect(pareceTruncada("Buenísimo 😊")).toBe(false);
  });

  it("ACEPTA una lista de precios que termina en unidad (el bug que rompía cotizar)", () => {
    const lista = ["Te dejo los precios:", "- Alitas: S/ 12.00 por kg", "- Gallina doble: S/ 14.00 por kg"].join("\n");
    expect(pareceTruncada(lista)).toBe(false);
  });

  it("acepta una lista que cierra con la pregunta de avance", () => {
    const lista = [
      "Estos son los que más piden:",
      "- Pechuga deshuesada: S/ 18.00 por kg",
      "¿Cuántos kilos manejas por semana?",
    ].join("\n");
    expect(pareceTruncada(lista)).toBe(false);
  });

  it("sigue detectando una lista cuya última línea quedó cortada", () => {
    const lista = ["Te dejo los precios:", "- Alitas: S/ 12.00 por kg", "- Gallina doble el precio es de"].join("\n");
    expect(pareceTruncada(lista)).toBe(true);
  });

  it("tolera emojis con variation selector al final", () => {
    expect(pareceTruncada("Listo, quedamos así ✔️")).toBe(false);
  });
});

describe("quitarEtiquetaHandoff", () => {
  it("quita TODAS las etiquetas, en cualquier capitalización", () => {
    const salida = quitarEtiquetaHandoff("Te paso con una asesora [HANDOFF] ahora [ handoff ]");
    expect(salida).not.toMatch(/handoff/i);
  });

  it("NO aplasta los saltos de línea de una lista", () => {
    const entrada = "Te dejo los precios:\n\n- Alitas: S/ 12.00 por kg\n- Pollo entero: S/ 10.50 por kg";
    const salida = quitarEtiquetaHandoff(entrada);
    expect(salida.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});

describe("pideHandoff", () => {
  it("es tolerante a mayúsculas y espacios", () => {
    expect(pideHandoff("listo [HANDOFF]")).toBe(true);
    expect(pideHandoff("listo [ handoff ]")).toBe(true);
    expect(pideHandoff("listo")).toBe(false);
    expect(pideHandoff(null)).toBe(false);
  });
});

describe("limpiarMarkdown", () => {
  it("convierte la negrita de Markdown a la de WhatsApp", () => {
    expect(limpiarMarkdown("El **pollo entero** está S/ 10.50")).toBe("El *pollo entero* está S/ 10.50");
    expect(limpiarMarkdown("## Precios de hoy")).toBe("Precios de hoy");
  });
});

describe("sanearRespuestaBot", () => {
  it("descarta lo inservible", () => {
    expect(sanearRespuestaBot("{")).toBeNull();
    expect(sanearRespuestaBot("Te cotizo el pollo entero para")).toBeNull();
    expect(sanearRespuestaBot("")).toBeNull();
  });

  it("deja pasar una cotización con lista y quita la etiqueta", () => {
    const salida = sanearRespuestaBot(
      "Te dejo lo que más piden:\n- Alitas: S/ 12.00 por kg\n- Pechuga deshuesada: S/ 18.00 por kg\n[HANDOFF]"
    );
    expect(salida).not.toBeNull();
    expect(salida).not.toMatch(/handoff/i);
    expect(salida).toContain("S/ 12.00");
  });

  it("descarta si al quitar la etiqueta no queda nada útil", () => {
    expect(sanearRespuestaBot("[HANDOFF]")).toBeNull();
  });
});

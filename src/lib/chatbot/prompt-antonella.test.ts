import { describe, expect, it } from "vitest";
import { CONFIG_BOT_DEFAULT, normalizarConfigBot } from "./config-bot";
import { cartaDeMarca } from "./carta-comercial";
import { construirCarta, momentoLima, type ContextoNegocio } from "./contexto-negocio";
import { construirSystemPrompt, construirTurnos, etiquetaMedia } from "./prompt-antonella";

/** Catálogo de mentira, con los nombres REALES que tiene la DB. */
const CATALOGO = [
  { nombre: "Pollo con menudencia entero", unidad: "kg", precio_venta: 10.5 },
  { nombre: "Pechuga deshuesada / filetes", unidad: "kg", precio_venta: 18 },
  { nombre: "Alas", unidad: "kg", precio_venta: 12 },
  { nombre: "Gallina doble pecho venta entera (peso aprox. 3.600 a 4.200 kg)", unidad: "kg", precio_venta: 14 },
  { nombre: "Cuy entero precio por uni.", unidad: "uni", precio_venta: 35 },
  { nombre: "Bistec de res", unidad: "kg", precio_venta: 30 },
];

function contextoDePrueba(overrides: Partial<ContextoNegocio> = {}): ContextoNegocio {
  const config = normalizarConfigBot(null);
  const carta = construirCarta(cartaDeMarca("Transavic", true), CATALOGO);
  return {
    empresa: "Transavic",
    marcaNombre: "Transavic",
    config,
    carta,
    cartaDegradada: false,
    // martes 5 de agosto de 2026, 10:42 en Lima (UTC-5)
    momento: momentoLima(config, new Date("2026-08-05T15:42:00Z")),
    lead: { primerNombre: "Hugo", distrito: "Lince", rubro: "Restaurante" },
    cliente: {
      esCliente: true,
      rubro: "Restaurante",
      distrito: "Lince",
      topProductos: ["Pechuga deshuesada (filete de pechuga)", "Alitas"],
      diasDesdeUltimaCompra: 12,
    },
    ...overrides,
  };
}

describe("construirTurnos", () => {
  const h = (sender: string, body: string, type = "text") => ({ sender, body, type });

  it("empieza y termina con el usuario, y no repite roles seguidos", () => {
    const turnos = construirTurnos(
      [h("bot", "¡Hola! ¿En qué te ayudo?"), h("cliente", "hola"), h("bot", "dime"), h("asesora", "aquí Leslie")],
      ["quiero 20 kg", "para mañana"]
    );
    expect(turnos[0].rol).toBe("usuario");
    expect(turnos[turnos.length - 1].rol).toBe("usuario");
    for (let i = 1; i < turnos.length; i++) {
      expect(turnos[i].rol).not.toBe(turnos[i - 1].rol);
    }
  });

  it("junta la ráfaga en UN solo turno", () => {
    const turnos = construirTurnos([h("cliente", "hola"), h("bot", "¡Hola!")], [
      "20 kg",
      "para mañana",
      "en Surco",
    ]);
    const ultimo = turnos[turnos.length - 1];
    expect(ultimo.rol).toBe("usuario");
    expect(ultimo.texto).toBe("20 kg\npara mañana\nen Surco");
  });

  it("nunca mete base64 de una foto en el prompt", () => {
    const turnos = construirTurnos(
      [h("cliente", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ", "image")],
      ["esto es lo que necesito"]
    );
    expect(turnos.some((t) => t.texto.includes("base64"))).toBe(false);
    expect(turnos.some((t) => t.texto.includes("[el cliente envió una foto]"))).toBe(true);
  });

  it("descarta las notas internas del sistema", () => {
    const turnos = construirTurnos(
      [h("cliente", "hola"), h("sistema", "⚠️ El asistente no pudo responder")],
      ["sigo ahí?"]
    );
    expect(turnos.some((t) => t.texto.includes("no pudo responder"))).toBe(false);
  });

  it("devuelve vacío si no hay nada del cliente", () => {
    expect(construirTurnos([h("bot", "hola")], [])).toEqual([]);
  });

  it("etiqueta cada tipo de adjunto", () => {
    expect(etiquetaMedia("audio")).toContain("audio");
    expect(etiquetaMedia("document")).toContain("documento");
  });
});

describe("construirSystemPrompt", () => {
  it("incluye la verdad del negocio: distritos, horario, mínimos y prohíbe dar precios", () => {
    const p = construirSystemPrompt(contextoDePrueba());
    for (const distrito of CONFIG_BOT_DEFAULT.distritos_cobertura) {
      expect(p).toContain(distrito);
    }
    // NUNCA debe inyectar precios numéricos en el prompt
    expect(p).not.toContain("S/ 10.50");
    expect(p).not.toContain("S/ 18.00");
    expect(p).not.toContain("S/ 35.00");
    expect(p).toContain("REGLA DE ORO DE PRECIOS");
    expect(p).toContain("NUNCA des precios");
    expect(p).toContain("5 kg para hogar");
    expect(p).toContain("Yape");
  });

  it("usa nombres comerciales, no los del catálogo", () => {
    const p = construirSystemPrompt(contextoDePrueba());
    expect(p).toContain("Pollo entero");
    expect(p).not.toContain("Cuy entero precio por uni.");
    expect(p).not.toContain("Gallina doble pecho venta entera");
  });

  it("conserva el contrato [HANDOFF] y los guardrails", () => {
    const p = construirSystemPrompt(contextoDePrueba());
    expect(p).toContain("[HANDOFF]");
    expect(p).toContain("POLLERÍAS");
    expect(p).toMatch(/NUNCA afirmes que hay stock/);
    expect(p).toMatch(/TEXTO LITERAL/);
  });

  it("NUNCA nombra a la otra marca", () => {
    const tra = construirSystemPrompt(contextoDePrueba());
    expect(tra).not.toContain("Avícola de Tony");

    const avi = construirSystemPrompt(
      contextoDePrueba({ empresa: "Avícola de Tony", marcaNombre: "La Avícola de Tony" })
    );
    expect(avi).toContain("La Avícola de Tony");
    // "Transavic" no debe aparecer como marca en el prompt de la otra
    expect(avi).not.toMatch(/\bTransavic\b/);
  });

  it("aprovecha que ya es cliente y no repregunta lo que sabe", () => {
    const p = construirSystemPrompt(contextoDePrueba());
    expect(p).toContain("YA ES CLIENTE");
    expect(p).toContain("Hugo");
    expect(p).toContain("Lince");
    expect(p).toContain("No le vuelvas a pedir estos datos");
  });

  it("prohíbe dar precios y exige derivar a la asesora humana", () => {
    const p = construirSystemPrompt(contextoDePrueba());
    expect(p).toContain("PROHIBIDO DAR PRECIOS");
    expect(p).toContain("asesora");
    expect(p).toContain("[HANDOFF]");
  });

  it("mete las instrucciones del admin al final y acotadas", () => {
    const config = normalizarConfigBot({ instrucciones_extra: "x".repeat(2000) });
    expect(config.instrucciones_extra.length).toBe(800);
    const p = construirSystemPrompt(contextoDePrueba({ config }));
    expect(p.indexOf("AJUSTES DEL ADMINISTRADOR")).toBeGreaterThan(p.indexOf("[HANDOFF]"));
  });
});

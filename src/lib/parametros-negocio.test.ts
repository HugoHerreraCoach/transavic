// src/lib/parametros-negocio.test.ts
//
// Tests de `agregarALista`, la función que usa el formulario de gasto para crear
// una categoría que falta sin salir de la pantalla (6 ago 2026, pedido de
// Marianela: "Delivery").
//
// El módulo solo importa `@neondatabase/serverless` como TIPO (`import type`),
// que TypeScript borra al compilar — por eso corre bajo vitest sin toparse con
// el gotcha #13 (el driver no arranca en Node 26).
import { describe, expect, it } from "vitest";
import {
  agregarALista,
  MAX_LARGO_OPCION,
  MAX_OPCIONES_LISTA,
  PARAMETROS_NEGOCIO_DEFAULT,
} from "./parametros-negocio";

const BASE = ["Almuerzo", "Limpieza", "Otros"];

describe("agregarALista", () => {
  it("agrega al final y deja el resto intacto", () => {
    const r = agregarALista(BASE, "Delivery");
    expect(r).toEqual({
      ok: true,
      lista: ["Almuerzo", "Limpieza", "Otros", "Delivery"],
      canonico: "Delivery",
      yaExistia: false,
    });
  });

  it("no muta la lista original", () => {
    const original = [...BASE];
    agregarALista(BASE, "Delivery");
    expect(BASE).toEqual(original);
  });

  it("capitaliza la primera letra para que no convivan 'delivery' y 'Delivery'", () => {
    const r = agregarALista(BASE, "delivery");
    expect(r.ok && r.canonico).toBe("Delivery");
  });

  it("respeta las mayúsculas internas de un nombre propio", () => {
    const r = agregarALista(BASE, "pago a MotoTaxi");
    expect(r.ok && r.canonico).toBe("Pago a MotoTaxi");
  });

  it("recorta y colapsa los espacios de más", () => {
    const r = agregarALista(BASE, "   pago   de   luz  ");
    expect(r.ok && r.canonico).toBe("Pago de luz");
  });

  // El caso que más va a pasar: la escribe de nuevo porque no la vio en la lista.
  describe("cuando ya existe", () => {
    it("no la duplica y devuelve la que ya está", () => {
      const r = agregarALista(BASE, "almuerzo");
      expect(r).toEqual({ ok: true, lista: BASE, canonico: "Almuerzo", yaExistia: true });
    });

    it("ignora las tildes en ambos sentidos", () => {
      expect(agregarALista(["Útiles"], "utiles")).toMatchObject({ canonico: "Útiles", yaExistia: true });
      expect(agregarALista(["Utiles"], "Útiles")).toMatchObject({ canonico: "Utiles", yaExistia: true });
    });

    it("ignora mayúsculas y espacios sobrantes", () => {
      expect(agregarALista(BASE, "  LIMPIEZA ")).toMatchObject({ canonico: "Limpieza", yaExistia: true });
    });

    it("devuelve la MISMA lista, sin reordenar", () => {
      const r = agregarALista(BASE, "otros");
      expect(r.ok && r.lista).toEqual(BASE);
    });
  });

  describe("rechaza", () => {
    it("el texto vacío o de solo espacios", () => {
      expect(agregarALista(BASE, "")).toMatchObject({ ok: false });
      expect(agregarALista(BASE, "    ")).toMatchObject({ ok: false });
    });

    it("un nombre más largo que el tope", () => {
      const r = agregarALista(BASE, "x".repeat(MAX_LARGO_OPCION + 1));
      expect(r).toMatchObject({ ok: false });
      expect(r.ok === false && r.error).toContain(String(MAX_LARGO_OPCION));
    });

    it("agregar cuando la lista ya llegó al tope", () => {
      const llena = Array.from({ length: MAX_OPCIONES_LISTA }, (_, i) => `Cat ${i}`);
      expect(agregarALista(llena, "Delivery")).toMatchObject({ ok: false });
      // …pero una que YA está sigue resolviéndose, aunque esté llena.
      expect(agregarALista(llena, "Cat 0")).toMatchObject({ ok: true, yaExistia: true });
    });

    it("acepta exactamente el largo máximo", () => {
      expect(agregarALista(BASE, "x".repeat(MAX_LARGO_OPCION))).toMatchObject({ ok: true });
    });
  });
});

describe("defaults", () => {
  it("incluye Delivery, lo que pidió Marianela", () => {
    expect(PARAMETROS_NEGOCIO_DEFAULT.categorias_gasto).toContain("Delivery");
  });

  it("conserva las categorías históricas (los gastos viejos guardan esos strings)", () => {
    for (const historica of ["Almuerzo", "Limpieza", "Combustible", "Útiles", "Mantenimiento", "Sencillo", "Otros"]) {
      expect(PARAMETROS_NEGOCIO_DEFAULT.categorias_gasto).toContain(historica);
    }
  });

  it("no trae duplicados según la misma regla de comparación del helper", () => {
    for (const lista of [
      PARAMETROS_NEGOCIO_DEFAULT.categorias_gasto,
      PARAMETROS_NEGOCIO_DEFAULT.tipos_doc_compra,
    ]) {
      for (const valor of lista) {
        // Agregar algo que ya está nunca debe crecer la lista.
        expect(agregarALista(lista, valor).ok && agregarALista(lista, valor)).toMatchObject({
          yaExistia: true,
        });
      }
    }
  });
});

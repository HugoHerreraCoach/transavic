// Tests del traductor de errores de Postgres.
// Lo que protegen: que a una usuaria NUNCA le llegue el texto crudo del motor
// (le pasó a Marianela al anular una compra, 21 ago 2026).
import { describe, expect, it } from "vitest";
import { esViolacionLlaveForanea, mensajeErrorSql } from "./errores-sql";

// El error REAL que vio la usuaria en pantalla.
const ERROR_REAL = {
  code: "23503",
  constraint: "pagos_proveedores_aplicaciones_deuda_fk",
  message:
    'update or delete on table "cuentas_por_pagar" violates foreign key constraint "pagos_proveedores_aplicaciones_deuda_fk" on table "pagos_proveedores_aplicaciones"',
};

describe("mensajeErrorSql", () => {
  it("REGRESIÓN: el caso de Marianela devuelve un mensaje accionable en español", () => {
    const m = mensajeErrorSql(ERROR_REAL);
    expect(m).toContain("pagos");
    expect(m).toContain("Ficha del Proveedor");
    // Y NADA de jerga: ni tablas, ni constraints, ni inglés.
    expect(m).not.toContain("cuentas_por_pagar");
    expect(m).not.toContain("constraint");
    expect(m).not.toContain("violates");
    expect(m).not.toContain("_fk");
  });

  it("reconoce la restricción aunque el driver no exponga `constraint`", () => {
    // El driver HTTP de Neon a veces solo trae el texto.
    const soloTexto = { message: ERROR_REAL.message };
    expect(mensajeErrorSql(soloTexto)).toBe(mensajeErrorSql(ERROR_REAL));
  });

  it("el segundo bloqueador (deuda prioritaria) también tiene su mensaje", () => {
    const m = mensajeErrorSql({ code: "23503", constraint: "pagos_proveedores_deuda_prioritaria_fk" });
    expect(m).toContain("Ficha del Proveedor");
    expect(m).not.toContain("_fk");
  });

  it("llave foránea desconocida → mensaje genérico entendible, nunca el crudo", () => {
    const m = mensajeErrorSql({ code: "23503", constraint: "otra_cosa_fk", message: "violates foreign key constraint" });
    expect(m).toContain("dependen de este");
    expect(m).not.toContain("foreign key");
  });

  it("duplicado y check tienen su propio mensaje", () => {
    expect(mensajeErrorSql({ code: "23505" })).toContain("ya existe");
    expect(mensajeErrorSql({ code: "23514" })).toContain("fuera de lo permitido");
  });

  it("un error cualquiera cae en el respaldo, sin filtrar su texto", () => {
    const m = mensajeErrorSql(new Error("connection terminated unexpectedly"));
    expect(m).not.toContain("connection terminated");
    expect(m).toContain("Vuelve a intentarlo");
  });

  it("acepta un respaldo propio del endpoint", () => {
    expect(mensajeErrorSql(new Error("x"), "No se pudo anular la compra.")).toBe("No se pudo anular la compra.");
  });

  it("no revienta con null, undefined ni formas raras", () => {
    for (const raro of [null, undefined, "texto suelto", 42, {}]) {
      expect(typeof mensajeErrorSql(raro)).toBe("string");
    }
  });
});

describe("esViolacionLlaveForanea", () => {
  it("detecta por código y por texto", () => {
    expect(esViolacionLlaveForanea(ERROR_REAL)).toBe(true);
    expect(esViolacionLlaveForanea({ message: ERROR_REAL.message })).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(esViolacionLlaveForanea({ code: "23505" })).toBe(false);
    expect(esViolacionLlaveForanea(new Error("timeout"))).toBe(false);
    expect(esViolacionLlaveForanea(null)).toBe(false);
  });
});

// Tests de la regla "quién puede editar el catálogo y qué campos".
// Lo que protegen: que el permiso puntual de la asesora NO se desborde al costo
// ni a la baja de productos (el PATCH acepta los ocho campos en el mismo body).
import { describe, expect, it } from "vitest";
import { evaluarEdicionCatalogo } from "./permisos-precios";

describe("evaluarEdicionCatalogo", () => {
  it("sin sesión → 401", () => {
    expect(evaluarEdicionCatalogo(null, ["precio_venta"])).toEqual({
      ok: false,
      status: 401,
      error: "No autorizado.",
    });
    expect(evaluarEdicionCatalogo(undefined, [])).toMatchObject({ status: 401 });
    // Sesión sin rol (forma inesperada) tampoco pasa.
    expect(evaluarEdicionCatalogo({ role: null }, ["precio_venta"])).toMatchObject({ status: 401 });
  });

  it("admin puede tocar TODOS los campos (sin regresión)", () => {
    const d = evaluarEdicionCatalogo({ role: "admin" }, [
      "precio_venta",
      "precio_compra",
      "activo",
      "nombre",
      "codigo",
    ]);
    expect(d).toEqual({ ok: true, alcance: "total" });
  });

  it("admin no necesita la bandera", () => {
    expect(
      evaluarEdicionCatalogo({ role: "admin", puede_editar_precio_venta: false }, ["precio_compra"])
    ).toMatchObject({ ok: true, alcance: "total" });
  });

  it("asesora SIN la bandera no edita nada", () => {
    for (const bandera of [undefined, null, false] as const) {
      const d = evaluarEdicionCatalogo(
        { role: "asesor", puede_editar_precio_venta: bandera },
        ["precio_venta"]
      );
      expect(d).toEqual({
        ok: false,
        status: 403,
        error: "No tienes permiso para editar el catálogo.",
      });
    }
  });

  it("asesora CON la bandera cambia el precio de venta", () => {
    expect(
      evaluarEdicionCatalogo({ role: "asesor", puede_editar_precio_venta: true }, ["precio_venta"])
    ).toEqual({ ok: true, alcance: "solo_precio_venta" });
  });

  it("REGRESIÓN: la asesora NO puede colar el costo junto al precio", () => {
    const d = evaluarEdicionCatalogo({ role: "asesor", puede_editar_precio_venta: true }, [
      "precio_venta",
      "precio_compra",
    ]);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.status).toBe(403);
      // El mensaje nombra el campo para que se entienda qué se rechazó.
      expect(d.error).toContain("precio_compra");
    }
  });

  it("REGRESIÓN: la asesora NO puede desactivar ni renombrar productos", () => {
    for (const campo of ["activo", "nombre", "codigo", "categoria"]) {
      expect(
        evaluarEdicionCatalogo({ role: "asesor", puede_editar_precio_venta: true }, [campo])
      ).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("un rol que no es asesor con la bandera encendida (dato viejo) NO pasa", () => {
    for (const role of ["repartidor", "produccion"]) {
      expect(
        evaluarEdicionCatalogo({ role, puede_editar_precio_venta: true }, ["precio_venta"])
      ).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("campo desconocido → niega (fail-closed)", () => {
    expect(
      evaluarEdicionCatalogo({ role: "asesor", puede_editar_precio_venta: true }, ["foo"])
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("body vacío pasa el permiso: el 400 lo da el handler", () => {
    expect(
      evaluarEdicionCatalogo({ role: "asesor", puede_editar_precio_venta: true }, [])
    ).toEqual({ ok: true, alcance: "solo_precio_venta" });
  });
});

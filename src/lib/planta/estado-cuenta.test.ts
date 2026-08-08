import { describe, expect, it } from "vitest";
import { construirEstadoCuentaPlanta } from "@/lib/planta/estado-cuenta";
import type { MovimientoPlanta } from "@/lib/planta/types";

// Los movimientos llegan del historial ya ordenados; acá se arman a mano para
// fijar las reglas de negocio sin tocar la base.

let seq = 0;
function venta(
  over: Partial<MovimientoPlanta> & { monto: number; tipo_pago: "Contado" | "Credito" }
): MovimientoPlanta {
  seq += 1;
  return {
    tipo: "venta",
    id: `venta-${seq}`,
    fecha: "2026-08-07",
    created_at: `2026-08-07T10:0${seq}:00Z`,
    medio_pago: null,
    observaciones: null,
    anulado: false,
    anulacion_motivo: null,
    tiene_comprobante: false,
    comprobante_serie_numero: null,
    creado_por_nombre: "Ariana",
    items: [],
    ...over,
  } as MovimientoPlanta;
}

function abono(over: Partial<MovimientoPlanta> & { monto: number }): MovimientoPlanta {
  seq += 1;
  return {
    tipo: "abono",
    id: `abono-${seq}`,
    fecha: "2026-08-07",
    created_at: `2026-08-07T18:0${seq}:00Z`,
    tipo_pago: null,
    medio_pago: "efectivo",
    observaciones: null,
    anulado: false,
    anulacion_motivo: null,
    tiene_comprobante: false,
    comprobante_serie_numero: null,
    creado_por_nombre: "Ariana",
    ...over,
  } as MovimientoPlanta;
}

const SIN_SALDO_PREVIO = { saldo_anterior: 0 };

describe("construirEstadoCuentaPlanta", () => {
  it("una venta a crédito sube el saldo", () => {
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [venta({ monto: 180, tipo_pago: "Credito" })],
      null,
      null
    );
    expect(est.saldo_final).toBe(180);
    expect(est.total_credito).toBe(180);
    expect(est.dias[0].saldo_anterior).toBe(0);
    expect(est.dias[0].saldo_actual).toBe(180);
  });

  it("una venta al CONTADO se registra pero NO mueve el saldo", () => {
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [venta({ monto: 95.5, tipo_pago: "Contado" })],
      null,
      null
    );
    expect(est.saldo_final).toBe(0);
    expect(est.total_credito).toBe(0);
    expect(est.total_contado).toBe(95.5);
    expect(est.dias[0].venta_contado).toBe(95.5);
    expect(est.dias[0].saldo_actual).toBe(0);
  });

  it("contado y crédito el mismo día conviven sin mezclarse", () => {
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [
        venta({ monto: 40.2, tipo_pago: "Credito" }),
        venta({ monto: 60, tipo_pago: "Contado" }),
      ],
      null,
      null
    );
    const dia = est.dias[0];
    expect(dia.venta_credito).toBe(40.2);
    expect(dia.venta_contado).toBe(60);
    expect(dia.saldo_actual).toBe(40.2);
    expect(est.saldo_final).toBe(40.2);
  });

  it("el saldo anterior del cliente es el punto de partida", () => {
    const est = construirEstadoCuentaPlanta(
      { saldo_anterior: 250 },
      [venta({ monto: 100, tipo_pago: "Credito" })],
      null,
      null
    );
    expect(est.saldo_inicial).toBe(250);
    expect(est.saldo_final).toBe(350);
  });

  it("cada abono del día conserva su propio saldo posterior", () => {
    const est = construirEstadoCuentaPlanta(
      { saldo_anterior: 300 },
      [abono({ monto: 100 }), abono({ monto: 50 })],
      null,
      null
    );
    const abonos = est.dias[0].abonos;
    expect(abonos).toHaveLength(2);
    expect(abonos[0].saldo_posterior).toBe(200);
    expect(abonos[1].saldo_posterior).toBe(150);
    expect(est.saldo_final).toBe(150);
  });

  it("los movimientos anulados no cuentan", () => {
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [
        venta({ monto: 180, tipo_pago: "Credito" }),
        venta({ monto: 999, tipo_pago: "Credito", anulado: true, anulacion_motivo: "error" }),
      ],
      null,
      null
    );
    expect(est.saldo_final).toBe(180);
    expect(est.dias).toHaveLength(1);
  });

  it("el saldo inicial arrastra lo anterior al período (caso Cabezón Acopio)", () => {
    // 05/08 se lleva S/ 180 a crédito; 07/08 otros S/ 40.20. Mirando SOLO el
    // 07/08, el saldo tiene que arrancar en 180 y cerrar en 220.20.
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [
        venta({
          monto: 180,
          tipo_pago: "Credito",
          fecha: "2026-08-05",
          created_at: "2026-08-05T09:00:00Z",
        }),
        venta({
          monto: 40.2,
          tipo_pago: "Credito",
          fecha: "2026-08-07",
          created_at: "2026-08-07T09:00:00Z",
        }),
      ],
      "2026-08-07",
      null
    );
    expect(est.saldo_inicial).toBe(180);
    expect(est.dias).toHaveLength(1);
    expect(est.saldo_final).toBe(220.2);
  });

  it("un tope pasado da el saldo REAL a esa fecha, no el de hoy", () => {
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [
        venta({
          monto: 180,
          tipo_pago: "Credito",
          fecha: "2026-08-05",
          created_at: "2026-08-05T09:00:00Z",
        }),
        venta({
          monto: 40.2,
          tipo_pago: "Credito",
          fecha: "2026-08-07",
          created_at: "2026-08-07T09:00:00Z",
        }),
      ],
      null,
      "2026-08-05"
    );
    expect(est.saldo_final).toBe(180);
  });

  it("los días salen en orden ascendente aunque el historial venga al revés", () => {
    const est = construirEstadoCuentaPlanta(
      SIN_SALDO_PREVIO,
      [
        venta({
          monto: 40.2,
          tipo_pago: "Credito",
          fecha: "2026-08-07",
          created_at: "2026-08-07T09:00:00Z",
        }),
        venta({
          monto: 180,
          tipo_pago: "Credito",
          fecha: "2026-08-05",
          created_at: "2026-08-05T09:00:00Z",
        }),
      ],
      null,
      null
    );
    expect(est.dias.map((d) => d.fecha)).toEqual(["2026-08-05", "2026-08-07"]);
    expect(est.dias[1].saldo_anterior).toBe(180);
  });

  it("un abono que deja saldo a favor da negativo", () => {
    const est = construirEstadoCuentaPlanta(
      { saldo_anterior: 50 },
      [abono({ monto: 80 })],
      null,
      null
    );
    expect(est.saldo_final).toBe(-30);
  });
});

import { describe, expect, it } from "vitest";
import { construirFilasEstadoCuentaPlanta } from "@/lib/reportes/pdf-estado-cuenta-planta";
import type { DiaEstadoCuentaPlanta } from "@/lib/planta/estado-cuenta";
import type { ItemMovimientoPlanta } from "@/lib/planta/types";

// Índices de las columnas que se aserta.
const CONCEPTO = 1;
const PRODUCTO = 2;
const MONTO = 3;
const SALDO_ANTERIOR = 4;
const SALDO_ACTUAL = 6;

function item(nombre: string, cant: number, precio: number, unidad = "kg"): ItemMovimientoPlanta {
  return {
    pedido_id: "pedido-prueba",
    producto_nombre: nombre,
    cantidad: cant,
    unidad,
    precio_unitario: precio,
    subtotal: Math.round(cant * precio * 100) / 100,
  };
}

function dia(
  over: Partial<DiaEstadoCuentaPlanta> & { items?: ItemMovimientoPlanta[] }
): DiaEstadoCuentaPlanta {
  const items = over.items ?? [];
  const credito = over.venta_credito ?? items.reduce((a, it) => a + it.subtotal, 0);
  return {
    fecha: "2026-08-07",
    abonos: [],
    abonos_del_dia: 0,
    venta_contado: 0,
    saldo_anterior: 180,
    saldo_actual: 180 + credito,
    hay_venta: items.length > 0 || credito > 0,
    hay_abono: false,
    ...over,
    items,
    venta_credito: credito,
  } as DiaEstadoCuentaPlanta;
}

const aNumero = (s: string) => Number(s.replace("S/", "").replace(/,/g, "").replace("-", "").trim());

describe("construirFilasEstadoCuentaPlanta", () => {
  it("da una fila por producto, cada una con SU importe", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [dia({ items: [item("Menudencia Mixta", 9, 5), item("Alas", 2, 10.4)] })],
      true
    );
    expect(body).toHaveLength(3); // 2 productos + total
    expect(body[0][PRODUCTO]).toBe("Menudencia Mixta — 9 kg × S/ 5.00");
    expect(body[1][MONTO]).toBe("S/ 20.80");
  });

  it("cierra el día con el TOTAL A CRÉDITO y ahí van los saldos", () => {
    const { body, filasTotal } = construirFilasEstadoCuentaPlanta(
      [dia({ items: [item("Menudencia Mixta", 9, 5), item("Alas", 2, 10.4)] })],
      true
    );
    const total = body[2];
    expect(total[PRODUCTO]).toBe("TOTAL DEL DÍA A CRÉDITO");
    expect(total[SALDO_ANTERIOR]).toBe("S/ 180.00");
    expect(total[SALDO_ACTUAL]).toBe("S/ 245.80");
    expect(filasTotal.has(2)).toBe(true);
    // Las filas de producto no repiten saldos.
    expect(body[0][SALDO_ANTERIOR]).toBe("");
    expect(body[0][SALDO_ACTUAL]).toBe("");
  });

  it("los importes de los productos suman EXACTO el total del día", () => {
    const items = [item("Menudencia Mixta", 9, 5), item("Alas", 2, 10.4), item("Molleja", 3, 11.9)];
    const { body } = construirFilasEstadoCuentaPlanta([dia({ items })], true);
    const suma = items.reduce((a, it) => a + it.subtotal, 0);
    expect(suma).toBeCloseTo(aNumero(body[3][MONTO]), 2);
  });

  it("un día de solo abono es una sola fila, sin monto", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [dia({ items: [], venta_credito: 0, hay_abono: true, abonos_del_dia: 50, saldo_actual: 130 })],
      true
    );
    expect(body).toHaveLength(1);
    expect(body[0][PRODUCTO]).toBe("");
    expect(body[0][MONTO]).toBe("");
    expect(body[0][CONCEPTO]).toBe("Abono");
  });

  it("el contado se anota aparte y NO mueve el saldo", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [
        dia({
          items: [item("Alas", 2, 10.4)],
          venta_credito: 0,
          venta_contado: 20.8,
          saldo_actual: 180,
        }),
      ],
      true
    );
    // producto + "Pagado al contado" + total
    expect(body).toHaveLength(3);
    expect(body[1][PRODUCTO]).toBe("Pagado al contado (no suma a la deuda)");
    expect(body[2][MONTO]).toBe("S/ 0.00");
    expect(body[2][SALDO_ACTUAL]).toBe("S/ 180.00");
    expect(body[0][CONCEPTO]).toBe("Contado");
  });

  it("un día mixto etiqueta las dos formas de pago", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [
        dia({
          items: [item("Alas", 2, 10.4), item("Molleja", 1, 11.9)],
          venta_credito: 11.9,
          venta_contado: 20.8,
          saldo_actual: 191.9,
        }),
      ],
      true
    );
    expect(body[0][CONCEPTO]).toBe("Crédito + Contado");
  });

  it("si el total no cuadra con los productos, lo muestra como Ajuste", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [dia({ items: [item("Alas", 2, 10.4)], venta_credito: 100, saldo_actual: 280 })],
      true
    );
    // producto + Ajuste + total
    expect(body).toHaveLength(3);
    expect(body[1][PRODUCTO]).toBe("Ajuste");
    expect(body[1][MONTO]).toBe("S/ 79.20");
  });

  it("sin precios muestra solo la cantidad, pero el importe sigue", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [dia({ items: [item("Alas", 2, 10.4), item("Molleja", 1, 11.9)] })],
      false
    );
    expect(body[0][PRODUCTO]).toBe("Alas — 2 kg");
    expect(body[0][MONTO]).toBe("S/ 20.80");
  });

  it("respeta la unidad de cada línea (kg vs uni)", () => {
    const { body } = construirFilasEstadoCuentaPlanta(
      [dia({ items: [item("Pollo Brasa", 3, 11.9, "uni"), item("Alas", 2, 10.4)] })],
      true
    );
    expect(body[0][PRODUCTO]).toBe("Pollo Brasa — 3 uni × S/ 11.90");
    expect(body[1][PRODUCTO]).toBe("Alas — 2 kg × S/ 10.40");
  });

  it("varios días se apilan sin pisarse los índices de total", () => {
    const { body, filasTotal } = construirFilasEstadoCuentaPlanta(
      [
        dia({ fecha: "2026-08-05", items: [item("Alas", 2, 10.4)] }),
        dia({ fecha: "2026-08-07", items: [item("Molleja", 1, 11.9), item("Alas", 1, 10.4)] }),
      ],
      true
    );
    // día 1: 1 producto + total = 2 · día 2: 2 productos + total = 3
    expect(body).toHaveLength(5);
    expect([...filasTotal]).toEqual([1, 4]);
    expect(body[0][0]).toBe("05/08/2026");
    expect(body[2][0]).toBe("07/08/2026");
    expect(body[3][0]).toBe("");
  });
});

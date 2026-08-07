import { describe, expect, it } from "vitest";
import { construirFilasEstadoCuenta } from "./pdf-estado-cuenta-avicola";
import type { DiaEstadoCuenta } from "@/lib/avicola/estado-cuenta";

/** Columnas de la tabla del PDF. */
const PRODUCTO = 2;
const MONTO = 3;
const SALDO_ANTERIOR = 4;
const SALDO_ACTUAL = 6;

type ItemPrueba = DiaEstadoCuenta["items"][number];

function item(nombre: string, peso: number, precio: number): ItemPrueba {
  return {
    id: `${nombre}-${peso}`,
    venta_id: "venta-prueba",
    producto_id: `prod-${nombre}`,
    producto_nombre: nombre,
    peso_kg: peso,
    precio_kg: precio,
    subtotal: Math.round(peso * precio * 100) / 100,
  } as ItemPrueba;
}

function dia(over: Partial<DiaEstadoCuenta> & { items?: ItemPrueba[] }): DiaEstadoCuenta {
  const items = over.items ?? [];
  const venta = over.venta_del_dia ?? items.reduce((a, it) => a + it.subtotal, 0);
  return {
    fecha: "2026-07-26",
    guias: [445],
    abonos: [],
    abonos_del_dia: 0,
    saldo_anterior: 418.8,
    saldo_actual: 418.8 + venta,
    hay_venta: items.length > 0 || venta > 0,
    hay_abono: false,
    ...over,
    items,
    venta_del_dia: venta,
  } as DiaEstadoCuenta;
}

describe("construirFilasEstadoCuenta", () => {
  it("da una fila por producto, cada una con SU importe", () => {
    const { body } = construirFilasEstadoCuenta(
      [dia({ items: [item("Alas", 8, 12), item("Filetes de pierna", 12, 12)] })],
      true
    );
    // 2 productos + la fila de total
    expect(body).toHaveLength(3);
    expect(body[0][PRODUCTO]).toBe("Alas — 8 kg × S/ 12.00");
    expect(body[0][MONTO]).toBe("S/ 96.00");
    expect(body[1][PRODUCTO]).toBe("Filetes de pierna — 12 kg × S/ 12.00");
    expect(body[1][MONTO]).toBe("S/ 144.00");
  });

  it("cierra el día con el TOTAL y ahí van los saldos", () => {
    const { body, filasTotal } = construirFilasEstadoCuenta(
      [dia({ items: [item("Alas", 8, 12), item("Menudencia Mixta", 4, 12)] })],
      true
    );
    const total = body[2];
    expect(total[PRODUCTO]).toBe("TOTAL DEL DÍA");
    expect(total[MONTO]).toBe("S/ 144.00"); // 96 + 48
    expect(total[SALDO_ANTERIOR]).toBe("S/ 418.80");
    expect(total[SALDO_ACTUAL]).toBe("S/ 562.80");
    expect(filasTotal.has(2)).toBe(true);
    // Las filas de producto NO repiten los saldos del día.
    expect(body[0][SALDO_ANTERIOR]).toBe("");
    expect(body[0][SALDO_ACTUAL]).toBe("");
  });

  it("los importes de los productos suman EXACTO el total", () => {
    const items = [item("Alas", 8, 12), item("Gallina colorada o roja", 22, 12), item("Menudencia Mixta", 4, 12)];
    const { body } = construirFilasEstadoCuenta([dia({ items })], true);
    const aNumero = (s: string) => Number(s.replace("S/", "").replace(/,/g, "").trim());
    const suma = items.map((_, i) => aNumero(body[i][MONTO])).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(aNumero(body[3][MONTO]), 2);
  });

  it("un solo producto NO repite el total en otra fila", () => {
    const { body, filasTotal } = construirFilasEstadoCuenta(
      [dia({ items: [item("Asado de tira de res", 12, 34.9)], guias: [3] })],
      true
    );
    expect(body).toHaveLength(1);
    expect(filasTotal.size).toBe(0);
    expect(body[0][MONTO]).toBe("S/ 418.80");
    expect(body[0][SALDO_ACTUAL]).toBe("S/ 837.60");
  });

  it("un día de solo abono sigue siendo una fila", () => {
    const { body } = construirFilasEstadoCuenta(
      [dia({ items: [], guias: [], hay_venta: false, hay_abono: true, venta_del_dia: 0 })],
      true
    );
    expect(body).toHaveLength(1);
    expect(body[0][PRODUCTO]).toBe("");
    expect(body[0][MONTO]).toBe("");
  });

  it("si el total no cuadra con los productos, lo muestra como Ajuste (no lo esconde)", () => {
    // Caso real encontrado en dev-hugo: 5 ítems suman 945.60 y el total dice 1200.
    const items = [
      item("Alas", 8, 12),
      item("Filetes de pierna", 12, 12),
      item("Gallina colorada o roja", 22, 12),
      item("Gallina doble pechuga", 32.8, 12),
      item("Menudencia Mixta", 4, 12),
    ];
    const { body } = construirFilasEstadoCuenta([dia({ items, venta_del_dia: 1200 })], true);
    // 5 productos + ajuste + total
    expect(body).toHaveLength(7);
    expect(body[5][PRODUCTO]).toBe("Ajuste");
    expect(body[5][MONTO]).toBe("S/ 254.40");
    expect(body[6][MONTO]).toBe("S/ 1,200.00");
  });

  it("sin precios (opción conPrecio=false) muestra solo el peso", () => {
    const { body } = construirFilasEstadoCuenta([dia({ items: [item("Alas", 8, 12)] })], false);
    expect(body[0][PRODUCTO]).toBe("Alas — 8 kg");
    // El importe SÍ se muestra: es lo que el cliente necesita para revisar.
    expect(body[0][MONTO]).toBe("S/ 96.00");
  });

  it("varios días se apilan sin pisarse los índices de total", () => {
    const { body, filasTotal } = construirFilasEstadoCuenta(
      [
        dia({ fecha: "2026-07-09", guias: [3], items: [item("Asado de tira de res", 12, 34.9)] }),
        dia({ fecha: "2026-07-26", items: [item("Alas", 8, 12), item("Menudencia Mixta", 4, 12)] }),
      ],
      true
    );
    // 1 (día simple) + 2 productos + 1 total
    expect(body).toHaveLength(4);
    expect([...filasTotal]).toEqual([3]);
    expect(body[0][0]).toBe("09/07/2026");
    expect(body[1][0]).toBe("26/07/2026");
    // La segunda fila del bloque ya no repite la fecha.
    expect(body[2][0]).toBe("");
  });
});

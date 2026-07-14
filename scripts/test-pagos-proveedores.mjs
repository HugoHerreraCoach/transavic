import assert from "node:assert/strict";
import {
  construirEstadoCuentaProveedor,
  construirMovimientosProveedor,
} from "../src/lib/proveedores/estado-cuenta.ts";
import { distribuirPagoProveedor } from "../src/lib/proveedores/distribucion.ts";

const base = {
  documento: null,
  cuenta_nombre: null,
  notas: null,
  items: [],
  aplicaciones: [],
};

// Tres pagos del mismo dia deben conservar tres filas y su orden de registro.
const movimientos = [
  {
    ...base,
    id: "deuda-1",
    tipo: "deuda",
    fecha: "2026-07-13",
    created_at: "2026-07-13T08:00:00-05:00",
    monto: 1000,
    concepto: "Compra",
  },
  ...[100, 200, 300].map((monto, i) => ({
    ...base,
    id: `pago-${i + 1}`,
    tipo: "pago",
    fecha: "2026-07-13",
    created_at: `2026-07-13T${String(9 + i).padStart(2, "0")}:00:00-05:00`,
    monto,
    concepto: "Pago",
    cuenta_nombre: "BBVA",
  })),
];
const estado = construirEstadoCuentaProveedor(movimientos);
assert.deepEqual(
  estado.movimientos.filter((m) => m.tipo === "pago").map((m) => m.id),
  ["pago-1", "pago-2", "pago-3"]
);
assert.equal(estado.total_pagado, 600);
assert.equal(estado.deuda_pendiente, 400);

// El pago grande se aplica a varias deudas y el excedente queda como anticipo.
const distribucion = distribuirPagoProveedor(
  18_500,
  [
    { id: "reciente", saldo: 1000, fecha_vencimiento: "2026-08-01", created_at: "2026-07-02" },
    { id: "prioritaria", saldo: 3636.81, fecha_vencimiento: "2026-09-01", created_at: "2026-07-03" },
  ],
  "prioritaria"
);
assert.deepEqual(distribucion.aplicaciones, [
  { deuda_id: "prioritaria", monto: 3636.81 },
  { deuda_id: "reciente", monto: 1000 },
]);
assert.equal(distribucion.saldo_favor, 13_863.19);

const soloUnaDeuda = distribuirPagoProveedor(18_500, [
  { id: "guia", saldo: 3636.81, fecha_vencimiento: "2026-07-20", created_at: "2026-07-01" },
]);
assert.equal(soloUnaDeuda.aplicaciones[0].monto, 3636.81);
assert.equal(soloUnaDeuda.saldo_favor, 14_863.19);

// El filtro calcula un saldo inicial real y no colapsa pagos del periodo.
const periodo = construirEstadoCuentaProveedor(movimientos, "2026-07-14", "2026-07-14");
assert.equal(periodo.saldo_inicial, 400);
assert.equal(periodo.movimientos.length, 0);
assert.equal(periodo.saldo_final, 400);

// Una anulacion conserva el pago original y muestra el contraasiento. El neto
// vuelve a cero sin borrar ninguna fila del historial financiero.
const movimientosAnulados = [
  {
    ...base,
    id: "deuda-anulada",
    tipo: "deuda",
    fecha: "2026-07-13",
    created_at: "2026-07-13T08:00:00-05:00",
    monto: 100,
    concepto: "Compra",
  },
  {
    ...base,
    id: "pago-anulado",
    tipo: "pago",
    fecha: "2026-07-13",
    created_at: "2026-07-13T09:00:00-05:00",
    monto: 100,
    concepto: "Pago al proveedor",
    cuenta_nombre: "BBVA",
  },
  {
    ...base,
    id: "pago-anulado-contraasiento",
    tipo: "contraasiento",
    fecha: "2026-07-14",
    created_at: "2026-07-14T10:00:00-05:00",
    monto: 100,
    concepto: "Contraasiento de pago anulado",
    cuenta_nombre: "BBVA",
    notas: "Referencia incorrecta",
  },
];
const estadoAnulado = construirEstadoCuentaProveedor(movimientosAnulados);
assert.deepEqual(
  estadoAnulado.movimientos.map((m) => m.tipo),
  ["deuda", "pago", "contraasiento"]
);
assert.equal(estadoAnulado.total_comprado, 100);
assert.equal(estadoAnulado.total_pagado, 0);
assert.equal(estadoAnulado.saldo_final, 100);

const periodoContraasiento = construirEstadoCuentaProveedor(
  movimientosAnulados,
  "2026-07-14",
  "2026-07-14"
);
assert.equal(periodoContraasiento.saldo_inicial, 0);
assert.equal(periodoContraasiento.total_pagado, -100);
assert.equal(periodoContraasiento.saldo_final, 100);
assert.equal(periodoContraasiento.movimientos[0].tipo, "contraasiento");

// La misma transformación usada por GET /ficha debe crear automáticamente las
// dos evidencias de un pago anulado; el consumidor no las fabrica manualmente.
const movimientosDesdeFicha = construirMovimientosProveedor([], [
  {
    id: "pago-ficha-anulado",
    fecha: "2026-07-13",
    monto: 100,
    notas: "Operacion 123",
    estado: "anulado",
    cuenta_nombre: "BBVA",
    registrado_por: "Admin",
    created_at: "2026-07-13T09:00:00-05:00",
    motivo_anulacion: "Referencia incorrecta",
    anulado_at: "2026-07-14T10:00:00-05:00",
    total_aplicado: 100,
    saldo_anticipo: 0,
    aplicaciones: [],
  },
]);
assert.deepEqual(
  movimientosDesdeFicha.map((m) => [m.tipo, m.fecha, m.monto]),
  [
    ["pago", "2026-07-13", 100],
    ["contraasiento", "2026-07-14", 100],
  ]
);
assert.equal(movimientosDesdeFicha[1].notas, "Referencia incorrecta");

console.log("OK: pagos, anticipos y estado de cuenta de proveedores");

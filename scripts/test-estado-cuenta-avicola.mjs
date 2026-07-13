import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const outDir = join(root, ".tmp", "estado-cuenta-avicola-test");
const sourcePath = join(root, "src/lib/avicola/estado-cuenta.ts");
const destPath = join(outDir, "estado-cuenta.js");

await rm(outDir, { recursive: true, force: true });
const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    strict: true,
  },
  fileName: sourcePath,
}).outputText;
await mkdir(dirname(destPath), { recursive: true });
await writeFile(destPath, transpiled);

const { construirEstadoCuenta } = require(destPath);
const fecha = "2026-07-12";
const base = {
  fecha,
  numero_guia: null,
  observaciones: null,
  anulado: false,
  anulacion_motivo: null,
  tiene_comprobante: false,
  creado_por_nombre: "Antonio",
};
const historial = [
  {
    ...base,
    tipo: "venta",
    id: "venta-1",
    created_at: "2026-07-12T13:00:00.000Z", // 08:00 Lima
    monto: 60,
    numero_guia: 1,
    medio_pago: null,
    items: [],
  },
  {
    ...base,
    tipo: "abono",
    id: "abono-1",
    created_at: "2026-07-12T14:05:00.000Z", // 09:05 Lima
    monto: 10,
    medio_pago: "efectivo",
    observaciones: "Primer pago",
  },
  {
    ...base,
    tipo: "abono",
    id: "abono-2",
    created_at: "2026-07-12T17:30:00.000Z", // 12:30 Lima
    monto: 20,
    medio_pago: "yape",
    observaciones: "Segundo pago",
  },
  {
    ...base,
    tipo: "abono",
    id: "abono-3",
    created_at: "2026-07-12T22:45:00.000Z", // 17:45 Lima
    monto: 30,
    medio_pago: "transferencia",
    observaciones: "Tercer pago",
  },
  {
    ...base,
    tipo: "abono",
    id: "abono-anulado",
    created_at: "2026-07-12T23:00:00.000Z",
    monto: 999,
    medio_pago: "otro",
    anulado: true,
    anulacion_motivo: "Registro duplicado",
  },
];

// El helper recibe el historial DESC desde la API; debe ordenar por created_at.
const estado = construirEstadoCuenta({ saldo_anterior: 100 }, [...historial].reverse(), null, null);
assert.equal(estado.dias.length, 1);
assert.equal(estado.total_vendido, 60);
assert.equal(estado.total_abonado, 60);
assert.equal(estado.saldo_final, 100);

const dia = estado.dias[0];
assert.equal(dia.abonos_del_dia, 60, "el total diario se conserva");
assert.equal(dia.abonos.length, 3, "cada abono activo debe conservarse por separado");
assert.deepEqual(
  dia.abonos.map((a) => [a.id, a.monto, a.medio_pago, a.saldo_posterior]),
  [
    ["abono-1", 10, "efectivo", 150],
    ["abono-2", 20, "yape", 130],
    ["abono-3", 30, "transferencia", 100],
  ]
);

console.log("Estado de cuenta Avícola: 3 abonos separados OK");

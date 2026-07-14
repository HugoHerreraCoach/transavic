import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const outDir = join(root, ".tmp", "pos-detalle-costos-test");
const sourcePath = join(root, "src/lib/planta/ventas-pos.ts");
const destPath = join(outDir, "ventas-pos.js");

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

const {
  normalizarVentaConDetallePos,
  resumirCostosVentaPos,
  subtotalVentaPos,
  totalVentaPos,
} = require(destPath);

assert.equal(subtotalVentaPos(1.23, 8.9), 10.95);
assert.equal(
  totalVentaPos([
    { cantidad: 1.23, precioUnitario: 8.9 },
    { cantidad: 1.23, precioUnitario: 8.9 },
  ]),
  21.9,
  "el cobro debe sumar los subtotales redondeados por fila"
);

// Kilos y unidades conservan cantidad, precio, subtotal de venta y costo histórico.
const completa = normalizarVentaConDetallePos({
  total: "69.20",
  items: [
    {
      producto_nombre: "Pechuga",
      cantidad: "2.50",
      unidad: "kg",
      precio_unitario: "20.00",
      subtotal_venta: "50.00",
      costo_unitario: "12.40",
      subtotal_costo: "31.00",
      // Debe ignorarse: el contrato solo usa el snapshot de la venta.
      precio_compra_actual: "99.00",
    },
    {
      producto_nombre: "Huevos",
      cantidad: 2,
      unidad: "plancha",
      precio_unitario: 9.6,
      subtotal_venta: 19.2,
      costo_unitario: 7.55,
      subtotal_costo: 15.1,
    },
  ],
});
assert.equal(completa.total, 69.2);
assert.equal(completa.items[0].cantidad, 2.5);
assert.equal(completa.items[1].unidad, "plancha");
assert.equal(completa.costo_completo, true);
assert.equal(completa.costo_total, 46.1);

// Cambiar el catálogo no altera lo ya capturado: solo cuenta costo_unitario.
assert.equal(completa.items[0].costo_unitario, 12.4);
assert.equal(completa.items[0].subtotal_costo, 31);

// Históricos sin evidencia no inventan S/ 0 ni usan el costo actual.
const incompleta = normalizarVentaConDetallePos({
  total: 20,
  items: [
    {
      producto_nombre: "Alas",
      cantidad: 2,
      unidad: "kg",
      precio_unitario: 10,
      subtotal_venta: 20,
      costo_unitario: null,
      subtotal_costo: null,
      precio_compra_actual: 8,
    },
  ],
});
assert.equal(incompleta.items[0].costo_unitario, null);
assert.equal(incompleta.items[0].subtotal_costo, null);
assert.equal(incompleta.costo_completo, false);
assert.equal(incompleta.costo_total, null);
assert.deepEqual(resumirCostosVentaPos([]), {
  costo_completo: false,
  costo_total: null,
});

// Contratos de persistencia/API: snapshots server-side y tipo de pago histórico.
const postRoute = await readFile(join(root, "src/app/api/pos/route.ts"), "utf8");
assert.match(postRoute, /costo_unitario_snapshot/);
assert.match(
  postRoute,
  /SELECT p\.precio_compra FROM productos p WHERE p\.id/,
  "el costo debe leerse del catálogo en el INSERT transaccional"
);
assert.doesNotMatch(
  postRoute.match(/const PosItemSchema[\s\S]*?const PosSaleSchema/)?.[0] ?? "",
  /costo/i,
  "el cliente POS no debe poder enviar el costo"
);

for (const rel of [
  "src/app/api/pos/resumen-dia/route.ts",
  "src/app/api/pos/ventas/route.ts",
]) {
  const route = await readFile(join(root, rel), "utf8");
  assert.match(route, /\["admin", "produccion"\]/, `${rel} debe mantener permisos restringidos`);
  assert.match(route, /costo_unitario_snapshot/, `${rel} debe leer el snapshot`);
  assert.match(
    route,
    /EXISTS \([\s\S]*?FROM cobranzas_planta cpx WHERE cpx\.pedido_id = p\.id/,
    `${rel} debe conservar el tipo de pago original incluso si la cobranza fue anulada`
  );
}

const resumenRoute = await readFile(
  join(root, "src/app/api/pos/resumen-dia/route.ts"),
  "utf8"
);
assert.match(
  resumenRoute,
  /const totalVentaRows[\s\S]*?FROM pedidos p[\s\S]*?LEFT JOIN pedido_items/,
  "el total vendido debe venir de pedidos e ítems, no de movimientos financieros"
);
assert.match(
  resumenRoute,
  /cob\.monto - COALESCE\(SUM\(ab\.monto\) FILTER \(WHERE NOT ab\.anulado\), 0\)/,
  "por cobrar debe representar el saldo vigente, no el monto bruto original"
);

const posUi = await readFile(
  join(root, "src/app/dashboard/pos-planta/pos-client.tsx"),
  "utf8"
);
const historialUi = await readFile(
  join(root, "src/app/dashboard/pos-planta/ventas/ventas-planta-client.tsx"),
  "utf8"
);
assert.doesNotMatch(posUi, /Crédito · Por cobrar/);
assert.doesNotMatch(historialUi, /Crédito · Por cobrar/);

const migration = await readFile(
  join(root, "scripts/migrate-pos-costo-snapshot-2026-07-13.sql"),
  "utf8"
);
const rollback = await readFile(
  join(root, "scripts/rollback-pos-costo-snapshot-2026-07-13.sql"),
  "utf8"
);
assert.match(migration, /ADD COLUMN IF NOT EXISTS costo_unitario_snapshot NUMERIC\(10,2\)/);
assert.match(rollback, /DROP COLUMN IF EXISTS costo_unitario_snapshot/);

console.log("POS Planta: detalle, costo histórico y contratos de API OK");

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const outDir = join(root, ".tmp", "ventas-ejecutivas-test");
const helperPath = join(root, "src/lib/ventas-generales.ts");
const destPath = join(outDir, "ventas-generales.js");
const idempotenciaPath = join(root, "src/lib/pedidos-idempotencia.ts");
const idempotenciaDest = join(outDir, "pedidos-idempotencia.js");

await rm(outDir, { recursive: true, force: true });
const source = await readFile(helperPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true, strict: true }, fileName: helperPath,
}).outputText;
await mkdir(dirname(destPath), { recursive: true });
await writeFile(destPath, transpiled);
const idempotenciaSource = await readFile(idempotenciaPath, "utf8");
const idempotenciaTranspiled = ts.transpileModule(idempotenciaSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true, strict: true }, fileName: idempotenciaPath,
}).outputText;
await writeFile(idempotenciaDest, idempotenciaTranspiled);

const { resumenVentasGeneralesPorFecha } = require(destPath);
const {
  claveItemPedido,
  decimalCanonicoNullable,
  redondearDecimalPedido,
} = require(idempotenciaDest);
const consultas = [];
const detallesFixture = [
  ...Array.from({ length: 23 }, (_, indice) => ({
    id: `pedido-confirmado-${indice}`,
    cliente: `Cliente ${indice + 1}`,
    asesor: "Ejecutiva 1",
    createdAt: "2026-07-12 09:15",
    fechaEntrega: "2026-07-13",
    estadoPedido: "Listo_Para_Despacho",
    numeroGuia: 100 + indice,
    monto: indice < 22 ? "400.00" : "862.39",
    estadoValoracion: "confirmada",
    itemsPendientes: 0,
  })),
  ...Array.from({ length: 4 }, (_, indice) => ({
    id: `pedido-pendiente-${indice}`,
    cliente: `Cliente pendiente ${indice + 1}`,
    asesor: "Ejecutiva 2",
    createdAt: "2026-07-12 10:30",
    fechaEntrega: "2026-07-14",
    estadoPedido: "Pendiente",
    numeroGuia: null,
    monto: null,
    estadoValoracion: "por_valorizar",
    itemsPendientes: 2,
  })),
];
const sqlFalso = async (strings, ...values) => {
  consultas.push({ texto: strings.join("?"), values });
  return [{
    operaciones: {
      ejecutivas: { total: "9662.39", ventas: 27, ventasValorizadas: 23, ventasPorValorizar: 4 },
      campo: { total: "8994.98", ventas: 18, ventasValorizadas: 18, ventasPorValorizar: 0 },
      planta: { total: "23.20", ventas: 2, ventasValorizadas: 2, ventasPorValorizar: 0 },
    },
    detalle_ejecutivas: detallesFixture,
    total: "18680.57", total_ventas: 47,
  }];
};

const resumen = await resumenVentasGeneralesPorFecha(sqlFalso, "2026-07-12");
assert.equal(consultas.length, 1, "resumen y detalle deben salir de una sola consulta");
assert.deepEqual(resumen.operaciones.ejecutivas,
  { total: 9662.39, ventas: 27, ventasValorizadas: 23, ventasPorValorizar: 4 });
assert.equal(resumen.detalleEjecutivas.length, 27);
assert.equal(resumen.detalleEjecutivas[0].monto, 400);
assert.equal(resumen.detalleEjecutivas[23].monto, null);
assert.equal(resumen.detalleEjecutivas[23].estadoValoracion, "por_valorizar");
assert.equal(
  resumen.detalleEjecutivas.reduce((suma, venta) => suma + (venta.monto ?? 0), 0),
  resumen.operaciones.ejecutivas.total,
  "el detalle visible debe sumar exactamente la tarjeta"
);
assert.equal(resumen.total, 18680.57);

// Un replay usa la misma representación que NUMERIC(10,8)/(10,2), aunque el
// navegador haya enviado más decimales que PostgreSQL puede conservar.
assert.equal(redondearDecimalPedido(-12.046374019, 8), -12.04637402);
assert.equal(
  decimalCanonicoNullable(-77.042793819, 8),
  decimalCanonicoNullable("-77.04279382", 8)
);
const itemNavegador = {
  productoId: "producto-1",
  nombre: "Pollo entero",
  cantidad: 1.234,
  unidad: "kg",
  notas: null,
};
const itemPersistido = { ...itemNavegador, cantidad: "1.23" };
assert.equal(
  claveItemPedido(itemNavegador, true),
  claveItemPedido(itemPersistido, true),
  "el redondeo de cantidad no debe convertir un replay genuino en conflicto"
);
assert.notEqual(
  claveItemPedido(itemNavegador, true),
  claveItemPedido({ ...itemPersistido, cantidad: "1.24" }, true),
  "un payload realmente distinto sí debe detectarse"
);

assert.match(source, /COUNT\(pi\.subtotal_real\) = COUNT\(pi\.id\)/);
assert.match(source, /COALESCE\(p\.origen, 'asesor'\) IN \('asesor', 'pos_planta'\)/);
assert.match(source, /p\.estado <> 'Fallido'/);
assert.match(source, /NOT COALESCE\(p\.anulada, FALSE\)/);
assert.match(source, /p\.created_at AT TIME ZONE 'America\/Lima'/);
assert.doesNotMatch(source,
  /FROM\s+facturas|JOIN\s+facturas|FROM\s+comprobantes|JOIN\s+comprobantes/i);

const apiPedidos = await readFile(join(root, "src/app/api/pedidos/route.ts"), "utf8");
const formulario = await readFile(join(root, "src/components/PedidoForm.tsx"), "utf8");
assert.match(apiPedidos, /id: z\.string\(\)\.uuid\(\)\.optional\(\)/);
assert.match(apiPedidos, /await sql\.transaction\(queries\)/);
assert.match(apiPedidos, /dbError\.code !== "23505"/);
assert.match(apiPedidos, /INSERT INTO notificaciones/);
assert.match(formulario, /pedidoIdRef\.current = crypto\.randomUUID\(\)/);
assert.match(formulario, /id: pedidoIdRef\.current/);

const diagnostico = await readFile(
  join(root, "scripts/diagnostico-ventas-ejecutivas-duplicadas.sql"),
  "utf8"
);
assert.match(
  diagnostico,
  /\(b\.created_at, b\.id\) > \(a\.created_at, a\.id\)/,
  "los pares candidatos deben ordenarse por fecha+UUID, no por UUID aislado"
);

console.log("Ventas de Ejecutivas: conciliación e idempotencia OK");

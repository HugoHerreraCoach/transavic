import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const outDir = join(root, ".tmp", "operaciones-facturacion-test");
const fuentes = [
  "src/lib/operaciones-venta.ts",
  "src/lib/sunat/nota-credito.ts",
];

await rm(outDir, { recursive: true, force: true });
for (const rel of fuentes) {
  const sourcePath = join(root, rel);
  const destPath = join(outDir, rel.replace(/\.ts$/, ".js"));
  const source = await readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText;
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, output);
}

const operaciones = require(join(outDir, "src/lib/operaciones-venta.js"));
assert.equal(
  operaciones.operacionDeComprobante({ venta_avicola_id: "venta-campo" }),
  "campo"
);
assert.equal(
  operaciones.operacionDeComprobante({ pedido_origen: "pos_planta" }),
  "planta"
);
assert.equal(operaciones.operacionDeComprobante({}), "ejecutivas");

const notas = require(join(outDir, "src/lib/sunat/nota-credito.js"));
for (const codigo of ["01", "02", "06"]) {
  const xml = `<CreditNote><cbc:ResponseCode>${codigo}</cbc:ResponseCode></CreditNote>`;
  assert.equal(notas.codigoNotaCreditoDesdeXml(xml), codigo);
  assert.equal(notas.esNotaCreditoTotalXml(xml), true);
  assert.equal(
    notas.esNotaCreditoTotalBase64(Buffer.from(xml).toString("base64")),
    true
  );
}
assert.equal(
  notas.esNotaCreditoTotalXml(
    "<CreditNote><cbc:ResponseCode>03</cbc:ResponseCode></CreditNote>"
  ),
  false,
  "una corrección parcial no debe anular toda la cartera"
);
assert.equal(notas.esNotaCreditoTotalBase64("no-es-base64"), false);

console.log("Operaciones y NC totales: pruebas OK");

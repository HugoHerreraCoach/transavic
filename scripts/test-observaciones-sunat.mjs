import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = process.cwd();
const outDir = join(root, ".tmp", "observaciones-sunat-test");

const sourceFiles = [
  "src/lib/sunat/types.ts",
  "src/lib/sunat/config-transavic.ts",
  "src/lib/sunat/observaciones.ts",
  "src/lib/sunat/xml-builder.ts",
  "src/lib/sunat/xml-builder-guia.ts",
  "src/lib/sunat/parse-cpe-items.ts",
];

async function transpileSources() {
  await rm(outDir, { recursive: true, force: true });
  for (const rel of sourceFiles) {
    const sourcePath = join(root, rel);
    const destPath = join(outDir, rel.replace(/\.ts$/, ".js"));
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
  }
}

function compiled(rel) {
  return require(join(outDir, rel.replace(/\.ts$/, ".js")));
}

function configPrueba() {
  return {
    environment: "beta",
    empresa: "transavic",
    ruc: "20123456789",
    razonSocial: "TRANSAVIC SAC",
    nombreComercial: "Transavic",
    direccion: "AV. PRUEBA 123",
    ubigeo: "150101",
    departamento: "LIMA",
    provincia: "LIMA",
    distrito: "LIMA",
    urbanizacion: "",
    codigoPais: "PE",
    solUser: "MODDATOS",
    solPassword: "moddatos",
    clientId: "",
    clientSecret: "",
    certificatePath: "",
    certificatePassword: "",
    certificateBase64: "",
    endpoints: { factura: "", guia: "", consultaCdr: "" },
  };
}

await transpileSources();

const {
  MAX_OBSERVACION_CPE,
  MAX_OBSERVACION_GRE,
  normalizarObservacionSunat,
} = compiled("src/lib/sunat/observaciones.ts");
const {
  TipoAfectacionIGV,
  TipoComprobante,
  TipoDocumentoIdentidad,
  TipoOperacion,
} = compiled("src/lib/sunat/types.ts");
const { generarXMLComprobante } = compiled("src/lib/sunat/xml-builder.ts");
const { generarXMLGuia } = compiled("src/lib/sunat/xml-builder-guia.ts");
const {
  parseCpeObservacion,
  parseGuiaObservacion,
} = compiled("src/lib/sunat/parse-cpe-items.ts");

assert.equal(MAX_OBSERVACION_CPE, 200);
assert.equal(MAX_OBSERVACION_GRE, 250);

assert.equal(
  normalizarObservacionSunat("  Entregar\nen puerta\tazul  ", MAX_OBSERVACION_CPE),
  "Entregar en puerta azul"
);
assert.equal(normalizarObservacionSunat("    ", MAX_OBSERVACION_CPE), null);
assert.throws(
  () => normalizarObservacionSunat("x".repeat(MAX_OBSERVACION_CPE + 1), MAX_OBSERVACION_CPE),
  /200/
);

const observacion = "Entregar en puerta azul";
const xmlFactura = generarXMLComprobante(
  {
    tipoComprobante: TipoComprobante.FACTURA,
    serie: "F001",
    numero: 1,
    fechaEmision: "2026-06-21",
    horaEmision: "10:30:00",
    tipoOperacion: TipoOperacion.VENTA_INTERNA,
    moneda: "PEN",
    cliente: {
      tipoDocumento: TipoDocumentoIdentidad.RUC,
      numDocumento: "20123456789",
      razonSocial: "CLIENTE SAC",
      direccion: "CALLE CLIENTE 456",
    },
    observacionComprobante: observacion,
    items: [
      {
        codigo: "P001",
        descripcion: "POLLO ENTERO",
        unidadMedida: "KGM",
        cantidad: 1,
        precioUnitario: 10,
        tipoAfectacionIGV: TipoAfectacionIGV.GRAVADA_ONEROSA,
        porcentajeIGV: 18,
      },
    ],
  },
  configPrueba()
);

const noteMontoIdx = xmlFactura.indexOf('languageLocaleID="1000"');
const noteObsIdx = xmlFactura.indexOf(`<cbc:Note>${observacion}</cbc:Note>`);
const currencyIdx = xmlFactura.indexOf("<cbc:DocumentCurrencyCode");
assert.ok(noteMontoIdx >= 0, "debe conservar la leyenda 1000 de monto en letras");
assert.ok(noteObsIdx > noteMontoIdx, "la observación debe ir después de la leyenda 1000");
assert.ok(currencyIdx > noteObsIdx, "la observación debe ir antes de DocumentCurrencyCode");
assert.equal(
  /<cbc:Note[^>]*languageLocaleID="2012"[^>]*>/.test(xmlFactura),
  false,
  "la observación libre no debe usar un código de leyenda rechazado por beta"
);
assert.equal(parseCpeObservacion(xmlFactura), observacion);

const xmlGuia = generarXMLGuia(
  {
    serie: "T001",
    numero: 1,
    fechaEmision: "2026-06-21",
    horaEmision: "10:30:00",
    fechaInicioTraslado: "2026-06-21",
    motivoTraslado: "01",
    pesoBrutoTotal: 1,
    totalBultos: 1,
    modalidadTraslado: "02",
    indicadorM1L: true,
    observacionComprobante: observacion,
    repartidor: {
      docTipo: "1",
      docNum: "",
      licencia: "",
      nombres: "-",
      apellidos: "-",
      placa: "",
    },
    cliente: {
      tipoDocumento: "6",
      numDocumento: "20123456789",
      razonSocial: "CLIENTE SAC",
      direccion: "CALLE CLIENTE 456",
      ubigeo: "150101",
    },
    items: [
      {
        codigo: "P001",
        descripcion: "POLLO ENTERO",
        unidadMedida: "KGM",
        cantidad: 1,
      },
    ],
  },
  configPrueba()
);

const typeIdx = xmlGuia.indexOf("<cbc:DespatchAdviceTypeCode");
const guiaNoteIdx = xmlGuia.indexOf(`<cbc:Note>${observacion}</cbc:Note>`);
const signatureIdx = xmlGuia.indexOf("<cac:Signature>");
assert.ok(typeIdx >= 0, "debe existir DespatchAdviceTypeCode");
assert.ok(guiaNoteIdx > typeIdx, "la observación GRE debe ir después del tipo de documento");
assert.ok(signatureIdx > guiaNoteIdx, "la observación GRE debe ir antes de la firma");
assert.equal(parseGuiaObservacion(xmlGuia), observacion);

console.log("Observaciones SUNAT: pruebas OK");

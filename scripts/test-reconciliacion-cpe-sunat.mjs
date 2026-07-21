import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { strToU8, zipSync } = require("fflate");
const root = process.cwd();
const outDir = join(root, ".tmp", "reconciliacion-cpe-sunat-test");

const archivosRequeridosEnGit = [
  "scripts/migrate-reconciliacion-cpe-sunat-2026-07-20.sql",
  "scripts/rollback-reconciliacion-cpe-sunat-2026-07-20.sql",
  "scripts/test-reconciliacion-cpe-sunat.mjs",
  "src/lib/sunat/consulta-integrada-client.ts",
  "src/lib/sunat/efectos-aceptacion-cpe.ts",
  "src/lib/sunat/reconciliacion-cpe.ts",
  "src/app/api/comprobantes/[id]/verificar-sunat/route.ts",
  "src/app/api/cron/reconciliar-cpe-sunat/route.ts",
];

function verificarPreparacionDeDespliegue() {
  let raizGit;
  try {
    raizGit = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    assert.fail(
      "No se pudo verificar la preparación del despliegue: ejecuta esta prueba dentro de un checkout Git."
    );
  }

  const registrados = execFileSync(
    "git",
    ["ls-files", "--cached", "--", ...archivosRequeridosEnGit],
    {
      cwd: raizGit,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  const registradosSet = new Set(registrados);
  const faltantes = archivosRequeridosEnGit.filter(
    (archivo) => !registradosSet.has(archivo)
  );

  assert.equal(
    faltantes.length,
    0,
    `Preparación de despliegue incompleta: registra en Git estos archivos SUNAT:\n- ${faltantes.join(
      "\n- "
    )}`
  );
}

const fuentesEjecutables = [
  "src/lib/sunat/types.ts",
  "src/lib/sunat/config-transavic.ts",
  "src/lib/sunat/mensajes-amigables.ts",
  "src/lib/sunat/consulta-integrada-client.ts",
  "src/lib/sunat/soap-client.ts",
];

async function transpilarFuentes() {
  await rm(outDir, { recursive: true, force: true });
  for (const rel of fuentesEjecutables) {
    const sourcePath = join(root, rel);
    const destPath = join(outDir, rel.replace(/\.ts$/, ".js"));
    let source = await readFile(sourcePath, "utf8");

    // soap-client usa createRequire(import.meta.url), pero el arnes compila a
    // CommonJS para poder cargar las fuentes TypeScript sin agregar un runner.
    source = source.replaceAll("import.meta.url", "__filename");
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
}

function compiled(rel) {
  return require(join(outDir, rel.replace(/\.ts$/, ".js")));
}

function configPrueba() {
  return {
    environment: "production",
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
    consultaClientId: "consulta-test",
    consultaClientSecret: "consulta-secret",
    certificatePath: "",
    certificatePassword: "",
    certificateBase64: "",
    endpoints: {
      factura: "https://sunat.test/billService?wsdl",
      guia: "https://sunat.test/guiaService?wsdl",
      consultaCdr: "https://sunat.test/billConsultService?wsdl",
    },
  };
}

function respuestaSoap(cuerpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return cuerpo;
    },
  };
}

function faultSoap(codigo, mensaje) {
  return `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">
    <soap-env:Body><soap-env:Fault>
      <faultcode>soap-env:Client.${codigo}</faultcode>
      <faultstring>${mensaje}</faultstring>
    </soap-env:Fault></soap-env:Body>
  </soap-env:Envelope>`;
}

function fault0140() {
  return faultSoap("0140", "Existe un Documento igual en Proceso");
}

function respuestaConsulta(codigo, mensaje) {
  return `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">
    <soap-env:Body><getStatusResponse><status>
      <statusCode>${codigo}</statusCode>
      <statusMessage>${mensaje}</statusMessage>
    </status></getStatusResponse></soap-env:Body>
  </soap-env:Envelope>`;
}

function respuestaConsultaConContenido(codigo, mensaje, content) {
  return `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">
    <soap-env:Body><getStatusCdrResponse><status>
      <statusCode>${codigo}</statusCode>
      <statusMessage>${mensaje}</statusMessage>
      <content>${content}</content>
    </status></getStatusCdrResponse></soap-env:Body>
  </soap-env:Envelope>`;
}

async function conFetchMock(respuestas, fn) {
  const fetchOriginal = globalThis.fetch;
  const logOriginal = console.log;
  const errorOriginal = console.error;
  const llamadas = [];
  const cola = [...respuestas];
  // El cliente registra cada request y los SOAP Fault esperados. Silenciamos
  // solo durante el mock para que el resultado de la regresion sea legible.
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    llamadas.push({ url: String(url), init });
    assert.ok(cola.length > 0, `fetch inesperado a ${String(url)}`);
    const siguiente = cola.shift();
    if (siguiente instanceof Error) throw siguiente;
    return respuestaSoap(siguiente.body, siguiente.status ?? 200);
  };

  try {
    const resultado = await fn(llamadas);
    assert.equal(cola.length, 0, "deben consumirse todas las respuestas SOAP simuladas");
    return resultado;
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

verificarPreparacionDeDespliegue();
await transpilarFuentes();

const { EstadoSunat } = compiled("src/lib/sunat/types.ts");
const { enviarComprobante, consultarEstadoCpe } = compiled(
  "src/lib/sunat/soap-client.ts"
);
const config = configPrueba();

const consultaBeta = await conFetchMock([], () =>
  consultarEstadoCpe(
    {
      ...config,
      environment: "beta",
      endpoints: { ...config.endpoints, consultaCdr: "" },
    },
    { ruc: config.ruc, tipo: "01", serie: "F002", numero: 1 }
  )
);
assert.equal(consultaBeta.estado, EstadoSunat.POR_CONFIRMAR);
assert.match(consultaBeta.error ?? "", /BETA/i);

// 0140 no es un rechazo definitivo para factura/boleta: SUNAT pudo haber
// recibido el mismo numero y el unico paso seguro es consultarlo.
for (const tipo of ["01", "03"]) {
  const resultado = await conFetchMock(
    [{ body: fault0140(), status: 500 }],
    () => enviarComprobante("<Invoice/>", tipo, tipo === "01" ? "F002" : "B002", 412, config)
  );
  assert.equal(resultado.estado, EstadoSunat.POR_CONFIRMAR, `${tipo}: 0140 debe quedar POR_CONFIRMAR`);
  assert.equal(resultado.exito, false);
  assert.equal(resultado.codigoRespuesta, "0140");
  assert.equal(resultado.tieneCdr, false);
  assert.match(resultado.error ?? "", /no emitas otro/i);
}

// SUNAT tambien usa 1032/1033 (y variantes textuales) cuando el mismo CPE ya
// fue informado o registrado. Para 01/03 eso tampoco demuestra rechazo: se
// consulta el numero existente. Probamos codigo y texto por separado porque el
// gateway no siempre devuelve ambos de forma consistente.
const faultsDocumentoYaInformado = [
  {
    codigo: "1032",
    mensaje: "Error de procesamiento",
    caso: "codigo 1032",
  },
  {
    codigo: "1033",
    mensaje: "Error de procesamiento",
    caso: "codigo 1033",
  },
  {
    codigo: "9998",
    mensaje: "El documento fue previamente informado a SUNAT",
    caso: "texto previamente informado",
  },
  {
    codigo: "9999",
    mensaje: "El documento ya se encuentra registrado",
    caso: "texto ya registrado",
  },
];

for (const tipo of ["01", "03"]) {
  for (const fault of faultsDocumentoYaInformado) {
    const resultado = await conFetchMock(
      [{ body: faultSoap(fault.codigo, fault.mensaje), status: 500 }],
      () =>
        enviarComprobante(
          "<Invoice/>",
          tipo,
          tipo === "01" ? "F002" : "B002",
          420,
          config
        )
    );
    assert.equal(
      resultado.estado,
      EstadoSunat.POR_CONFIRMAR,
      `${tipo}: ${fault.caso} debe quedar POR_CONFIRMAR`
    );
    assert.equal(resultado.exito, false);
    assert.equal(resultado.tieneCdr, false);
    assert.match(resultado.error ?? "", /no emitas otro/i);
  }
}

// La ampliacion es deliberadamente exclusiva de facturas/boletas. NC y GRE
// conservan la clasificacion historica de estos SOAP Faults.
for (const tipo of ["07", "09"]) {
  for (const fault of faultsDocumentoYaInformado) {
    const resultado = await conFetchMock(
      [{ body: faultSoap(fault.codigo, fault.mensaje), status: 500 }],
      () =>
        enviarComprobante(
          "<Documento/>",
          tipo,
          tipo === "07" ? "FC01" : "T001",
          3,
          config
        )
    );
    assert.equal(
      resultado.estado,
      EstadoSunat.RECHAZADA,
      `${tipo}: ${fault.caso} debe conservar RECHAZADA`
    );
  }
}

// NC y GRE conservan su clasificacion historica. Esta mejora no debe cambiar
// esos flujos ni convertir sus respuestas 0140/errores de red en POR_CONFIRMAR.
for (const tipo of ["07", "09"]) {
  const resultado0140 = await conFetchMock(
    [{ body: fault0140(), status: 500 }],
    () => enviarComprobante("<Documento/>", tipo, tipo === "07" ? "FC01" : "T001", 1, config)
  );
  assert.notEqual(resultado0140.estado, EstadoSunat.POR_CONFIRMAR, `${tipo}: 0140 no debe adoptar el flujo 01/03`);

  const resultadoRed = await conFetchMock([new Error("fetch failed")], () =>
    enviarComprobante("<Documento/>", tipo, tipo === "07" ? "FC01" : "T001", 2, config)
  );
  assert.equal(resultadoRed.estado, EstadoSunat.ERROR, `${tipo}: una falla de red conserva ERROR`);
}

// billConsultService: 0001 aceptado, 0002 rechazado, 0003 anulado y 0011 aun
// no encontrado. Las respuestas son simuladas; la prueba no usa red ni DB.
const casosConsulta = [
  { codigo: "0002", estado: EstadoSunat.RECHAZADA, exito: false },
  { codigo: "0003", estado: EstadoSunat.ANULADA, exito: false },
  { codigo: "0011", estado: EstadoSunat.POR_CONFIRMAR, exito: false },
];

for (const caso of casosConsulta) {
  const resultado = await conFetchMock(
    [{ body: respuestaConsulta(caso.codigo, `Estado ${caso.codigo}`) }],
    (llamadas) =>
      consultarEstadoCpe(config, {
        ruc: config.ruc,
        tipo: "01",
        serie: "F002",
        numero: 412,
      }).then((valor) => ({ valor, llamadas }))
  );
  assert.equal(resultado.valor.codigoRespuesta, caso.codigo);
  assert.equal(resultado.valor.estado, caso.estado);
  assert.equal(resultado.valor.exito, caso.exito);
  assert.equal(resultado.llamadas.length, 1);
  assert.equal(resultado.llamadas[0].init.headers.SOAPAction, '"urn:getStatus"');
  assert.match(String(resultado.llamadas[0].init.body), /<tipoComprobante>01<\/tipoComprobante>/);
  assert.match(String(resultado.llamadas[0].init.body), /<serieComprobante>F002<\/serieComprobante>/);
  assert.match(String(resultado.llamadas[0].init.body), /<numeroComprobante>412<\/numeroComprobante>/);
}

// Boleta 03 NO usa billConsultService: SUNAT solo admite series F en ese SOAP.
// Debe obtener OAuth propio de Consulta Integrada y enviar fecha+monto al REST
// validarcomprobante. estadoCp: 1=aceptada, 2=baja, 0=no encontrada aun.
const casosConsultaBoleta = [
  {
    estadoCp: 1,
    estado: EstadoSunat.ACEPTADA,
    codigo: "1",
    exito: true,
  },
  {
    estadoCp: 2,
    estado: EstadoSunat.ANULADA,
    codigo: "2",
    exito: false,
  },
  {
    estadoCp: 0,
    estado: EstadoSunat.POR_CONFIRMAR,
    codigo: "0011",
    exito: false,
  },
];

for (const caso of casosConsultaBoleta) {
  const clientId = `consulta-estado-${caso.estadoCp}`;
  const clientSecret = `secret-${caso.estadoCp}`;
  const token = `token-${caso.estadoCp}`;
  const resultado = await conFetchMock(
    [
      {
        body: JSON.stringify({ access_token: token, expires_in: 3600 }),
      },
      {
        body: JSON.stringify({
          success: true,
          message: "Consulta completada",
          data: { estadoCp: caso.estadoCp, estadoRuc: "00", condDomiRuc: "00" },
        }),
      },
    ],
    (llamadas) =>
      consultarEstadoCpe(
        {
          ...config,
          consultaClientId: clientId,
          consultaClientSecret: clientSecret,
        },
        {
          ruc: config.ruc,
          tipo: "03",
          serie: "B002",
          numero: 413,
          fechaEmision: "2026-07-15",
          monto: 1593.27,
        }
      ).then((valor) => ({ valor, llamadas, clientId, clientSecret, token }))
  );

  assert.equal(resultado.valor.estado, caso.estado);
  assert.equal(resultado.valor.codigoRespuesta, caso.codigo);
  assert.equal(resultado.valor.exito, caso.exito);
  assert.equal(resultado.valor.tieneCdr, false);
  assert.equal(resultado.llamadas.length, 2);

  const tokenRequest = resultado.llamadas[0];
  assert.match(tokenRequest.url, /api-seguridad\.sunat\.gob\.pe/);
  assert.match(tokenRequest.url, new RegExp(resultado.clientId));
  assert.equal(tokenRequest.init.method, "POST");
  assert.match(String(tokenRequest.init.body), /grant_type=client_credentials/);
  assert.match(String(tokenRequest.init.body), /client_id=consulta-estado-/);
  assert.match(String(tokenRequest.init.body), /client_secret=secret-/);

  const consultaRequest = resultado.llamadas[1];
  assert.match(
    consultaRequest.url,
    /api\.sunat\.gob\.pe\/v1\/contribuyente\/contribuyentes\/20123456789\/validarcomprobante$/
  );
  assert.equal(
    consultaRequest.init.headers.Authorization,
    `Bearer ${resultado.token}`
  );
  assert.equal(
    consultaRequest.init.headers.SOAPAction,
    undefined,
    "una boleta nunca debe caer en billConsultService SOAP"
  );
  assert.deepEqual(JSON.parse(String(consultaRequest.init.body)), {
    numRuc: config.ruc,
    codComp: "03",
    numeroSerie: "B002",
    numero: 413,
    fechaEmision: "15/07/2026",
    monto: 1593.27,
  });
}

const boletaSinCredenciales = await conFetchMock([], () =>
  consultarEstadoCpe(
    {
      ...config,
      consultaClientId: "",
      consultaClientSecret: "",
    },
    {
      ruc: config.ruc,
      tipo: "03",
      serie: "B002",
      numero: 414,
      fechaEmision: "2026-07-15",
      monto: 100,
    }
  )
);
assert.equal(boletaSinCredenciales.estado, EstadoSunat.POR_CONFIRMAR);
assert.equal(boletaSinCredenciales.exito, false);
assert.equal(boletaSinCredenciales.codigoRespuesta, "CFG_API03");
assert.equal(boletaSinCredenciales.requiereRevision, true);
assert.equal(boletaSinCredenciales.tieneCdr, false);
assert.match(boletaSinCredenciales.error ?? "", /credenciales|configuraci[oó]n/i);

// La funcion publica tampoco debe enviar 07/09 al billConsult de facturas. Los
// flujos propios de NC y GRE se mantienen fuera de esta conciliacion 01/03.
for (const tipo of ["07", "09"]) {
  const aislado = await conFetchMock([], (llamadas) =>
    consultarEstadoCpe(config, {
      ruc: config.ruc,
      tipo,
      serie: tipo === "07" ? "FC01" : "T001",
      numero: 1,
    }).then((valor) => ({ valor, llamadas }))
  );
  assert.notEqual(aislado.valor.estado, EstadoSunat.ACEPTADA);
  assert.equal(
    aislado.llamadas.length,
    0,
    `${tipo}: la consulta 01/03 no debe invocar SOAP ni REST`
  );
}

const cdrXmlAceptado = `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ResponseCode>0</cbc:ResponseCode>
  <cbc:Description>La Factura ha sido aceptada</cbc:Description>
</ApplicationResponse>`;
const cdrZipBase64 = Buffer.from(
  zipSync({ "R-20123456789-01-F002-414.xml": strToU8(cdrXmlAceptado) })
).toString("base64");
const aceptadoConCdr = await conFetchMock(
  [
    { body: respuestaConsulta("0001", "El comprobante existe y esta aceptado") },
    {
      body: respuestaConsultaConContenido(
        "0004",
        "Constancia encontrada",
        cdrZipBase64
      ),
    },
  ],
  () =>
    consultarEstadoCpe(config, {
      ruc: config.ruc,
      tipo: "01",
      serie: "F002",
      numero: 414,
    })
);
assert.equal(aceptadoConCdr.estado, EstadoSunat.ACEPTADA);
assert.equal(aceptadoConCdr.exito, true);
assert.equal(aceptadoConCdr.tieneCdr, true);
assert.equal(aceptadoConCdr.cdrBase64, cdrZipBase64);

// Contratos de seguridad entre persistencia, endpoints y UI.
const leer = (rel) => readFile(join(root, rel), "utf8");
const [
  soapSource,
  conciliacionSource,
  verificarSource,
  reintentarSource,
  indexSource,
  efectosAceptacionSource,
  emitirSource,
  emitirManualSource,
  duplicadoSource,
  mensajesSource,
  consultaIntegradaSource,
  emitirUiSource,
  listaUiSource,
  listaApiSource,
] = await Promise.all([
  leer("src/lib/sunat/soap-client.ts"),
  leer("src/lib/sunat/reconciliacion-cpe.ts"),
  leer("src/app/api/comprobantes/[id]/verificar-sunat/route.ts"),
  leer("src/app/api/comprobantes/[id]/reintentar/route.ts"),
  leer("src/lib/sunat/index.ts"),
  leer("src/lib/sunat/efectos-aceptacion-cpe.ts"),
  leer("src/app/api/comprobantes/emitir/route.ts"),
  leer("src/app/api/comprobantes/emitir-manual/route.ts"),
  leer("src/lib/sunat/duplicado.ts"),
  leer("src/lib/sunat/mensajes-amigables.ts"),
  leer("src/lib/sunat/consulta-integrada-client.ts"),
  leer("src/app/dashboard/comprobantes/nuevo/emitir-client.tsx"),
  leer("src/app/dashboard/comprobantes/comprobantes-client.tsx"),
  leer("src/app/api/comprobantes/route.ts"),
]);

assert.match(
  soapSource,
  /return tipoDoc === ["']01["'] \|\| tipoDoc === ["']03["']/,
  "la clasificacion incierta debe limitarse a factura/boleta"
);

const inicioBoletaRest = soapSource.indexOf(
  'if (normalizado.tipo === "03")'
);
const inicioConsultaSoap = soapSource.indexOf(
  'buildConsultaCpeEnvelope("getStatus"',
  inicioBoletaRest
);
assert.ok(
  inicioBoletaRest >= 0 && inicioConsultaSoap > inicioBoletaRest,
  "la boleta debe desviarse a Consulta Integrada antes de construir SOAP"
);
assert.match(
  soapSource.slice(inicioBoletaRest, inicioConsultaSoap),
  /consultarBoletaIntegrada/,
  "tipo 03 debe delegar al cliente REST oficial"
);
assert.match(
  soapSource.slice(inicioBoletaRest, inicioConsultaSoap),
  /normalizado\.tipo !== ["']01["']/,
  "solo tipo 01 puede continuar hacia billConsultService"
);
assert.match(consultaIntegradaSource, /config\.consultaClientId/);
assert.match(consultaIntegradaSource, /config\.consultaClientSecret/);
assert.doesNotMatch(
  consultaIntegradaSource,
  /config\.clientId|config\.clientSecret/,
  "Consulta Integrada no debe reutilizar las credenciales OAuth de GRE"
);
assert.match(consultaIntegradaSource, /validarcomprobante/);
assert.match(consultaIntegradaSource, /fechaEmision/);
assert.match(consultaIntegradaSource, /monto/);
assert.match(
  consultaIntegradaSource,
  /CODIGO_CONFIG_FALTANTE[\s\S]*requiereRevision:\s*true/,
  "sin credenciales la boleta debe quedar bloqueada para revision"
);

assert.match(conciliacionSource, /tipo IN \('01', '03'\)/);
assert.match(conciliacionSource, /!\[["']01["'], ["']03["']\]\.includes\(c\.tipo\)/);
assert.match(verificarSource, /!\[["']01["'], ["']03["']\]\.includes\(c\.tipo\)/);
for (const prohibido of [
  /xml-builder/,
  /xml-signer/,
  /urn:sendBill/,
  /siguienteCorrelativo/,
]) {
  assert.doesNotMatch(
    conciliacionSource,
    prohibido,
    "la conciliacion solo consulta; no firma, reconstruye, envia ni consume correlativos"
  );
}

const inicioSelectorCron = conciliacionSource.indexOf(
  "export async function comprobantesPendientesDeConciliar("
);
assert.ok(inicioSelectorCron >= 0, "debe existir el selector del cron SUNAT");
const selectorCron = conciliacionSource.slice(inicioSelectorCron);
assert.match(
  selectorCron,
  /UPDATE comprobantes[\s\S]*SET estado = 'por_confirmar'[\s\S]*estado = 'emitiendo'[\s\S]*INTERVAL '15 minutes'/,
  "el cron debe recuperar reservas emitiendo abandonadas antes de seleccionar"
);
assert.match(
  selectorCron,
  /WHERE tipo IN \('01', '03'\)/,
  "la recuperacion stale no debe alcanzar NC ni GRE"
);
assert.match(
  conciliacionSource,
  /const aceptadoSinCdr\s*=\s*c\.tipo === ["']01["'][\s\S]{0,180}!c\.sunat_cdr_legible/,
  "solo una factura aceptada puede volver a consultar para recuperar CDR"
);
assert.match(
  selectorCron,
  /estado IN \('aceptado', 'observado'\)[\s\S]{0,120}tipo = '01'[\s\S]{0,120}NOT sunat_cdr_legible/,
  "una boleta aceptada sin CDR no debe volver al selector SOAP"
);

const definicionesEntradaPostproceso =
  conciliacionSource.match(
    /export async function completarPostprocesoAceptadoPorId\s*\(/g
  ) ?? [];
assert.equal(
  definicionesEntradaPostproceso.length,
  1,
  "debe existir una sola entrada publica al postproceso aceptado 01/03"
);
assert.match(
  conciliacionSource,
  /export async function completarPostprocesoAceptadoPorId[\s\S]{0,300}completarPostprocesoAceptado\(c\)/,
  "la entrada publica debe reutilizar el mismo claim/postproceso de conciliacion"
);
assert.match(
  efectosAceptacionSource,
  /export async function aplicarEfectosAceptacionCpe\s*\(/,
  "los efectos de cartera deben permanecer centralizados en un helper"
);
assert.match(
  indexSource,
  /await completarPostprocesoAceptadoPorId\(reservaPreSunatId\)/,
  "la aceptacion inmediata debe usar el postproceso central"
);
assert.match(
  reintentarSource,
  /await completarPostprocesoAceptadoPorId\(id\)/,
  "la aceptacion de un reintento debe usar el postproceso central"
);

for (const [nombre, source] of [
  ["emitir pedido", emitirSource],
  ["emitir manual", emitirManualSource],
]) {
  const inicioGuardaLocal = source.indexOf("const debeCrearCobranza =");
  const finGuardaLocal = source.indexOf(
    "if (debeCrearCobranza)",
    inicioGuardaLocal
  );
  assert.ok(
    inicioGuardaLocal >= 0 && finGuardaLocal > inicioGuardaLocal,
    `${nombre}: debe conservar una guarda explicita para cartera local`
  );
  const guardaLocal = source.slice(inicioGuardaLocal, finGuardaLocal);
  assert.match(
    guardaLocal,
    /EstadoSunat\.PENDIENTE/,
    `${nombre}: la cartera directa solo aplica al modo local sin certificado`
  );
  assert.doesNotMatch(
    guardaLocal,
    /EstadoSunat\.ACEPTADA/,
    `${nombre}: una aceptacion real debe pasar por el postproceso central`
  );
}

const consultaAntesDelReenvio = reintentarSource.indexOf(
  "await conciliarComprobanteSunat("
);
const reenvioXml = reintentarSource.indexOf(
  "await enviarComprobante("
);
assert.ok(
  consultaAntesDelReenvio >= 0 && reenvioXml > consultaAntesDelReenvio,
  "un CPE 01/03 incierto debe consultarse antes de considerar reenviar su XML"
);
assert.match(
  reintentarSource,
  /por_confirmar/,
  "el endpoint de reintento debe reconocer y consultar por_confirmar"
);

assert.match(emitirSource, /facturacion_cpe_claim_token/);
assert.match(
  emitirSource,
  /estado NOT IN \('rechazado', 'anulado'\)/,
  "un pedido con por_confirmar debe bloquear otro correlativo"
);
assert.match(emitirSource, /bloqueante:\s*true/);

assert.match(
  duplicadoSource,
  /por_confirmar/,
  "el detector standalone debe reconocer un comprobante incierto reciente"
);
assert.match(
  duplicadoSource,
  /bloqueante/,
  "el detector debe distinguir el bloqueo duro del aviso duplicado confirmable"
);
assert.ok(
  emitirManualSource.includes("dup.bloqueante") ||
    emitirManualSource.includes("dup?.bloqueante"),
  "la emision manual debe respetar el bloqueo aunque se solicite confirmarDuplicado"
);

const fuentesUiCpe = `${emitirUiSource}\n${listaUiSource}`;
assert.doesNotMatch(
  fuentesUiCpe,
  /\bNO se emiti[oó]\b/i,
  "la UI no debe afirmar que un CPE incierto no se emitio"
);

const inicioMensajeCaida = mensajesSource.indexOf("if (esMensajeSunatCaido");
const finMensajeCaida = mensajesSource.indexOf(
  "if (esMensajeErrorEsquema",
  inicioMensajeCaida
);
assert.ok(inicioMensajeCaida >= 0 && finMensajeCaida > inicioMensajeCaida);
const mensajeCaida = mensajesSource.slice(inicioMensajeCaida, finMensajeCaida);
assert.doesNotMatch(
  mensajeCaida,
  /NO (?:lleg[oó]|qued[oó]|se emiti[oó])/i,
  "una caida de transporte no prueba que SUNAT haya descartado el CPE"
);
assert.match(mensajeCaida, /verific|confirm/i);

const inicioErrorSinDetalle = mensajesSource.indexOf('if (estado === "error")');
const finErrorSinDetalle = mensajesSource.indexOf(
  'if (estado === "rechazado")',
  inicioErrorSinDetalle
);
assert.ok(
  inicioErrorSinDetalle >= 0 && finErrorSinDetalle > inicioErrorSinDetalle
);
assert.doesNotMatch(
  mensajesSource.slice(inicioErrorSinDetalle, finErrorSinDetalle),
  /NO qued[oó] registrado/i,
  "un error de conexion historico debe verificarse antes de declararlo inexistente"
);
assert.match(emitirUiSource, /POR CONFIRMAR CON SUNAT/);
assert.match(emitirUiSource, /No emitas otro/);
assert.match(emitirUiSource, /Verificar ahora/);
assert.match(
  emitirUiSource,
  /!porConfirmar\s*&&\s*!noRegistrado\s*&&\s*\([\s\S]{0,900}Emitir otro/,
  "Emitir otro debe ocultarse mientras SUNAT no confirma o declara no registrado"
);
assert.match(emitirUiSource, /Reintentar el mismo número/);
assert.match(listaUiSource, /const porConfirmar = esCpePorConfirmar\(c\)/);
assert.match(listaUiSource, /\{porConfirmar \? \([\s\S]{0,900}Verificar ahora/);
assert.match(
  listaUiSource,
  /!esGuia\s*&&\s*!porConfirmar/,
  "las acciones posteriores del CPE deben ocultarse mientras esta por confirmar"
);
assert.match(
  listaApiSource,
  /AS nota_credito_serie_numero/,
  "la lista debe exponer la NC aceptada que corrigio el CPE base"
);
assert.match(
  listaApiSource,
  /AS nota_credito_id/,
  "la lista debe exponer el id exacto de la NC aceptada"
);
assert.match(
  listaApiSource,
  /nc\.estado NOT IN \('error', 'rechazado', 'anulado'\)[\s\S]*?OR \(nc\.estado = 'error' AND nc\.xml_firmado_base64 IS NOT NULL\)[\s\S]*?AS tiene_nc_bloqueante/,
  "la lista debe replicar el predicado backend que bloquea otra NC"
);
assert.match(
  listaApiSource,
  /ncHistoricaSerieSql[\s\S]*?nota de cr\[eé\]dito[\s\S]*?ncHistoricaAceptadaSql/,
  "la lista debe reconocer la evidencia de NC historicas igual que el endpoint"
);
assert.ok(
  (listaApiSource.match(/OR \$\{ncHistoricaAceptadaSql\}/g) ?? []).length >= 4,
  "las NC historicas deben marcar tanto la relacion como el bloqueo en ambos SELECT"
);
assert.match(
  listaUiSource,
  /duplicado\s*&&\s*c\.tiene_nc/,
  "una revision historica por duplicado debe reconocerse como resuelta por la NC"
);
assert.match(
  listaUiSource,
  /Corregido con la Nota de Crédito/,
  "la asesora debe ver que el caso duplicado ya fue corregido"
);
const inicioPuedeNotaCredito = listaUiSource.indexOf(
  "const puedeNotaCredito = (c: Comprobante)"
);
const finPuedeNotaCredito = listaUiSource.indexOf(
  "const puedeReintentar = (c: Comprobante)",
  inicioPuedeNotaCredito
);
assert.ok(
  inicioPuedeNotaCredito >= 0 && finPuedeNotaCredito > inicioPuedeNotaCredito
);
assert.match(
  listaUiSource.slice(inicioPuedeNotaCredito, finPuedeNotaCredito),
  /!c\.tiene_nc_bloqueante/,
  "una factura o boleta con NC activa o con XML no debe ofrecer otra Nota de Credito"
);
const inicioMostrarNc = listaUiSource.indexOf(
  "const mostrarNotaCreditoRelacionada ="
);
const finMostrarNc = listaUiSource.indexOf(
  "const ANULAR_HABILITADO",
  inicioMostrarNc
);
assert.ok(inicioMostrarNc >= 0 && finMostrarNc > inicioMostrarNc);
const bloqueMostrarNc = listaUiSource.slice(inicioMostrarNc, finMostrarNc);
assert.doesNotMatch(
  bloqueMostrarNc,
  /!c\.nota_credito_id\s*\|\|/,
  "una NC historica debe poder abrirse por su serie aunque no tenga id relacionado"
);
for (const patron of [
  /setFiltroTipo\("07"\)/,
  /setFiltroEstado\("all"\)/,
  /setFiltroDesde\(""\)/,
  /setFiltroHasta\(""\)/,
  /setBusqueda\(c\.nota_credito_serie_numero\)/,
  /setSearchDebounced\(c\.nota_credito_serie_numero\)/,
]) {
  assert.match(
    bloqueMostrarNc,
    patron,
    "abrir la NC debe limpiar filtros incompatibles y buscar la NC exacta"
  );
}
assert.ok(
  (listaUiSource.match(/mostrarNotaCreditoRelacionada\(c\)/g) ?? []).length >= 2,
  "los accesos movil y escritorio deben usar el mismo helper seguro"
);
assert.ok(
  (listaUiSource.match(/msg\.resuelta/g) ?? []).length >= 4,
  "movil y escritorio deben presentar la revision resuelta en verde"
);

console.log("Reconciliacion CPE SUNAT: pruebas OK");

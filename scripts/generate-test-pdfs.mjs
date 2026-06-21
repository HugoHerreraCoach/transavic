// scripts/generate-test-pdfs.mjs
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const outDir = join(root, '.tmp', 'pdf-generation-test');

const sourceFiles = [
  'src/lib/sunat/config-transavic.ts',
  'src/lib/sunat/pdf-comprobante.ts',
  'src/lib/sunat/pdf-guia.ts',
];

async function transpileSources() {
  await rm(outDir, { recursive: true, force: true });
  for (const rel of sourceFiles) {
    const sourcePath = join(root, rel);
    const destPath = join(outDir, rel.replace(/\.ts$/, '.js'));
    const source = await readFile(sourcePath, 'utf8');
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
  return require(join(outDir, rel.replace(/\.ts$/, '.js')));
}

async function run() {
  try {
    console.log('Transpiling TS to JS...');
    await transpileSources();

    const { generarPDFComprobante } = compiled('src/lib/sunat/pdf-comprobante.ts');
    const { generarPDFGuia } = compiled('src/lib/sunat/pdf-guia.ts');

    console.log('Generating Factura PDF...');
    const facturaData = {
      tipo: '01',
      serie: 'F001',
      numero: 20,
      serieNumero: 'F001-00000020',
      fechaEmision: '2026-06-21',
      cliente: {
        tipoDocumento: '6',
        numDocumento: '20601234567',
        razonSocial: 'CLIENTE TEST S.A.C.',
        direccion: 'Av. Evitamiento 123, Ate, Lima',
      },
      items: [
        {
          codigo: 'P001',
          descripcion: 'POLLO ENTERO',
          cantidad: 10,
          unidadMedida: 'KGM',
          precioUnitario: 12.50,
          subtotal: 125.00,
        }
      ],
      totales: {
        totalGravadas: 105.93,
        totalExoneradas: 0,
        totalInafectas: 0,
        totalIGV: 19.07,
        totalISC: 0,
        totalOtrosCargos: 0,
        importeTotal: 125.00,
      },
      moneda: 'PEN',
      hashCpe: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
      observacionComprobante: 'Factura de prueba con observacion libre para Transavic',
      formaPago: 'Contado',
      empresa: 'transavic',
      emisor: {
        ruc: '20612806901',
        razonSocial: 'NEGOCIOS Y SERVICIOS TRANSAVIC S.A.C.',
        nombreComercial: 'TRANSAVIC',
        direccion: 'Cal. Las Esmeraldas 624, Balconcillo, La Victoria, Lima',
        ubigeo: '150115',
        departamento: 'LIMA',
        provincia: 'LIMA',
        distrito: 'LA VICTORIA',
      }
    };
    const blobFactura = generarPDFComprobante(facturaData);
    const bufFactura = Buffer.from(await blobFactura.arrayBuffer());
    await mkdir(join(root, 'downloads'), { recursive: true });
    await writeFile(join(root, 'downloads/factura_prueba.pdf'), bufFactura);
    console.log('✅ Factura PDF saved to downloads/factura_prueba.pdf');

    console.log('Generating Boleta PDF...');
    const boletaData = {
      tipo: '03',
      serie: 'B002',
      numero: 3,
      serieNumero: 'B002-00000003',
      fechaEmision: '2026-06-21',
      cliente: {
        tipoDocumento: '1',
        numDocumento: '71054884',
        razonSocial: 'ANTONIO RESURRECCION',
        direccion: 'Av. Los Olivos 456, Los Olivos, Lima',
      },
      items: [
        {
          codigo: 'P002',
          descripcion: 'FILETE DE PECHUGA',
          cantidad: 5,
          unidadMedida: 'NIU',
          precioUnitario: 15.00,
          subtotal: 75.00,
        }
      ],
      totales: {
        totalGravadas: 63.56,
        totalExoneradas: 0,
        totalInafectas: 0,
        totalIGV: 11.44,
        totalISC: 0,
        totalOtrosCargos: 0,
        importeTotal: 75.00,
      },
      moneda: 'PEN',
      hashCpe: 'zYxWvUtSrQpOnMlKjIhGfEdCbA654321',
      observacionComprobante: 'Boleta de prueba con observacion libre para Transavic',
      formaPago: 'Contado',
      empresa: 'transavic',
      emisor: {
        ruc: '20612806901',
        razonSocial: 'NEGOCIOS Y SERVICIOS TRANSAVIC S.A.C.',
        nombreComercial: 'TRANSAVIC',
        direccion: 'Cal. Las Esmeraldas 624, Balconcillo, La Victoria, Lima',
        ubigeo: '150115',
        departamento: 'LIMA',
        provincia: 'LIMA',
        distrito: 'LA VICTORIA',
      }
    };
    const blobBoleta = generarPDFComprobante(boletaData);
    const bufBoleta = Buffer.from(await blobBoleta.arrayBuffer());
    await writeFile(join(root, 'downloads/boleta_prueba.pdf'), bufBoleta);
    console.log('✅ Boleta PDF saved to downloads/boleta_prueba.pdf');

    console.log('Generating Guia de Remision PDF...');
    const guiaData = {
      serieNumero: 'T001-00000006',
      rucEmisor: '20612806901',
      empresa: 'transavic',
      fechaEmision: '21/06/2026 10:30 a. m.',
      fechaInicioTraslado: '21/06/2026',
      motivoTraslado: '01',
      modalidadTraslado: '02',
      indicadorM1L: true,
      puntoPartida: 'Cal. Las Esmeraldas 624, Balconcillo, La Victoria, Lima',
      puntoLlegada: 'Av. Evitamiento 123, Ate, Lima',
      destinatario: {
        docTipo: '6',
        docNum: '20601234567',
        razonSocial: 'CLIENTE TEST S.A.C.',
      },
      observacionComprobante: 'Guia de remision de prueba con observacion para Transavic',
      items: [
        {
          descripcion: 'POLLO ENTERO',
          cantidad: 10,
          unidad: 'KGM',
        }
      ],
      pesoBrutoTotal: 15.5,
      totalBultos: 2,
    };
    const blobGuia = generarPDFGuia(guiaData);
    const bufGuia = Buffer.from(await blobGuia.arrayBuffer());
    await writeFile(join(root, 'downloads/guia_prueba.pdf'), bufGuia);
    console.log('✅ Guia PDF saved to downloads/guia_prueba.pdf');

  } catch (e) {
    console.error('❌ Error generating PDFs:', e);
  }
}
run();

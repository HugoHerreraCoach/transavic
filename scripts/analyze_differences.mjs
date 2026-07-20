import { neon } from '@neondatabase/serverless';

const prodDbUrl = "postgres://neondb_owner:npg_UNCfhQeidK96@ep-cool-sound-adxrsjt5-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";

// Manual data from screenshots
const saraiManual = [
  // 16/07
  { fecha: '2026-07-16', cliente: 'BUEN SABOR', flete: 0, monto: 829.47, doc: 'F002-00000418' },
  { fecha: '2026-07-16', cliente: 'LA PICOLINA', flete: 5, monto: 485.06, doc: 'F002-00000419' },
  { fecha: '2026-07-16', cliente: 'DENNIS', flete: 5, monto: 107.89, doc: 'B002-00000232' },
  { fecha: '2026-07-16', cliente: 'ARTURO', flete: 6, monto: 119.05, doc: 'B002-00000234' },
  { fecha: '2026-07-16', cliente: 'MAGDA PORTUGAL', flete: 5, monto: 105.12, doc: 'B002-00000228' },
  { fecha: '2026-07-16', cliente: 'GRANO CAFÉ', flete: 5, monto: 393.70, doc: 'E001-5795' },
  { fecha: '2026-07-16', cliente: 'FUMANCHU', flete: 0, monto: 768.44, doc: 'F002-00000417' },
  { fecha: '2026-07-16', cliente: 'CULINARIA', flete: 0, monto: 3786.93, doc: 'F001-00000494' },
  { fecha: '2026-07-16', cliente: 'JOEL ARENAS', flete: 7, monto: 94.78, doc: 'B002-00000245' },
  { fecha: '2026-07-16', cliente: 'CIRO', flete: 0, monto: 86.81, doc: 'E001-4590' },
  // 17/07
  { fecha: '2026-07-17', cliente: 'CIRO', flete: 0, monto: 372.09, doc: 'E001-4591' },
  { fecha: '2026-07-17', cliente: 'DANIEL SANTA', flete: 0, monto: 310.00, doc: 'F002-00000428' },
  { fecha: '2026-07-17', cliente: 'LA TREZ', flete: 0, monto: 528.86, doc: 'F002-00000427' },
  { fecha: '2026-07-17', cliente: 'BUEN SABOR', flete: 0, monto: 2055.70, doc: 'F002-00000426' },
  { fecha: '2026-07-17', cliente: 'MANUEL MEZA', flete: 8, monto: 142.52, doc: 'F002-00000425' },
  { fecha: '2026-07-17', cliente: 'OSCAR', flete: 6, monto: 116.03, doc: 'F002-00000429' },
  { fecha: '2026-07-17', cliente: 'CIELO', flete: 6, monto: 212.03, doc: 'F002-00000424' },
  { fecha: '2026-07-17', cliente: 'CHRIS', flete: 7, monto: 196.28, doc: 'F002-00000423' },
  { fecha: '2026-07-17', cliente: 'PILAR MASIAS', flete: 8, monto: 90.17, doc: 'E001-5800' },
  { fecha: '2026-07-17', cliente: 'RESTAURANTE ZANY', flete: 8, monto: 769.01, doc: 'E001-5799' },
  { fecha: '2026-07-17', cliente: 'FUMANCHU', flete: 0, monto: 643.97, doc: 'F002-00000430' },
  { fecha: '2026-07-17', cliente: 'MANHATTAN', flete: 8, monto: 603.57, doc: 'F002-00000422' },
  { fecha: '2026-07-17', cliente: 'HENRRY ALVARADO', flete: 0, monto: 342.53, doc: 'F002-00000431' },
  // 18/07
  { fecha: '2026-07-18', cliente: 'CIRO', flete: 0, monto: 205.30, doc: 'E001-4592' },
  { fecha: '2026-07-18', cliente: 'LA TREZ', flete: 0, monto: 509.64, doc: 'F002-00000439' },
  { fecha: '2026-07-18', cliente: 'BUEN SABOR', flete: 0, monto: 1374.33, doc: 'F002-00000438' },
  { fecha: '2026-07-18', cliente: 'FUMANCHU', flete: 0, monto: 569.20, doc: 'F002-00000436' },
  { fecha: '2026-07-18', cliente: 'DIANIK-HOSPITAL', flete: 5, monto: 764.42, doc: 'F002-00000437' },
  { fecha: '2026-07-18', cliente: 'MARIA JOSE', flete: 5, monto: 79.09, doc: 'B002-00000243' },
  { fecha: '2026-07-18', cliente: 'MANUEL MEZA', flete: 8, monto: 173.81, doc: 'F002-00000435' },
];

const jhoselynManual = [
  { fecha: 'N/A', cliente: 'ALEX LINARES', monto: 75.89, doc: 'B002-00000231' }, // Or B002-00000238
  { fecha: 'N/A', cliente: 'MECHITA BRASERO', monto: 160.34, doc: 'F001-00000513' },
  { fecha: 'N/A', cliente: 'GABRIELA PEREZ', monto: 584.58, doc: 'F002-00000432' },
  { fecha: 'N/A', cliente: 'NORMA BEDOYA', monto: 97.00, doc: 'B002-00000230' }, // Or B002-00000239
  { fecha: 'N/A', cliente: 'PATRICIA YAMAMOTO', monto: 523.25, doc: 'F002-00000433' },
  { fecha: 'N/A', cliente: 'CARNICA', monto: 256.00, doc: 'F001-00000515' },
  { fecha: 'N/A', cliente: 'SILVANA', monto: 265.77, doc: 'B002-00000240' },
  { fecha: 'N/A', cliente: 'ALEXIS ZENTENO', monto: 87.12, doc: 'B002-00000242' },
  { fecha: 'N/A', cliente: 'MANOLO', monto: 95.96, doc: 'B002-00000241' },
  { fecha: 'N/A', cliente: 'PATRICIA YAMAMOTO', monto: 148.35, doc: 'F002-00000434' },
  { fecha: 'N/A', cliente: 'MECHITA CAMPESTRE', monto: 224.81, doc: 'F001-00000516' },
  { fecha: 'N/A', cliente: 'PACHANKA', monto: 90.24, doc: 'F002-00000442' },
  { fecha: 'N/A', cliente: 'PATRICIA YAMAMOTO', monto: 414.96, doc: 'F002-00000441' },
  { fecha: 'N/A', cliente: 'MECHITA BRASERO', monto: 363.65, doc: 'F001-00000531' },
  { fecha: 'N/A', cliente: 'TERESA PEÑA', monto: 198.26, doc: 'B002-00000249' },
  { fecha: 'N/A', cliente: 'SILVANA', monto: 302.81, doc: 'B002-00000248' },
  { fecha: 'N/A', cliente: 'FAUSTO GARCIA', monto: 170.50, doc: 'B002-00000247' },
  { fecha: 'N/A', cliente: 'JESSICA BALAREZO', monto: 446.39, doc: 'F002-00000440' },
];

const yesicaManual = [
  // 16/07
  { fecha: '2026-07-16', cliente: 'CPE 193.63', monto: 193.63, doc: 'F001-00000493' },
  { fecha: '2026-07-16', cliente: 'CPE 87.39', monto: 87.39, doc: 'B002-00000229' },
  { fecha: '2026-07-16', cliente: 'CPE 87.08', monto: 87.08, doc: 'B002-00000227' },
  { fecha: '2026-07-16', cliente: 'CPE 85.68', monto: 85.68, doc: 'B001-00000189' },
  // 17/07
  { fecha: '2026-07-17', cliente: 'CPE 251.77', monto: 251.77, doc: 'F001-00000507' },
  { fecha: '2026-07-17', cliente: 'CPE 183.88', monto: 183.88, doc: 'F001-00000508' },
  { fecha: '2026-07-17', cliente: 'CPE 95.42', monto: 95.42, doc: 'B001-00000198' }, // Or B002-00000236
  // 18/07
  { fecha: '2026-07-18', cliente: 'CPE 175.70', monto: 175.70, doc: 'F001-00000517' },
  { fecha: '2026-07-18', cliente: 'CPE 196.56', monto: 196.56, doc: 'F001-00000518' },
  { fecha: '2026-07-18', cliente: 'CPE 117.08', monto: 117.08, doc: 'F001-00000526' }, // Wait, in DB it is F001-00000526 (117.09)
  { fecha: '2026-07-18', cliente: 'CPE 120.66', monto: 120.66, doc: 'F001-00000525' },
  // NC
  { fecha: '2026-07-16', cliente: 'NC Matías Córdova', tipoNC: true, monto: 86.70, doc: 'BC01-00000037' },
  { fecha: '2026-07-17', cliente: 'NC Zulma Barrenechea', tipoNC: true, monto: 95.42, doc: 'BC01-00000038' },
];

const yaliManual = [
  // 16/07
  { fecha: '2026-07-16', cliente: 'EVELYN GAMARRA', monto: 145.34, doc: 'B001-00000195' },
  { fecha: '2026-07-16', cliente: 'KELLY PEREZ', monto: 138.68, doc: 'B001-00000193' },
  { fecha: '2026-07-16', cliente: 'INTRO BARRANCO', monto: 696.72, doc: 'F001-00000495' },
  { fecha: '2026-07-16', cliente: 'ANA YNAMINE', monto: 384.38, doc: 'F001-00000496' },
  { fecha: '2026-07-16', cliente: 'NATHALIE BRISEÑO', monto: 328.91, doc: 'B001-00000191' },
  { fecha: '2026-07-16', cliente: 'ALEX YUCRA', monto: 572.11, doc: 'F001-00000497' },
  { fecha: '2026-07-16', cliente: 'ZULEMA', monto: 267.02, doc: 'F001-00000503' },
  { fecha: '2026-07-16', cliente: 'NIKUYA', monto: 792.24, doc: 'F001-00000504' },
  { fecha: '2026-07-16', cliente: 'KAME SUSHI', monto: 209.10, doc: 'F001-00000498' },
  { fecha: '2026-07-16', cliente: 'KAME SUSHI', monto: 848.76, doc: 'F001-00000499' },
  { fecha: '2026-07-16', cliente: 'KAME SUSHI', monto: 144.76, doc: 'F001-00000500' },
  { fecha: '2026-07-16', cliente: 'KATHY CUMBICUS', monto: 414.12, doc: 'F001-00000502' },
  { fecha: '2026-07-16', cliente: 'NICOLE CHIKEN', monto: 1041.29, doc: 'F001-00000505' },
  // 17/07
  { fecha: '2026-07-17', cliente: 'LUIS HARO', monto: 256.50, doc: 'B001-00000201' },
  { fecha: '2026-07-17', cliente: 'ANA YNAMINE', monto: 211.55, doc: 'F001-00000511' },
  { fecha: '2026-07-17', cliente: 'ALEX YUCRA', monto: 491.50, doc: 'F001-00000510' },
  { fecha: '2026-07-17', cliente: 'TRAVIATA', monto: 132.08, doc: 'F001-00000509' },
  { fecha: '2026-07-17', cliente: 'NATHALIE BRISEÑO', monto: 174.26, doc: 'B001-00000200' },
  { fecha: '2026-07-17', cliente: 'NATHALIA MONTILLO GODOY', monto: 294.22, doc: 'B001-00000199' },
  { fecha: '2026-07-17', cliente: 'RONALDO', monto: 255.42, doc: 'F001-00000514' },
  // 18/07
  { fecha: '2026-07-18', cliente: 'LALA', monto: 1131.90, doc: 'F001-00000520' },
  { fecha: '2026-07-18', cliente: 'ARRARRAY', monto: 300.08, doc: 'F001-00000521' },
  { fecha: '2026-07-18', cliente: 'PARRITECA', monto: 127.43, doc: 'F001-00000522' },
  { fecha: '2026-07-18', cliente: 'LUIS HIJO', monto: 89.03, doc: 'B001-00000202' },
  { fecha: '2026-07-18', cliente: 'GRECIA ENCISO', monto: 89.80, doc: 'B001-00000203' },
  { fecha: '2026-07-18', cliente: 'ALEX YUCRA', monto: 544.38, doc: 'F001-00000523' },
  { fecha: '2026-07-18', cliente: 'CHRISTIAN ODRÍA', monto: 305.35, doc: 'F001-00000524' },
  { fecha: '2026-07-18', cliente: 'NIKUYA', monto: 963.80, doc: 'F001-00000530' },
  { fecha: '2026-07-18', cliente: 'MANUEL LINCE', monto: 641.12, doc: 'F001-00000519' },
  { fecha: '2026-07-18', cliente: 'ZULEMA', monto: 221.20, doc: 'F001-00000529' },
  { fecha: '2026-07-18', cliente: 'FRANKOS', monto: 376.22, doc: 'F001-00000527' },
  { fecha: '2026-07-18', cliente: 'AMERICO', monto: 450.87, doc: 'F001-00000528' },
  // NC
  { fecha: '2026-07-16', cliente: 'NICOLE CHIKEN', tipoNC: true, monto: 1041.29, doc: 'FC01-00000042' }
];

async function analyzeAdvisor(sql, name, list) {
  console.log(`\n=================== ANALYZING ADVISOR: ${name.toUpperCase()} ===================`);
  
  const report = [];

  for (const item of list) {
    // 1. Fetch Comprobante from DB
    const comps = await sql`
      SELECT c.id, c.pedido_id, c.tipo, c.serie_numero, c.cliente_razon_social, c.monto_total,
             p.cliente as ped_cliente, p.fecha_pedido as ped_fecha, p.estado as ped_estado,
             (SELECT SUM(subtotal_real) FROM pedido_items WHERE pedido_id = p.id) as ped_total_real,
             (SELECT SUM(precio_unitario * cantidad) FROM pedido_items WHERE pedido_id = p.id) as ped_total_preventa
      FROM comprobantes c
      LEFT JOIN pedidos p ON c.pedido_id = p.id
      WHERE c.serie_numero = ${item.doc}
    `;

    if (comps.length === 0) {
      report.push({
        documento: item.doc,
        fecha_manual: item.fecha,
        cliente_manual: item.cliente,
        monto_manual: item.monto,
        db_cpe_monto: 'NO ENCONTRADO EN DB',
        db_pedido_cliente: 'N/A',
        db_pedido_fecha: 'N/A',
        db_pedido_estado: 'N/A',
        db_pedido_total_real: 'N/A',
        db_pedido_total_prev: 'N/A',
        observaciones: '⚠️ El comprobante no existe en la base de datos de la aplicación.'
      });
      continue;
    }

    const c = comps[0];
    const diffManualCpe = Math.abs(parseFloat(item.monto) - parseFloat(c.monto_total));
    const diffCpePedReal = c.ped_total_real ? Math.abs(parseFloat(c.monto_total) - parseFloat(c.ped_total_real)) : null;

    let obs = [];
    if (diffManualCpe > 0.05) {
      obs.push(`Diferencia de monto Manual vs CPE: S/ ${diffManualCpe.toFixed(2)} (Manual S/ ${parseFloat(item.monto).toFixed(2)}, DB S/ ${parseFloat(c.monto_total).toFixed(2)})`);
    }

    if (c.ped_total_real !== null) {
      const fleteMonto = parseFloat(item.flete || 0);
      const expectedTotal = parseFloat(c.ped_total_real) + fleteMonto;
      const expectedDiff = Math.abs(parseFloat(c.monto_total) - expectedTotal);
      
      if (expectedDiff > 0.05) {
        obs.push(`CPE vs Pedido Real+Flete difiere: CPE S/ ${parseFloat(c.monto_total).toFixed(2)}, Pedido+Flete S/ ${expectedTotal.toFixed(2)} (Items real = S/ ${parseFloat(c.ped_total_real).toFixed(2)}, Flete = S/ ${fleteMonto.toFixed(2)})`);
      }
    } else {
      if (!item.tipoNC) {
        obs.push(`⚠️ El pedido asociado en la base de datos no tiene pesos reales registrados (subtotal_real es nulo).`);
      }
    }

    if (obs.length === 0) {
      obs.push('✅ Todo coincide perfectamente.');
    }

    report.push({
      documento: c.serie_numero,
      fecha_manual: item.fecha,
      cliente_manual: item.cliente,
      monto_manual: parseFloat(item.monto).toFixed(2),
      db_cpe_monto: parseFloat(c.monto_total).toFixed(2),
      db_pedido_cliente: c.ped_cliente || '(Sin pedido)',
      db_pedido_fecha: c.ped_fecha ? c.ped_fecha.toISOString().split('T')[0] : 'N/A',
      db_pedido_estado: c.ped_estado || 'N/A',
      db_pedido_total_real: c.ped_total_real ? parseFloat(c.ped_total_real).toFixed(2) : 'N/A',
      db_pedido_total_prev: c.ped_total_preventa ? parseFloat(c.ped_total_preventa).toFixed(2) : 'N/A',
      observaciones: obs.join(' | ')
    });
  }

  console.table(report);
}

async function main() {
  const sql = neon(prodDbUrl);

  await analyzeAdvisor(sql, "Saraí (Image 1)", saraiManual);
  await analyzeAdvisor(sql, "Jhoselyn (Image 2)", jhoselynManual);
  await analyzeAdvisor(sql, "Yesica (Image 3)", yesicaManual);
  await analyzeAdvisor(sql, "Yali (Image 4)", yaliManual);
}

main().catch(console.error);

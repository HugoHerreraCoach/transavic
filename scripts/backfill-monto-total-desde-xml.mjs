// scripts/backfill-monto-total-desde-xml.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Alinea comprobantes.monto_total/monto_subtotal/monto_igv (y la deuda de las
// cobranzas NO pagadas) con los importes REALES del XML firmado (cbc:PayableAmount,
// LineExtensionAmount global y TaxAmount de documento).
//
// POR QUÉ: el motor calculaba el total por un camino paralelo que redondeaba en
// distinto orden que el XML → en el 34% de los comprobantes monto_total (DB/PDF)
// difería 1-2 céntimos del PayableAmount que SUNAT registró. Quien validaba con el
// monto del PDF en la Consulta de Validez del CPE recibía "no existe". El XML es la
// ÚNICA fuente de verdad legal (inmutable) → acá solo se alinea el número mostrado
// al del XML. La emisión ya fue corregida (index.ts usa calcularTotales).
//
// Cobranzas (facturas.monto): se alinean SOLO las NO pagadas
// (estado IN ('Pendiente','Vencida')) — decisión de Hugo. Emparejamiento SEGURO:
//   (a) facturas.comprobante_id = comprobante.id  (vínculo sólido), o
//   (b) comprobante_id NULL AND numero_comprobante = serie_numero AND pedido_id
//       compartido  (las 2 empresas comparten series F001/B001 → numero solo NO
//       basta, gotcha #24).
// Guarda extra: solo se toca si |monto - importeTotal| <= 0.02 (el descuadre de
// redondeo) — nunca un monto que difiera por otra razón.
//
// Usa psql como I/O (evita el bug @neondatabase/serverless + Node 26 — gotcha #13)
// y fflate NO hace falta (el XML está en base64 plano, no zip). IDEMPOTENTE.
//
//   node scripts/backfill-monto-total-desde-xml.mjs            # DRY-RUN (no escribe)
//   node scripts/backfill-monto-total-desde-xml.mjs --apply    # aplica los cambios
//
// Requiere `psql` en el PATH y DATABASE_URL_UNPOOLED (de .env). Antes de --apply
// hace un respaldo CSV automático en scratch/.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const APPLY = process.argv.includes("--apply");
const DB = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DB) {
  console.error("❌ Falta DATABASE_URL_UNPOOLED / DATABASE_URL");
  process.exit(1);
}
try {
  console.log(`📍 DB: ${new URL(DB).hostname}`);
} catch {}

function psql(sql) {
  return execFileSync("psql", [DB, "-t", "-A", "-F", "\t", "-c", sql], {
    encoding: "utf-8",
    maxBuffer: 512 * 1024 * 1024,
  });
}
const esc = (s) => String(s ?? "").replace(/'/g, "''");
const num = (s) => {
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
};

// Totales de CABECERA del XML (mismo algoritmo que src/lib/sunat/parse-cpe-items.ts:parseCpeTotales).
function parseCpeTotales(xml) {
  if (!xml) return null;
  const header = xml
    .replace(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g, "")
    .replace(/<cac:CreditNoteLine>[\s\S]*?<\/cac:CreditNoteLine>/g, "")
    .replace(/<cac:DebitNoteLine>[\s\S]*?<\/cac:DebitNoteLine>/g, "");
  const pay = header.match(/<cbc:PayableAmount[^>]*>([\d.]+)<\/cbc:PayableAmount>/);
  if (!pay) return null;
  const importeTotal = num(pay[1]);
  const legal = header.match(/<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/);
  const legalBlock = legal ? legal[1] : header;
  const lev = legalBlock.match(/<cbc:LineExtensionAmount[^>]*>([\d.]+)<\/cbc:LineExtensionAmount>/);
  const subtotal = lev ? num(lev[1]) : 0;
  const tax = header.match(/<cac:TaxTotal>[\s\S]*?<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/);
  const igv = tax ? num(tax[1]) : 0;
  return { subtotal, igv, importeTotal };
}

const dif = (a, b) => Math.abs(num(a) - num(b)) >= 0.005;

// ── 1) Comprobantes con XML ─────────────────────────────────────────────────
const compRows = psql(
  `SELECT id, serie_numero, tipo, COALESCE(pedido_id::text,''), monto_subtotal, monto_igv, monto_total, COALESCE(xml_firmado_base64,'')
     FROM comprobantes WHERE xml_firmado_base64 IS NOT NULL AND xml_firmado_base64 <> '' ORDER BY created_at`
)
  .split("\n")
  .filter(Boolean);

const compChanges = []; // {id, serie, sub, igv, total}
const compTotalById = new Map(); // id -> importeTotal (XML)
const compTotalBySerPed = new Map(); // `${serie}|${pedido}` -> importeTotal (para cobranzas sin comprobante_id)
let sinParse = 0;

for (const line of compRows) {
  const [id, serie, , pedidoId, sub, igv, total, b64] = line.split("\t");
  const xml = Buffer.from(b64, "base64").toString("utf-8");
  const t = parseCpeTotales(xml);
  if (!t) { sinParse++; continue; }
  compTotalById.set(id, t.importeTotal);
  if (pedidoId) compTotalBySerPed.set(`${serie}|${pedidoId}`, t.importeTotal);
  if (dif(total, t.importeTotal) || dif(sub, t.subtotal) || dif(igv, t.igv)) {
    compChanges.push({ id, serie, sub: t.subtotal, igv: t.igv, total: t.importeTotal, deTotal: num(total) });
  }
}

// ── 2) Cobranzas NO pagadas a alinear ───────────────────────────────────────
const cobRows = psql(
  `SELECT id, COALESCE(comprobante_id::text,''), COALESCE(numero_comprobante,''), COALESCE(pedido_id::text,''), monto, estado
     FROM facturas WHERE estado IN ('Pendiente','Vencida')`
)
  .split("\n")
  .filter(Boolean);

const cobChanges = []; // {id, de, a, via}
let cobSinMatch = 0; // tienen numero pero no se pudo emparejar con seguridad

for (const line of cobRows) {
  const [id, compId, numComp, pedidoId, monto] = line.split("\t");
  let target = null;
  let via = "";
  if (compId && compTotalById.has(compId)) {
    target = compTotalById.get(compId);
    via = "comprobante_id";
  } else if (numComp && pedidoId && compTotalBySerPed.has(`${numComp}|${pedidoId}`)) {
    target = compTotalBySerPed.get(`${numComp}|${pedidoId}`);
    via = "numero+pedido";
  }
  if (target == null) {
    if (numComp) cobSinMatch++;
    continue;
  }
  // Guarda: solo el descuadre de redondeo (<= 2 céntimos), y solo si difiere.
  if (dif(monto, target) && Math.abs(num(monto) - target) <= 0.02) {
    cobChanges.push({ id, de: num(monto), a: target, via });
  }
}

// ── Reporte ─────────────────────────────────────────────────────────────────
console.log(`\nComprobantes con XML: ${compRows.length} (sin total parseable: ${sinParse})`);
console.log(`Comprobantes a corregir (monto_total/subtotal/igv): ${compChanges.length}`);
for (const c of compChanges.slice(0, 12))
  console.log(`  • ${c.serie}: total ${c.deTotal} → ${c.total}`);
if (compChanges.length > 12) console.log(`  … y ${compChanges.length - 12} más`);

console.log(`\nCobranzas NO pagadas a alinear (facturas.monto): ${cobChanges.length}`);
for (const c of cobChanges.slice(0, 12))
  console.log(`  • factura ${c.id.slice(0, 8)}…: ${c.de} → ${c.a}  [${c.via}]`);
if (cobChanges.length > 12) console.log(`  … y ${cobChanges.length - 12} más`);
if (cobSinMatch)
  console.log(`\n⚠️  ${cobSinMatch} cobranzas Pendiente/Vencida con numero_comprobante pero SIN vínculo seguro (sin comprobante_id ni pedido compartido) → NO se tocan. Revisar manualmente si alguna quedó con 1-2 céntimos.`);

if (!APPLY) {
  console.log("\n🟡 DRY-RUN: no se escribió nada. Re-ejecuta con --apply para aplicar.");
  process.exit(0);
}

// ── Respaldo antes de escribir ──────────────────────────────────────────────
const stamp = process.env.BACKFILL_STAMP || "backfill";
const bkComp = `scratch/backup-comprobantes-${stamp}.csv`;
const bkFact = `scratch/backup-facturas-${stamp}.csv`;
writeFileSync(
  bkComp,
  psql(`\\copy (SELECT id,serie_numero,monto_subtotal,monto_igv,monto_total FROM comprobantes WHERE xml_firmado_base64 IS NOT NULL) TO STDOUT CSV HEADER`)
);
writeFileSync(
  bkFact,
  psql(`\\copy (SELECT id,numero_comprobante,monto,estado FROM facturas WHERE estado IN ('Pendiente','Vencida')) TO STDOUT CSV HEADER`)
);
console.log(`\n💾 Respaldo: ${bkComp} + ${bkFact}`);

// ── Aplicar — idempotente (guards por valor) ────────────────────────────────
let n1 = 0, n2 = 0;
for (const c of compChanges) {
  psql(
    `UPDATE comprobantes SET monto_subtotal=${c.sub}, monto_igv=${c.igv}, monto_total=${c.total} WHERE id='${esc(c.id)}'`
  );
  n1++;
}
for (const c of cobChanges) {
  // Re-chequea estado + guarda de céntimo en el WHERE (idempotente y seguro).
  psql(
    `UPDATE facturas SET monto=${c.a} WHERE id='${esc(c.id)}' AND estado IN ('Pendiente','Vencida') AND ABS(monto - ${c.a}) <= 0.02`
  );
  n2++;
}
console.log(`\n✅ Aplicado: ${n1} comprobantes + ${n2} cobranzas no pagadas alineados al XML.`);

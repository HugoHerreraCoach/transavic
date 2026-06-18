// scripts/diagnostico-totales-comprobantes.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CHEQUEO DE SALUD (read-only) de los importes de los comprobantes vs su XML
// firmado. Úsalo si sospechas que un total no cuadra (PDF ≠ SUNAT, cobranza ≠
// comprobante, etc.). NO escribe nada. Para CORREGIR un descuadre DB↔XML usa
// `scripts/backfill-monto-total-desde-xml.mjs`.
//
// Reporta 3 cosas, cada una con ejemplos:
//   (1) monto_total (DB) ≠ cbc:PayableAmount (XML)   → descuadre DB↔XML
//       (lo que el PDF/lista muestran ≠ lo que SUNAT registró). Fix: backfill.
//   (2) total emitido ≠ bruto intencional (Σ AlternativeConditionPrice × cant)
//       → comprobante NO anclado al precio con IGV (esperado en los emitidos
//       ANTES del anclaje del 18 jun 2026; en los NUEVOS debería ser 0).
//   (3) facturas.monto (cobranza) ≠ monto_total del comprobante vinculado
//       (solo cobranzas no anuladas, por comprobante_id) → deuda desalineada.
//
// Por defecto apunta a PRODUCCIÓN (.env). Para otra DB:
//   DATABASE_URL_UNPOOLED="postgres://…" node scripts/diagnostico-totales-comprobantes.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
dotenv.config({ quiet: true }); // SOLO .env (prod) salvo override por shell

const DB = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DB) { console.error("❌ Falta DATABASE_URL_UNPOOLED / DATABASE_URL"); process.exit(1); }
try { console.log(`📍 DB: ${new URL(DB).hostname}\n`); } catch {}

const psql = (sql) => execFileSync("psql", [DB, "-t", "-A", "-F", "\t", "-c", sql],
  { encoding: "utf-8", maxBuffer: 512 * 1024 * 1024 }).trim();
const num = (s) => { const n = Number(s); return Number.isNaN(n) ? 0 : n; };
const r2 = (n) => Math.round(n * 100) / 100;
const dif = (a, b) => Math.abs(num(a) - num(b)) >= 0.005;

const payableDe = (xml) => num((xml.match(/<cbc:PayableAmount[^>]*>([\d.]+)</) || [])[1]);
function brutoIntencional(xml) {
  let bruto = 0;
  const re = /<cac:(InvoiceLine|CreditNoteLine)>([\s\S]*?)<\/cac:\1>/g; let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[2];
    const q = b.match(/<cbc:(?:Invoiced|Credited)Quantity\s+unitCode="[^"]*"[^>]*>([\d.]+)</);
    const alt = b.match(/<cac:AlternativeConditionPrice>\s*<cbc:PriceAmount[^>]*>([\d.]+)</);
    bruto += r2((alt ? num(alt[1]) : 0) * (q ? num(q[1]) : 0));
  }
  return r2(bruto);
}

const comp = psql(`SELECT id, serie_numero, monto_total, COALESCE(xml_firmado_base64,'') FROM comprobantes WHERE xml_firmado_base64 IS NOT NULL AND xml_firmado_base64 <> '' ORDER BY created_at DESC`)
  .split("\n").filter(Boolean);

const totalById = new Map();
let dbXml = 0, noAnclado = 0;
const ej1 = [], ej2 = [];
for (const line of comp) {
  const [id, serie, mt, b64] = line.split("\t");
  const xml = Buffer.from(b64, "base64").toString("utf-8");
  const pay = payableDe(xml);
  totalById.set(id, pay);
  if (dif(mt, pay)) { dbXml++; if (ej1.length < 8) ej1.push(`${serie}: DB=${mt} XML=${pay}`); }
  const bruto = brutoIntencional(xml);
  if (dif(bruto, pay)) { noAnclado++; if (ej2.length < 8) ej2.push(`${serie}: bruto=${bruto} total=${pay} dif=${r2(pay - bruto)}`); }
}

const cob = psql(`SELECT f.id, f.numero_comprobante, f.monto, f.estado, f.comprobante_id::text FROM facturas f WHERE f.estado <> 'Anulada' AND f.comprobante_id IS NOT NULL`)
  .split("\n").filter(Boolean);
let cobDesal = 0; const ej3 = [];
for (const line of cob) {
  const [id, nro, monto, estado, compId] = line.split("\t");
  const t = totalById.get(compId);
  if (t == null) continue;
  if (dif(monto, t)) { cobDesal++; if (ej3.length < 8) ej3.push(`${nro || id.slice(0,8)} (${estado}): cobranza=${monto} comprobante=${t}`); }
}

const linea = (n, txt) => console.log(`${n === 0 ? "✅" : "⚠️ "} ${txt}: ${n}`);
console.log(`Comprobantes con XML: ${comp.length}\n`);
linea(dbXml, "(1) DB monto_total ≠ XML PayableAmount  [fix: backfill-monto-total-desde-xml.mjs]");
ej1.forEach((e) => console.log("     " + e));
linea(noAnclado, "(2) total emitido ≠ bruto intencional (no anclado)  [esperado en pre-18jun2026; 0 en nuevos]");
ej2.forEach((e) => console.log("     " + e));
linea(cobDesal, "(3) cobranza ≠ comprobante vinculado  [no anuladas, por comprobante_id]");
ej3.forEach((e) => console.log("     " + e));
console.log("\n(read-only: no se modificó nada)");

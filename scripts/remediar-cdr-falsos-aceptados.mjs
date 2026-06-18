// scripts/remediar-cdr-falsos-aceptados.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Repara los comprobantes que el sistema marcó 'aceptado'/'observado' pero que
// SUNAT en realidad RECHAZÓ. Causa: el parser de CDR antiguo fallaba con el ZIP
// "data descriptor" de SUNAT → el ResponseCode no se leía → todo caía a 'aceptado'
// por defecto (5 notas de crédito rechazadas con 3286 quedaron como aceptadas).
//
// Este script lee el `cdr_base64` YA GUARDADO (que es correcto), extrae el
// ResponseCode real y corrige el estado + `mensaje_sunat`. Para las NC que pasan a
// 'rechazado' también corrige las observaciones de su factura ("(ACEPTADA)" →
// "(RECHAZADA)") para desbloquear la RE-EMISIÓN (el anti-duplicado de NC mira ese
// texto). NO reenvía nada a SUNAT y NO toca cobranzas (decisión: las ventas se
// cancelaron de verdad; lo correcto es re-emitir las NC, no reactivar deudas).
//
// Usa psql como I/O (evita el bug de @neondatabase/serverless + Node 26 — gotcha #13)
// y fflate para descomprimir. IDEMPOTENTE (re-correrlo no cambia nada nuevo).
//
//   node scripts/remediar-cdr-falsos-aceptados.mjs            # DRY-RUN (no escribe)
//   node scripts/remediar-cdr-falsos-aceptados.mjs --apply    # aplica los cambios
//
// Requiere `psql` en el PATH y DATABASE_URL_UNPOOLED (de .env / .env.local).
// Antes de --apply en producción: respaldar
//   psql "$URL" -c "\copy (SELECT id,serie_numero,estado,mensaje_sunat FROM comprobantes WHERE estado IN ('aceptado','observado')) TO 'backup-comprobantes.csv' CSV HEADER"
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
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
    maxBuffer: 256 * 1024 * 1024,
  });
}
const esc = (s) => String(s ?? "").replace(/'/g, "''");

/** Lee el ResponseCode/Description del CDR base64 (ZIP de SUNAT). */
function leerCdr(b64) {
  try {
    const files = unzipSync(new Uint8Array(Buffer.from(b64.replace(/\s+/g, ""), "base64")));
    const n =
      Object.keys(files).find((k) => /R-.*\.xml$/i.test(k)) ??
      Object.keys(files).find((k) => k.toLowerCase().endsWith(".xml"));
    if (!n) return null;
    const xml = strFromU8(files[n]);
    const cod = xml.match(/<cbc:ResponseCode[^>]*>([^<]*)<\/cbc:ResponseCode>/);
    const des = xml.match(/<cbc:Description[^>]*>([^<]*)<\/cbc:Description>/);
    return { codigo: cod ? cod[1].trim() : "", descripcion: des ? des[1].trim() : "" };
  } catch {
    return null;
  }
}

/** Estado correcto a partir del ResponseCode (misma escala que soap-client.ts). */
function estadoCorrecto(codigo, estadoActual) {
  const n = Number(codigo);
  if (codigo === "" || !Number.isInteger(n) || n < 0) return "error";
  if (n === 0) return estadoActual; // 0 = aceptado real → sin cambio de estado
  if (n >= 100 && n <= 3999) return "rechazado";
  if (n >= 4000) return "observado";
  return "error"; // 1-99 no estándar
}

// 1) Candidatos: aceptados/observados con CDR.
const rows = psql(
  `SELECT id, serie_numero, tipo, estado, COALESCE(cdr_base64,''), COALESCE(referencia_comprobante_id::text,'') FROM comprobantes WHERE estado IN ('aceptado','observado') AND cdr_base64 IS NOT NULL ORDER BY created_at`
)
  .split("\n")
  .filter(Boolean);

const cambios = [];
for (const line of rows) {
  const [id, serie, tipo, estado, b64, refId] = line.split("\t");
  const cdr = leerCdr(b64);
  if (!cdr) {
    cambios.push({ id, serie, tipo, de: estado, a: "error", codigo: "?", mensaje: "CDR ilegible (revisar manualmente)", refId });
    continue;
  }
  const a = estadoCorrecto(cdr.codigo, estado);
  if (a !== estado) {
    cambios.push({ id, serie, tipo, de: estado, a, codigo: cdr.codigo, mensaje: `${cdr.codigo}: ${cdr.descripcion}`.slice(0, 1000), refId });
  }
}

const ncRechazadas = cambios.filter((c) => c.tipo === "07" && c.a === "rechazado" && c.refId);

console.log(`\nComprobantes 'aceptado'/'observado' con CDR analizados: ${rows.length}`);
console.log(`Cambios de estado a aplicar: ${cambios.length}`);
for (const c of cambios) console.log(`  • ${c.serie} (tipo ${c.tipo}): ${c.de} → ${c.a}   [${c.mensaje.slice(0, 70)}]`);
console.log(`\nNotas de crédito → 'rechazado': ${ncRechazadas.length} (se corrige "(ACEPTADA)"→"(RECHAZADA)" en su factura para desbloquear la re-emisión):`);
for (const nc of ncRechazadas) console.log(`  • ${nc.serie}  (factura ref: ${nc.refId})`);

if (!APPLY) {
  console.log("\n🟡 DRY-RUN: no se escribió nada. Re-ejecuta con --apply para aplicar.");
  process.exit(0);
}

// 2) Aplicar — idempotente (guards por estado/texto).
let n1 = 0,
  n2 = 0;
for (const c of cambios) {
  psql(`UPDATE comprobantes SET estado='${esc(c.a)}', mensaje_sunat='${esc(c.mensaje)}' WHERE id='${esc(c.id)}' AND estado IN ('aceptado','observado')`);
  n1++;
}
for (const nc of ncRechazadas) {
  // Solo la mención de ESTA NC en la factura (preciso; no toca otras NC).
  psql(`UPDATE comprobantes SET observaciones = REPLACE(observaciones, '${esc(nc.serie)} (ACEPTADA)', '${esc(nc.serie)} (RECHAZADA)') WHERE id='${esc(nc.refId)}'`);
  n2++;
}
console.log(`\n✅ Aplicado: ${n1} estados corregidos + ${n2} facturas con observaciones corregidas. (Cobranzas intactas.)`);

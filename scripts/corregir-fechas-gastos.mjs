#!/usr/bin/env node
// scripts/corregir-fechas-gastos.mjs
//
// Reubica en su día los gastos que se cargaron con la fecha de hoy porque la
// pantalla no dejaba elegirla. La fecha real está escrita DENTRO de la
// descripción ("Gasto: Otros - PETER CON 13-07"), que fue el apaño que encontró
// la administradora: este script la extrae y la pone donde corresponde.
//
//   node scripts/corregir-fechas-gastos.mjs                 # DRY-RUN (no toca nada)
//   node scripts/corregir-fechas-gastos.mjs --apply         # aplica
//   node scripts/corregir-fechas-gastos.mjs --prod          # contra producción (.env)
//   node scripts/corregir-fechas-gastos.mjs --anio 2026     # año a asumir (default: el actual)
//
// Por defecto trabaja contra dev-hugo (.env.local). SIEMPRE correr primero el
// dry-run y hacer que Marianela revise la lista antes de aplicar.
//
// Qué actualiza, por gasto (en una transacción):
//   gastos.fecha, transacciones.fecha y transacciones.created_at (hora conservada).
// El monto y la cuenta NO se tocan: el dinero ya se movió.
//
// Node 26: usa `psql` como I/O, NO @neondatabase/serverless (gotcha #13) — el
// mismo patrón de scripts/remediar-cdr-falsos-aceptados.mjs. Requiere psql en el
// PATH y DATABASE_URL_UNPOOLED en .env / .env.local.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const APLICAR = args.includes("--apply");
const PROD = args.includes("--prod");
const ANIO = Number(args[args.indexOf("--anio") + 1]) || new Date().getFullYear();

function urlDeEntorno() {
  const archivo = PROD ? ".env" : ".env.local";
  const linea = readFileSync(archivo, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL_UNPOOLED="));
  if (!linea) throw new Error(`No encontré DATABASE_URL_UNPOOLED en ${archivo}`);
  return linea.slice("DATABASE_URL_UNPOOLED=".length).trim().replace(/^["']|["']$/g, "");
}

/**
 * Extrae "13-07" / "13/07" del texto y lo convierte a fecha ISO.
 * Exige día 1-31 y mes 1-12 para no confundirse con un monto o un teléfono.
 */
export function fechaDesdeTexto(texto, anio) {
  if (!texto) return null;
  const m = String(texto).match(/(?:^|[\s(–—-])(\d{1,2})[-/](\d{1,2})(?!\d)/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  const iso = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  // Que la fecha exista de verdad (rechaza 31-02).
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1) return null;
  return iso;
}

const soles = (n) => `S/ ${Number(n).toFixed(2)}`;

const DB = urlDeEntorno();

/** Ejecuta SQL y devuelve las filas como arrays de strings (separador tab). */
function psql(sql) {
  const salida = execFileSync("psql", [DB, "-t", "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return salida.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

/** Escapa una comilla simple para interpolar en SQL. */
const esc = (v) => String(v ?? "").replace(/'/g, "''");

function main() {
  const hoy = psql("SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text")[0][0];

  console.log(`\n📋 Gastos con fecha en la descripción — ${PROD ? "PRODUCCIÓN" : "dev-hugo"}`);
  console.log(`   Año asumido: ${ANIO} · Modo: ${APLICAR ? "APLICAR" : "DRY-RUN (no toca nada)"}\n`);

  // El separador es tab, así que se limpia cualquier tab de la descripción.
  const rows = psql(`
    SELECT g.id, TO_CHAR(g.fecha,'YYYY-MM-DD'), g.categoria,
           REPLACE(COALESCE(g.descripcion,''), E'\\t', ' '), g.monto
    FROM gastos g ORDER BY g.created_at ASC
  `).map(([id, fecha, categoria, descripcion, monto]) => ({ id, fecha, categoria, descripcion, monto }));

  const cambios = [];
  const sinFecha = [];
  for (const g of rows) {
    const detectada = fechaDesdeTexto(g.descripcion, ANIO);
    if (!detectada) {
      sinFecha.push(g);
      continue;
    }
    if (detectada === g.fecha) continue; // ya está bien
    if (detectada > hoy) {
      console.log(`   ⚠️  ${g.descripcion} → ${detectada} es futura, se omite`);
      continue;
    }
    cambios.push({ ...g, nueva: detectada });
  }

  if (cambios.length === 0) {
    console.log("✅ No hay gastos que reubicar.\n");
  } else {
    console.log(`Se reubicarán ${cambios.length} gasto(s):\n`);
    console.log("   FECHA ACTUAL → FECHA REAL   MONTO        DESCRIPCIÓN");
    for (const c of cambios) {
      console.log(
        `   ${c.fecha} → ${c.nueva}   ${soles(c.monto).padEnd(12)} ${c.categoria} · ${c.descripcion}`
      );
    }
    console.log("");
  }

  if (sinFecha.length) {
    console.log(`ℹ️  ${sinFecha.length} gasto(s) sin fecha en el texto (hay que corregirlos a mano):`);
    for (const g of sinFecha) {
      console.log(`   ${g.fecha}  ${soles(g.monto).padEnd(12)} ${g.categoria} · ${g.descripcion ?? "(sin descripción)"}`);
    }
    console.log("");
  }

  if (!APLICAR) {
    console.log("🔍 DRY-RUN: no se modificó nada. Revisa la lista con Marianela y corre con --apply.\n");
    return;
  }

  let ok = 0;
  for (const c of cambios) {
    try {
      // Las dos tablas se mueven juntas. La transacción del ledger viaja con el
      // gasto: misma fecha y un created_at en ese día (conservando la hora), que
      // es lo que saca al gasto del arqueo de la caja de hoy.
      psql(`
        BEGIN;
        UPDATE gastos SET fecha = '${esc(c.nueva)}'::date,
               updated_at = (NOW() AT TIME ZONE 'America/Lima')
         WHERE id = '${esc(c.id)}';
        UPDATE transacciones
           SET fecha = '${esc(c.nueva)}'::date,
               created_at = ('${esc(c.nueva)}'::date + (created_at AT TIME ZONE 'America/Lima')::time) AT TIME ZONE 'America/Lima'
         WHERE referencia_id = '${esc(c.id)}';
        COMMIT;
      `);
      ok++;
    } catch (err) {
      console.error(`   ❌ ${c.descripcion}: ${err.message}`);
    }
  }
  console.log(`\n✅ ${ok}/${cambios.length} gasto(s) reubicados.\n`);
}

try {
  main();
} catch (err) {
  console.error("❌ Error:", err);
  process.exitCode = 1;
}

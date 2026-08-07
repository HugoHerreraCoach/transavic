#!/usr/bin/env node
// scripts/alinear-created-at-pagos-proveedor.mjs
//
// Pone el `created_at` de los PAGOS A PROVEEDOR retroactivos en el día que dice
// su propia `fecha` (conservando la hora), para que dejen de caer en el arqueo
// de la caja equivocada.
//
// Por qué (6 ago 2026): `lib/proveedores/pagos.ts` escribía la `fecha` elegida
// por la usuaria pero dejaba el `created_at` en NOW(). El arqueo de caja filtra
// por `created_at >= caja.abierta_at` (api/caja-diaria/route.ts:295,305), así
// que un pago de julio tecleado en agosto descontaba del efectivo esperado de
// HOY. El código ya quedó corregido (created_at sintético, mismo patrón que el
// POS); esto alinea las filas que se cargaron antes del arreglo.
//
//   node scripts/alinear-created-at-pagos-proveedor.mjs           # DRY-RUN
//   node scripts/alinear-created-at-pagos-proveedor.mjs --apply
//   node scripts/alinear-created-at-pagos-proveedor.mjs --prod --apply
//
// NO toca montos, ni cuentas, ni `fecha`, ni saldos: el dinero ya se movió y
// los saldos ya lo reflejan. Solo cambia a qué TURNO DE CAJA pertenece el
// movimiento. Antes de aplicar deja un respaldo CSV con el created_at original.
//
// Alcance deliberadamente angosto — solo filas que cumplen LAS DOS cosas:
//   1. `concepto LIKE 'Pago a Proveedor%'`
//   2. el created_at (en hora de Lima) es POSTERIOR a la fecha
// La condición 2 importa: hay 6 movimientos del POS con el desfase al revés
// (created_at ANTERIOR a la fecha), que son otro bug — ahí la `fecha` quedó en
// UTC, un día adelantada. Ésos NO se tocan; corregirlos con esta regla los
// empeoraría.
//
// Node 26: usa `psql` como I/O, NO @neondatabase/serverless (gotcha #13).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const APLICAR = args.includes("--apply");
const PROD = args.includes("--prod");

// Las dos condiciones del alcance, en un solo lugar: el conteo, el listado, el
// respaldo y el UPDATE tienen que usar EXACTAMENTE el mismo filtro.
// Se usa con la tabla aliaseada como `t` en TODAS las consultas (incluido el
// UPDATE, que en Postgres admite alias).
const FILTRO = `
  t.concepto LIKE 'Pago a Proveedor%'
  AND (t.created_at AT TIME ZONE 'America/Lima')::date > t.fecha
`;

function urlDeEntorno() {
  const archivo = PROD ? ".env" : ".env.local";
  const linea = readFileSync(archivo, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL_UNPOOLED="));
  if (!linea) throw new Error(`No encontré DATABASE_URL_UNPOOLED en ${archivo}`);
  return linea.slice("DATABASE_URL_UNPOOLED=".length).trim().replace(/^["']|["']$/g, "");
}

const DB = urlDeEntorno();

function psql(sql, extra = []) {
  const salida = execFileSync("psql", [DB, "-t", "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1", ...extra, "-c", sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return salida.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

const soles = (n) => `S/ ${Number(n).toFixed(2)}`;

function main() {
  console.log(`\n🧾 Pagos a proveedor con el created_at fuera de su día — ${PROD ? "PRODUCCIÓN" : "dev-hugo"}`);
  console.log(`   Modo: ${APLICAR ? "APLICAR" : "DRY-RUN (no toca nada)"}\n`);

  const filas = psql(`
    SELECT t.id,
           TO_CHAR(t.fecha, 'YYYY-MM-DD'),
           TO_CHAR(t.created_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI'),
           t.monto,
           REPLACE(t.concepto, E'\\t', ' '),
           COALESCE(c.nombre, '?')
      FROM transacciones t
      LEFT JOIN cuentas_bancarias c ON c.id = t.cuenta_id
     WHERE ${FILTRO}
     ORDER BY t.fecha, t.created_at
  `).map(([id, fecha, creado, monto, concepto, cuenta]) => ({ id, fecha, creado, monto, concepto, cuenta }));

  if (filas.length === 0) {
    console.log("✅ No hay nada que alinear.\n");
    return;
  }

  // Resumen por día de teclado: es lo que explica el descuadre de cada caja.
  const porDiaTecleado = new Map();
  for (const f of filas) {
    const dia = f.creado.slice(0, 10);
    const acc = porDiaTecleado.get(dia) ?? { n: 0, monto: 0 };
    acc.n += 1;
    acc.monto += Number(f.monto);
    porDiaTecleado.set(dia, acc);
  }

  console.log(`Se alinearán ${filas.length} movimiento(s), por un total de ${soles(filas.reduce((s, f) => s + Number(f.monto), 0))}.\n`);
  console.log("   Salen del arqueo del día en que se tecleó:");
  for (const [dia, acc] of [...porDiaTecleado].sort()) {
    console.log(`   ${dia}   ${String(acc.n).padStart(3)} movimiento(s)   ${soles(acc.monto)}`);
  }

  console.log("\n   Y vuelven a su día real:");
  const porFecha = new Map();
  for (const f of filas) {
    const acc = porFecha.get(f.fecha) ?? { n: 0, monto: 0 };
    acc.n += 1;
    acc.monto += Number(f.monto);
    porFecha.set(f.fecha, acc);
  }
  for (const [dia, acc] of [...porFecha].sort()) {
    console.log(`   ${dia}   ${String(acc.n).padStart(3)} movimiento(s)   ${soles(acc.monto)}`);
  }
  console.log("");

  if (!APLICAR) {
    console.log("🔍 DRY-RUN: no se modificó nada. Corre con --apply cuando esté revisado.\n");
    return;
  }

  // Respaldo ANTES de tocar: con esto se puede reconstruir el created_at previo.
  mkdirSync("scripts/respaldos", { recursive: true });
  const marca = psql("SELECT TO_CHAR(NOW() AT TIME ZONE 'America/Lima', 'YYYYMMDD-HH24MI')")[0][0];
  const ruta = `scripts/respaldos/created-at-pagos-${PROD ? "prod" : "dev"}-${marca}.csv`;
  const csv = [
    "id,fecha,created_at_original_lima,monto,cuenta,concepto",
    ...filas.map((f) => `${f.id},${f.fecha},${f.creado},${f.monto},"${f.cuenta}","${f.concepto.replace(/"/g, '""')}"`),
  ].join("\n");
  writeFileSync(ruta, csv);
  console.log(`💾 Respaldo: ${ruta}`);

  // Un solo UPDATE, en su propia transacción (-1). La hora se conserva; solo
  // cambia el día. Vuelve a evaluar el mismo filtro, así que es idempotente.
  const afectadas = psql(
    `UPDATE transacciones t
        SET created_at = (t.fecha + (t.created_at AT TIME ZONE 'America/Lima')::time) AT TIME ZONE 'America/Lima'
      WHERE ${FILTRO}
      RETURNING 1`,
    ["-1"]
  ).length;

  const quedan = psql(`SELECT COUNT(*) FROM transacciones t WHERE ${FILTRO}`)[0][0];
  console.log(`\n✅ ${afectadas} movimiento(s) alineados. Quedan sin alinear: ${quedan}.\n`);
}

try {
  main();
} catch (err) {
  console.error("❌ Error:", err.message ?? err);
  process.exitCode = 1;
}

// Prueba de integracion REAL sobre dev-hugo. Crea fixtures aislados y los borra.
// Requiere que la migracion de pagos ya este aplicada:
//   RUN_DB_TESTS=1 node --no-warnings scripts/test-pagos-proveedores-db.mjs
import assert from "node:assert/strict";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import {
  anularPagoProveedor,
  consultaBloqueoProveedor,
  consultasAplicarAnticiposADeuda,
  PagoProveedorError,
  registrarPagoProveedor,
} from "../src/lib/proveedores/pagos.ts";

if (process.env.RUN_DB_TESTS !== "1") {
  throw new Error("Esta prueba escribe fixtures temporales. Ejecuta con RUN_DB_TESTS=1.");
}
// Fuerza la URL de dev-hugo aunque el shell tenga otra DATABASE_URL exportada.
config({ path: ".env.local", override: true });
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL_UNPOOLED en .env.local");
const sql = neon(connectionString);

const proveedorId = crypto.randomUUID();
const otroProveedorId = crypto.randomUUID();
const cuentaId = crypto.randomUUID();
const deudaId = crypto.randomUUID();
const deudaFuturaId = crypto.randomUUID();
const deudaAjenaId = crypto.randomUUID();
const pagoGrandeId = crypto.randomUUID();
const pagoDosId = crypto.randomUUID();
const pagoTresId = crypto.randomUUID();
const pagoCarreraUno = crypto.randomUUID();
const pagoCarreraDos = crypto.randomUUID();
const pagos = [pagoGrandeId, pagoDosId, pagoTresId, pagoCarreraUno, pagoCarreraDos];

let usuarioId;
try {
  const usuarios = await sql`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`;
  assert.ok(usuarios.length > 0, "dev-hugo necesita un usuario admin para la prueba");
  usuarioId = usuarios[0].id;

  await sql.transaction([
    sql`INSERT INTO proveedores (id, razon_social, telefono, tipo, activo) VALUES (${proveedorId}, 'QA Pago Proveedor Temporal', '999999999', 'secundario', TRUE)`,
    sql`INSERT INTO proveedores (id, razon_social, telefono, tipo, activo) VALUES (${otroProveedorId}, 'QA Otro Proveedor Temporal', '999999998', 'secundario', TRUE)`,
    sql`INSERT INTO cuentas_bancarias (id, nombre, tipo, saldo, activa) VALUES (${cuentaId}, ${`QA Cuenta ${cuentaId}`}, 'banco', 0, TRUE)`,
    sql`INSERT INTO cuentas_por_pagar (id, proveedor_id, monto_deuda, monto_pagado, estado, concepto) VALUES (${deudaId}, ${proveedorId}, 3636.81, 0, 'Pendiente', 'QA deuda inicial')`,
    sql`INSERT INTO cuentas_por_pagar (id, proveedor_id, monto_deuda, monto_pagado, estado, concepto) VALUES (${deudaAjenaId}, ${otroProveedorId}, 100, 0, 'Pendiente', 'QA deuda ajena')`,
  ]);

  const inputGrande = {
    id: pagoGrandeId,
    proveedor_id: proveedorId,
    cuenta_bancaria_id: cuentaId,
    monto: 18_500,
    fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()),
    notas: "QA pago grande",
    deuda_prioritaria_id: deudaId,
    confirmar_anticipo: false,
  };

  // Dos IDs distintos ven inicialmente la misma deuda. Solo uno puede
  // consumirla; el segundo debe recibir confirmacion de anticipo DESPUES del lock.
  const carrera = await Promise.allSettled([
    registrarPagoProveedor(sql, usuarioId, {
      ...inputGrande,
      id: pagoCarreraUno,
      monto: 3000,
      notas: "QA carrera uno",
    }),
    registrarPagoProveedor(sql, usuarioId, {
      ...inputGrande,
      id: pagoCarreraDos,
      monto: 3000,
      notas: "QA carrera dos",
    }),
  ]);
  assert.equal(carrera.filter((r) => r.status === "fulfilled").length, 1);
  const rechazoCarrera = carrera.find((r) => r.status === "rejected");
  assert.ok(
    rechazoCarrera?.status === "rejected" &&
      rechazoCarrera.reason instanceof PagoProveedorError &&
      rechazoCarrera.reason.codigo === "ANTICIPO_REQUIERE_CONFIRMACION"
  );
  const pagoCarreraActivo = await sql`
    SELECT id FROM pagos_proveedores
    WHERE id = ANY(${[pagoCarreraUno, pagoCarreraDos]}::uuid[]) AND estado = 'registrado'
  `;
  assert.equal(pagoCarreraActivo.length, 1);
  await anularPagoProveedor(
    sql,
    usuarioId,
    proveedorId,
    pagoCarreraActivo[0].id,
    "Reversion carrera QA"
  );

  await assert.rejects(
    () => registrarPagoProveedor(sql, usuarioId, inputGrande),
    (error) => error instanceof PagoProveedorError && error.codigo === "ANTICIPO_REQUIERE_CONFIRMACION"
  );

  // Dos solicitudes concurrentes con el mismo UUID deben producir un solo pago,
  // una sola transaccion bancaria y una sola aplicacion.
  await Promise.all([
    registrarPagoProveedor(sql, usuarioId, { ...inputGrande, confirmar_anticipo: true }),
    registrarPagoProveedor(sql, usuarioId, { ...inputGrande, confirmar_anticipo: true }),
  ]);
  const trasPago = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM pagos_proveedores WHERE id = ${pagoGrandeId}) AS pagos,
      (SELECT COUNT(*)::int FROM transacciones WHERE pago_proveedor_id = ${pagoGrandeId} AND tipo = 'egreso') AS egresos,
      (SELECT COALESCE(SUM(monto), 0)::float8 FROM pagos_proveedores_aplicaciones WHERE pago_id = ${pagoGrandeId}) AS aplicado
  `;
  assert.equal(trasPago[0].pagos, 1);
  assert.equal(trasPago[0].egresos, 1);
  assert.equal(trasPago[0].aplicado, 3636.81);

  // Una deuda futura consume el anticipo sin crear otro egreso bancario.
  await sql.transaction([
    consultaBloqueoProveedor(sql, proveedorId),
    sql`INSERT INTO cuentas_por_pagar (id, proveedor_id, monto_deuda, monto_pagado, estado, concepto) VALUES (${deudaFuturaId}, ${proveedorId}, 1000, 0, 'Pendiente', 'QA deuda futura')`,
    ...consultasAplicarAnticiposADeuda(sql, proveedorId, deudaFuturaId, inputGrande.fecha),
  ]);
  const futura = await sql`SELECT monto_pagado::float8 AS pagado, estado FROM cuentas_por_pagar WHERE id = ${deudaFuturaId}`;
  assert.equal(futura[0].pagado, 1000);
  assert.equal(futura[0].estado, "Pagado");

  await assert.rejects(
    () => registrarPagoProveedor(sql, usuarioId, { ...inputGrande, id: crypto.randomUUID(), deuda_prioritaria_id: deudaAjenaId, confirmar_anticipo: true }),
    (error) => error instanceof PagoProveedorError && error.codigo === "DEUDA_DE_OTRO_PROVEEDOR"
  );

  // Un proveedor inactivo conserva su historial y puede recibir pagos.
  await sql`UPDATE proveedores SET activo = FALSE WHERE id = ${proveedorId}`;
  for (const [id, monto] of [[pagoDosId, 10], [pagoTresId, 20]]) {
    await registrarPagoProveedor(sql, usuarioId, {
      ...inputGrande,
      id,
      monto,
      notas: `QA pago ${monto}`,
      deuda_prioritaria_id: null,
      confirmar_anticipo: true,
    });
  }
  const separados = await sql`SELECT COUNT(*)::int AS total FROM pagos_proveedores WHERE id = ANY(${[pagoGrandeId, pagoDosId, pagoTresId]}::uuid[])`;
  assert.equal(separados[0].total, 3);

  const anulacionesConcurrentes = await Promise.all([
    anularPagoProveedor(sql, usuarioId, proveedorId, pagoGrandeId, "Reversion QA"),
    anularPagoProveedor(sql, usuarioId, proveedorId, pagoGrandeId, "Reversion QA"),
  ]);
  assert.ok(anulacionesConcurrentes.every((r) => r.anulado));
  const reversos = await sql`
    SELECT COUNT(*)::int AS total FROM transacciones
    WHERE pago_proveedor_id = ${pagoGrandeId} AND tipo = 'ingreso'
  `;
  assert.equal(reversos[0].total, 1);
  const repetida = await anularPagoProveedor(sql, usuarioId, proveedorId, pagoGrandeId, "Reversion QA");
  assert.equal(repetida.repetido, true);
  await anularPagoProveedor(sql, usuarioId, proveedorId, pagoDosId, "Reversion QA");
  await anularPagoProveedor(sql, usuarioId, proveedorId, pagoTresId, "Reversion QA");

  const saldoCuenta = await sql`SELECT saldo::float8 AS saldo FROM cuentas_bancarias WHERE id = ${cuentaId}`;
  assert.equal(saldoCuenta[0].saldo, 0);
  console.log("OK DB: idempotencia, concurrencia, anticipos, cruce, inactivo y anulacion");
} finally {
  // Limpieza ordenada; no toca ningun dato ajeno al prefijo/UUID de la prueba.
  await sql`DELETE FROM transacciones WHERE pago_proveedor_id = ANY(${pagos}::uuid[])`;
  await sql`DELETE FROM pagos_proveedores_aplicaciones WHERE pago_id = ANY(${pagos}::uuid[])`;
  await sql`DELETE FROM pagos_proveedores WHERE id = ANY(${pagos}::uuid[])`;
  await sql`DELETE FROM cuentas_por_pagar WHERE id = ANY(${[deudaId, deudaFuturaId, deudaAjenaId]}::uuid[])`;
  await sql`DELETE FROM proveedores WHERE id = ANY(${[proveedorId, otroProveedorId]}::uuid[])`;
  await sql`DELETE FROM cuentas_bancarias WHERE id = ${cuentaId}`;
}

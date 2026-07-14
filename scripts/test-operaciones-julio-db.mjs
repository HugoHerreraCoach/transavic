// Integración real y autolimpiable sobre dev-hugo:
// - replay de UUID no duplica cabecera, ítems ni notificaciones;
// - el costo POS queda congelado aunque cambie el catálogo.
import assert from "node:assert/strict";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import {
  redondearDecimalPedido,
} from "../src/lib/pedidos-idempotencia.ts";
import {
  subtotalVentaPos,
} from "../src/lib/planta/ventas-pos.ts";

if (process.env.RUN_DB_TESTS !== "1") {
  throw new Error("Esta prueba escribe fixtures temporales. Ejecuta con RUN_DB_TESTS=1.");
}

// override=true es deliberado: una variable exportada en el shell nunca debe
// hacer que esta prueba de desarrollo apunte accidentalmente a producción.
config({ path: ".env.local", override: true });
const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL_UNPOOLED en .env.local");
const sql = neon(connectionString);

const pedidoId = crypto.randomUUID();
const posPedidoId = crypto.randomUUID();
const nombreQa = `QA idempotencia ${pedidoId}`;

let usuarioId;
let producto;

try {
  const usuarios = await sql`
    SELECT id FROM users
    WHERE role IN ('admin', 'asesor')
    ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
    LIMIT 1
  `;
  assert.ok(usuarios.length > 0, "dev-hugo necesita un admin o asesor");
  usuarioId = usuarios[0].id;

  const productos = await sql`
    SELECT id, nombre, precio_venta::float8 AS precio_venta,
           precio_compra::float8 AS precio_compra
    FROM productos
    WHERE precio_compra IS NOT NULL AND precio_venta IS NOT NULL
    ORDER BY id
    LIMIT 1
  `;
  assert.ok(productos.length > 0, "dev-hugo necesita un producto con costo y precio");
  producto = productos[0];

  const cantidad = redondearDecimalPedido(1.234, 2);
  const crearPedido = () => [
    sql`
      INSERT INTO pedidos (
        id, cliente, detalle, empresa, fecha_pedido, asesor_id, origen,
        latitude, longitude
      ) VALUES (
        ${pedidoId}, ${nombreQa}, '1.234 kg QA', 'Transavic',
        (NOW() AT TIME ZONE 'America/Lima')::date, ${usuarioId}, 'asesor',
        -12.04637402, -77.04279382
      )
    `,
    sql`
      INSERT INTO pedido_items (
        pedido_id, producto_id, producto_nombre, cantidad, unidad,
        unidad_pedido, precio_unitario, subtotal
      ) VALUES (
        ${pedidoId}, ${producto.id}, ${producto.nombre}, ${cantidad}, 'kg', 'kg',
        ${producto.precio_venta}, ${subtotalVentaPos(cantidad, producto.precio_venta)}
      )
    `,
    sql`
      INSERT INTO notificaciones (user_id, tipo, titulo, mensaje, link, pedido_id)
      SELECT id, 'pedido_creado', 'QA pedido', ${nombreQa},
             '/dashboard/produccion', ${pedidoId}
      FROM users WHERE role = 'produccion'
    `,
  ];

  await sql.transaction(crearPedido());
  await assert.rejects(
    () => sql.transaction(crearPedido()),
    (error) => error?.code === "23505",
    "el segundo INSERT del mismo UUID debe colisionar sin ejecutar el resto del batch"
  );

  const conteos = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM pedidos WHERE id = ${pedidoId}) AS pedidos,
      (SELECT COUNT(*)::int FROM pedido_items WHERE pedido_id = ${pedidoId}) AS items,
      (SELECT COUNT(*)::int FROM notificaciones WHERE pedido_id = ${pedidoId}) AS notificaciones,
      (SELECT COUNT(*)::int FROM users WHERE role = 'produccion') AS destinatarios
  `;
  assert.equal(conteos[0].pedidos, 1);
  assert.equal(conteos[0].items, 1);
  assert.equal(conteos[0].notificaciones, conteos[0].destinatarios);

  const costoOriginal = Number(producto.precio_compra);
  const costoNuevo = Math.round((costoOriginal + 1.11) * 100) / 100;
  const subtotal = subtotalVentaPos(1.23, Number(producto.precio_venta));
  const resultados = await sql.transaction([
    sql`
      INSERT INTO pedidos (
        id, cliente, detalle, detalle_final, estado, empresa, fecha_pedido,
        asesor_id, origen, entregado
      ) VALUES (
        ${posPedidoId}, 'QA POS costo', 'QA POS costo', 'QA POS costo',
        'Entregado', 'Transavic', (NOW() AT TIME ZONE 'America/Lima')::date,
        ${usuarioId}, 'pos_planta', TRUE
      )
    `,
    sql`
      INSERT INTO pedido_items (
        pedido_id, producto_id, producto_nombre, cantidad, unidad,
        unidad_pedido, precio_unitario, subtotal, subtotal_real,
        costo_unitario_snapshot
      )
      SELECT ${posPedidoId}, id, nombre, 1.23, 'kg', 'kg',
             precio_venta, ${subtotal}, ${subtotal}, precio_compra
      FROM productos WHERE id = ${producto.id}
    `,
    sql`UPDATE productos SET precio_compra = ${costoNuevo} WHERE id = ${producto.id}`,
    sql`
      SELECT pi.costo_unitario_snapshot::float8 AS snapshot,
             p.precio_compra::float8 AS costo_actual
      FROM pedido_items pi
      JOIN productos p ON p.id = pi.producto_id
      WHERE pi.pedido_id = ${posPedidoId}
    `,
    sql`UPDATE productos SET precio_compra = ${costoOriginal} WHERE id = ${producto.id}`,
    sql`DELETE FROM pedidos WHERE id = ${posPedidoId}`,
  ]);
  const evidenciaCosto = resultados[3][0];
  assert.equal(evidenciaCosto.snapshot, costoOriginal);
  assert.equal(evidenciaCosto.costo_actual, costoNuevo);

  console.log("OK DB: UUID idempotente y costo POS histórico inmutable");
} finally {
  await sql`DELETE FROM notificaciones WHERE pedido_id = ANY(${[pedidoId, posPedidoId]}::uuid[])`;
  await sql`DELETE FROM pedidos WHERE id = ANY(${[pedidoId, posPedidoId]}::uuid[])`;
  if (producto?.id && producto?.precio_compra !== undefined) {
    await sql`
      UPDATE productos SET precio_compra = ${Number(producto.precio_compra)}
      WHERE id = ${producto.id}
    `;
  }
}

import { neon } from '@neondatabase/serverless';

const prodDbUrl = "postgres://neondb_owner:npg_UNCfhQeidK96@ep-cool-sound-adxrsjt5-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function main() {
  console.log("Connecting to production database...");
  const sql = neon(prodDbUrl);

  // 1. Orders count by fecha_pedido (delivery date)
  const ordersCount = await sql`
    SELECT fecha_pedido, COUNT(*) as count 
    FROM pedidos 
    WHERE fecha_pedido BETWEEN '2026-07-15' AND '2026-07-19'
    GROUP BY fecha_pedido
    ORDER BY fecha_pedido
  `;
  console.log("\nOrders count by delivery date (fecha_pedido):");
  console.table(ordersCount);

  // 2. Querying all orders in the range
  const ordersDetails = await sql`
    SELECT id, cliente, ruc_dni, fecha_pedido, estado, empresa, created_at, asesor_id
    FROM pedidos
    WHERE fecha_pedido BETWEEN '2026-07-16' AND '2026-07-18'
    ORDER BY fecha_pedido, cliente
  `;
  console.log("\nOrders details:");
  console.table(ordersDetails.map(o => ({
    id: o.id.substring(0, 8),
    cliente: o.cliente,
    ruc_dni: o.ruc_dni,
    fecha_pedido: o.fecha_pedido.toISOString().split('T')[0],
    estado: o.estado,
    empresa: o.empresa,
    created_at: o.created_at,
    asesor_id: o.asesor_id
  })));

  // 3. Querying all items in the range
  const items = await sql`
    SELECT pi.pedido_id, p.cliente, p.fecha_pedido, pi.producto_nombre, pi.cantidad, pi.unidad, pi.precio_unitario, pi.subtotal, pi.cantidad_real, pi.subtotal_real
    FROM pedido_items pi
    JOIN pedidos p ON pi.pedido_id = p.id
    WHERE p.fecha_pedido BETWEEN '2026-07-16' AND '2026-07-18'
    ORDER BY p.fecha_pedido, p.cliente
  `;
  console.log("\nItems details:");
  console.table(items.map(i => ({
    pedido_id: i.pedido_id.substring(0, 8),
    cliente: i.cliente,
    fecha_pedido: i.fecha_pedido.toISOString().split('T')[0],
    producto: i.producto_nombre,
    cant: i.cantidad,
    uni: i.unidad,
    precio: i.precio_unitario,
    subtotal: i.subtotal,
    cant_real: i.cantidad_real,
    sub_real: i.subtotal_real
  })));

  // 4. Querying all comprobantes in the range (using relationship to pedidos)
  const comps = await sql`
    SELECT c.id, c.pedido_id, p.cliente, p.fecha_pedido as pedido_fecha, c.tipo, c.serie_numero, c.cliente_razon_social, c.monto_total, c.created_at
    FROM comprobantes c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    WHERE p.fecha_pedido BETWEEN '2026-07-16' AND '2026-07-18'
       OR c.created_at::date BETWEEN '2026-07-16' AND '2026-07-18'
    ORDER BY c.created_at
  `;
  console.log("\nComprobantes linked to these dates or created in these dates:");
  console.table(comps.map(c => ({
    id: c.id.substring(0, 8),
    pedido_id: c.pedido_id ? c.pedido_id.substring(0, 8) : 'null',
    pedido_cliente: c.cliente || 'null',
    pedido_fecha: c.pedido_fecha ? c.pedido_fecha.toISOString().split('T')[0] : 'null',
    tipo: c.tipo,
    serie_numero: c.serie_numero,
    cliente_razon: c.cliente_razon_social,
    monto: c.monto_total,
    created_at: c.created_at.toISOString()
  })));
}

main().catch(console.error);

import { neon } from '@neondatabase/serverless';

const prodDbUrl = "postgres://neondb_owner:npg_UNCfhQeidK96@ep-cool-sound-adxrsjt5-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const sql = neon(prodDbUrl);

  // Get users map
  const users = await sql`SELECT id, name, role FROM users`;
  const usersMap = {};
  users.forEach(u => {
    usersMap[u.id] = u.name.trim();
  });
  console.log("Users/Advisors in the system:");
  console.table(users);

  // Get orders and sum of item subtotals (both preventa and real)
  const orders = await sql`
    SELECT 
      p.id, 
      p.cliente, 
      p.fecha_pedido, 
      p.estado, 
      p.empresa, 
      p.asesor_id,
      COALESCE((SELECT SUM(precio_unitario * cantidad) FROM pedido_items WHERE pedido_id = p.id), 0) as total_preventa,
      COALESCE((SELECT SUM(subtotal_real) FROM pedido_items WHERE pedido_id = p.id), 0) as total_real_items,
      (SELECT STRING_AGG(producto_nombre || ': ' || cantidad || ' ' || unidad || ' (Real: ' || COALESCE(cantidad_real::text, 'null') || ' ' || unidad || ')', ', ') FROM pedido_items WHERE pedido_id = p.id) as items_desc
    FROM pedidos p
    WHERE p.fecha_pedido BETWEEN '2026-07-16' AND '2026-07-18'
    ORDER BY p.fecha_pedido, p.cliente
  `;

  // Get comprobantes for these dates
  const comps = await sql`
    SELECT 
      c.id, 
      c.pedido_id, 
      c.tipo, 
      c.serie_numero, 
      c.cliente_razon_social, 
      c.monto_total, 
      c.created_at,
      p.cliente as pedido_cliente,
      p.fecha_pedido as pedido_fecha
    FROM comprobantes c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    WHERE p.fecha_pedido BETWEEN '2026-07-16' AND '2026-07-18'
       OR c.created_at::date BETWEEN '2026-07-16' AND '2026-07-18'
    ORDER BY c.created_at
  `;

  console.log("\n=================== DETAILED ANALYSIS OF DATABASE ===================");

  for (const date of ['2026-07-16', '2026-07-17', '2026-07-18']) {
    console.log(`\n------------------- DATE: ${date} -------------------`);
    
    // Filter orders for this date
    const dateOrders = orders.filter(o => o.fecha_pedido.toISOString().split('T')[0] === date);
    console.log(`\nOrders in App (Delivery Date = ${date}): total ${dateOrders.length}`);
    const ordersTable = dateOrders.map(o => ({
      id: o.id.substring(0, 8),
      cliente: o.cliente,
      asesor: usersMap[o.asesor_id] || 'Desconocido',
      empresa: o.empresa,
      estado: o.estado,
      total_preventa: parseFloat(o.total_preventa).toFixed(2),
      total_real: parseFloat(o.total_real_items).toFixed(2),
    }));
    console.table(ordersTable);

    // Filter comprobantes created on this date or linked to orders on this date
    const dateComps = comps.filter(c => {
      const isLinkedToOrderOfThisDate = c.pedido_fecha && c.pedido_fecha.toISOString().split('T')[0] === date;
      const isCreatedOnThisDate = c.created_at.toISOString().split('T')[0] === date;
      return isLinkedToOrderOfThisDate || isCreatedOnThisDate;
    });

    console.log(`\nComprobantes in App linked or created on ${date}: total ${dateComps.length}`);
    const compsTable = dateComps.map(c => ({
      id: c.id.substring(0, 8),
      pedido_id: c.pedido_id ? c.pedido_id.substring(0, 8) : 'null',
      cliente_doc: c.cliente_razon_social,
      tipo: c.tipo === '01' ? 'Factura' : c.tipo === '03' ? 'Boleta' : c.tipo === '07' ? 'N.Crédito' : c.tipo,
      serie_numero: c.serie_numero,
      monto: parseFloat(c.monto_total).toFixed(2),
      created_at: c.created_at.toISOString().replace('T', ' ').substring(0, 19),
      linked_pedido_cliente: c.pedido_cliente || 'null'
    }));
    console.table(compsTable);
  }

  // Print all items description for verification
  console.log("\n=================== ITEMS IN ORDERS ===================");
  orders.forEach(o => {
    console.log(`Order: ${o.id.substring(0, 8)} | Date: ${o.fecha_pedido.toISOString().split('T')[0]} | Client: ${o.cliente} | Prev: ${parseFloat(o.total_preventa).toFixed(2)} | Real: ${parseFloat(o.total_real_items).toFixed(2)}`);
    console.log(`   Items: ${o.items_desc}`);
  });
}

main().catch(console.error);

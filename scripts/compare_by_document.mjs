import { neon } from '@neondatabase/serverless';

const prodDbUrl = "postgres://neondb_owner:npg_UNCfhQeidK96@ep-cool-sound-adxrsjt5-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const sql = neon(prodDbUrl);

  // Fetch all users to map asesor_id
  const users = await sql`SELECT id, name FROM users`;
  const usersMap = {};
  users.forEach(u => {
    usersMap[u.id] = u.name.trim();
  });

  // Fetch all comprobantes between July 15 and July 19 (created_at)
  const comps = await sql`
    SELECT 
      c.id as comp_id,
      c.pedido_id,
      c.tipo,
      c.serie_numero,
      c.cliente_razon_social,
      c.monto_total,
      c.created_at as comp_created,
      p.cliente as ped_cliente,
      p.fecha_pedido as ped_fecha,
      p.estado as ped_estado,
      p.empresa as ped_empresa,
      p.asesor_id as ped_asesor_id,
      (SELECT SUM(subtotal_real) FROM pedido_items WHERE pedido_id = p.id) as ped_total_real,
      (SELECT SUM(precio_unitario * cantidad) FROM pedido_items WHERE pedido_id = p.id) as ped_total_preventa
    FROM comprobantes c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    WHERE c.created_at::date BETWEEN '2026-07-15' AND '2026-07-19'
       OR p.fecha_pedido BETWEEN '2026-07-15' AND '2026-07-19'
    ORDER BY c.serie_numero
  `;

  console.log(`Found ${comps.length} comprobantes in database`);

  // Write detailed records for comparison
  const data = comps.map(c => ({
    serie_numero: c.serie_numero,
    tipo: c.tipo === '01' ? 'Factura' : c.tipo === '03' ? 'Boleta' : c.tipo === '07' ? 'NC' : c.tipo,
    monto_cpe: parseFloat(c.monto_total).toFixed(2),
    cliente_cpe: c.cliente_razon_social,
    pedido_cliente: c.ped_cliente || 'SIN PEDIDO VINCULADO',
    pedido_fecha: c.ped_fecha ? c.ped_fecha.toISOString().split('T')[0] : 'N/A',
    pedido_estado: c.ped_estado || 'N/A',
    pedido_empresa: c.ped_empresa || 'N/A',
    pedido_total_real: c.ped_total_real ? parseFloat(c.ped_total_real).toFixed(2) : 'N/A',
    pedido_total_prev: c.ped_total_preventa ? parseFloat(c.ped_total_preventa).toFixed(2) : 'N/A',
    asesor: usersMap[c.ped_asesor_id] || 'N/A',
    created_at: c.comp_created.toISOString().substring(0, 19).replace('T', ' ')
  }));

  console.log("\n=================== ALL COMPROBANTES DETAILS ===================");
  console.table(data);
}

main().catch(console.error);

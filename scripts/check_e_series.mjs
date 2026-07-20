import { neon } from '@neondatabase/serverless';

const prodDbUrl = "postgres://neondb_owner:npg_UNCfhQeidK96@ep-cool-sound-adxrsjt5-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const sql = neon(prodDbUrl);

  // 1. Search for any document starting with 'E'
  const eComps = await sql`
    SELECT COUNT(*) as count FROM comprobantes WHERE serie_numero LIKE 'E%'
  `;
  console.log(`Comprobantes starting with 'E': ${eComps[0].count}`);

  // Fetch some if they exist
  if (eComps[0].count > 0) {
    const sample = await sql`
      SELECT id, serie_numero, cliente_razon_social, monto_total, created_at 
      FROM comprobantes 
      WHERE serie_numero LIKE 'E%' 
      LIMIT 10
    `;
    console.table(sample);
  }

  // 2. Search for any client named 'Ciro' or containing 'Ciro'
  const ciroClients = await sql`
    SELECT id, nombre, ruc_dni, whatsapp, distrito, asesor_id 
    FROM clientes 
    WHERE nombre ILIKE '%ciro%' OR razon_social ILIKE '%ciro%'
  `;
  console.log("\nClients containing 'Ciro':");
  console.table(ciroClients);

  // 3. Search for any orders for Ciro historically
  const ciroOrders = await sql`
    SELECT id, cliente, fecha_pedido, estado, created_at 
    FROM pedidos 
    WHERE cliente ILIKE '%ciro%' 
    ORDER BY fecha_pedido DESC 
    LIMIT 10
  `;
  console.log("\nOrders containing 'Ciro' historically:");
  console.table(ciroOrders);

  // 4. Search for other 'E001' or similar in database
  const series = await sql`
    SELECT DISTINCT serie FROM comprobantes ORDER BY serie
  `;
  console.log("\nDistinct series in comprobantes table:");
  console.table(series);
}

main().catch(console.error);

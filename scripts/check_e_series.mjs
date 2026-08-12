import { neon } from '@neondatabase/serverless';

// La cadena de conexión NUNCA va en el repo (esta línea tuvo la clave de producción
// en texto plano hasta el 11 ago 2026). Se lee del entorno:
//   DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" node scripts/check_e_series.mjs
const prodDbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
if (!prodDbUrl) {
  console.error("Falta DATABASE_URL (o DATABASE_URL_UNPOOLED) en el entorno.");
  process.exit(1);
}

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

import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS direccion_mapa TEXT`;
  console.log('✅ Columna direccion_mapa agregada exitosamente a la tabla pedidos');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

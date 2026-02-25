import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_por TEXT`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_at TIMESTAMP WITH TIME ZONE`;
  console.log('✅ Columnas entregado_por y entregado_at agregadas exitosamente');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

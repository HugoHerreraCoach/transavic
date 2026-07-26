// scripts/check-visualizador-activo.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL no está configurada.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    const user = (await sql`SELECT * FROM public.users WHERE name = 'el vizualizador'`)[0];
    console.log('Usuario completo:', JSON.stringify(user, null, 2));
  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

main();

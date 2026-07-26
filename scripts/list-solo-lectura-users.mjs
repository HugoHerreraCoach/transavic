// scripts/list-solo-lectura-users.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL no está configurada.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    const users = await sql`
      SELECT id, name, role, solo_lectura
      FROM public.users
      ORDER BY name;
    `;
    console.log('--- USUARIOS EN BASE DE DATOS ---');
    console.table(users);
  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

main();

// scripts/update-antonio-password.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcrypt';

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL no está configurada.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    const name = 'Antonio';
    const password = 'Antonio1234';
    const hash = await bcrypt.hash(password, 10);
    
    await sql`
      UPDATE public.users
      SET password = ${hash}
      WHERE name = ${name};
    `;
    console.log(`✅ Contraseña de "${name}" actualizada a: ${password}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

main();

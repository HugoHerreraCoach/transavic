// scripts/set-visualizador-password.mjs
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
    const password = 'Vizualizador123!';
    const hash = await bcrypt.hash(password, 10);
    
    await sql`
      UPDATE public.users
      SET password = ${hash}
      WHERE name = 'el vizualizador';
    `;
    console.log('✅ Contraseña de "el vizualizador" actualizada a: Vizualizador123!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

main();

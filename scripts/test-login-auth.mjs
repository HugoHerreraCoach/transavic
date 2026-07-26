// scripts/test-login-auth.mjs
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
    const user = (await sql`SELECT * FROM users WHERE name = 'el vizualizador'`)[0];
    if (!user) {
      console.log('❌ Usuario "el vizualizador" no encontrado.');
      return;
    }
    
    console.log('Usuario encontrado:', user.name);
    console.log('Hashed password:', user.password);
    
    const inputPassword = 'Vizualizador123!';
    const match = await bcrypt.compare(inputPassword, user.password);
    console.log(`¿La contraseña "${inputPassword}" coincide?:`, match ? '✅ SÍ' : '❌ NO');
  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

main();

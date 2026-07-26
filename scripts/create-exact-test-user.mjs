// scripts/create-exact-test-user.mjs
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
    const name = 'Vizualizador';
    const password = 'Vizualizador1234';
    const hash = await bcrypt.hash(password, 10);
    
    // Eliminar si ya existe para evitar conflictos
    await sql`DELETE FROM public.users WHERE name = ${name}`;
    
    // Insertar el usuario de solo lectura
    await sql`
      INSERT INTO public.users (name, password, role, solo_lectura, activo)
      VALUES (${name}, ${hash}, 'admin', TRUE, TRUE);
    `;
    console.log(`✅ Usuario "${name}" creado exitosamente con contraseña "${password}" y solo_lectura = TRUE.`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

main();

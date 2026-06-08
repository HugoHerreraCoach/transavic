import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const dividirNombreLocal = (fullName) => {
  const limpio = (fullName || "").trim().replace(/\s+/g, " ");
  if (!limpio) return { nombres: "", apellidos: "" };
  const palabras = limpio.split(" ");
  const n = palabras.length;
  if (n <= 1) return { nombres: limpio, apellidos: "-" };
  if (n === 2) return { nombres: palabras[0], apellidos: palabras[1] };
  if (n === 3) return { nombres: palabras[0], apellidos: `${palabras[1]} ${palabras[2]}` };
  return { nombres: `${palabras[0]} ${palabras[1]}`, apellidos: palabras.slice(2).join(" ") };
};

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  // 1. Agregar columnas si no existen
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS chofer_nombres VARCHAR(100)`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS chofer_apellidos VARCHAR(100)`;
  console.log('✅ Columnas chofer_nombres y chofer_apellidos agregadas exitosamente a la tabla users');

  // 2. Backfill para motorizados existentes
  const users = await sql`SELECT id, name FROM users WHERE role = 'repartidor'`;
  for (const u of users) {
    const { nombres, apellidos } = dividirNombreLocal(u.name);
    await sql`
      UPDATE users 
      SET chofer_nombres = COALESCE(chofer_nombres, ${nombres}), 
          chofer_apellidos = COALESCE(chofer_apellidos, ${apellidos})
      WHERE id = ${u.id}
    `;
    console.log(`- Backfill completado para conductor: ${u.name} (Nombres: ${nombres}, Apellidos: ${apellidos})`);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

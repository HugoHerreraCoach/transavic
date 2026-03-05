// scripts/run-migration.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    // 1. Add column
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS asesor_id UUID REFERENCES users(id) ON DELETE SET NULL`;
    console.log('✅ Columna asesor_id agregada');

    // 2. Assign existing clients to admin
    await sql`UPDATE clientes SET asesor_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) WHERE asesor_id IS NULL`;
    console.log('✅ Clientes existentes asignados al admin');

    // 3. Create index
    await sql`CREATE INDEX IF NOT EXISTS idx_clientes_asesor_id ON clientes(asesor_id)`;
    console.log('✅ Índice creado');

    // 4. Verify
    const count = await sql`SELECT COUNT(*) as total FROM clientes`;
    console.log('Total clientes:', count[0].total);

    const sample = await sql`SELECT id, nombre, asesor_id FROM clientes LIMIT 3`;
    console.log('Muestra:', JSON.stringify(sample, null, 2));

    console.log('\n🎉 Migración completada exitosamente');
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
  process.exit(0);
}

run();

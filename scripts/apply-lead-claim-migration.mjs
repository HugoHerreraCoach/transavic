// scripts/apply-lead-claim-migration.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL no está configurada.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const sqlFile = fs.readFileSync(path.resolve('scripts/migrate-lead-claim.sql'), 'utf8');

async function main() {
  console.log('🔄 Ejecutando migrate-lead-claim.sql...');
  try {
    // Para simplificar, dividimos las sentencias por si el driver tiene problemas
    const lines = sqlFile
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('--'));
    
    if (lines.length > 0) {
      const query = lines.join(' ');
      await sql.query(query);
      console.log('✅ Migración aplicada exitosamente.');
    }
  } catch (error) {
    console.error('❌ Error al aplicar la migración:', error);
  }
  process.exit(0);
}

main();

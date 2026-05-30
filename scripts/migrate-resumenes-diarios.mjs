// scripts/migrate-resumenes-diarios.mjs
// Migración: tabla resumenes_diarios — registra cada Resumen Diario de Boletas (RC-)
// enviado a SUNAT. Sirve para (a) IDEMPOTENCIA (no reenviar el resumen del mismo día
// si el cron se dispara dos veces) y (b) guardar el ticket para consultarlo después.
//
// ⚠️ Node 26 rompe @neondatabase/serverless (DNS "fetch failed"). Si este script falla,
// aplicar el SQL equivalente con psql:
//   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-resumenes-diarios.sql
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL no está definida");
  process.exit(1);
}
const sql = neon(connectionString);

async function migrate() {
  console.log("🔄 Migración: resumenes_diarios\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  console.log("1️⃣ Tabla resumenes_diarios...");
  await sql`
    CREATE TABLE IF NOT EXISTS resumenes_diarios (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      empresa VARCHAR(50) NOT NULL,
      ruc VARCHAR(11) NOT NULL,
      fecha_referencia DATE NOT NULL,
      correlativo INTEGER,
      nombre_archivo VARCHAR(120),
      ticket TEXT,
      estado VARCHAR(20) NOT NULL DEFAULT 'enviando',
      boletas_incluidas INTEGER DEFAULT 0,
      mensaje_sunat TEXT,
      xml_firmado_base64 TEXT,
      cdr_base64 TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ resumenes_diarios creada");

  await sql`CREATE INDEX IF NOT EXISTS idx_resumen_ruc_fecha ON resumenes_diarios (ruc, fecha_referencia)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_resumen_ticket ON resumenes_diarios (ticket)`;
  console.log("   ✅ Índices creados");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

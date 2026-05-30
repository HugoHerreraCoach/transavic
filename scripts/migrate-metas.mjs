// scripts/migrate-metas.mjs
// Migración: tabla de overrides manuales de metas mensuales por asesora.
// La meta NORMAL se calcula automáticamente (mes anterior × 1.15 / días hábiles).
// Esta tabla solo guarda overrides explícitos del admin.
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
  console.log("🔄 Migración: tabla metas_asesoras\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  await sql`
    CREATE TABLE IF NOT EXISTS metas_asesoras (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      asesor_id UUID REFERENCES users(id) ON DELETE CASCADE,
      mes DATE NOT NULL,
      monto_meta NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(asesor_id, mes)
    )
  `;
  console.log("   ✅ Tabla metas_asesoras creada");

  await sql`CREATE INDEX IF NOT EXISTS idx_metas_asesor_mes ON metas_asesoras(asesor_id, mes)`;
  console.log("   ✅ Índice idx_metas_asesor_mes creado");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

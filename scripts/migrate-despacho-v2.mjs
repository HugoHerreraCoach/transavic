// scripts/migrate-despacho-v2.mjs
// Migración: Settings table + nuevos campos para rutas
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Iniciando migración despacho-v2...\n");

  // 1. Crear tabla settings
  console.log("1️⃣ Creando tabla settings...");
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla settings creada");

  // 2. Insertar ubicación base por defecto
  console.log("2️⃣ Insertando ubicación base por defecto...");
  await sql`
    INSERT INTO settings (key, value) VALUES 
      ('base_location', '{"lat": -12.0464, "lng": -77.0428, "address": "Centro de Lima", "name": "Local Principal"}'::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;
  console.log("   ✅ Ubicación base insertada");

  // 3. Agregar columnas a pedidos
  console.log("3️⃣ Agregando columna distancia_km...");
  await sql`
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS distancia_km NUMERIC(6,2)
  `;
  console.log("   ✅ distancia_km agregada");

  console.log("4️⃣ Agregando columna duracion_estimada_min...");
  await sql`
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS duracion_estimada_min INTEGER
  `;
  console.log("   ✅ duracion_estimada_min agregada");

  console.log("\n🎉 Migración completada exitosamente!");
}

migrate().catch((err) => {
  console.error("❌ Error en migración:", err);
  process.exit(1);
});

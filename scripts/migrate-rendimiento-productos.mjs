// scripts/migrate-rendimiento-productos.mjs
// Migración: agregar columna rendimiento_porcentaje a la tabla productos
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

// Cargar .env.local primero, luego .env
dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL no está definida");
  process.exit(1);
}

const sql = neon(connectionString);

async function migrate() {
  console.log("🔄 Migración: Rendimiento de Productos (Desposte)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando columna rendimiento_porcentaje a productos...");
  await sql`
    ALTER TABLE productos 
      ADD COLUMN IF NOT EXISTS rendimiento_porcentaje NUMERIC(5,2) DEFAULT 100.00
  `;
  console.log("   ✅ Columna agregada a productos");
  console.log("\n🚀 Migración finalizada exitosamente.");
}

migrate().catch((err) => {
  console.error("❌ Error durante la migración:", err);
  process.exit(1);
});

import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") }); // Priority to beta environment
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  if (!process.env.DATABASE_URL_UNPOOLED) {
    console.error("Falta DATABASE_URL_UNPOOLED en .env");
    process.exit(1);
  }

  // Se requiere la URL no-pooled para evitar errores en cambios de esquema.
  const sql = neon(process.env.DATABASE_URL_UNPOOLED);

  console.log("Iniciando migración: agregar columna origen a pedidos...");

  try {
    // 1. Add origen column (asesor = default para todo lo histórico)
    console.log("1. Agregando origen...");
    await sql`
      ALTER TABLE pedidos
      ADD COLUMN IF NOT EXISTS origen VARCHAR(50) DEFAULT 'asesor'
    `;
    console.log("✅ Columna origen agregada (o ya existía).");

    console.log("🎉 Migración exitosa.");
  } catch (err) {
    console.error("❌ Error en la migración:", err);
    process.exit(1);
  }
}

main();

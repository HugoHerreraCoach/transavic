import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env.local") });

async function main() {
  if (!process.env.DATABASE_URL_UNPOOLED) {
    throw new Error("DATABASE_URL_UNPOOLED no está definida en .env.local");
  }

  const sql = neon(process.env.DATABASE_URL_UNPOOLED);

  try {
    console.log("🔄 Migración: notas en pedido_items\n");

    console.log("1️⃣ Agregando notas a pedido_items...");
    await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS notas VARCHAR(255)`;
    console.log("   ✅ Columna agregada a pedido_items");

    console.log("\n✅ Migración completada exitosamente.");
  } catch (error) {
    console.error("❌ Error durante la migración:", error);
    process.exit(1);
  }
}

main();

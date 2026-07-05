// scripts/migrate-crm-extensions.mjs
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
  console.log("🔄 Migración: CRM Extensions (tags y unread_count)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando columna tags...");
  await sql`ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`;

  console.log("2️⃣ Agregando columna unread_count...");
  await sql`ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS unread_count INT DEFAULT 0`;

  console.log("\n🎉 Migración de CRM Extensions completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error en la migración:", err);
  process.exit(1);
});

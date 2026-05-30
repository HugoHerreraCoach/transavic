// scripts/migrate-cantidad-real.mjs
// Migración: registrar peso real de cada producto entregado + tracking de quién pesó.
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
  console.log("🔄 Migración: cantidad_real en pedido_items\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando cantidad_real y subtotal_real a pedido_items...");
  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS cantidad_real NUMERIC(10, 2)`;
  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS subtotal_real NUMERIC(10, 2)`;
  console.log("   ✅ Columnas agregadas a pedido_items");

  console.log("2️⃣ Agregando tracking pesado_por / pesado_at a pedidos...");
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pesado_por UUID REFERENCES users(id)`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pesado_at TIMESTAMP WITH TIME ZONE`;
  console.log("   ✅ Columnas agregadas a pedidos");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

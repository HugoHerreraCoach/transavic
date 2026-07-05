// scripts/migrate-crm-rotacion.mjs
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
  console.log("🔄 Migración: CRM Rotación de Leads (users extensions)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando columna activo_rotacion a la tabla users...");
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS activo_rotacion BOOLEAN DEFAULT TRUE`;

  console.log("2️⃣ Agregando columna orden_rotacion a la tabla users...");
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS orden_rotacion INT DEFAULT 1`;

  console.log("3️⃣ Agregando columna leads_recibidos_hoy a la tabla users...");
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS leads_recibidos_hoy INT DEFAULT 0`;

  console.log("4️⃣ Creando índice para la optimización de la rotación...");
  await sql`CREATE INDEX IF NOT EXISTS idx_users_rotacion ON public.users(role, activo_rotacion, orden_rotacion)`;

  console.log("\n🎉 Migración de CRM Rotación completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error en la migración:", err);
  process.exit(1);
});

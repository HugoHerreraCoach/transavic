// scripts/migrate-notificaciones.mjs
// Migración: sistema de notificaciones in-app (campanita 🔔).
// Polling cada 30s (sin Pusher por ahora — eso en Fase C).
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
  console.log("🔄 Migración: tabla notificaciones\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  await sql`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tipo VARCHAR(50) NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      link TEXT,
      pedido_id UUID,
      leida BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla notificaciones creada");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notif_user_unread
    ON notificaciones(user_id, leida, created_at DESC)
  `;
  console.log("   ✅ Índice idx_notif_user_unread creado");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

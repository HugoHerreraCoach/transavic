// scripts/migrate-comunicados.mjs
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
  console.log("🔄 Migración: Sistema de Comunicados\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Creando extensión uuid-ossp...");
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  console.log("2️⃣ Tabla comunicados...");
  await sql`
    CREATE TABLE IF NOT EXISTS comunicados (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      titulo        TEXT NOT NULL,
      cuerpo        TEXT NOT NULL DEFAULT '',
      creado_por    TEXT NOT NULL,
      destinatarios JSONB NOT NULL DEFAULT '[]',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla comunicados creada");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_comunicados_created
    ON comunicados(created_at DESC)
  `;
  console.log("   ✅ Índice idx_comunicados_created creado");

  console.log("3️⃣ Tabla comunicado_imagenes...");
  await sql`
    CREATE TABLE IF NOT EXISTS comunicado_imagenes (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      comunicado_id   UUID REFERENCES comunicados(id) ON DELETE CASCADE,
      imagen_base64   TEXT NOT NULL,
      imagen_mime     VARCHAR(50) NOT NULL DEFAULT 'image/webp',
      orden           SMALLINT NOT NULL DEFAULT 1,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla comunicado_imagenes creada");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_com_imagenes_orden
    ON comunicado_imagenes(comunicado_id, orden)
  `;
  console.log("   ✅ Índice idx_com_imagenes_orden creado");

  console.log("4️⃣ Tabla comunicado_lecturas...");
  await sql`
    CREATE TABLE IF NOT EXISTS comunicado_lecturas (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      comunicado_id  UUID REFERENCES comunicados(id) ON DELETE CASCADE,
      user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
      leido_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(comunicado_id, user_id)
    )
  `;
  console.log("   ✅ Tabla comunicado_lecturas creada");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_com_lecturas_user
    ON comunicado_lecturas(user_id, comunicado_id)
  `;
  console.log("   ✅ Índice idx_com_lecturas_user creado");

  console.log("\n🎉 Migración completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error en la migración:", err);
  process.exit(1);
});

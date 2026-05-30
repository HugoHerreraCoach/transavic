// scripts/migrate-correlativos-guias.mjs
// Migración: tabla de correlativos + columnas en pedidos para guía digital + foto firmada.
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
  console.log("🔄 Migración: correlativos de guías + foto firmada\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Creando tabla correlativos...");
  await sql`
    CREATE TABLE IF NOT EXISTS correlativos (
      tipo VARCHAR(50) PRIMARY KEY,
      ultimo_numero INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla correlativos creada");

  console.log("2️⃣ Inicializando correlativo de guías...");
  await sql`
    INSERT INTO correlativos (tipo) VALUES ('guia_remision')
    ON CONFLICT (tipo) DO NOTHING
  `;
  console.log("   ✅ Correlativo 'guia_remision' inicializado");

  console.log("3️⃣ Agregando columnas a pedidos para guía...");
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_guia INTEGER`;
  // guia_firmada_data guarda la imagen en base64 (no requiere storage externo, $0 costo)
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_data TEXT`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_mime VARCHAR(50)`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_at TIMESTAMP WITH TIME ZONE`;
  console.log("   ✅ Columnas numero_guia, guia_firmada_data, guia_firmada_mime, guia_firmada_at agregadas");

  console.log("4️⃣ Creando índice de número de guía único...");
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero_guia
    ON pedidos(numero_guia) WHERE numero_guia IS NOT NULL
  `;
  console.log("   ✅ Índice creado");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

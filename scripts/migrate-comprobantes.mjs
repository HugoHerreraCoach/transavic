// scripts/migrate-comprobantes.mjs
// Migración: tabla de comprobantes SUNAT + contador atómico de correlativos.
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
  console.log("🔄 Migración: comprobantes SUNAT\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Tabla comprobantes_contador (correlativos atómicos por RUC + serie)...");
  await sql`
    CREATE TABLE IF NOT EXISTS comprobantes_contador (
      ruc VARCHAR(11) NOT NULL,
      serie VARCHAR(10) NOT NULL,
      ultimo_numero INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (ruc, serie)
    )
  `;
  console.log("   ✅ comprobantes_contador creada");

  console.log("2️⃣ Tabla comprobantes...");
  await sql`
    CREATE TABLE IF NOT EXISTS comprobantes (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
      ruc_emisor VARCHAR(11) NOT NULL,
      empresa VARCHAR(50) NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      serie VARCHAR(10) NOT NULL,
      numero INTEGER NOT NULL,
      serie_numero VARCHAR(50) NOT NULL,
      cliente_doc_tipo VARCHAR(2),
      cliente_doc_num VARCHAR(20),
      cliente_razon_social VARCHAR(255),
      monto_subtotal NUMERIC(12, 2),
      monto_igv NUMERIC(12, 2),
      monto_total NUMERIC(12, 2),
      moneda VARCHAR(3) DEFAULT 'PEN',
      estado VARCHAR(50) NOT NULL,
      hash_cpe TEXT,
      xml_firmado_base64 TEXT,
      cdr_base64 TEXT,
      observaciones TEXT,
      mensaje_sunat TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (ruc_emisor, serie, numero)
    )
  `;
  console.log("   ✅ comprobantes creada");

  await sql`CREATE INDEX IF NOT EXISTS idx_comp_pedido ON comprobantes(pedido_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_comp_estado ON comprobantes(estado)`;
  console.log("   ✅ Índices creados");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

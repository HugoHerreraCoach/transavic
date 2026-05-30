// scripts/migrate-cobranzas.mjs
// Migración: plazo de pago por cliente + tabla de facturas.
// Soporta plazos flexibles (al momento, 1 día, 3 días, 7, 15, etc.).
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
  console.log("🔄 Migración: cobranzas\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando plazo_pago_dias a clientes...");
  await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER DEFAULT 0`;
  console.log("   ✅ Columna agregada (0 = pago al momento)");

  console.log("2️⃣ Creando tabla facturas...");
  await sql`
    CREATE TABLE IF NOT EXISTS facturas (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
      cliente_id UUID,
      cliente_nombre VARCHAR(255) NOT NULL,
      asesor_id UUID REFERENCES users(id),
      monto NUMERIC(12, 2) NOT NULL,
      plazo_dias INTEGER NOT NULL DEFAULT 0,
      fecha_emision DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
      fecha_vencimiento DATE NOT NULL,
      fecha_pago DATE,
      estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
      numero_comprobante VARCHAR(50),
      notas TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla facturas creada");

  console.log("3️⃣ Creando índices...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_facturas_vencimiento
    ON facturas(fecha_vencimiento) WHERE fecha_pago IS NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_facturas_asesor ON facturas(asesor_id, estado)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id)`;
  console.log("   ✅ Índices creados");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

// scripts/migrate-precios-productos.mjs
// Migración: agregar precios a productos + tabla histórica + columnas en pedido_items
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

// Carga .env.local primero (branch dev), después .env (prod) como fallback
dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL no está definida");
  process.exit(1);
}

const sql = neon(connectionString);

async function migrate() {
  console.log("🔄 Migración: precios de productos\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando columnas precio_compra, precio_venta a productos...");
  await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_compra NUMERIC(10, 2)`;
  await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_venta NUMERIC(10, 2)`;
  console.log("   ✅ Columnas agregadas a productos");

  console.log("2️⃣ Creando tabla histórica de precios...");
  await sql`
    CREATE TABLE IF NOT EXISTS precios_productos (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
      precio_compra NUMERIC(10, 2),
      precio_venta NUMERIC(10, 2) NOT NULL,
      vigente_desde DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
      vigente_hasta DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_by UUID REFERENCES users(id)
    )
  `;
  console.log("   ✅ Tabla precios_productos creada");

  console.log("3️⃣ Creando índice para consulta rápida de precio vigente...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_precios_vigentes
    ON precios_productos(producto_id, vigente_desde DESC)
    WHERE vigente_hasta IS NULL
  `;
  console.log("   ✅ Índice creado");

  console.log("4️⃣ Agregando precio_unitario y subtotal a pedido_items (snapshot)...");
  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10, 2)`;
  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2)`;
  console.log("   ✅ Columnas agregadas a pedido_items");

  // ── Verificación ──
  console.log("\n🔍 Verificación post-migración:");
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'productos' AND column_name LIKE 'precio%'
    ORDER BY column_name
  `;
  for (const c of cols) {
    console.log(`   productos.${c.column_name}: ${c.data_type}`);
  }
  const cols2 = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'pedido_items' AND column_name IN ('precio_unitario', 'subtotal')
    ORDER BY column_name
  `;
  for (const c of cols2) {
    console.log(`   pedido_items.${c.column_name}: ${c.data_type}`);
  }

  console.log("\n🎉 Migración completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error en migración:", err);
  process.exit(1);
});

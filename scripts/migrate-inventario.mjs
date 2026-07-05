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
    console.log("🔄 Migración: Módulo de Inventario Flexible y Mermas\n");

    console.log("1️⃣ Creando tabla inventario_lotes...");
    await sql`
      CREATE TABLE IF NOT EXISTS inventario_lotes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        cantidad DECIMAL(12,2) NOT NULL DEFAULT 0, -- Puede ser negativo (stock flexible)
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima'),
        UNIQUE(producto_id)
      )
    `;
    console.log("   ✅ Tabla inventario_lotes creada");

    console.log("2️⃣ Creando tabla mermas_diarias...");
    await sql`
      CREATE TABLE IF NOT EXISTS mermas_diarias (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fecha DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Lima')::date),
        peso_bruto DECIMAL(10,2) NOT NULL,
        peso_limpio DECIMAL(10,2) NOT NULL,
        peso_menudencia DECIMAL(10,2) NOT NULL,
        merma DECIMAL(10,2) NOT NULL,
        porcentaje_merma DECIMAL(5,2) NOT NULL,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
      )
    `;
    console.log("   ✅ Tabla mermas_diarias creada");

    // Insertar registros en inventario_lotes para todos los productos existentes (empezando en 0)
    console.log("3️⃣ Inicializando inventario en 0 para productos existentes...");
    await sql`
      INSERT INTO inventario_lotes (producto_id, cantidad)
      SELECT id, 0 FROM productos
      ON CONFLICT (producto_id) DO NOTHING
    `;
    console.log("   ✅ Inventario inicializado");

    console.log("\n✅ Migración de Inventario completada exitosamente.");
  } catch (error) {
    console.error("❌ Error durante la migración:", error);
    process.exit(1);
  }
}

main();

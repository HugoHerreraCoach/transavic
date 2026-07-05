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
    console.log("🔄 Migración: Módulo de Cuentas y Transacciones\n");

    console.log("1️⃣ Creando tabla cuentas_bancarias...");
    await sql`
      CREATE TABLE IF NOT EXISTS cuentas_bancarias (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        nombre VARCHAR(255) NOT NULL,
        tipo VARCHAR(50) NOT NULL, -- 'efectivo', 'banco'
        saldo DECIMAL(12,2) NOT NULL DEFAULT 0,
        activa BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima'),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
      )
    `;
    console.log("   ✅ Tabla cuentas_bancarias creada");

    console.log("2️⃣ Creando tabla transacciones...");
    await sql`
      CREATE TABLE IF NOT EXISTS transacciones (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        cuenta_id UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        tipo VARCHAR(50) NOT NULL, -- 'ingreso', 'egreso'
        monto DECIMAL(12,2) NOT NULL,
        concepto TEXT NOT NULL,
        referencia_id UUID, -- Opcional: ID de pedido o venta POS asociada
        created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
      )
    `;
    console.log("   ✅ Tabla transacciones creada");

    // Insertar cuentas por defecto
    console.log("3️⃣ Insertando cuentas por defecto (Caja Efectivo, Yape, Plin)...");
    await sql`
      INSERT INTO cuentas_bancarias (nombre, tipo, saldo)
      VALUES 
        ('Caja Efectivo (Producción)', 'efectivo', 0),
        ('Yape Empresa', 'banco', 0),
        ('Plin Empresa', 'banco', 0),
        ('BCP Antonio', 'banco', 0)
      ON CONFLICT DO NOTHING
    `;
    console.log("   ✅ Cuentas por defecto insertadas");

    console.log("\n✅ Migración de Cuentas completada exitosamente.");
  } catch (error) {
    console.error("❌ Error durante la migración:", error);
    process.exit(1);
  }
}

main();

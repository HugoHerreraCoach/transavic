// scripts/migrate-comprobantes-guias.mjs
// Migración: Crear tabla comprobantes_guias y agregar datos de chofer/placa en users.
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
  console.log("🔄 Migración: Guías de Remisión Electrónicas (SUNAT)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Creando tabla comprobantes_guias...");
  await sql`
    CREATE TABLE IF NOT EXISTS public.comprobantes_guias (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
      ruc_emisor VARCHAR(11) NOT NULL,
      empresa VARCHAR(50) NOT NULL,
      serie VARCHAR(10) NOT NULL,
      numero INTEGER NOT NULL,
      serie_numero VARCHAR(50) NOT NULL,
      cliente_doc_tipo VARCHAR(2) NOT NULL,
      cliente_doc_num VARCHAR(20) NOT NULL,
      cliente_razon_social VARCHAR(255) NOT NULL,
      peso_bruto_total NUMERIC(10, 2) NOT NULL,
      total_bultos INTEGER NOT NULL DEFAULT 1,
      modalidad_traslado VARCHAR(2) NOT NULL DEFAULT '02',
      motivo_traslado VARCHAR(2) NOT NULL DEFAULT '01',
      fecha_inicio_traslado DATE NOT NULL,
      repartidor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      vehiculo_placa VARCHAR(15),
      chofer_doc_tipo VARCHAR(2),
      chofer_doc_num VARCHAR(20),
      chofer_licencia VARCHAR(30),
      estado VARCHAR(50) NOT NULL,
      hash_cpe TEXT,
      xml_firmado_base64 TEXT,
      cdr_base64 TEXT,
      observaciones TEXT,
      mensaje_sunat TEXT,
      emitido_por VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (ruc_emisor, serie, numero)
    )
  `;
  console.log("   ✅ Tabla comprobantes_guias creada");

  console.log("2️⃣ Creando índices para comprobantes_guias...");
  await sql`CREATE INDEX IF NOT EXISTS idx_comp_guias_pedido ON public.comprobantes_guias(pedido_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_comp_guias_estado ON public.comprobantes_guias(estado)`;
  console.log("   ✅ Índices creados");

  console.log("3️⃣ Agregando columnas de conductor y placa a tabla users...");
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS chofer_dni VARCHAR(15)`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS chofer_licencia VARCHAR(30)`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS vehiculo_placa VARCHAR(15)`;
  console.log("   ✅ Columnas chofer_dni, chofer_licencia y vehiculo_placa agregadas");

  console.log("\n🎉 Migración completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error de migración:", err);
  process.exit(1);
});

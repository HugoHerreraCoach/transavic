// scripts/migrate-prestamos.mjs
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
  console.log("🔄 Iniciando Migración: Préstamos de Mercadería\n");

  console.log("1️⃣ Creando tabla: prestamos_saldos");
  await sql`
    CREATE TABLE IF NOT EXISTS public.prestamos_saldos (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
      producto_id UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
      jabas INTEGER NOT NULL DEFAULT 0,
      peso_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(proveedor_id, producto_id)
    );
  `;
  console.log("   ✅ Tabla prestamos_saldos lista (Positivo = Proveedor nos debe, Negativo = Nosotros debemos)");

  console.log("2️⃣ Creando tabla: prestamos_transacciones");
  await sql`
    CREATE TABLE IF NOT EXISTS public.prestamos_transacciones (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
      producto_id UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
      tipo_movimiento VARCHAR(50) NOT NULL, -- 'PRESTAMO_RECIBIDO', 'PRESTAMO_OTORGADO', 'DEVOLUCION_RECIBIDA', 'DEVOLUCION_OTORGADA'
      jabas INTEGER NOT NULL DEFAULT 0,
      peso_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
      fecha DATE NOT NULL,
      notas TEXT,
      created_by UUID REFERENCES public.users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla prestamos_transacciones lista");

  console.log("\n🎉 Migración de Préstamos completada exitosamente.");
}

migrate().catch((err) => {
  console.error("❌ Error durante la migración:", err);
  process.exit(1);
});

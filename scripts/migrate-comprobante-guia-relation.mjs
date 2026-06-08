// scripts/migrate-comprobante-guia-relation.mjs
// Migración: Agregar columna comprobante_id a comprobantes_guias.
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
  console.log("🔄 Migración: Relación Comprobante ↔ Guía de Remisión\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando columna comprobante_id a comprobantes_guias...");
  await sql`
    ALTER TABLE public.comprobantes_guias
    ADD COLUMN IF NOT EXISTS comprobante_id UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL;
  `;
  console.log("   ✅ Columna comprobante_id agregada");

  console.log("2️⃣ Creando índice para comprobante_id...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_comp_guias_comprobante ON public.comprobantes_guias(comprobante_id);
  `;
  console.log("   ✅ Índice idx_comp_guias_comprobante creado");

  console.log("\n🎉 Migración completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error de migración:", err);
  process.exit(1);
});

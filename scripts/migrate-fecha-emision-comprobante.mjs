// scripts/migrate-fecha-emision-comprobante.mjs
// Migración: fecha de emisión seleccionable en comprobantes (boletas/facturas).
//
// Hasta ahora el comprobante se emitía SIEMPRE con la fecha de hoy y esa fecha se
// infería de `created_at`. Para permitir emitir con una fecha distinta (hoy o
// retroactiva dentro del plazo SUNAT: factura 3 días, boleta 7 días), guardamos la
// fecha de emisión REAL del XML en una columna propia.
//
// Idempotente y aditiva. En producción aplicar por psql (gotcha #13/#17):
//   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-fecha-emision-comprobante.sql
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
  console.log("🔄 Migración: comprobantes.fecha_emision\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Agregando columna fecha_emision a comprobantes...");
  await sql`ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS fecha_emision DATE`;
  console.log("   ✅ Columna agregada");

  console.log("2️⃣ Backfill de filas históricas (created_at en zona Lima)...");
  // Mismo criterio que la lectura actual del PDF ([id]/route.ts): ningún
  // comprobante histórico cambia de fecha visible.
  await sql`
    UPDATE comprobantes
    SET fecha_emision = (created_at AT TIME ZONE 'America/Lima')::date
    WHERE fecha_emision IS NULL
  `;
  console.log("   ✅ Backfill aplicado");

  console.log("3️⃣ Índice para filtros de reporte por fecha...");
  await sql`CREATE INDEX IF NOT EXISTS idx_comprobantes_fecha_emision ON comprobantes(fecha_emision)`;
  console.log("   ✅ Índice creado");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

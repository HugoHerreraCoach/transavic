// scripts/migrate-crm.mjs
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
  console.log("🔄 Migración: Módulo CRM y Bot de IA (Fase 4)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Creando extensión uuid-ossp...");
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  console.log("2️⃣ Creando tabla leads...");
  await sql`
    CREATE TABLE IF NOT EXISTS public.leads (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      nombre         VARCHAR(255) NOT NULL,
      telefono       VARCHAR(20) NOT NULL UNIQUE,
      negocio        VARCHAR(255),
      ciudad         VARCHAR(100),
      origen         VARCHAR(50) DEFAULT 'whatsapp',
      empresa        VARCHAR(50) DEFAULT 'Transavic',
      estado         VARCHAR(50) DEFAULT 'Nuevo',
      vendedor_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
      chatbot_activo BOOLEAN DEFAULT TRUE,
      notas          TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla leads creada o ya existente");

  console.log("3️⃣ Creando tabla lead_mensajes...");
  await sql`
    CREATE TABLE IF NOT EXISTS public.lead_mensajes (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      lead_id    UUID REFERENCES public.leads(id) ON DELETE CASCADE,
      sender     VARCHAR(50) NOT NULL,
      body       TEXT NOT NULL,
      type       VARCHAR(20) DEFAULT 'text',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla lead_mensajes creada o ya existente");

  console.log("4️⃣ Creando índices...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_leads_estado ON public.leads(estado);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON public.leads(vendedor_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lead_mensajes_lead ON public.lead_mensajes(lead_id, created_at ASC);
  `;
  console.log("   ✅ Índices creados exitosamente");

  console.log("\n🎉 Migración de CRM completada exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error en la migración:", err);
  process.exit(1);
});

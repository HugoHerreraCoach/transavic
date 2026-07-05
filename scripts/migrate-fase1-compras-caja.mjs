// scripts/migrate-fase1-compras-caja.mjs
// Migración: Fase 1 del Sistema Integral Transavic (Infraestructura de Compras y Caja)
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
  console.log("🔄 Iniciando Migración: Fase 1 (Proveedores, Compras, Caja, Gastos)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  console.log("1️⃣ Creando tabla: proveedores");
  await sql`
    CREATE TABLE IF NOT EXISTS public.proveedores (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      ruc VARCHAR(11) NOT NULL UNIQUE,
      razon_social VARCHAR(255) NOT NULL,
      direccion TEXT,
      telefono VARCHAR(20),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla proveedores lista");

  console.log("2️⃣ Creando tabla: compras");
  await sql`
    CREATE TABLE IF NOT EXISTS public.compras (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
      fecha DATE NOT NULL,
      tipo_doc VARCHAR(20),
      nro_doc VARCHAR(50),
      estado VARCHAR(20) DEFAULT 'Completado',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      igv NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_by UUID REFERENCES public.users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla compras lista");

  console.log("3️⃣ Creando tabla: compra_items");
  await sql`
    CREATE TABLE IF NOT EXISTS public.compra_items (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      compra_id UUID REFERENCES public.compras(id) ON DELETE CASCADE,
      producto_id UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
      jabas INTEGER DEFAULT 0,
      peso_bruto NUMERIC(10,2) NOT NULL,
      peso_tara NUMERIC(10,2) NOT NULL DEFAULT 0,
      peso_neto NUMERIC(10,2) NOT NULL,
      costo_unitario NUMERIC(10,2) NOT NULL,
      subtotal NUMERIC(12,2) NOT NULL
    );
  `;
  console.log("   ✅ Tabla compra_items lista");

  console.log("4️⃣ Creando tabla: cuentas_por_pagar");
  await sql`
    CREATE TABLE IF NOT EXISTS public.cuentas_por_pagar (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
      compra_id UUID REFERENCES public.compras(id) ON DELETE CASCADE,
      monto_deuda NUMERIC(12,2) NOT NULL,
      monto_pagado NUMERIC(12,2) DEFAULT 0,
      estado VARCHAR(20) DEFAULT 'Pendiente', -- Pendiente, Parcial, Pagado
      fecha_vencimiento DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla cuentas_por_pagar lista");

  console.log("5️⃣ Creando tabla: gastos");
  await sql`
    CREATE TABLE IF NOT EXISTS public.gastos (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      categoria VARCHAR(100) NOT NULL,
      monto NUMERIC(10,2) NOT NULL,
      fecha DATE NOT NULL,
      responsable_id UUID REFERENCES public.users(id),
      comprobante VARCHAR(100),
      descripcion TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla gastos lista");

  console.log("6️⃣ Creando tabla: caja_diaria");
  await sql`
    CREATE TABLE IF NOT EXISTS public.caja_diaria (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      fecha DATE NOT NULL UNIQUE,
      apertura NUMERIC(12,2) DEFAULT 0,
      ingresos NUMERIC(12,2) DEFAULT 0,
      egresos NUMERIC(12,2) DEFAULT 0,
      cierre_teorico NUMERIC(12,2) DEFAULT 0,
      cierre_fisico NUMERIC(12,2),
      diferencia NUMERIC(12,2),
      estado VARCHAR(20) DEFAULT 'Abierta', -- Abierta, Cerrada
      user_id UUID REFERENCES public.users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla caja_diaria lista");

  console.log("7️⃣ Creando tabla de auditoría: precios_audit_log");
  await sql`
    CREATE TABLE IF NOT EXISTS public.precios_audit_log (
      id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
      entidad VARCHAR(50) NOT NULL, -- 'producto', 'compra_item'
      entidad_id UUID NOT NULL,
      precio_anterior NUMERIC(10,2),
      precio_nuevo NUMERIC(10,2) NOT NULL,
      motivo TEXT,
      modificado_por UUID REFERENCES public.users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  console.log("   ✅ Tabla precios_audit_log lista");

  console.log("\n🎉 Fase 1: Migración de esquema completada exitosamente.");
}

migrate().catch((err) => {
  console.error("❌ Error durante la migración:", err);
  process.exit(1);
});

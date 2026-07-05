-- scripts/migrate-crm.sql
-- Migración del Módulo CRM y Bot de IA (Fase 4)
-- Idempotente y aditivo.

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA: leads
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
);

-- 3. TABLA: lead_mensajes
CREATE TABLE IF NOT EXISTS public.lead_mensajes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id    UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  sender     VARCHAR(50) NOT NULL, -- 'cliente', 'bot', 'asesora' (o el nombre del usuario)
  body       TEXT NOT NULL,
  type       VARCHAR(20) DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_leads_estado ON public.leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON public.leads(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_lead_mensajes_lead ON public.lead_mensajes(lead_id, created_at ASC);

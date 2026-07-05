-- scripts/migrate-crm-extensions.sql
-- Agregar columnas adicionales de Conexipema al CRM de Transavic
-- Idempotente y aditivo.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS unread_count INT DEFAULT 0;

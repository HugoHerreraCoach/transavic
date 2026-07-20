-- scripts/migrate-lead-claim.sql
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS estado_asignacion VARCHAR(50) DEFAULT 'asignado',
ADD COLUMN IF NOT EXISTS candidatos_nivel UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS candidato_actual UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS inicio_turno TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS timeout_nivel INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS golden_ticket_phase VARCHAR(50) DEFAULT 'individual';

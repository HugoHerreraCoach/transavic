-- scripts/rollback-lead-claim.sql
ALTER TABLE public.leads 
DROP COLUMN IF EXISTS estado_asignacion,
DROP COLUMN IF EXISTS candidatos_nivel,
DROP COLUMN IF EXISTS candidato_actual,
DROP COLUMN IF EXISTS inicio_turno,
DROP COLUMN IF EXISTS timeout_nivel;

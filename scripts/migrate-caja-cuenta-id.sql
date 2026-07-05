-- La caja diaria FIJA su cuenta de efectivo por id al abrirse (QA 5 jul 2026).
-- Antes el GET/PUT buscaban la cuenta por el NOMBRE exacto 'Caja Efectivo Planta'
-- (hardcodeado): renombrar la cuenta rompía el arqueo en silencio, y en entornos
-- con otro nombre los ingresos/egresos salían 0. Con cuenta_id persistido, la
-- caja abierta queda amarrada a SU cuenta aunque cambie el nombre.
-- Las cajas viejas (cuenta_id NULL) siguen resolviendo por nombre (fallback).
--
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-caja-cuenta-id.sql

ALTER TABLE public.caja_diaria
  ADD COLUMN IF NOT EXISTS cuenta_id UUID REFERENCES public.cuentas_bancarias(id);

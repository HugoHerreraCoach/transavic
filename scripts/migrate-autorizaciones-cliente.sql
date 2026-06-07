-- Agrega cliente_json a autorizaciones_precio para que el admin vea
-- los datos del cliente y la asesora pueda pre-llenar el form al volver.
ALTER TABLE autorizaciones_precio
  ADD COLUMN IF NOT EXISTS cliente_json JSONB;

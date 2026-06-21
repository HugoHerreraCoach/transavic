-- Observación libre impresa/enviada en el XML del comprobante.
-- NO confundir con `observaciones`, que guarda observaciones CDR/SUNAT y logs.

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS observacion_comprobante TEXT;

COMMENT ON COLUMN public.comprobantes.observacion_comprobante IS
  'Observación libre del usuario para factura/boleta. Se imprime en el PDF y se emite en el XML como cbc:Note libre sin languageLocaleID.';

ALTER TABLE public.comprobantes_guias
  ADD COLUMN IF NOT EXISTS observacion_comprobante TEXT;

COMMENT ON COLUMN public.comprobantes_guias.observacion_comprobante IS
  'Observación libre del usuario para GRE. Se imprime en el PDF y se emite en el XML como DespatchAdvice/cbc:Note.';

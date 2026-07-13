// Reglas compartidas de Notas de Crédito que afectan el total completo del CPE.
// La versión actual reproduce todos los ítems del XML base y solo habilita:
// 01 anulación, 02 anulación por RUC y 06 devolución total.

export const CODIGOS_NOTA_CREDITO_TOTAL = ["01", "02", "06"] as const;

export function codigoNotaCreditoDesdeXml(xml: string): string | null {
  return xml.match(/<cbc:ResponseCode[^>]*>(\d{2})<\/cbc:ResponseCode>/)?.[1] ?? null;
}

export function esNotaCreditoTotalXml(xml: string): boolean {
  const codigo = codigoNotaCreditoDesdeXml(xml);
  return codigo !== null && CODIGOS_NOTA_CREDITO_TOTAL.includes(
    codigo as (typeof CODIGOS_NOTA_CREDITO_TOTAL)[number]
  );
}

export function esNotaCreditoTotalBase64(xmlBase64: string | null | undefined): boolean {
  if (!xmlBase64) return false;
  try {
    return esNotaCreditoTotalXml(Buffer.from(xmlBase64, "base64").toString("utf-8"));
  } catch {
    return false;
  }
}

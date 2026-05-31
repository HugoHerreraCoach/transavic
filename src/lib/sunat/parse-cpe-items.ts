// src/lib/sunat/parse-cpe-items.ts
// Extrae las LÍNEAS DE ÍTEM de un CPE (Comprobante de Pago Electrónico) UBL 2.1
// firmado — factura/boleta (<cac:InvoiceLine>) o nota de crédito
// (<cac:CreditNoteLine>).
//
// POR QUÉ EXISTE: el XML firmado es la ÚNICA fuente fiel de lo que se emitió a
// SUNAT (cantidad, unidad, código, descripción, precios). Las facturas
// "standalone" (sin pedido) no guardan sus ítems en la DB, así que el PDF los
// reconstruía con una línea genérica equivocada ("Venta a <cliente>", 1 UNIDAD).
// Parseando el XML, el PDF SIEMPRE coincide con el comprobante real.
//
// El XML lo genera nuestro propio `xml-builder.ts` (formato determinístico),
// por eso una extracción por regex es confiable acá.

export interface CpeItem {
  descripcion: string;
  unidadMedida: string; // unitCode SUNAT (ej. "KGM", "NIU")
  cantidad: number;
  precioUnitario: number; // valor unitario SIN IGV (cac:Price/cbc:PriceAmount)
  valorVenta: number; // LineExtensionAmount (sin IGV)
  montoIGV: number; // IGV de la línea
  precioTotal: number; // valorVenta + IGV
  codigo: string; // SellersItemIdentification/ID (código interno)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&"); // &amp; al final para no romper las otras
}

function stripCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function num(s: string | undefined): number {
  if (s == null) return 0;
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parsea los ítems de un XML CPE (string ya decodificado, no base64).
 * Devuelve [] si el XML no tiene líneas reconocibles.
 */
export function parseCpeItems(xml: string): CpeItem[] {
  if (!xml || typeof xml !== "string") return [];
  const items: CpeItem[] = [];

  // Cada línea: <cac:InvoiceLine>…</cac:InvoiceLine> o CreditNoteLine.
  const lineRe = /<cac:(InvoiceLine|CreditNoteLine)>([\s\S]*?)<\/cac:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(xml)) !== null) {
    const b = m[2];

    const q = b.match(
      /<cbc:(?:Invoiced|Credited)Quantity\s+unitCode="([^"]*)"[^>]*>([\d.]+)<\/cbc:(?:Invoiced|Credited)Quantity>/
    );
    const unidadMedida = q ? q[1] : "NIU";
    const cantidad = q ? num(q[2]) : 0;

    const lev = b.match(
      /<cbc:LineExtensionAmount[^>]*>([\d.]+)<\/cbc:LineExtensionAmount>/
    );
    const valorVenta = lev ? num(lev[1]) : 0;

    // IGV de la línea = primer TaxAmount dentro del cac:TaxTotal de la línea.
    const tax = b.match(
      /<cac:TaxTotal>[\s\S]*?<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/
    );
    const montoIGV = tax ? num(tax[1]) : 0;

    const desc = b.match(/<cbc:Description>([\s\S]*?)<\/cbc:Description>/);
    const descripcion = desc ? decodeEntities(stripCdata(desc[1])).trim() : "";

    const cod = b.match(
      /<cac:SellersItemIdentification>\s*<cbc:ID>([^<]*)<\/cbc:ID>/
    );
    const codigo = cod ? cod[1].trim() : "";

    // Valor unitario SIN IGV = el PriceAmount dentro de <cac:Price> (NO el de
    // PricingReference/AlternativeConditionPrice, que es con IGV).
    const price = b.match(
      /<cac:Price>\s*<cbc:PriceAmount[^>]*>([\d.]+)<\/cbc:PriceAmount>/
    );
    const precioUnitario = price
      ? num(price[1])
      : cantidad
        ? Number((valorVenta / cantidad).toFixed(4))
        : 0;

    items.push({
      descripcion,
      unidadMedida,
      cantidad,
      precioUnitario,
      valorVenta,
      montoIGV,
      precioTotal: Number((valorVenta + montoIGV).toFixed(2)),
      codigo,
    });
  }

  return items;
}

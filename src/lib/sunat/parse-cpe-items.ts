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

export interface CpeTotales {
  subtotal: number; // LineExtensionAmount global (total neto sin IGV)
  igv: number; // TaxAmount global del documento
  importeTotal: number; // cbc:PayableAmount — lo que SUNAT registra y valida
}

/**
 * Extrae los TOTALES DE CABECERA de un CPE firmado (factura/boleta/NC).
 *
 * POR QUÉ EXISTE: el `cbc:PayableAmount` del XML es la ÚNICA fuente de verdad del
 * importe total ante SUNAT (la Consulta de Validez compara exacto al céntimo). El
 * PDF/lista deben mostrar ESE número, no un recálculo. Los mismos tags
 * (LineExtensionAmount, TaxAmount) existen por línea, así que primero se quitan
 * las líneas y se leen los totales de documento (cac:LegalMonetaryTotal y el
 * cac:TaxTotal de cabecera).
 *
 * Devuelve null si el XML no trae PayableAmount (no confiable).
 */
export function parseCpeTotales(xml: string): CpeTotales | null {
  if (!xml || typeof xml !== "string") return null;

  // Quitar las líneas → quedan solo los totales de cabecera.
  const header = xml
    .replace(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g, "")
    .replace(/<cac:CreditNoteLine>[\s\S]*?<\/cac:CreditNoteLine>/g, "")
    .replace(/<cac:DebitNoteLine>[\s\S]*?<\/cac:DebitNoteLine>/g, "");

  const pay = header.match(
    /<cbc:PayableAmount[^>]*>([\d.]+)<\/cbc:PayableAmount>/
  );
  if (!pay) return null;
  const importeTotal = num(pay[1]);

  // Subtotal neto = LineExtensionAmount dentro de cac:LegalMonetaryTotal.
  const legal = header.match(
    /<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/
  );
  const legalBlock = legal ? legal[1] : header;
  const lev = legalBlock.match(
    /<cbc:LineExtensionAmount[^>]*>([\d.]+)<\/cbc:LineExtensionAmount>/
  );
  const subtotal = lev ? num(lev[1]) : 0;

  // IGV global = TaxAmount del cac:TaxTotal de documento (ya sin líneas).
  const tax = header.match(
    /<cac:TaxTotal>[\s\S]*?<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/
  );
  const igv = tax ? num(tax[1]) : 0;

  return { subtotal, igv, importeTotal };
}

/**
 * Extrae la DIRECCIÓN del cliente (adquirente) del XML CPE firmado.
 * Es la dirección fiel a lo emitido (la fiscal declarada a SUNAT). El PDF la
 * usa para mostrar la dirección del CLIENTE (no la del emisor).
 *
 * Se acota al bloque <cac:AccountingCustomerParty> a propósito: el emisor
 * (<cac:AccountingSupplierParty>) tiene su propia RegistrationAddress y NO debe
 * confundirse con la del cliente.
 *
 * Devuelve null si el XML no trae dirección del cliente (boletas a consumidor
 * final sin dirección, etc.).
 */
export function parseCpeClienteDireccion(xml: string): string | null {
  if (!xml || typeof xml !== "string") return null;
  const cust = xml.match(
    /<cac:AccountingCustomerParty>([\s\S]*?)<\/cac:AccountingCustomerParty>/
  );
  if (!cust) return null;
  const line = cust[1].match(
    /<cac:RegistrationAddress>[\s\S]*?<cbc:Line>([\s\S]*?)<\/cbc:Line>/
  );
  if (!line) return null;
  const dir = decodeEntities(stripCdata(line[1])).trim();
  return dir || null;
}

/**
 * Extrae la observación libre de factura/boleta desde cbc:Note.
 * Ignora la leyenda 1000 de monto en letras y los motivos de NC.
 */
export function parseCpeObservacion(xml: string): string | null {
  if (!xml || typeof xml !== "string") return null;
  const notes = xml.match(/<cbc:Note\b[^>]*>[\s\S]*?<\/cbc:Note>/g) || [];
  for (const note of notes) {
    if (/languageLocaleID="1000"/.test(note)) continue; // monto en letras
    const match = note.match(/<cbc:Note\b[^>]*>([\s\S]*?)<\/cbc:Note>/);
    if (!match) continue;
    const value = decodeEntities(stripCdata(match[1])).replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return null;
}

// ─── Guía de Remisión (GRE) ───────────────────────────────────────────────────

export interface DespatchItem {
  descripcion: string;
  unidadMedida: string; // unitCode SUNAT (ej. "KGM", "NIU", "ZZ")
  cantidad: number;
  codigo: string; // SellersItemIdentification/ID
}

/**
 * Parsea los ítems de una Guía de Remisión Electrónica (DespatchAdvice UBL 2.1).
 * Cada línea viene en <cac:DespatchLine>…</cac:DespatchLine>.
 * Devuelve [] si el XML no tiene líneas reconocibles.
 */
export function parseDespatchItems(xml: string): DespatchItem[] {
  if (!xml || typeof xml !== "string") return [];
  const items: DespatchItem[] = [];

  const lineRe = /<cac:DespatchLine>([\s\S]*?)<\/cac:DespatchLine>/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(xml)) !== null) {
    const b = m[1];

    // Cantidad: <cbc:DeliveredQuantity unitCode="KGM">0.40</cbc:DeliveredQuantity>
    const q = b.match(
      /<cbc:DeliveredQuantity\s+unitCode="([^"]*)"[^>]*>([\d.]+)<\/cbc:DeliveredQuantity>/
    );
    const unidadMedida = q ? q[1] : "NIU";
    const cantidad = q ? num(q[2]) : 0;

    // Descripción: <cbc:Description>…</cbc:Description>
    const desc = b.match(/<cbc:Description>([\s\S]*?)<\/cbc:Description>/);
    const descripcion = desc ? decodeEntities(stripCdata(desc[1])).trim() : "";

    // Código interno: <cac:Item><cac:SellersItemIdentification><cbc:ID>…</cbc:ID>
    const cod = b.match(
      /<cac:SellersItemIdentification>\s*<cbc:ID>([^<]*)<\/cbc:ID>/
    );
    const codigo = cod ? cod[1].trim() : "";

    items.push({ descripcion, unidadMedida, cantidad, codigo });
  }

  return items;
}

/**
 * Extrae la observación libre de cabecera GRE. Se acota al bloque anterior a
 * <cac:Signature> para no confundirla con notas futuras dentro de líneas/detalles.
 */
export function parseGuiaObservacion(xml: string): string | null {
  if (!xml || typeof xml !== "string") return null;
  const header = xml.split("<cac:Signature>")[0] || xml;
  const match = header.match(/<cbc:Note\b[^>]*>([\s\S]*?)<\/cbc:Note>/);
  if (!match) return null;
  const value = decodeEntities(stripCdata(match[1])).replace(/\s+/g, " ").trim();
  return value || null;
}

export interface GuiaPuntoLlegada {
  ubigeo: string;       // código ubigeo (ej. "150115")
  direccion: string;    // calle / dirección libre
}

/**
 * Extrae el Punto de Llegada de un XML de Guía de Remisión.
 * Busca en <cac:Delivery><cac:DeliveryAddress>…</cac:DeliveryAddress>.
 * Devuelve null si no encuentra la sección.
 */
export function parseGuiaPuntoLlegada(xml: string): GuiaPuntoLlegada | null {
  if (!xml || typeof xml !== "string") return null;

  // El Punto de Llegada está en el segundo <cac:Delivery> (el primero es Punto de Partida).
  // SUNAT GRE: Partida = primer Shipment/Consignment/…; Llegada = cac:Delivery directo.
  // En nuestro xml-builder-guia.ts el Punto de Llegada se emite como:
  // <cac:Delivery><cac:DeliveryAddress>…</cac:DeliveryAddress></cac:Delivery>
  // fuera de cac:Shipment.
  const deliveryMatch = xml.match(
    /<cac:Delivery>([\s\S]*?)<\/cac:Delivery>/g
  );
  if (!deliveryMatch) return null;

  // Tomamos el primer bloque <cac:Delivery> que contenga <cac:DeliveryAddress>
  for (const block of deliveryMatch) {
    const addrBlock = block.match(
      /<cac:DeliveryAddress>([\s\S]*?)<\/cac:DeliveryAddress>/
    );
    if (!addrBlock) continue;

    const inner = addrBlock[1];

    // El <cbc:ID> del ubigeo lleva atributos (schemeAgencyName/schemeName); hay que permitirlos.
    const ubigeoMatch = inner.match(/<cbc:ID[^>]*>([\s\S]*?)<\/cbc:ID>/);
    const ubigeo = ubigeoMatch ? ubigeoMatch[1].trim() : "";

    // La dirección se emite en <cac:AddressLine><cbc:Line>…, NO en <cbc:StreetName>
    // (igual que parseCpeClienteDireccion en este mismo archivo).
    const lineMatch = inner.match(/<cbc:Line>([\s\S]*?)<\/cbc:Line>/);
    const direccion = lineMatch
      ? decodeEntities(stripCdata(lineMatch[1])).trim()
      : "";

    if (ubigeo || direccion) {
      return { ubigeo, direccion };
    }
  }

  return null;
}

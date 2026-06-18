// ============================================================
// SUNAT XML Builder - UBL 2.1 Document Generator
// ============================================================

import { create } from "xmlbuilder2";
import {
  DatosComprobante,
  TipoComprobante,
  TipoAfectacionIGV,
  ComprobanteItem,
  TotalesComprobante,
  DatosResumenDiario,
  DatosComunicacionBaja,
} from "./types";
import { SunatConfig, CATALOGO, formatNumero, montoATexto } from "./config-transavic";

// --- Namespaces UBL 2.1 ---
const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  creditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  debitNote: "urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  sac: "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1",
  ccts: "urn:un:unece:uncefact:documentation:2",
  qdt: "urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2",
  udt: "urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2",
  // Summary Documents
  summaryDoc:
    "urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1",
  voidedDoc:
    "urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1",
};

// --- Helper: Redondeo a 2 decimales ---
// Exportado para que el motor (index.ts) calcule los totales de DB con la MISMA
// aritmética que el XML (evita el descuadre de 1 céntimo monto_total≠PayableAmount).
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Helper: Format decimal smartly (min 2, max 10, trim trailing zeros) ---
// SUNAT allows up to 10 decimals for PriceAmount (valor unitario)
function formatDecimalSunat(n: number, minDecimals: number = 2, maxDecimals: number = 10): string {
  const fixed = n.toFixed(maxDecimals);
  // Remove trailing zeros but keep at least minDecimals
  const parts = fixed.split('.');
  let decimals = parts[1] || '';
  // Trim trailing zeros
  while (decimals.length > minDecimals && decimals.endsWith('0')) {
    decimals = decimals.slice(0, -1);
  }
  return `${parts[0]}.${decimals}`;
}

// --- Helper: Calcular totales ---
// Fuente ÚNICA de verdad de los importes del comprobante: redondea cada línea
// (r2) y suma líneas ya redondeadas → produce el cbc:PayableAmount del XML que
// SUNAT registra y valida. El motor (index.ts) la usa para persistir
// monto_total/subtotal/igv idénticos al XML (NO recalcular en paralelo).
export function calcularTotales(items: ComprobanteItem[]): TotalesComprobante {
  let totalGravadas = 0;
  let totalExoneradas = 0;
  let totalInafectas = 0;
  let totalGratuitas = 0;
  let totalIGV = 0;

  for (const item of items) {
    let valorVenta: number;
    let montoIGV: number;
    let brutoLinea: number;

    if (item.valorVenta != null && item.montoIGV != null) {
      // Línea con importes YA fijados (ej. una NOTA DE CRÉDITO que copia EXACTO
      // las líneas del XML firmado de su factura): se respetan tal cual para que
      // NC == factura. NO se re-ancla: re-anclar podría dar un total mayor al de
      // una factura vieja que quedó 1 céntimo por debajo → SUNAT 3286 (NC > factura).
      valorVenta = r2(item.valorVenta);
      montoIGV = r2(item.montoIGV);
      brutoLinea = r2(valorVenta + montoIGV);
    } else {
      // ANCLAJE AL BRUTO (precio CON IGV): el negocio cobra un precio con IGV
      // (ej. S/100). Para que el TOTAL del comprobante sea EXACTAMENTE ese bruto
      // (y no 100.01 por el redondeo del IGV), se calcula así:
      //   bruto de línea = redondeo(precio_con_igv * cantidad)
      //   valorVenta (base) = redondeo(bruto / 1.18)
      //   IGV = bruto - base   (en vez de redondeo(base*0.18), que desviaba 1 céntimo)
      // El IGV resultante difiere ≤0.005 de base*18% — dentro de la tolerancia que
      // SUNAT aplica al validar el impuesto por línea (verificado en beta: boleta
      // S/100 ACEPTADA con IGV 15.25). Así total == precio con IGV tecleado, y
      // pantalla/cobranza/XML cuadran.
      const factor = 1 + item.porcentajeIGV / 100; // 1.18 (gravada) ó 1 (exonerada/inafecta)
      const precioConIgvUnit = r2(item.precioUnitario * factor);
      brutoLinea = r2(precioConIgvUnit * item.cantidad);
      valorVenta = r2(brutoLinea / factor);
      montoIGV = r2(brutoLinea - valorVenta);
    }

    item.valorVenta = valorVenta;
    item.montoIGV = montoIGV;
    item.precioTotal = brutoLinea;

    switch (item.tipoAfectacionIGV) {
      case TipoAfectacionIGV.GRAVADA_ONEROSA:
        totalGravadas += valorVenta;
        totalIGV += montoIGV;
        break;
      case TipoAfectacionIGV.EXONERADA_ONEROSA:
        totalExoneradas += valorVenta;
        break;
      case TipoAfectacionIGV.INAFECTA_ONEROSA:
        totalInafectas += valorVenta;
        break;
      default:
        if (parseInt(item.tipoAfectacionIGV) >= 11 && parseInt(item.tipoAfectacionIGV) <= 17) {
          totalGratuitas += valorVenta;
          totalIGV += montoIGV;
        } else {
          totalGravadas += valorVenta;
          totalIGV += montoIGV;
        }
    }
  }

  const importeTotal = r2(totalGravadas + totalExoneradas + totalInafectas + totalIGV);

  return {
    totalGravadas: r2(totalGravadas),
    totalExoneradas: r2(totalExoneradas),
    totalInafectas: r2(totalInafectas),
    totalGratuitas: r2(totalGratuitas),
    totalIGV: r2(totalIGV),
    totalISC: 0,
    totalOtrosCargos: 0,
    totalDescuentos: 0,
    importeTotal,
  };
}

/**
 * Genera XML UBL 2.1 para Factura (01) o Boleta (03)
 */
export function generarXMLComprobante(
  datos: DatosComprobante,
  config: SunatConfig
): string {
  // Calcular totales si no se proporcionaron
  const totales = datos.totales || calcularTotales(datos.items);
  datos.totales = totales;

  const horaEmision = datos.horaEmision || new Date().toTimeString().slice(0, 8);
  const serieNumero = `${datos.serie}-${formatNumero(datos.numero)}`;

  // Determinar root element y namespace según tipo de documento
  let rootTag: string;
  let rootNs: string;

  if (datos.tipoComprobante === TipoComprobante.NOTA_CREDITO) {
    rootTag = "CreditNote";
    rootNs = NS.creditNote;
  } else if (datos.tipoComprobante === TipoComprobante.NOTA_DEBITO) {
    rootTag = "DebitNote";
    rootNs = NS.debitNote;
  } else {
    rootTag = "Invoice";
    rootNs = NS.invoice;
  }

  // Crear documento XML. Namespaces idénticos a conexipema (probado en PRODUCCIÓN).
  // sac/ccts/qdt/udt van aunque no todos se usen en facturas — así lo emite
  // conexipema y SUNAT producción lo acepta. (El BETA `ol-ti-itcpfegem-beta` es un
  // validador viejo que los rechaza, pero no es representativo — ver CLAUDE.md §13.)
  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele(rootNs, rootTag)
    .att("xmlns:cac", NS.cac)
    .att("xmlns:cbc", NS.cbc)
    .att("xmlns:ext", NS.ext)
    .att("xmlns:ds", NS.ds)
    .att("xmlns:sac", NS.sac)
    .att("xmlns:ccts", NS.ccts)
    .att("xmlns:qdt", NS.qdt)
    .att("xmlns:udt", NS.udt);

  // --- UBLExtensions (placeholder para firma digital) ---
  const extensions = doc.ele(NS.ext, "ext:UBLExtensions");
  extensions
    .ele(NS.ext, "ext:UBLExtension")
    .ele(NS.ext, "ext:ExtensionContent");
  // La firma (ds:Signature) se insertará aquí por xml-signer.ts

  // --- Datos del comprobante ---
  doc.ele(NS.cbc, "cbc:UBLVersionID").txt(CATALOGO.UBL_VERSION);
  doc.ele(NS.cbc, "cbc:CustomizationID").txt(CATALOGO.CUSTOMIZATION_ID);

  // ID (Serie-Número)
  doc.ele(NS.cbc, "cbc:ID").txt(serieNumero);

  // Fecha y hora de emisión
  doc.ele(NS.cbc, "cbc:IssueDate").txt(datos.fechaEmision);
  doc.ele(NS.cbc, "cbc:IssueTime").txt(horaEmision);

  // Fecha de vencimiento (si aplica)
  if (datos.fechaVencimiento) {
    doc.ele(NS.cbc, "cbc:DueDate").txt(datos.fechaVencimiento);
  }

  // Tipo de comprobante
  if (rootTag === "Invoice") {
    doc
      .ele(NS.cbc, "cbc:InvoiceTypeCode")
      .att("listID", datos.tipoOperacion)
      .att("name", "Tipo de Operacion")
      .att("listAgencyName", "PE:SUNAT")
      .att("listName", "Tipo de Documento")
      .att("listURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01")
      .txt(datos.tipoComprobante);
  }

  // Leyendas
  const leyendaTexto =
    datos.leyendas?.[0]?.valor ||
    montoATexto(totales.importeTotal, datos.moneda);

  // Leyenda (monto en letras). languageLocaleID="1000" = código de catálogo 52.
  doc
    .ele(NS.cbc, "cbc:Note")
    .att("languageLocaleID", "1000")
    .txt(leyendaTexto);

  // Moneda
  doc
    .ele(NS.cbc, "cbc:DocumentCurrencyCode")
    .att("listID", "ISO 4217 Alpha")
    .att("listName", "Currency")
    .att("listAgencyName", "United Nations Economic Commission for Europe")
    .txt(datos.moneda);

  // --- Referencia a documento (para NC/ND) ---
  if (datos.documentoReferencia && (rootTag === "CreditNote" || rootTag === "DebitNote")) {
    const refTag = rootTag === "CreditNote" ? "cac:DiscrepancyResponse" : "cac:DiscrepancyResponse";
    const discrepancy = doc.ele(NS.cac, refTag);
    discrepancy.ele(NS.cbc, "cbc:ReferenceID").txt(
      `${datos.documentoReferencia.serie}-${formatNumero(datos.documentoReferencia.numero)}`
    );
    discrepancy.ele(NS.cbc, "cbc:ResponseCode").txt(
      rootTag === "CreditNote"
        ? datos.documentoReferencia.tipoNotaCredito || "01"
        : datos.documentoReferencia.tipoNotaDebito || "01"
    );
    discrepancy.ele(NS.cbc, "cbc:Description").txt(datos.documentoReferencia.motivo);

    const billingRef = doc.ele(NS.cac, "cac:BillingReference");
    const invoiceDocRef = billingRef.ele(NS.cac, "cac:InvoiceDocumentReference");
    invoiceDocRef.ele(NS.cbc, "cbc:ID").txt(
      `${datos.documentoReferencia.serie}-${formatNumero(datos.documentoReferencia.numero)}`
    );
    invoiceDocRef.ele(NS.cbc, "cbc:DocumentTypeCode").txt(datos.documentoReferencia.tipoComprobante);
  }

  // --- Firma digital (referencia) ---
  const signature = doc.ele(NS.cac, "cac:Signature");
  signature.ele(NS.cbc, "cbc:ID").txt(`IDSign${config.ruc}`);
  const signatoryParty = signature.ele(NS.cac, "cac:SignatoryParty");
  signatoryParty
    .ele(NS.cac, "cac:PartyIdentification")
    .ele(NS.cbc, "cbc:ID")
    .txt(config.ruc);
  signatoryParty
    .ele(NS.cac, "cac:PartyName")
    .ele(NS.cbc, "cbc:Name")
    .txt(config.razonSocial);
  signature
    .ele(NS.cac, "cac:DigitalSignatureAttachment")
    .ele(NS.cac, "cac:ExternalReference")
    .ele(NS.cbc, "cbc:URI")
    .txt(`#SignSUNAT`);

  // --- Datos del emisor ---
  const supplier = doc.ele(NS.cac, "cac:AccountingSupplierParty");
  const supplierParty = supplier.ele(NS.cac, "cac:Party");

  supplierParty
    .ele(NS.cac, "cac:PartyIdentification")
    .ele(NS.cbc, "cbc:ID")
    .att("schemeID", "6") // RUC
    .att("schemeName", "Documento de Identidad")
    .att("schemeAgencyName", "PE:SUNAT")
    .att("schemeURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06")
    .txt(config.ruc);

  supplierParty
    .ele(NS.cac, "cac:PartyName")
    .ele(NS.cbc, "cbc:Name")
    .txt(config.nombreComercial);

  const supplierLegal = supplierParty.ele(NS.cac, "cac:PartyLegalEntity");
  supplierLegal.ele(NS.cbc, "cbc:RegistrationName").txt(config.razonSocial);

  const supplierAddr = supplierLegal.ele(NS.cac, "cac:RegistrationAddress");
  supplierAddr.ele(NS.cbc, "cbc:ID").txt(config.ubigeo);
  supplierAddr.ele(NS.cbc, "cbc:AddressTypeCode").txt("0000");
  // Urbanización (CitySubdivisionName): SOLO se incluye si existe. Un elemento
  // VACÍO dispara la observación SUNAT 4095 ("la urbanización del domicilio
  // fiscal no cumple con el formato"). Si no hay urbanización, se OMITE (SUNAT
  // lo permite). Se configura con SUNAT_*_URBANIZACION (vacío por defecto).
  if (config.urbanizacion && config.urbanizacion.trim()) {
    supplierAddr
      .ele(NS.cbc, "cbc:CitySubdivisionName")
      .txt(config.urbanizacion.trim());
  }
  supplierAddr.ele(NS.cbc, "cbc:CityName").txt(config.provincia);
  supplierAddr.ele(NS.cbc, "cbc:CountrySubentity").txt(config.departamento);
  supplierAddr.ele(NS.cbc, "cbc:District").txt(config.distrito);
  supplierAddr
    .ele(NS.cac, "cac:AddressLine")
    .ele(NS.cbc, "cbc:Line")
    .txt(config.direccion);
  supplierAddr
    .ele(NS.cac, "cac:Country")
    .ele(NS.cbc, "cbc:IdentificationCode")
    .txt(config.codigoPais);

  // --- Datos del cliente ---
  const customer = doc.ele(NS.cac, "cac:AccountingCustomerParty");
  const customerParty = customer.ele(NS.cac, "cac:Party");

  customerParty
    .ele(NS.cac, "cac:PartyIdentification")
    .ele(NS.cbc, "cbc:ID")
    .att("schemeID", datos.cliente.tipoDocumento)
    .att("schemeName", "Documento de Identidad")
    .att("schemeAgencyName", "PE:SUNAT")
    .att("schemeURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06")
    .txt(datos.cliente.numDocumento);

  const customerLegal = customerParty.ele(NS.cac, "cac:PartyLegalEntity");
  customerLegal.ele(NS.cbc, "cbc:RegistrationName").txt(datos.cliente.razonSocial);

  if (datos.cliente.direccion) {
    customerLegal
      .ele(NS.cac, "cac:RegistrationAddress")
      .ele(NS.cac, "cac:AddressLine")
      .ele(NS.cbc, "cbc:Line")
      .txt(datos.cliente.direccion);
  }

  // --- Forma de pago (solo para Invoice, no para NC/ND) ---
  if (rootTag === "Invoice") {
    const paymentTerms = doc.ele(NS.cac, "cac:PaymentTerms");
    paymentTerms.ele(NS.cbc, "cbc:ID").txt("FormaPago");
    paymentTerms.ele(NS.cbc, "cbc:PaymentMeansID").txt(datos.formaPago || "Contado");

    if (datos.formaPago === "Credito" && datos.fechaVencimiento) {
      paymentTerms
        .ele(NS.cbc, "cbc:Amount")
        .att("currencyID", datos.moneda)
        .txt(totales.importeTotal.toFixed(2));

      const cuota = doc.ele(NS.cac, "cac:PaymentTerms");
      cuota.ele(NS.cbc, "cbc:ID").txt("FormaPago");
      cuota.ele(NS.cbc, "cbc:PaymentMeansID").txt("Cuota001");
      cuota
        .ele(NS.cbc, "cbc:Amount")
        .att("currencyID", datos.moneda)
        .txt(totales.importeTotal.toFixed(2));
      cuota.ele(NS.cbc, "cbc:PaymentDueDate").txt(datos.fechaVencimiento);
    }
  }

  // --- Totales de impuestos ---
  const taxTotal = doc.ele(NS.cac, "cac:TaxTotal");
  taxTotal
    .ele(NS.cbc, "cbc:TaxAmount")
    .att("currencyID", datos.moneda)
    .txt(totales.totalIGV.toFixed(2));

  // Sub-total IGV (gravadas)
  if (totales.totalGravadas > 0) {
    agregarSubTotalImpuesto(taxTotal, totales.totalGravadas, totales.totalIGV, datos.moneda, {
      id: "1000", nombre: "IGV", codigo: "VAT", tipoAfectacion: "10"
    });
  }

  // Sub-total exoneradas
  if (totales.totalExoneradas > 0) {
    agregarSubTotalImpuesto(taxTotal, totales.totalExoneradas, 0, datos.moneda, {
      id: "9997", nombre: "EXO", codigo: "VAT", tipoAfectacion: "20"
    });
  }

  // Sub-total inafectas
  if (totales.totalInafectas > 0) {
    agregarSubTotalImpuesto(taxTotal, totales.totalInafectas, 0, datos.moneda, {
      id: "9998", nombre: "INA", codigo: "FRE", tipoAfectacion: "30"
    });
  }

  // --- Totales monetarios ---
  const legalTotal = doc.ele(NS.cac, "cac:LegalMonetaryTotal");
  legalTotal
    .ele(NS.cbc, "cbc:LineExtensionAmount")
    .att("currencyID", datos.moneda)
    .txt(r2(totales.totalGravadas + totales.totalExoneradas + totales.totalInafectas).toFixed(2));
  legalTotal
    .ele(NS.cbc, "cbc:TaxInclusiveAmount")
    .att("currencyID", datos.moneda)
    .txt(totales.importeTotal.toFixed(2));
  legalTotal
    .ele(NS.cbc, "cbc:AllowanceTotalAmount")
    .att("currencyID", datos.moneda)
    .txt(totales.totalDescuentos.toFixed(2));
  legalTotal
    .ele(NS.cbc, "cbc:ChargeTotalAmount")
    .att("currencyID", datos.moneda)
    .txt(totales.totalOtrosCargos.toFixed(2));
  // Monto de redondeo (SUNAT: para que el total sea exacto)
  if (totales.montoRedondeo && totales.montoRedondeo !== 0) {
    legalTotal
      .ele(NS.cbc, "cbc:PayableRoundingAmount")
      .att("currencyID", datos.moneda)
      .txt(totales.montoRedondeo.toFixed(2));
  }
  legalTotal
    .ele(NS.cbc, "cbc:PayableAmount")
    .att("currencyID", datos.moneda)
    .txt(totales.importeTotal.toFixed(2));

  // --- Items/Líneas ---
  datos.items.forEach((item, index) => {
    const lineTag = rootTag === "Invoice" ? "cac:InvoiceLine" : "cac:CreditNoteLine";
    agregarLineaItem(doc, item, index + 1, datos.moneda, lineTag);
  });

  return doc.end({ prettyPrint: true });
}

/** Agrega un sub-total de impuesto al TaxTotal */
function agregarSubTotalImpuesto(
  taxTotal: ReturnType<typeof create>,
  baseImponible: number,
  montoImpuesto: number,
  moneda: string,
  tributo: { id: string; nombre: string; codigo: string; tipoAfectacion: string }
) {
  const subtotal = taxTotal.ele(NS.cac, "cac:TaxSubtotal");
  subtotal
    .ele(NS.cbc, "cbc:TaxableAmount")
    .att("currencyID", moneda)
    .txt(baseImponible.toFixed(2));
  subtotal
    .ele(NS.cbc, "cbc:TaxAmount")
    .att("currencyID", moneda)
    .txt(montoImpuesto.toFixed(2));

  const taxCategory = subtotal.ele(NS.cac, "cac:TaxCategory");
  taxCategory.ele(NS.cbc, "cbc:ID").txt(tributo.tipoAfectacion);
  const taxScheme = taxCategory.ele(NS.cac, "cac:TaxScheme");
  taxScheme.ele(NS.cbc, "cbc:ID").txt(tributo.id);
  taxScheme.ele(NS.cbc, "cbc:Name").txt(tributo.nombre);
  taxScheme.ele(NS.cbc, "cbc:TaxTypeCode").txt(tributo.codigo);
}

/** Agrega una línea de item al comprobante */
function agregarLineaItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  item: ComprobanteItem,
  lineNumber: number,
  moneda: string,
  lineTag: string
) {
  const valorVenta = item.valorVenta ?? r2(item.cantidad * item.precioUnitario);
  const montoIGV = item.montoIGV ?? r2(valorVenta * (item.porcentajeIGV / 100));
  const precioConIGV = r2(item.precioUnitario * (1 + item.porcentajeIGV / 100));

  const line = doc.ele(NS.cac, lineTag);
  line.ele(NS.cbc, "cbc:ID").txt(lineNumber.toString());

  // Cantidad. Atributos idénticos a conexipema (aceptado en PRODUCCIÓN).
  const qtyTag = lineTag.includes("Invoice") ? "cbc:InvoicedQuantity" : "cbc:CreditedQuantity";
  line
    .ele(NS.cbc, qtyTag)
    .att("unitCode", item.unidadMedida)
    .att("unitCodeListID", "UN/ECE rec 20")
    .att("unitCodeListAgencyName", "United Nations Economic Commission for Europe")
    .txt(item.cantidad.toString());

  // Valor de venta de la línea
  line
    .ele(NS.cbc, "cbc:LineExtensionAmount")
    .att("currencyID", moneda)
    .txt(valorVenta.toFixed(2));

  // Precio con impuestos
  const pricing = line.ele(NS.cac, "cac:PricingReference");
  const altPrice = pricing.ele(NS.cac, "cac:AlternativeConditionPrice");
  altPrice
    .ele(NS.cbc, "cbc:PriceAmount")
    .att("currencyID", moneda)
    .txt(precioConIGV.toFixed(2));
  altPrice.ele(NS.cbc, "cbc:PriceTypeCode").txt("01"); // Precio unitario con impuestos

  // Impuestos del item
  const lineTaxTotal = line.ele(NS.cac, "cac:TaxTotal");
  lineTaxTotal
    .ele(NS.cbc, "cbc:TaxAmount")
    .att("currencyID", moneda)
    .txt(montoIGV.toFixed(2));

  const lineTaxSubtotal = lineTaxTotal.ele(NS.cac, "cac:TaxSubtotal");
  lineTaxSubtotal
    .ele(NS.cbc, "cbc:TaxableAmount")
    .att("currencyID", moneda)
    .txt(valorVenta.toFixed(2));
  lineTaxSubtotal
    .ele(NS.cbc, "cbc:TaxAmount")
    .att("currencyID", moneda)
    .txt(montoIGV.toFixed(2));

  const lineTaxCategory = lineTaxSubtotal.ele(NS.cac, "cac:TaxCategory");
  lineTaxCategory.ele(NS.cbc, "cbc:ID").txt(item.tipoAfectacionIGV);
  lineTaxCategory
    .ele(NS.cbc, "cbc:Percent")
    .txt(item.porcentajeIGV.toString());
  lineTaxCategory.ele(NS.cbc, "cbc:TaxExemptionReasonCode").txt(item.tipoAfectacionIGV);

  const lineTaxScheme = lineTaxCategory.ele(NS.cac, "cac:TaxScheme");
  lineTaxScheme.ele(NS.cbc, "cbc:ID").txt(CATALOGO.IGV.id);
  lineTaxScheme.ele(NS.cbc, "cbc:Name").txt(CATALOGO.IGV.nombre);
  lineTaxScheme.ele(NS.cbc, "cbc:TaxTypeCode").txt(CATALOGO.IGV.codigoInternacional);

  // Descripción y precio unitario
  const itemDesc = line.ele(NS.cac, "cac:Item");
  itemDesc.ele(NS.cbc, "cbc:Description").txt(item.descripcion);
  if (item.codigo) {
    itemDesc
      .ele(NS.cac, "cac:SellersItemIdentification")
      .ele(NS.cbc, "cbc:ID")
      .txt(item.codigo);
  }

  // Código de producto SUNAT (UNSPSC - Catálogo N° 25)
  if (item.codigoProductoSunat) {
    itemDesc
      .ele(NS.cac, "cac:CommodityClassification")
      .ele(NS.cbc, "cbc:ItemClassificationCode")
      .att("listID", "UNSPSC")
      .att("listAgencyName", "GS1 US")
      .att("listName", "Item classification")
      .txt(item.codigoProductoSunat);
  }

  const price = line.ele(NS.cac, "cac:Price");
  price
    .ele(NS.cbc, "cbc:PriceAmount")
    .att("currencyID", moneda)
    .txt(formatDecimalSunat(item.precioUnitario));
}

/**
 * Genera XML para Resumen Diario de Boletas (SummaryDocuments)
 */
export function generarXMLResumenDiario(
  datos: DatosResumenDiario,
  config: SunatConfig
): string {
  const idResumen = `RC-${datos.fechaEmision.replace(/-/g, "")}-${datos.correlativo.toString().padStart(5, "0")}`;

  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele(NS.summaryDoc, "SummaryDocuments")
    .att("xmlns:cac", NS.cac)
    .att("xmlns:cbc", NS.cbc)
    .att("xmlns:ext", NS.ext)
    .att("xmlns:ds", NS.ds)
    .att("xmlns:sac", NS.sac);

  // UBLExtensions (placeholder para firma)
  const extensions = doc.ele(NS.ext, "ext:UBLExtensions");
  extensions
    .ele(NS.ext, "ext:UBLExtension")
    .ele(NS.ext, "ext:ExtensionContent")
    .txt("");

  doc.ele(NS.cbc, "cbc:UBLVersionID").txt("2.0");
  doc.ele(NS.cbc, "cbc:CustomizationID").txt("1.0");
  doc.ele(NS.cbc, "cbc:ID").txt(idResumen);
  doc.ele(NS.cbc, "cbc:ReferenceDate").txt(datos.fechaReferencia);
  doc.ele(NS.cbc, "cbc:IssueDate").txt(datos.fechaEmision);

  // Firma
  const signature = doc.ele(NS.cac, "cac:Signature");
  signature.ele(NS.cbc, "cbc:ID").txt(`IDSign${config.ruc}`);
  const sigParty = signature.ele(NS.cac, "cac:SignatoryParty");
  sigParty.ele(NS.cac, "cac:PartyIdentification").ele(NS.cbc, "cbc:ID").txt(config.ruc);
  sigParty.ele(NS.cac, "cac:PartyName").ele(NS.cbc, "cbc:Name").txt(config.razonSocial);
  signature.ele(NS.cac, "cac:DigitalSignatureAttachment")
    .ele(NS.cac, "cac:ExternalReference")
    .ele(NS.cbc, "cbc:URI").txt("#SignSUNAT");

  // Emisor
  const supplier = doc.ele(NS.cac, "cac:AccountingSupplierParty");
  supplier.ele(NS.cbc, "cbc:CustomerAssignedAccountID").txt(config.ruc);
  supplier.ele(NS.cbc, "cbc:AdditionalAccountID").txt("6");
  const supplierParty = supplier.ele(NS.cac, "cac:Party");
  supplierParty.ele(NS.cac, "cac:PartyLegalEntity")
    .ele(NS.cbc, "cbc:RegistrationName").txt(config.razonSocial);

  // Líneas del resumen
  datos.items.forEach((item, index) => {
    const line = doc.ele(NS.sac, "sac:SummaryDocumentsLine");
    line.ele(NS.cbc, "cbc:LineID").txt((index + 1).toString());
    line.ele(NS.cbc, "cbc:DocumentTypeCode").txt(item.tipoComprobante);
    line.ele(NS.sac, "sac:DocumentSerialID").txt(item.serie);
    line.ele(NS.sac, "sac:StartDocumentNumberID").txt(item.numeroInicio.toString());
    line.ele(NS.sac, "sac:EndDocumentNumberID").txt(item.numeroFin.toString());

    // Total
    line.ele(NS.sac, "sac:TotalAmount")
      .att("currencyID", item.moneda)
      .txt(item.importeTotal.toFixed(2));

    // Cliente
    const accountingCustomer = line.ele(NS.cac, "cac:AccountingCustomerParty");
    accountingCustomer.ele(NS.cbc, "cbc:CustomerAssignedAccountID").txt(item.numDocumentoCliente);
    accountingCustomer.ele(NS.cbc, "cbc:AdditionalAccountID").txt(item.tipoDocumentoCliente);

    // Billing payment (gravadas, exoneradas, inafectas)
    if (item.totalGravadas > 0) {
      const billing1 = line.ele(NS.sac, "sac:BillingPayment");
      billing1.ele(NS.cbc, "cbc:PaidAmount").att("currencyID", item.moneda).txt(item.totalGravadas.toFixed(2));
      billing1.ele(NS.cbc, "cbc:InstructionID").txt("01");
    }
    if (item.totalExoneradas > 0) {
      const billing2 = line.ele(NS.sac, "sac:BillingPayment");
      billing2.ele(NS.cbc, "cbc:PaidAmount").att("currencyID", item.moneda).txt(item.totalExoneradas.toFixed(2));
      billing2.ele(NS.cbc, "cbc:InstructionID").txt("02");
    }
    if (item.totalInafectas > 0) {
      const billing3 = line.ele(NS.sac, "sac:BillingPayment");
      billing3.ele(NS.cbc, "cbc:PaidAmount").att("currencyID", item.moneda).txt(item.totalInafectas.toFixed(2));
      billing3.ele(NS.cbc, "cbc:InstructionID").txt("03");
    }

    // IGV
    const taxTotal = line.ele(NS.cac, "cac:TaxTotal");
    taxTotal.ele(NS.cbc, "cbc:TaxAmount").att("currencyID", item.moneda).txt(item.totalIGV.toFixed(2));
    const taxSubtotal = taxTotal.ele(NS.cac, "cac:TaxSubtotal");
    taxSubtotal.ele(NS.cbc, "cbc:TaxAmount").att("currencyID", item.moneda).txt(item.totalIGV.toFixed(2));
    const taxCategory = taxSubtotal.ele(NS.cac, "cac:TaxCategory");
    const taxScheme = taxCategory.ele(NS.cac, "cac:TaxScheme");
    taxScheme.ele(NS.cbc, "cbc:ID").txt("1000");
    taxScheme.ele(NS.cbc, "cbc:Name").txt("IGV");
    taxScheme.ele(NS.cbc, "cbc:TaxTypeCode").txt("VAT");

    // Estado
    line.ele(NS.sac, "sac:Status").ele(NS.cbc, "cbc:ConditionCode").txt(item.estadoItem);
  });

  return doc.end({ prettyPrint: true });
}

/**
 * Genera XML para Comunicación de Baja (VoidedDocuments)
 */
export function generarXMLComunicacionBaja(
  datos: DatosComunicacionBaja,
  config: SunatConfig
): string {
  const idBaja = `RA-${datos.fechaEmision.replace(/-/g, "")}-${datos.correlativo.toString().padStart(5, "0")}`;

  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele(NS.voidedDoc, "VoidedDocuments")
    .att("xmlns:cac", NS.cac)
    .att("xmlns:cbc", NS.cbc)
    .att("xmlns:ext", NS.ext)
    .att("xmlns:ds", NS.ds)
    .att("xmlns:sac", NS.sac);

  // UBLExtensions
  doc.ele(NS.ext, "ext:UBLExtensions")
    .ele(NS.ext, "ext:UBLExtension")
    .ele(NS.ext, "ext:ExtensionContent")
    .txt("");

  doc.ele(NS.cbc, "cbc:UBLVersionID").txt("2.0");
  doc.ele(NS.cbc, "cbc:CustomizationID").txt("1.0");
  doc.ele(NS.cbc, "cbc:ID").txt(idBaja);
  doc.ele(NS.cbc, "cbc:ReferenceDate").txt(datos.fechaReferencia);
  doc.ele(NS.cbc, "cbc:IssueDate").txt(datos.fechaEmision);

  // Firma
  const signature = doc.ele(NS.cac, "cac:Signature");
  signature.ele(NS.cbc, "cbc:ID").txt(`IDSign${config.ruc}`);
  const sigParty = signature.ele(NS.cac, "cac:SignatoryParty");
  sigParty.ele(NS.cac, "cac:PartyIdentification").ele(NS.cbc, "cbc:ID").txt(config.ruc);
  sigParty.ele(NS.cac, "cac:PartyName").ele(NS.cbc, "cbc:Name").txt(config.razonSocial);
  signature.ele(NS.cac, "cac:DigitalSignatureAttachment")
    .ele(NS.cac, "cac:ExternalReference")
    .ele(NS.cbc, "cbc:URI").txt("#SignSUNAT");

  // Emisor
  const supplier = doc.ele(NS.cac, "cac:AccountingSupplierParty");
  supplier.ele(NS.cbc, "cbc:CustomerAssignedAccountID").txt(config.ruc);
  supplier.ele(NS.cbc, "cbc:AdditionalAccountID").txt("6");
  const supplierParty = supplier.ele(NS.cac, "cac:Party");
  supplierParty.ele(NS.cac, "cac:PartyLegalEntity")
    .ele(NS.cbc, "cbc:RegistrationName").txt(config.razonSocial);

  // Líneas de baja
  datos.items.forEach((item, index) => {
    const line = doc.ele(NS.sac, "sac:VoidedDocumentsLine");
    line.ele(NS.cbc, "cbc:LineID").txt((index + 1).toString());
    line.ele(NS.cbc, "cbc:DocumentTypeCode").txt(item.tipoComprobante);
    line.ele(NS.sac, "sac:DocumentSerialID").txt(item.serie);
    line.ele(NS.sac, "sac:DocumentNumberID").txt(item.numero.toString());
    line.ele(NS.sac, "sac:VoidReasonDescription").txt(item.motivo);
  });

  return doc.end({ prettyPrint: true });
}

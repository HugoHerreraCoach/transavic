// src/lib/sunat/xml-builder-guia.ts
// ============================================================
// SUNAT XML Guía Builder - UBL 2.1 DespatchAdvice Document Generator
// ============================================================

import { create } from "xmlbuilder2";
import { SunatConfig, formatNumero } from "./config-transavic";
import { MAX_OBSERVACION_GRE, normalizarObservacionSunat } from "./observaciones";

export interface DatosGuia {
  serie: string;
  numero: number;
  fechaEmision: string;
  horaEmision?: string;
  fechaInicioTraslado: string;
  motivoTraslado: string; // Catálogo 18: '01' (Venta), '18' (Itinerante), etc.
  descripcionMotivo?: string;
  pesoBrutoTotal: number;
  totalBultos: number;
  modalidadTraslado: string; // Catálogo 20: '01' (Público) o '02' (Privado)
  indicadorM1L?: boolean; // Indicador de traslado en vehículos de categoría M1 o L
  /** Observación libre de cabecera GRE. SUNAT: /DespatchAdvice/cbc:Note, an..250. */
  observacionComprobante?: string | null;
  repartidor?: {
    docTipo: string; // Catálogo 06: '1' (DNI), etc.
    docNum: string;
    licencia: string;
    nombres: string;   // Nombres del conductor (SUNAT cbc:FirstName)
    apellidos: string;  // Apellidos del conductor (SUNAT cbc:FamilyName)
    placa: string;
  };
  cliente: {
    tipoDocumento: string; // Catálogo 06: '6' (RUC), '1' (DNI), etc.
    numDocumento: string;
    razonSocial: string;
    direccion: string;
    ubigeo: string;
  };
  items: {
    codigo: string;
    descripcion: string;
    unidadMedida: string;
    cantidad: number;
  }[];
}

const NS = {
  despatch: "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  ccts: "urn:un:unece:uncefact:documentation:2",
  qdt: "urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2",
  udt: "urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2",
};

/**
 * Genera el XML UBL 2.1 para una Guía de Remisión Electrónica Remitente (GRE)
 */
export function generarXMLGuia(datos: DatosGuia, config: SunatConfig): string {
  const horaEmision = datos.horaEmision || new Date().toTimeString().slice(0, 8);
  const serieNumero = `${datos.serie}-${formatNumero(datos.numero)}`;

  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele(NS.despatch, "DespatchAdvice")
    .att("xmlns:cac", NS.cac)
    .att("xmlns:cbc", NS.cbc)
    .att("xmlns:ext", NS.ext)
    .att("xmlns:ds", NS.ds)
    .att("xmlns:ccts", NS.ccts)
    .att("xmlns:qdt", NS.qdt)
    .att("xmlns:udt", NS.udt);

  // --- UBLExtensions (firma digital) ---
  const extensions = doc.ele(NS.ext, "ext:UBLExtensions");
  extensions
    .ele(NS.ext, "ext:UBLExtension")
    .ele(NS.ext, "ext:ExtensionContent");

  // --- Datos de Cabecera ---
  doc.ele(NS.cbc, "cbc:UBLVersionID").txt("2.1");
  doc.ele(NS.cbc, "cbc:CustomizationID").txt("2.0");
  doc.ele(NS.cbc, "cbc:ID").txt(serieNumero);
  doc.ele(NS.cbc, "cbc:IssueDate").txt(datos.fechaEmision);
  doc.ele(NS.cbc, "cbc:IssueTime").txt(horaEmision);
  
  // Código '09' = Guía de Remisión Remitente
  doc
    .ele(NS.cbc, "cbc:DespatchAdviceTypeCode")
    .att("listAgencyName", "PE:SUNAT")
    .att("listName", "Tipo de Documento")
    .att("listURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01")
    .txt("09");

  const observacion = normalizarObservacionSunat(
    datos.observacionComprobante,
    MAX_OBSERVACION_GRE
  );
  if (observacion) {
    doc.ele(NS.cbc, "cbc:Note").txt(observacion);
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

  // --- Datos del Emisor (Remitente) ---
  const supplier = doc.ele(NS.cac, "cac:DespatchSupplierParty");
  const supplierParty = supplier.ele(NS.cac, "cac:Party");

  supplierParty
    .ele(NS.cac, "cac:PartyIdentification")
    .ele(NS.cbc, "cbc:ID")
    .att("schemeID", "6") // RUC
    .att("schemeName", "Documento de Identidad")
    .att("schemeAgencyName", "PE:SUNAT")
    .att("schemeURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06")
    .txt(config.ruc);

  const supplierLegal = supplierParty.ele(NS.cac, "cac:PartyLegalEntity");
  supplierLegal.ele(NS.cbc, "cbc:RegistrationName").txt(config.razonSocial);

  // --- Datos del Destinatario (Cliente) ---
  const customer = doc.ele(NS.cac, "cac:DeliveryCustomerParty");
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

  // --- Datos del Traslado (Shipment) ---
  const shipment = doc.ele(NS.cac, "cac:Shipment");
  
  // ID obligatorio del envío (usar el mismo correlativo de la guía)
  shipment.ele(NS.cbc, "cbc:ID").txt(serieNumero);

  // Motivo de traslado (Catálogo 18)
  shipment
    .ele(NS.cbc, "cbc:HandlingCode")
    .att("listAgencyName", "PE:SUNAT")
    .att("listName", "Motivo de traslado")
    .att("listURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo18")
    .txt(datos.motivoTraslado);

  // Descripción del motivo — SUNAT regla 3418: cbc:Information SOLO es válido
  // para motivos 08 (Importación), 09 (Exportación), 19 (Mercancía extranjera).
  // Para cualquier otro motivo (01-Venta, 18-Itinerante, etc.) NO se debe incluir.
  const motivosConInformation = ["08", "09", "19"];
  if (datos.descripcionMotivo && motivosConInformation.includes(datos.motivoTraslado)) {
    shipment.ele(NS.cbc, "cbc:Information").txt(datos.descripcionMotivo);
  }

  // Peso bruto total
  shipment
    .ele(NS.cbc, "cbc:GrossWeightMeasure")
    .att("unitCode", "KGM")
    .txt(datos.pesoBrutoTotal.toFixed(2));

  // Cantidad de bultos
  shipment.ele(NS.cbc, "cbc:TotalTransportHandlingUnitQuantity").txt(datos.totalBultos.toString());

  // Indicador de traslado en vehículos de categoría M1 o L.
  // ⚠️ ORDEN XSD: en UBL 2.1 cac:Shipment es una SECUENCIA estricta — cbc:SpecialInstructions
  // (pos. 18) va DESPUÉS de GrossWeightMeasure (6) y TotalTransportHandlingUnitQuantity (12), y
  // ANTES de cac:ShipmentStage. Emitirlo antes del peso hizo que SUNAT rechazara la guía con
  // "Error al ValidarEsquema… Invalid content … 'cbc:GrossWeightMeasure'" (T002-8/9, 9 jun 2026).
  if (datos.indicadorM1L) {
    shipment.ele(NS.cbc, "cbc:SpecialInstructions").txt("SUNAT_Envio_IndicadorTrasladoVehiculoM1L");
  }

  // Etapa del transporte (ShipmentStage)
  const shipmentStage = shipment.ele(NS.cac, "cac:ShipmentStage");
  
  // Modalidad de traslado: '01' Público, '02' Privado
  shipmentStage
    .ele(NS.cbc, "cbc:TransportModeCode")
    .att("listAgencyName", "PE:SUNAT")
    .att("listName", "Modalidad de traslado")
    .att("listURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo20")
    .txt(datos.modalidadTraslado);

  // Fecha de inicio del traslado
  shipmentStage.ele(NS.cac, "cac:TransitPeriod").ele(NS.cbc, "cbc:StartDate").txt(datos.fechaInicioTraslado);

  // Vehículo — la placa va en ShipmentStage/TransportMeans/RoadTransport
  // (SUNAT error 2566 si falta cuando modalidad es 02-Privado)
  if (datos.modalidadTraslado === "02" && datos.repartidor?.placa) {
    shipmentStage
      .ele(NS.cac, "cac:TransportMeans")
      .ele(NS.cac, "cac:RoadTransport")
      .ele(NS.cbc, "cbc:LicensePlateID")
      .txt(datos.repartidor.placa);
  }

  // Si es modalidad Transporte Privado y hay datos del chofer, incluimos DriverPerson
  if (datos.modalidadTraslado === "02" && datos.repartidor && datos.repartidor.docNum) {
    const driver = shipmentStage.ele(NS.cac, "cac:DriverPerson");
    driver
      .ele(NS.cbc, "cbc:ID")
      .att("schemeID", datos.repartidor.docTipo) // Catálogo 06 (e.g. '1' para DNI)
      .att("schemeName", "Documento de Identidad")
      .att("schemeAgencyName", "PE:SUNAT")
      .att("schemeURI", "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06")
      .txt(datos.repartidor.docNum);

    // Nombres y apellidos del conductor (SUNAT error 3360 si falta)
    driver.ele(NS.cbc, "cbc:FirstName").txt(datos.repartidor.nombres || "-");
    driver.ele(NS.cbc, "cbc:FamilyName").txt(datos.repartidor.apellidos || "-");
    driver.ele(NS.cbc, "cbc:JobTitle").txt("Principal");

    // Licencia de conducir (opcional si es vehículo M1 o L)
    if (datos.repartidor.licencia && datos.repartidor.licencia.trim()) {
      driver
        .ele(NS.cac, "cac:IdentityDocumentReference")
        .ele(NS.cbc, "cbc:ID")
        .txt(datos.repartidor.licencia);
    }
  }

  // --- Direcciones de Partida (Despatch) y Llegada (Delivery) ---
  // SUNAT UBL 2.1: cac:Delivery va ANTES de cac:TransportHandlingUnit en cac:Shipment
  const delivery = shipment.ele(NS.cac, "cac:Delivery");

  // Punto de Llegada (Dirección del Cliente)
  const deliveryAddress = delivery.ele(NS.cac, "cac:DeliveryAddress");
  deliveryAddress
    .ele(NS.cbc, "cbc:ID")
    .att("schemeAgencyName", "PE:SUNAT")
    .att("schemeName", "Ubigeos")
    .txt(datos.cliente.ubigeo);
  deliveryAddress.ele(NS.cac, "cac:AddressLine").ele(NS.cbc, "cbc:Line").txt(datos.cliente.direccion);

  // Punto de Partida (Dirección del Almacén Emisor)
  const despatch = delivery.ele(NS.cac, "cac:Despatch");
  const despatchAddress = despatch.ele(NS.cac, "cac:DespatchAddress");
  despatchAddress
    .ele(NS.cbc, "cbc:ID")
    .att("schemeAgencyName", "PE:SUNAT")
    .att("schemeName", "Ubigeos")
    .txt(config.ubigeo);
  despatchAddress.ele(NS.cac, "cac:AddressLine").ele(NS.cbc, "cbc:Line").txt(config.direccion);
  despatchAddress
    .ele(NS.cac, "cac:Country")
    .ele(NS.cbc, "cbc:IdentificationCode")
    .txt(config.codigoPais);

  // Nota: SUNAT requiere la placa del vehículo en DOS lugares:
  // 1. ShipmentStage/TransportMeans/RoadTransport/LicensePlateID (ya incluido arriba)
  // 2. TransportHandlingUnit/TransportEquipment/ID (aquí abajo) — SUNAT error 2566 si falta
  if (datos.modalidadTraslado === "02" && datos.repartidor?.placa) {
    const transportUnit = shipment.ele(NS.cac, "cac:TransportHandlingUnit");
    transportUnit
      .ele(NS.cac, "cac:TransportEquipment")
      .ele(NS.cbc, "cbc:ID")
      .txt(datos.repartidor.placa.replace(/-/g, ""));
  }

  // --- Detalle de los ítems (Lines) ---
  datos.items.forEach((item, index) => {
    const line = doc.ele(NS.cac, "cac:DespatchLine");
    line.ele(NS.cbc, "cbc:ID").txt((index + 1).toString());
    
    // Cantidad entregada/trasladada
    line
      .ele(NS.cbc, "cbc:DeliveredQuantity")
      .att("unitCode", item.unidadMedida)
      .att("unitCodeListID", "UN/ECE rec 20")
      .att("unitCodeListAgencyName", "United Nations Economic Commission for Europe")
      .txt(item.cantidad.toString());

    // Referencia de la línea de la orden (requerido por SUNAT en UBL 2.1)
    const orderLineRef = line.ele(NS.cac, "cac:OrderLineReference");
    orderLineRef.ele(NS.cbc, "cbc:LineID").txt((index + 1).toString());

    // Datos del producto
    const lineItem = line.ele(NS.cac, "cac:Item");
    lineItem.ele(NS.cbc, "cbc:Description").txt(item.descripcion);
    
    if (item.codigo) {
      lineItem
        .ele(NS.cac, "cac:SellersItemIdentification")
        .ele(NS.cbc, "cbc:ID")
        .txt(item.codigo);
    }
  });

  return doc.end({ prettyPrint: true });
}

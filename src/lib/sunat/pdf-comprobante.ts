// ============================================================
// PDF Comprobante Generator - SUNAT Official Format
// ============================================================
// Generates PDFs that replicate the exact SUNAT official format
// for Boletas de Venta and Facturas Electrónicas.
// Uses jsPDF + jspdf-autotable (client-side).
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { EmpresaId } from "./config-transavic";
import { DATOS_EMISOR_MAP, EMPRESA_DEFAULT } from "./config-transavic";

// --- Types ---

interface PDFComprobanteData {
  tipo: string; // "01" = Factura, "03" = Boleta
  serie: string;
  numero: number;
  serieNumero: string;
  fechaEmision: string;
  cliente: {
    tipoDocumento?: string;
    numDocumento: string;
    razonSocial: string;
    direccion?: string;
  };
  items: {
    codigo?: string;
    /** Código de producto SUNAT (UNSPSC Catálogo N° 25) */
    codigoProductoSunat?: string;
    descripcion: string;
    unidadMedida: string;
    cantidad: number;
    precioUnitario: number;
    valorVenta?: number;
    montoIGV?: number;
    precioTotal?: number;
  }[];
  totales: {
    totalGravadas: number;
    totalExoneradas: number;
    totalInafectas: number;
    totalIGV: number;
    totalISC: number;
    totalOtrosCargos: number;
    importeTotal: number;
    montoRedondeo?: number;
  };
  moneda: string;
  hashCpe?: string | null;
  observaciones?: string[] | null;
  formaPago?: string;
  /** Fecha de vencimiento de la cuota (solo crédito), formato "YYYY-MM-DD". */
  fechaVencimiento?: string;
  /** Empresa emisora para datos del PDF (fallback si no se pasa `emisor`) */
  empresa?: EmpresaId;
  /** Datos del emisor (override completo — preferido sobre `empresa`).
   * Si está presente, los datos vienen del backend (que lee env vars reales),
   * en lugar de los placeholders de DATOS_EMISOR_MAP. */
  emisor?: {
    ruc: string;
    razonSocial: string;
    nombreComercial: string;
    direccion: string;
    ubigeo?: string;
    departamento?: string;
    provincia?: string;
    distrito?: string;
  };
}

// --- Emisor Data (dynamic) ---
interface EmisorPDF {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubicacion: string;
}

function getEmisor(
  empresa?: EmpresaId,
  override?: PDFComprobanteData["emisor"]
): EmisorPDF {
  // Si el caller pasó datos completos, usar esos (preferido — vienen de env vars)
  if (override) {
    return {
      ruc: override.ruc,
      razonSocial: override.razonSocial,
      nombreComercial: override.nombreComercial,
      direccion: override.direccion,
      ubicacion: `${override.distrito ?? ""} - ${override.provincia ?? ""} - ${override.departamento ?? ""}`,
    };
  }
  // Fallback: leer del map (placeholders)
  const id = empresa || EMPRESA_DEFAULT;
  const datos = DATOS_EMISOR_MAP[id];
  return {
    ruc: datos.ruc,
    razonSocial: datos.razonSocial,
    nombreComercial: datos.nombreComercial,
    direccion: datos.direccion,
    ubicacion: `${datos.distrito} - ${datos.provincia} - ${datos.departamento}`,
  };
}

// --- Colors ---
const COLOR_BLACK: [number, number, number] = [0, 0, 0];
const COLOR_AMBER_BG: [number, number, number] = [255, 243, 205]; // Light amber/yellow for value boxes

// --- Helpers ---

function formatMoney(amount: number): string {
  return `S/ ${amount.toFixed(2)}`;
}

/** Smart decimal formatting: minimum 2 decimals, more only when needed (up to maxDec) */
function formatDecimal(n: number, maxDec: number = 10): string {
  const fixed = n.toFixed(maxDec);
  const parts = fixed.split('.');
  let decimals = parts[1] || '';
  while (decimals.length > 2 && decimals.endsWith('0')) {
    decimals = decimals.slice(0, -1);
  }
  return `${parts[0]}.${decimals}`;
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

function getUnidadLabel(code: string): string {
  // SUNAT Catálogo N° 03 — Descriptions shown in portal PDF
  const map: Record<string, string> = {
    NIU: "UNIDAD", ZZ: "UNIDAD", KGM: "KILOGRAMO", LTR: "LITRO",
    BX: "CAJA", PK: "PAQUETE", TNE: "TONELADAS", BJ: "BALDE",
    BLL: "BARRILES", "4A": "BOBINAS", BG: "BOLSA", BO: "BOTELLAS",
    CT: "CARTONES", CMK: "CENTIMETRO CUADRADO", CMQ: "CENTIMETRO CUBICO",
    CMT: "CENTIMETRO LINEAL", CEN: "CIENTO DE UNIDADES", CY: "CILINDRO",
    DZN: "DOCENA", BE: "FARDO", GLL: "GALON", GRM: "GRAMO",
    GRO: "GRUESA", HLT: "HECTOLITRO", HUR: "HORA", INH: "PULGADAS",
    SET: "JUEGO", KT: "KIT", KTM: "KILOMETRO", KWH: "KILOVATIO HORA",
    CA: "LATAS", LBR: "LIBRAS", MGM: "MILIGRAMOS", MIL: "MILLARES",
    MLT: "MILILITRO", MMT: "MILIMETRO", MMK: "MILIMETRO CUADRADO",
    MMQ: "MILIMETRO CUBICO", UM: "MILLON DE UNIDADES", MTR: "METRO",
    MTK: "METRO CUADRADO", MTQ: "METRO CUBICO", MWH: "MEGAWATT HORA",
    ONZ: "ONZAS", PF: "PALETAS", PR: "PAR", C62: "PIEZAS",
    PG: "PLACAS", ST: "PLIEGO", FOT: "PIES", FTK: "PIES CUADRADOS",
    FTQ: "PIES CUBICOS", RM: "RESMA", ROL: "ROLLO", SA: "SACO",
    STN: "TONELADA CORTA", TU: "TUBOS", YRD: "YARDA", YDK: "YARDA CUADRADA",
    LEF: "HOJA", SEC: "SEGUNDO", BT: "TORNILLO", AV: "CAPSULA",
    JG: "JARRA", JR: "FRASCO", CH: "ENVASE", QD: "CUARTO DE DOCENA",
    U2: "TABLETA O BLISTER",
  };
  return map[code] || code;
}

function getTipoDocLabel(tipo: string): string {
  const map: Record<string, string> = {
    "1": "DNI", "4": "CARNET EXT.", "6": "RUC", "7": "PASAPORTE", "0": "-",
  };
  return map[tipo] || tipo;
}

/** ¿El receptor es un consumidor SIN documento? (tipo "0" o número vacío/"0").
 *  Caso boleta < S/700 a nombre del cliente o "CLIENTES VARIOS". Se usa para
 *  OMITIR la línea del documento en el PDF: mostrar "- : 0" se ve poco prolijo. */
function clienteSinDocumento(cli: { tipoDocumento?: string; numDocumento: string }): boolean {
  const tipo = (cli.tipoDocumento || "").trim();
  const num = (cli.numDocumento || "").trim();
  return tipo === "" || tipo === "0" || num === "" || num === "0";
}

function numeroALetras(monto: number): string {
  const unidades = [
    "", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
    "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
    "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  ];
  const decenas = [
    "", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA",
    "SESENTA", "SETENTA", "OCHENTA", "NOVENTA",
  ];
  const centenas = [
    "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
    "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
  ];

  function convertGroup(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    if (n < 20) return unidades[n];
    if (n < 30) return n === 20 ? "VEINTE" : "VEINTI" + unidades[n - 20];
    if (n < 100) {
      const dec = Math.floor(n / 10);
      const uni = n % 10;
      return decenas[dec] + (uni > 0 ? " Y " + unidades[uni] : "");
    }
    const cen = Math.floor(n / 100);
    const rest = n % 100;
    return centenas[cen] + (rest > 0 ? " " + convertGroup(rest) : "");
  }

  const parteEntera = Math.floor(monto);
  const centavos = Math.round((monto - parteEntera) * 100);
  const centavosStr = centavos.toString().padStart(2, "0");

  let resultado = "";
  if (parteEntera === 0) {
    resultado = "CERO";
  } else if (parteEntera < 1000) {
    resultado = convertGroup(parteEntera);
  } else if (parteEntera < 1000000) {
    const miles = Math.floor(parteEntera / 1000);
    const resto = parteEntera % 1000;
    resultado = miles === 1 ? "MIL" : convertGroup(miles) + " MIL";
    if (resto > 0) resultado += " " + convertGroup(resto);
  } else {
    const millones = Math.floor(parteEntera / 1000000);
    const resto = parteEntera % 1000000;
    resultado = millones === 1 ? "UN MILLON" : convertGroup(millones) + " MILLONES";
    if (resto > 0) {
      const miles = Math.floor(resto / 1000);
      const restoMil = resto % 1000;
      if (miles > 0) resultado += miles === 1 ? " MIL" : " " + convertGroup(miles) + " MIL";
      if (restoMil > 0) resultado += " " + convertGroup(restoMil);
    }
  }
  return `${resultado} Y ${centavosStr}/100 SOLES`;
}

/**
 * Genera nombre de archivo según nomenclatura oficial SUNAT:
 * {RUC}-{TipoDoc}-{Serie}-{Numero}
 * Ej: 20615365352-03-B001-00000001
 */
function generarNombreArchivo(data: PDFComprobanteData): string {
  const emisor = getEmisor(data.empresa, data.emisor);
  const numPadded = data.numero.toString().padStart(8, "0");
  return `${emisor.ruc}-${data.tipo}-${data.serie}-${numPadded}`;
}

// --- Shared drawing helpers ---

/** Draw a bordered box with optional amber background fill */
function drawValueBox(doc: jsPDF, x: number, y: number, w: number, h: number, fill: boolean = true) {
  if (fill) {
    doc.setFillColor(...COLOR_AMBER_BG);
    doc.setDrawColor(...COLOR_BLACK);
    doc.setLineWidth(0.25);
    doc.rect(x, y, w, h, "FD"); // Fill + Draw
  } else {
    doc.setDrawColor(...COLOR_BLACK);
    doc.setLineWidth(0.25);
    doc.rect(x, y, w, h);
  }
}

/**
 * Dibuja el bloque "INFORMACIÓN DEL CRÉDITO" (solo cuando la forma de pago es
 * Crédito): el monto neto pendiente de pago + una tabla con la cuota
 * (N° · Fecha de Vencimiento · Monto). Replica lo que muestra la SUNAT en la
 * representación de una factura al crédito. Devuelve el nuevo `y`.
 * Si la forma de pago NO es crédito, no dibuja nada y devuelve el `y` recibido.
 */
function drawInformacionCredito(
  doc: jsPDF,
  data: PDFComprobanteData,
  opts: { margin: number; contentWidth: number; lx: number },
  y: number
): number {
  const esCredito = (data.formaPago || "").toLowerCase() === "credito";
  if (!esCredito) return y;

  const { margin, contentWidth, lx } = opts;
  const total = data.totales.importeTotal;
  const venc = data.fechaVencimiento ? formatDate(data.fechaVencimiento) : "—";

  // Título
  y += 3;
  doc.setTextColor(...COLOR_BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("INFORMACIÓN DEL CRÉDITO", lx, y);

  // Monto neto pendiente de pago
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.text("Monto neto pendiente de pago:", lx, y);
  doc.setFont("helvetica", "bold");
  doc.text(formatMoney(total), lx + 52, y);

  // Tabla de cuotas: encabezado + 1 fila (N° · Fecha de Vencimiento · Monto)
  y += 3;
  const tblTop = y;
  const rowH = 5;
  const col1 = margin;        // N° Cuota
  const col2 = margin + 28;   // Fecha de Vencimiento
  const col3 = margin + 92;   // Monto
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("N° Cuota", col1 + 2, tblTop + 3.4);
  doc.text("Fecha de Vencimiento", col2 + 2, tblTop + 3.4);
  doc.text("Monto", col3 + 2, tblTop + 3.4);
  doc.setFont("helvetica", "normal");
  doc.text("1", col1 + 2, tblTop + rowH + 3.4);
  doc.text(venc, col2 + 2, tblTop + rowH + 3.4);
  doc.text(formatMoney(total), col3 + 2, tblTop + rowH + 3.4);

  // Bordes de la tabla
  const tblBottom = tblTop + rowH * 2;
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.2);
  doc.rect(margin, tblTop, contentWidth, rowH * 2);
  doc.line(margin, tblTop + rowH, margin + contentWidth, tblTop + rowH);
  doc.line(col2, tblTop, col2, tblBottom);
  doc.line(col3, tblTop, col3, tblBottom);

  doc.setTextColor(...COLOR_BLACK);
  doc.setFontSize(8);
  return tblBottom + 3;
}

// ============================================================
// FACTURA PDF — Matches SUNAT Portal XSL format exactly
// ============================================================

function generarPDFFactura(doc: jsPDF, data: PDFComprobanteData): void {
  const EMISOR = getEmisor(data.empresa, data.emisor);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 5;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  // Outer border will be drawn at the end, after all content is rendered
  const outerBorderTop = 10;

  // === HEADER ===
  // Right: Document type box (draw first to get boxY + boxH for left alignment)
  const boxW = 62;
  const boxH = 13;
  const boxX = pageWidth - margin - boxW;
  const boxY = outerBorderTop + 2; // small gap from outer border
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.4);
  doc.rect(boxX, boxY, boxW, boxH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  const boxCx = boxX + boxW / 2;
  // Dynamic document type title
  const tipoDocTitulo = data.tipo === "07" ? "NOTA DE CRÉDITO ELECTRÓNICA"
    : data.tipo === "08" ? "NOTA DE DÉBITO ELECTRÓNICA"
    : "FACTURA ELECTRONICA";
  doc.text(tipoDocTitulo, boxCx, boxY + 3.5, { align: "center" });
  doc.setFontSize(8);
  doc.text(`RUC: ${EMISOR.ruc}`, boxCx, boxY + 7, { align: "center" });
  doc.text(`${data.serieNumero}`, boxCx, boxY + 10.5, { align: "center" });

  // Left: Company info (bottom-aligned with the box — same pattern as boleta)
  const headerBottom = boxY + boxH;
  // Encabezado del emisor (igual a la representación oficial de SUNAT):
  //   [nombre comercial — solo si difiere de la razón social]
  //   razón social (negrita)
  //   dirección
  //   distrito - provincia - departamento
  // Ej.: Transavic muestra "TRANSAVIC" + "NEGOCIOS Y SERVICIOS TRANSAVIC S.A.C.";
  // una persona natural (RUC 10) sin nombre comercial muestra solo su nombre legal.
  const muestraComercial =
    !!EMISOR.nombreComercial &&
    EMISOR.nombreComercial.trim().toLowerCase() !== EMISOR.razonSocial.trim().toLowerCase();
  const headerLineas = muestraComercial ? 4 : 3;
  y = headerBottom - (headerLineas - 1) * 3.5;
  const headerLx = margin + 2;
  if (muestraComercial) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(EMISOR.nombreComercial, headerLx, y);
    y += 3.5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(EMISOR.razonSocial, headerLx, y);
  y += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(EMISOR.direccion, headerLx, y);
  y += 3.5;
  doc.text(EMISOR.ubicacion, headerLx, y);

  // === CLIENT DATA SECTION ===
  y = headerBottom + 3;
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.line(margin, y, pageWidth - margin, y);

  y += 4;
  const lx = margin + 2;
  const vx = margin + 48;
  doc.setFontSize(8);

  // Row 1: Fecha de Emisión (left) + Forma de pago (right)
  doc.setFont("helvetica", "normal");
  doc.text("Fecha de Emisión", lx, y);
  doc.text(":", vx - 2, y);
  doc.setFont("helvetica", "bold");
  doc.text(`${formatDate(data.fechaEmision)}`, vx + 1, y);

  const formaPagoLabel =
    (data.formaPago || "").toLowerCase() === "credito" ? "Crédito" : "Contado";
  doc.setFont("helvetica", "normal");
  doc.text(`Forma de pago: ${formaPagoLabel}`, boxCx, y, { align: "center" });

  // Row 2: Señor(es) - Client name
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text("Señor(es)", lx, y);
  doc.text(":", vx - 2, y);
  doc.setFont("helvetica", "bold");
  const maxClientNameW = boxX - vx - 5;
  const clientNameLines = doc.splitTextToSize(data.cliente.razonSocial, maxClientNameW);
  doc.text(`${clientNameLines[0]}`, vx + 1, y);
  for (let i = 1; i < clientNameLines.length; i++) {
    y += 4;
    doc.text(`  ${clientNameLines[i]}`, vx, y);
  }

  // Row 3: documento del cliente. Se OMITE para consumidor sin documento (tipo "0"
  // / número "0", p.ej. boleta a nombre sin DNI o "CLIENTES VARIOS"): la línea
  // "- : 0" se ve poco prolija, mejor dejar solo el nombre.
  if (!clienteSinDocumento(data.cliente)) {
    y += 5;
    const tipoDocCliente = getTipoDocLabel(data.cliente.tipoDocumento || "");
    doc.setFont("helvetica", "normal");
    doc.text(tipoDocCliente, lx, y);
    doc.text(":", vx - 2, y);
    doc.setFont("helvetica", "bold");
    doc.text(`${data.cliente.numDocumento}`, vx + 1, y);
  }

  // Row 4: Dirección del CLIENTE (adquirente). Se OMITE si no hay (consumidor sin
  // dirección). Antes esta fila mostraba "Establecimiento del Emisor" con la
  // dirección de Transavic → confundía: aparecía justo donde el adquirente espera
  // ver SU dirección. La dirección del cliente viene del XML firmado (endpoint [id]),
  // así que es fiel a lo emitido y aplica también a las facturas ya emitidas.
  const dirCliente = (data.cliente.direccion || "").trim();
  if (dirCliente) {
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Dirección del Cliente", lx, y);
    doc.text(":", vx - 2, y);
    doc.setFont("helvetica", "bold");
    const maxAddrW = boxX - vx - 5;
    const addrLines = doc.splitTextToSize(dirCliente, maxAddrW);
    doc.text(`${addrLines[0]}`, vx + 1, y);
    for (let i = 1; i < addrLines.length; i++) {
      y += 3.5;
      doc.text(`${addrLines[i]}`, vx + 1, y);
    }
  }

  // Row 5: Tipo de Moneda
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text("Tipo de Moneda", lx, y);
  doc.text(":", vx - 2, y);
  doc.setFont("helvetica", "bold");
  const monStr = data.moneda === "PEN" ? "SOLES" : data.moneda === "USD" ? "DOLARES" : data.moneda;
  doc.text(`${monStr}`, vx + 1, y);

  // Row 6: Observación
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text("Observación", lx, y);
  doc.text(":", vx - 2, y);

  // === INFORMACIÓN DEL CRÉDITO (solo facturas al crédito) ===
  y = drawInformacionCredito(doc, data, { margin, contentWidth, lx }, y);

  // Bottom border line (separator before table) — note: rect drawn after autoTable
  y += 3;
  // === ITEMS TABLE (6 columns for factura) ===
  const tableStartY = y; // top of the table box
  const headers = ["Cantidad", "Unidad Medida", "Código", "Descripción", "Valor Unitario", "ICBPER"];
  const body = data.items.map((item) => [
    item.cantidad.toFixed(2),
    getUnidadLabel(item.unidadMedida),
    item.codigo || "",
    item.descripcion,
    formatDecimal(item.precioUnitario),
    "0.00",
  ]);

  autoTable(doc, {
    startY: y,
    head: [headers],
    body: body,
    theme: "plain",
    styles: {
      fontSize: 7, cellPadding: { top: 0.3, bottom: 0.3, left: 1, right: 1 },
      textColor: COLOR_BLACK, font: "helvetica",
    },
    headStyles: {
      fillColor: [255, 255, 255], textColor: COLOR_BLACK, fontStyle: "bold",
      fontSize: 7, halign: "center",
      cellPadding: { top: 0.5, bottom: 0.5, left: 1, right: 1 },
    },
    columnStyles: {
      0: { halign: "right", cellWidth: 20 },
      1: { halign: "center", cellWidth: 26 },
      2: { halign: "center", cellWidth: 22 },
      3: { cellWidth: 'auto' },
      4: { halign: "right", cellWidth: 28 },
      5: { halign: "right", cellWidth: 20 },
    },
    margin: { left: margin, right: margin },
    // Only draw a bottom line under the header row (no grid lines)
    didDrawCell: (data: any) => {
      if (data.section === "head") {
        doc.setDrawColor(...COLOR_BLACK);
        doc.setLineWidth(0.25);
        doc.line(
          data.cell.x, data.cell.y + data.cell.height,
          data.cell.x + data.cell.width, data.cell.y + data.cell.height
        );
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY;

  // Draw complete box around the table (top + left + right + bottom)
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(margin, tableStartY, pageWidth - margin * 2, y - tableStartY);

  y += 4.5;

  // === BOTTOM SECTION: Two-column layout ===
  // Left column: "Valor de Venta de Op. Gratuitas" + "SON:"
  // Right column: Tax breakdown with amber boxes

  // Tax layout: wide boxes flush with right margin (matching real SUNAT)
  const taxBoxRight = pageWidth - margin - 0.5;  // 0.5mm padding from border
  const taxBoxW2 = 42;                           // wider boxes like real SUNAT
  const taxBoxX2 = taxBoxRight - taxBoxW2;        // box left edge
  const taxLabelRightX = taxBoxX2 - 2;            // labels end just before box

  // --- RIGHT COLUMN: Tax breakdown with amber boxes ---
  // Section starts roughly at page center
  const taxSectionX = pageWidth / 2 + 2;
  const startTaxY = y;
  let ty = y;

  const taxItems = [
    { label: "Sub Total Ventas :", value: formatMoney(data.totales.totalGravadas) },
    { label: "Anticipos :", value: formatMoney(0) },
    { label: "Descuentos :", value: formatMoney(0) },
    { label: "Valor Venta :", value: formatMoney(data.totales.totalGravadas) },
    { label: "ISC :", value: formatMoney(data.totales.totalISC) },
    { label: "IGV :", value: formatMoney(data.totales.totalIGV) },
    { label: "ICBPER :", value: formatMoney(0) },
    { label: "Otros Cargos :", value: formatMoney(data.totales.totalOtrosCargos) },
    { label: "Otros Tributos :", value: formatMoney(0) },
    { label: "Monto de redondeo :", value: formatMoney(data.totales.montoRedondeo ?? 0) },
    { label: "Importe Total :", value: formatMoney(data.totales.importeTotal) },
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  const rowH = 4.2; // Row height with small gap between boxes
  const taxRowBoxH = 3.2; // Shorter box = less vertical padding

  taxItems.forEach((item, idx) => {
    doc.setTextColor(...COLOR_BLACK);
    doc.text(item.label, taxLabelRightX, ty, { align: "right" });

    drawValueBox(doc, taxBoxX2, ty - 2.5, taxBoxW2, taxRowBoxH, false);

    doc.setFont("helvetica", idx === taxItems.length - 1 ? "bold" : "normal");
    doc.text(item.value, taxBoxX2 + taxBoxW2 - 1, ty, { align: "right" });
    doc.setFont("helvetica", "normal");

    ty += rowH;
  });

  // Draw containing border around entire tax breakdown section
  const taxSectionEndY = ty - rowH + taxRowBoxH - 2;
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(taxSectionX, startTaxY - 3.5, (pageWidth - margin) - taxSectionX, taxSectionEndY - startTaxY + 3.5);

  // --- LEFT COLUMN: Gratuitas + SON ---
  let ly = startTaxY + 8;

  // "Valor de Venta de Operaciones Gratuitas" with bordered box
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("Valor de Venta de Operaciones Gratuitas :", lx + 4, ly);
  // Box right after the text, almost touching
  const gratTextW = doc.getTextWidth("Valor de Venta de Operaciones Gratuitas :");
  const gratBoxX = lx + 4 + gratTextW + 2;
  const gratBoxW = taxSectionX - gratBoxX - 3;
  drawValueBox(doc, gratBoxX, ly - 3, gratBoxW, 4, false);
  doc.text(formatMoney(0), gratBoxX + 1, ly);

  // "SON:" total in words (left-aligned, bold)
  ly = startTaxY + 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`SON: ${numeroALetras(data.totales.importeTotal)}`, lx, ly);

  // === FOOTER ===
  y = Math.max(ty, ly) - 1;

  // Footer disclaimer inside a bordered box (matches SUNAT image)
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_BLACK);
  const disclaimerDocName = data.tipo === "07" ? "nota de crédito electrónica"
    : data.tipo === "08" ? "nota de débito electrónica"
    : "factura electrónica";
  const disclaimer = `Esta es una representación impresa de la ${disclaimerDocName}, generada en el Sistema de SUNAT. Puede verificarla utilizando su clave SOL.`;
  const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth - 16);
  const disclaimerH = disclaimerLines.length * 4 + 1; // height for the disclaimer box

  // Draw the bordered box for the disclaimer
  doc.rect(margin, y, contentWidth, disclaimerH);
  // Centered text inside the box
  doc.text(disclaimerLines, pageWidth / 2, y + 3.5, { align: "center" });

  y += disclaimerH;
  y += 1;

  // === OUTER BORDER (drawn last, adapts to content — no extra blank space) ===
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(margin - 1, outerBorderTop, contentWidth + 2, y - outerBorderTop);
}

// ============================================================
// BOLETA PDF — Matches SUNAT Portal XSL format exactly
// ============================================================

function generarPDFBoleta(doc: jsPDF, data: PDFComprobanteData): void {
  const EMISOR = getEmisor(data.empresa, data.emisor);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 5;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  // Outer border will be drawn at the end, after all content is rendered
  const outerBorderTop = 10;

  // Right: Document type box (draw first to get boxY + boxH for left alignment)
  const boxW = 62;
  const boxH = 13;
  const boxX = pageWidth - margin - boxW;
  const boxY = outerBorderTop + 2; // small gap from outer border
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.4);
  doc.rect(boxX, boxY, boxW, boxH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  const boxCx = boxX + boxW / 2;
  doc.text("BOLETA DE VENTA ELECTRONICA", boxCx, boxY + 3.5, { align: "center" });
  doc.setFontSize(8);
  doc.text(`RUC: ${EMISOR.ruc}`, boxCx, boxY + 7, { align: "center" });
  doc.text(`E${data.serie}-${data.numero}`, boxCx, boxY + 10.5, { align: "center" });

  // Left: Company info (bottom-aligned with the box) — mismo formato que la
  // factura: [nombre comercial si difiere] · razón social (negrita) · dirección ·
  // distrito - provincia - departamento.
  const headerBottom = boxY + boxH; // bottom of box = bottom reference
  const muestraComercial =
    !!EMISOR.nombreComercial &&
    EMISOR.nombreComercial.trim().toLowerCase() !== EMISOR.razonSocial.trim().toLowerCase();
  const headerLineas = muestraComercial ? 4 : 3;
  y = headerBottom - (headerLineas - 1) * 3.5;
  const headerLx = margin + 2; // small left padding from outer border
  if (muestraComercial) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(EMISOR.nombreComercial, headerLx, y);
    y += 3.5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(EMISOR.razonSocial, headerLx, y);
  y += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(EMISOR.direccion, headerLx, y);
  y += 3.5;
  doc.text(EMISOR.ubicacion, headerLx, y);

  // === CLIENT DATA SECTION ===
  y = headerBottom + 3;
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.line(margin, y, pageWidth - margin, y);

  y += 4;
  const lx = margin + 2;
  const vx = margin + 42;
  doc.setFontSize(8);

  // Fecha de Vencimiento (se llena solo si la boleta es al crédito)
  doc.setFont("helvetica", "normal");
  doc.text("Fecha de Vencimiento", lx, y);
  doc.text(":", vx - 2, y);
  if ((data.formaPago || "").toLowerCase() === "credito" && data.fechaVencimiento) {
    doc.setFont("helvetica", "bold");
    doc.text(formatDate(data.fechaVencimiento), vx + 1, y);
    doc.setFont("helvetica", "normal");
  }

  // Fecha de Emisión
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("Fecha de Emisión", lx, y);
  doc.text(":", vx - 2, y);
  doc.setFont("helvetica", "bold");
  doc.text(`${formatDate(data.fechaEmision)}`, vx + 1, y);

  // Señor(es)
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("Señor(es)", lx, y);
  doc.text(":", vx - 2, y);
  doc.setFont("helvetica", "bold");
  doc.text(`${data.cliente.razonSocial}`, vx + 1, y);

  // DNI / RUC — se OMITE para consumidor sin documento (tipo "0" / número "0",
  // p.ej. boleta a nombre sin DNI o "CLIENTES VARIOS"): "- : 0" se ve poco prolijo,
  // mejor dejar solo el nombre.
  if (!clienteSinDocumento(data.cliente)) {
    y += 4;
    const tipoDocCliente = getTipoDocLabel(data.cliente.tipoDocumento || "");
    doc.setFont("helvetica", "normal");
    doc.text(tipoDocCliente, lx, y);
    doc.text(":", vx - 2, y);
    doc.setFont("helvetica", "bold");
    doc.text(`${data.cliente.numDocumento}`, vx + 1, y);
  }

  // Dirección del cliente — solo si la hay (boletas a consumidor final suelen no
  // tenerla). Viene del XML firmado (endpoint [id]).
  const dirClienteBol = (data.cliente.direccion || "").trim();
  if (dirClienteBol) {
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.text("Dirección", lx, y);
    doc.text(":", vx - 2, y);
    doc.setFont("helvetica", "bold");
    const maxAddrW = pageWidth - margin - vx - 2;
    const addrLines = doc.splitTextToSize(dirClienteBol, maxAddrW);
    doc.text(`${addrLines[0]}`, vx + 1, y);
    for (let i = 1; i < addrLines.length; i++) {
      y += 3.5;
      doc.text(`${addrLines[i]}`, vx + 1, y);
    }
  }

  // Tipo de Moneda
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("Tipo de Moneda", lx, y);
  doc.text(":", vx - 2, y);
  const monStr = data.moneda === "PEN" ? "SOLES" : data.moneda;
  doc.setFont("helvetica", "bold");
  doc.text(`${monStr}`, vx + 1, y);

  // Observación
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("Observación", lx, y);
  doc.text(":", vx - 2, y);

  // === INFORMACIÓN DEL CRÉDITO (solo boletas al crédito) ===
  y = drawInformacionCredito(doc, data, { margin, contentWidth, lx }, y);

  // Bottom line of client section
  y += 3;
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.line(margin, y, pageWidth - margin, y);

  // === ITEMS + SUBTOTALS + DIVIDER BLOCK ===
  const blockStartY = y;

  // === ITEMS TABLE (8 columns for boleta) ===
  y += 1;
  const headers = [
    "Cantidad", "Unidad\nMedida", "Código", "Descripción",
    "Valor Unitario(*)", "Descuento(*)", "Importe de Venta(**)", "ICBPER",
  ];
  const body = data.items.map((item) => {
    const valorVenta = item.valorVenta ?? item.cantidad * item.precioUnitario;
    return [
      item.cantidad.toFixed(2),
      getUnidadLabel(item.unidadMedida),
      item.codigo || "",
      item.descripcion,
      formatDecimal(item.precioUnitario),
      "0.00",
      formatDecimal(valorVenta),
      "0.00",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [headers],
    body: body,
    theme: "plain",
    styles: {
      fontSize: 7, cellPadding: 1,
      textColor: COLOR_BLACK, font: "helvetica",
    },
    headStyles: {
      fillColor: [255, 255, 255], textColor: COLOR_BLACK, fontStyle: "bold",
      fontSize: 6.5, halign: "center",
    },
    columnStyles: {
      0: { halign: "right", cellWidth: 16 },
      1: { halign: "center", cellWidth: 16 },
      2: { halign: "center", cellWidth: 16 },
      3: { cellWidth: 'auto' },
      4: { halign: "right", cellWidth: 26 },
      5: { halign: "right", cellWidth: 22 },
      6: { halign: "right", cellWidth: 30 },
      7: { halign: "right", cellWidth: 18 },
    },
    margin: { left: margin, right: margin },
    // Only draw a bottom line under the header row (no other grid lines)
    didDrawCell: (data: any) => {
      if (data.section === "head") {
        doc.setDrawColor(...COLOR_BLACK);
        doc.setLineWidth(0.25);
        doc.line(
          data.cell.x, data.cell.y + data.cell.height,
          data.cell.x + data.cell.width, data.cell.y + data.cell.height
        );
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 2;

  // ============================================================
  // SECTION 1: Simple subtotals (right-aligned, NO amber boxes)
  // Otros Cargos, Otros Tributos, ICBPER (bordered), Importe Total
  // ============================================================
  const rightEdge = pageWidth - margin - 2; // 2px padding from block border
  const subValW = 36;
  const subValX = rightEdge;
  const subLabelX = rightEdge - subValW - 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  // Otros Cargos
  doc.text("Otros Cargos :", subLabelX, y, { align: "right" });
  doc.text(formatMoney(data.totales.totalOtrosCargos), subValX - 1, y, { align: "right" });
  y += 5;

  // Otros Tributos
  doc.text("Otros Tributos :", subLabelX, y, { align: "right" });
  doc.text(formatMoney(0), subValX - 1, y, { align: "right" });
  y += 5;

  // ICBPER — box spans from after label ":" to the right edge
  doc.setFont("helvetica", "normal");
  doc.text("ICBPER :", subLabelX, y, { align: "right" });
  const icbperBoxX = subLabelX + 2;
  const icbperBoxW = rightEdge - icbperBoxX;
  drawValueBox(doc, icbperBoxX, y - 3, icbperBoxW, 4.5, false);
  doc.text(formatMoney(0), rightEdge - 1, y, { align: "right" });
  y += 5;

  // Importe Total (normal weight, same as others)
  doc.text("Importe Total :", subLabelX, y, { align: "right" });
  doc.text(`S/${data.totales.importeTotal.toFixed(2)}`, subValX - 1, y, { align: "right" });
  y += 4;

  // ============================================================
  // SECTION 2: BLUE DIVIDER LINE
  // ============================================================
  doc.setDrawColor(0, 112, 192);
  doc.setLineWidth(0.4);
  doc.line(margin + 1, y, pageWidth - margin - 1, y);

  y += 4;

  // ============================================================
  // SECTION 3: "SON:" — RIGHT-aligned, bold
  // ============================================================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_BLACK);
  doc.text(`SON: ${numeroALetras(data.totales.importeTotal)}`, rightEdge, y, { align: "right" });
  y += 5;

  // ============================================================
  // SECTION 4: Two-column layout
  // LEFT: Footnotes ("(*) Sin impuestos", "(**) Incluye impuestos...")  
  // RIGHT: Tax breakdown boxes (Op. Gravada, Op. Exonerada, etc.)
  // ============================================================
  const taxStartY = y;

  // --- LEFT: Footnotes ---
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("(*) Sin impuestos.", lx, taxStartY + 3);
  doc.text("(**) Incluye impuestos, de ser Op. Gravada.", lx, taxStartY + 7);

  // --- RIGHT: Tax breakdown with bordered boxes ---
  const taxBoxW = 54;
  const taxBoxX = pageWidth - margin - taxBoxW - 1;
  const taxLabelRightX = taxBoxX - 1;
  let ty = taxStartY;

  const taxItems: { label: string; value: string; bold?: boolean }[] = [
    { label: "Op. Gravada :", value: formatMoney(data.totales.totalGravadas) },
    { label: "Op. Exonerada :", value: formatMoney(data.totales.totalExoneradas) },
    { label: "Op. Inafecta :", value: formatMoney(data.totales.totalInafectas) },
    { label: "ISC :", value: formatMoney(data.totales.totalISC) },
    { label: "IGV :", value: formatMoney(data.totales.totalIGV) },
    { label: "ICBPER :", value: formatMoney(0), bold: true },
    { label: "Otros Cargos :", value: formatMoney(data.totales.totalOtrosCargos) },
    { label: "Otros Tributos :", value: formatMoney(0) },
    { label: "Monto de Redondeo :", value: formatMoney(data.totales.montoRedondeo ?? 0) },
  ];

  doc.setFontSize(7.5);

  taxItems.forEach((item) => {
    doc.setTextColor(...COLOR_BLACK);
    doc.setFont("helvetica", item.bold ? "bold" : "normal");
    doc.text(item.label, taxLabelRightX, ty, { align: "right" });
    doc.setFont("helvetica", "normal");
    drawValueBox(doc, taxBoxX, ty - 2.8, taxBoxW, 3.5, false);
    doc.text(item.value, taxBoxX + taxBoxW - 1, ty, { align: "right" });
    ty += 4;
  });

  // Importe Total (bold, larger, thicker border)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Importe Total :", taxLabelRightX, ty, { align: "right" });
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(taxBoxX, ty - 2.8, taxBoxW, 4);
  doc.text(formatMoney(data.totales.importeTotal), taxBoxX + taxBoxW - 1, ty, { align: "right" });

  // Draw containing rectangle around entire items+subtotals+tax block
  const blockEndY = ty + 3.5;
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(margin, blockStartY, contentWidth, blockEndY - blockStartY);

  // ============================================================
  // FOOTER DISCLAIMER (full SUNAT text)
  // ============================================================
  y = blockEndY + 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR_BLACK);

  // Split into parts to make www.sunat.gob.pe underlined
  const disc1 = "Esta es una representación impresa de la Boleta de Venta Electrónica, generada en el Sistema de la SUNAT. El Emisor Electrónico puede";
  const disc2 = "verificarla utilizando su clave SOL, el Adquirente o Usuario puede consultar su validez en SUNAT Virtual: ";
  const discLink = "www.sunat.gob.pe";
  const disc3 = ", en Opciones sin";
  const disc4 = "Clave SOL/ Consulta de Validez del CPE.";

  // Line 1
  doc.text(disc1, pageWidth / 2, y, { align: "center" });
  y += 3.5;
  // Line 2: render in parts so link is blue
  const line2Pre = disc2 + " ";
  const preFullW = doc.getTextWidth(line2Pre + discLink + disc3);
  const line2StartX = (pageWidth - preFullW) / 2;
  // Part 1: black text before link
  doc.setTextColor(...COLOR_BLACK);
  doc.text(line2Pre, line2StartX, y);
  // Part 2: blue link
  const preW = doc.getTextWidth(line2Pre);
  const linkX = line2StartX + preW;
  const linkW = doc.getTextWidth(discLink);
  doc.setTextColor(0, 0, 255);
  doc.text(discLink, linkX, y);
  // Underline
  doc.setDrawColor(0, 0, 255);
  doc.setLineWidth(0.2);
  doc.line(linkX, y + 0.3, linkX + linkW, y + 0.3);
  doc.setDrawColor(...COLOR_BLACK);
  // Part 3: black text after link
  doc.setTextColor(...COLOR_BLACK);
  doc.text(disc3, linkX + linkW, y);
  y += 3.5;
  // Line 3
  doc.text(disc4, pageWidth / 2, y, { align: "center" });
  y += 3;

  // === OUTER BORDER (drawn last, adapts to content) ===
  doc.setDrawColor(...COLOR_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(margin - 1, outerBorderTop, contentWidth + 2, y - outerBorderTop);
}

// ============================================================
// Main PDF Generation Function
// ============================================================

export function generarPDFComprobante(data: PDFComprobanteData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  if (data.tipo === "03") {
    generarPDFBoleta(doc, data);
  } else {
    generarPDFFactura(doc, data);
  }

  return doc.output("blob");
}

/**
 * Descarga el PDF del comprobante con el nombre oficial de SUNAT.
 */
export function descargarPDFComprobante(data: PDFComprobanteData): void {
  const blob = generarPDFComprobante(data);
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${generarNombreArchivo(data)}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

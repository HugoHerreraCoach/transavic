// src/lib/sunat/pdf-guia.ts
// Generador del PDF (representación impresa) de la Guía de Remisión Electrónica
// con jsPDF — mismo mecanismo que pdf-comprobante.ts: se genera en el CLIENTE y
// se descarga como archivo (no abre pestaña). El diseño replica el formato
// oficial SUNAT (ver recursos/10710548841-09-EG07-432.pdf) y la página
// imprimible /pedidos/[id]/gre.
// Autocontenido a propósito (solo jspdf + autotable) para poder probarse aislado.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface PDFGuiaData {
  serieNumero: string;
  rucEmisor: string;
  /** 'transavic' | 'avicola' — define el nombre del emisor en la cabecera */
  empresa: string;
  /** "09/06/2026, 09:04 a. m." */
  fechaEmision: string;
  /** "09/06/2026" */
  fechaInicioTraslado: string;
  /** código catálogo 20 ('01' Venta, etc.) */
  motivoTraslado: string;
  /** '01' Público | '02' Privado */
  modalidadTraslado: string;
  indicadorM1L: boolean;
  puntoPartida: string;
  puntoLlegada: string;
  destinatario: {
    docTipo: string | null; // '1' DNI, '6' RUC, otro
    docNum: string | null;
    razonSocial: string | null;
  };
  comprobanteRelacionado?: {
    serieNumero: string;
    tipo: string; // '01' factura, '03' boleta
    ruc: string;
  } | null;
  observacionComprobante?: string | null;
  items: { descripcion: string; cantidad: number; unidad: string }[];
  pesoBrutoTotal: number;
  totalBultos: number;
  vehiculoPlaca?: string | null;
  choferDocNum?: string | null;
  choferLicencia?: string | null;
  /** PNG en dataURL para el QR (opcional; si no llega, se omite) */
  qrDataUrl?: string | null;
}

const EMISOR_GUIA: Record<string, { nombre: string; nombreComercial: string }> = {
  avicola: { nombre: "RESURRECCION GAMARRA TONIO", nombreComercial: "AVÍCOLA DE TONY" },
  transavic: { nombre: "NEGOCIOS Y SERVICIOS TRANSAVIC S.A.C.", nombreComercial: "TRANSAVIC" },
};

function motivoLabel(codigo: string): string {
  const map: Record<string, string> = {
    "01": "Venta", "02": "Compra", "03": "Venta con entrega a terceros",
    "04": "Traslado entre establecimientos de la misma empresa", "05": "Consignación",
    "06": "Devolución", "07": "Recojo de bienes transformados", "08": "Importación",
    "09": "Exportación", "13": "Otros", "14": "Venta sujeta a confirmación del comprador",
    "17": "Traslado de bienes para transformación", "18": "Recojo de bienes no transformados",
    "19": "Traslado emisor itinerante CP", "20": "Traslado a zona primaria",
  };
  return map[codigo] || `Código ${codigo}`;
}

function tipoDocLabel(codigo: string | null): string {
  if (codigo === "6") return "RUC N°";
  if (codigo === "1") return "DNI N°";
  return "Doc. N°";
}

function tipoComprobanteLabel(tipo: string): string {
  if (tipo === "01") return "Factura";
  if (tipo === "03") return "Boleta de Venta";
  if (tipo === "07") return "Nota de Crédito";
  return "Comprobante";
}

function unidadLabel(u: string): string {
  const up = (u || "").toUpperCase();
  if (up === "KGM" || up === "KG") return "KILOGRAMO";
  if (up === "NIU" || up === "UND" || up === "UNI" || up === "ZZ") return "UNIDAD";
  return up || "UNIDAD";
}

function formatCantidad(cant: number): string {
  if (cant % 1 === 0) return cant.toFixed(2);
  return cant.toString();
}

/** Genera el PDF de la Guía de Remisión y lo devuelve como Blob (para descargar). */
export function generarPDFGuia(data: PDFGuiaData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const emisor = EMISOR_GUIA[data.empresa] || EMISOR_GUIA.transavic;
  const ML = 14; // margen izquierdo
  const MR = 196; // borde derecho útil

  // ── CABECERA ──
  // QR (si llegó como dataURL)
  let xTexto = ML;
  if (data.qrDataUrl) {
    try {
      doc.addImage(data.qrDataUrl, "PNG", ML, 12, 22, 22);
      doc.setDrawColor(200);
      doc.rect(ML - 0.5, 11.5, 23, 23);
      xTexto = ML + 27;
    } catch {
      xTexto = ML; // si la imagen falla, seguimos sin QR
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(emisor.nombre, xTexto, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(emisor.nombreComercial, xTexto, 22);
  doc.setFontSize(7.5);
  doc.setTextColor(60);
  doc.setFont("helvetica", "bold");
  doc.text("Fecha y hora de emisión:", xTexto, 29);
  doc.setFont("helvetica", "normal");
  doc.text(data.fechaEmision, xTexto + 33, 29);

  // Recuadro derecho
  const boxX = 132, boxY = 12, boxW = 64, boxH = 27;
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.rect(boxX, boxY, boxW, boxH);
  const boxCx = boxX + boxW / 2;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`RUC N° ${data.rucEmisor}`, boxCx, boxY + 5.5, { align: "center" });
  doc.setFontSize(7.5);
  doc.text("GUÍA DE REMISIÓN ELECTRÓNICA", boxCx, boxY + 10.5, { align: "center" });
  doc.text("REMITENTE", boxCx, boxY + 14, { align: "center" });
  doc.line(boxX + 6, boxY + 17.5, boxX + boxW - 6, boxY + 17.5);
  doc.setFontSize(10);
  doc.text(`N° ${data.serieNumero}`, boxCx, boxY + 23.5, { align: "center" });

  // ── DATOS DEL TRASLADO (2 columnas) ──
  let y = 50;
  const colDerX = 105;
  const wIzq = 86, wDer = 91;

  const lineaConLabel = (x: number, yy: number, label: string, valor: string, maxW: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0);
    const labelW = doc.getTextWidth(label + " ");
    doc.text(label, x, yy);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(valor, maxW - labelW);
    doc.text(lines[0] || "", x + labelW, yy);
    let yyy = yy;
    for (let i = 1; i < lines.length; i++) {
      yyy += 3.8;
      doc.text(lines[i], x, yyy);
    }
    return yyy + 5;
  };

  let yIzq = lineaConLabel(ML, y, "Fecha de inicio de Traslado:", data.fechaInicioTraslado, wIzq);
  yIzq = lineaConLabel(ML, yIzq, "Motivo de Traslado:", motivoLabel(data.motivoTraslado), wIzq);
  let yDer = lineaConLabel(colDerX, y, "Punto de Partida:", data.puntoPartida, wDer);
  yDer = lineaConLabel(colDerX, yDer, "Punto de Llegada:", data.puntoLlegada, wDer);
  y = Math.max(yIzq, yDer) + 2;

  // ── DESTINATARIO ──
  const dest = data.destinatario;
  const tieneDoc = dest.docNum && dest.docNum !== "0";
  const destTexto = `${(dest.razonSocial || "—").toUpperCase()}${tieneDoc ? ` — ${tipoDocLabel(dest.docTipo)} ${dest.docNum}` : ""}`;
  y = lineaConLabel(ML, y, "Datos del Destinatario:", destTexto, MR - ML);

  // ── DOCUMENTOS RELACIONADOS ──
  if (data.comprobanteRelacionado) {
    const c = data.comprobanteRelacionado;
    y = lineaConLabel(ML, y, "Documentos Relacionados:", `${tipoComprobanteLabel(c.tipo)} N° ${c.serieNumero} — RUC N° ${c.ruc}`, MR - ML);
  }

  const observacion = (data.observacionComprobante || "").trim();
  if (observacion) {
    y = lineaConLabel(ML, y, "Observación:", observacion, MR - ML);
  }

  // ── BIENES POR TRANSPORTAR ──
  y += 1;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Bienes por transportar:", ML, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: 210 - MR },
    head: [["N°", "Bien\nnormalizado", "Código\nde Bien", "Código\nproducto\nSUNAT", "Partida\narancelaria", "Código\nGTIN", "Descripción Detallada", "Unidad de\nmedida", "Cantidad"]],
    body: data.items.map((it, idx) => [
      String(idx + 1), "NO", "-", "-", "-", "-",
      (it.descripcion || "").toUpperCase(),
      unidadLabel(it.unidad),
      formatCantidad(Number(it.cantidad)),
    ]),
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.4, lineColor: [120, 120, 120], lineWidth: 0.15, textColor: 20 },
    headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold", halign: "center", valign: "middle", lineColor: [60, 60, 60], lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 18, halign: "center" },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 17, halign: "center" },
      5: { cellWidth: 14, halign: "center" },
      6: { cellWidth: "auto", halign: "left" },
      7: { cellWidth: 19, halign: "center" },
      8: { cellWidth: 16, halign: "right", fontStyle: "bold" },
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── PESO Y BULTOS (texto plano, como el modelo SUNAT) ──
  y = lineaConLabel(ML, y, "Unidad de Medida del Peso Bruto:", "KGM", MR - ML) - 1;
  y = lineaConLabel(ML, y, "Peso Bruto total de la carga:", data.pesoBrutoTotal.toFixed(2), MR - ML) - 1;
  y = lineaConLabel(ML, y, "Total de bultos:", String(data.totalBultos), MR - ML) + 1;

  // ── DATOS DEL TRASLADO ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Datos del traslado:", ML, y);
  y += 5;
  yIzq = lineaConLabel(ML, y, "Modalidad de Traslado:", data.modalidadTraslado === "01" ? "Público" : "Privado", wIzq);
  yDer = lineaConLabel(colDerX, y, "Indicador de transbordo programado:", "NO", wDer);
  y = Math.max(yIzq, yDer) - 1;
  y = lineaConLabel(ML, y, "Indicador de traslado en vehículos de categoría M1 o L:", data.indicadorM1L ? "SI" : "NO", MR - ML);

  // Vehículo / conductor (solo si existen)
  if (data.vehiculoPlaca || data.choferDocNum) {
    const partes: string[] = [];
    if (data.vehiculoPlaca) partes.push(`Vehículo (Placa): ${data.vehiculoPlaca.toUpperCase()}`);
    if (data.choferDocNum) partes.push(`Conductor (DNI): ${data.choferDocNum}`);
    if (data.choferLicencia) partes.push(`Licencia: ${data.choferLicencia.toUpperCase()}`);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(partes.join("   |   "), ML, y);
  }

  // ── PIE DE PÁGINA ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(40);
  doc.text(
    "Esta es una representación impresa sin valor tributario de la Guía de Remisión Electrónica generada en el sistema de la SUNAT. Puede verificarla utilizando su clave SOL.",
    105, 285, { align: "center", maxWidth: 180 }
  );

  return doc.output("blob");
}

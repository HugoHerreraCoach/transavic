// src/lib/reportes/pdf-ventas.ts
// Genera el Reporte de Ventas como PDF de UNA página (client-side).
// Pensado para imprimir o compartir por WhatsApp. Usa jsPDF + jspdf-autotable,
// las mismas libs del PDF de comprobantes (sin costo, sin servidor).
//
// Recibe el ReporteVentas YA cargado en el cliente (mismo dato que la pantalla),
// así no duplica queries ni cifras.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReporteVentas } from "./datos-ventas";

const ROJO: [number, number, number] = [220, 38, 38];
const GRIS_TX: [number, number, number] = [55, 65, 81];
const GRIS_CL: [number, number, number] = [156, 163, 175];
const NEGRO: [number, number, number] = [23, 23, 23];

const EMPRESA_LABELS: Record<string, string> = {
  Transavic: "Transavic",
  "Avícola de Tony": "Avícola de Tony",
};

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function finalY(doc: jsPDF): number {
  // jspdf-autotable cuelga lastAutoTable del doc tras dibujar.
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
}

export function generarPdfVentas(reporte: ReporteVentas, etiquetaPeriodo: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14; // margen
  const generado = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  // ── Encabezado ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...ROJO);
  doc.text("Reporte de Ventas", M, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_TX);
  doc.text("Transavic / Avícola de Tony", M, 24);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NEGRO);
  doc.text(etiquetaPeriodo, W - M, 18, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS_CL);
  doc.text(`Generado: ${generado}`, W - M, 23, { align: "right" });
  doc.text("Facturación entregada", W - M, 27, { align: "right" });

  doc.setDrawColor(...ROJO);
  doc.setLineWidth(0.6);
  doc.line(M, 30, W - M, 30);

  // ── KPIs (4 cajas) ──
  const kpiY = 36;
  const kpiH = 20;
  const gap = 4;
  const kpiW = (W - 2 * M - 3 * gap) / 4;
  const kpis: { label: string; value: string; big?: boolean }[] = [
    { label: "Facturado", value: soles(reporte.kpis.total_facturado), big: true },
    { label: "Ticket promedio", value: soles(reporte.kpis.ticket_promedio) },
    { label: "Pedidos entregados", value: String(reporte.kpis.entregados) },
    {
      label: "% de entrega",
      value:
        reporte.kpis.total_pedidos > 0
          ? `${Math.round((reporte.kpis.entregados / reporte.kpis.total_pedidos) * 100)}%`
          : "0%",
    },
  ];
  kpis.forEach((kpi, i) => {
    const x = M + i * (kpiW + gap);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.setFillColor(i === 0 ? 254 : 255, i === 0 ? 242 : 255, i === 0 ? 242 : 255);
    doc.roundedRect(x, kpiY, kpiW, kpiH, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRIS_CL);
    doc.text(kpi.label.toUpperCase(), x + 3, kpiY + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(kpi.big ? 13 : 11);
    doc.setTextColor(...(i === 0 ? ROJO : NEGRO));
    doc.text(kpi.value, x + 3, kpiY + 14);
  });

  // ── Gráfico: ventas por día (barras) ──
  let y = kpiY + kpiH + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_TX);
  doc.text("Ventas por día", M, y);
  y += 3;

  const dias = reporte.ventasPorDia;
  const chartH = 26;
  const chartW = W - 2 * M;
  const chartBottom = y + chartH;
  if (dias.length > 0) {
    const maxMonto = Math.max(...dias.map((d) => d.monto), 1);
    const slot = chartW / dias.length;
    const barW = Math.min(slot * 0.6, 8);
    // línea base
    doc.setDrawColor(...GRIS_CL);
    doc.setLineWidth(0.2);
    doc.line(M, chartBottom, W - M, chartBottom);
    doc.setFillColor(...ROJO);
    // etiquetar como mucho ~12 fechas para no encimar
    const step = Math.ceil(dias.length / 12);
    dias.forEach((d, i) => {
      const h = (d.monto / maxMonto) * chartH;
      const cx = M + i * slot + slot / 2;
      doc.setFillColor(...ROJO);
      doc.roundedRect(cx - barW / 2, chartBottom - h, barW, h, 0.5, 0.5, "F");
      if (i % step === 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(...GRIS_CL);
        doc.text(d.fecha_corta, cx, chartBottom + 3.5, { align: "center" });
      }
    });
    y = chartBottom + 8;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS_CL);
    doc.text("Sin ventas entregadas en el período.", M, y + 6);
    y += 12;
  }

  // ── Tablas: ranking asesoras + top productos (lado a lado) ──
  const half = (W - 2 * M - 6) / 2;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M + half + 6 },
    tableWidth: half,
    head: [["#", "Asesora", "Facturado", "%"]],
    body: reporte.ranking.slice(0, 8).map((a, i) => [
      String(i + 1),
      a.name.trim(),
      soles(a.facturado),
      `${a.tasa}%`,
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.6 },
    headStyles: { fillColor: ROJO, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 6 },
      2: { halign: "right" },
      3: { halign: "right", cellWidth: 10 },
    },
    didDrawPage: () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...GRIS_TX);
      doc.text("Ranking de asesoras", M, y - 2);
    },
  });

  autoTable(doc, {
    startY: y,
    margin: { left: M + half + 6, right: M },
    tableWidth: half,
    head: [["Producto", "Cant.", "Facturado"]],
    body: reporte.topProductos.slice(0, 8).map((p) => [
      p.nombre,
      `${p.cantidad.toLocaleString("es-PE", { maximumFractionDigits: 1 })} ${p.unidad}`,
      soles(p.monto),
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.6 },
    headStyles: { fillColor: ROJO, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    didDrawPage: () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...GRIS_TX);
      doc.text("Top productos", M + half + 6, y - 2);
    },
  });

  // ── Por empresa (pie de página) ──
  let py = finalY(doc) + 8;
  if (reporte.porEmpresa.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GRIS_TX);
    doc.text("Por empresa", M, py);
    py += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    reporte.porEmpresa.forEach((e) => {
      doc.setTextColor(...NEGRO);
      doc.text(
        `${EMPRESA_LABELS[e.empresa] ?? e.empresa}: ${soles(e.monto)} (${e.pedidos} pedidos)`,
        M,
        py
      );
      py += 5;
    });
  }

  doc.save(`reporte-ventas-${reporte.rango.desde}_al_${reporte.rango.hasta}.pdf`);
}

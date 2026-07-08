// src/lib/reportes/pdf-estado-cuenta-avicola.ts
// Genera el ESTADO DE CUENTA de un cliente avícola como PDF A4 (client-side),
// para compartir por WhatsApp o descargar desde el modal (req. §12).
// Clona el estilo de pdf-ventas.ts (jsPDF + jspdf-autotable, branding rojo).
// jsPDF y jspdf-autotable se importan DINÁMICAMENTE para no inflar el bundle.
//
// Reglas:
// - Movimientos en orden CRONOLÓGICO ASC con saldo corrido.
// - EXCLUYE los anulados (no van al PDF ni al saldo corrido).
// - El saldo de arranque se deriva de saldo_actual − neto de los movimientos
//   incluidos, para que el corrido SIEMPRE cierre en el saldo pendiente real
//   aunque el historial venga recortado por rango ("Últimos 30 días"). Con el
//   historial completo equivale EXACTO a cliente.saldo_anterior (misma
//   aritmética de src/lib/avicola/saldos.ts).

import type {
  ClienteAvicolaConSaldo,
  MovimientoAvicola,
} from "@/lib/avicola/types";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/avicola/types";

const ROJO: [number, number, number] = [220, 38, 38];
const ROJO_CLARO: [number, number, number] = [254, 242, 242];
const GRIS_TX: [number, number, number] = [55, 65, 81];
const GRIS_CL: [number, number, number] = [156, 163, 175];
const NEGRO: [number, number, number] = [23, 23, 23];

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-07-07" → "07/07/2026" (sin pasar por Date: evita el corrimiento UTC). */
function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function detalleMovimiento(mov: MovimientoAvicola): string {
  if (mov.tipo === "venta") return `Venta · Guía N.º ${mov.numero_guia ?? "—"}`;
  const medio = mov.medio_pago ? ETIQUETA_MEDIO_PAGO[mov.medio_pago] : "—";
  return `Abono · ${medio}`;
}

export async function generarPdfEstadoCuenta(
  cliente: ClienteAvicolaConSaldo,
  historial: MovimientoAvicola[]
): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14; // margen

  const generado = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  // ── Encabezado (banda roja con la empresa del cliente) ──
  doc.setFillColor(...ROJO);
  doc.rect(0, 0, W, 26, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(cliente.empresa, M, 11);
  doc.setFontSize(11);
  doc.text("ESTADO DE CUENTA", M, 19);

  // ── Datos del cliente + fecha de generación (zona Lima) ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NEGRO);
  doc.text(cliente.nombre.trim(), M, 35);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_TX);
  const ubicacion = cliente.numero_puesto
    ? `${cliente.mercado} · ${cliente.numero_puesto}`
    : cliente.mercado;
  doc.text(ubicacion, M, 40.5);
  if (cliente.telefono) {
    doc.text(`Tel.: ${cliente.telefono}`, M, 45.5);
  }
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS_CL);
  doc.text(`Generado: ${generado}`, W - M, 35, { align: "right" });

  // ── KPIs (4 cajas) ──
  const kpiY = 51;
  const kpiH = 19;
  const gap = 4;
  const kpiW = (W - 2 * M - 3 * gap) / 4;
  const kpis: { label: string; value: string; destacado?: boolean }[] = [
    { label: "Saldo anterior", value: soles(cliente.saldo_anterior) },
    { label: "Total vendido", value: soles(cliente.total_vendido) },
    { label: "Total abonado", value: soles(cliente.total_abonado) },
    { label: "Saldo pendiente", value: soles(cliente.saldo_actual), destacado: true },
  ];
  kpis.forEach((kpi, i) => {
    const x = M + i * (kpiW + gap);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    if (kpi.destacado) {
      doc.setFillColor(...ROJO_CLARO);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.roundedRect(x, kpiY, kpiW, kpiH, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRIS_CL);
    doc.text(kpi.label.toUpperCase(), x + 3, kpiY + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(kpi.destacado ? 12 : 11);
    doc.setTextColor(...(kpi.destacado ? ROJO : NEGRO));
    doc.text(kpi.value, x + 3, kpiY + 14);
  });

  // ── Movimientos (orden cronológico ASC, sin anulados, con saldo corrido) ──
  const movs = historial
    .filter((m) => !m.anulado)
    .sort((a, b) =>
      a.fecha === b.fecha
        ? a.created_at.localeCompare(b.created_at)
        : a.fecha.localeCompare(b.fecha)
    );

  const netoMovs = movs.reduce(
    (acc, m) => acc + (m.tipo === "venta" ? m.monto : -m.monto),
    0
  );
  // Con el historial completo esto es EXACTAMENTE cliente.saldo_anterior.
  const saldoInicial = cliente.saldo_actual - netoMovs;

  let saldo = saldoInicial;
  const body: string[][] = [["", "Saldo anterior", "", "", soles(saldoInicial)]];
  for (const m of movs) {
    saldo += m.tipo === "venta" ? m.monto : -m.monto;
    body.push([
      fechaCorta(m.fecha),
      detalleMovimiento(m),
      m.tipo === "venta" ? soles(m.monto) : "",
      m.tipo === "abono" ? soles(m.monto) : "",
      soles(saldo),
    ]);
  }

  const tablaY = kpiY + kpiH + 9;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_TX);
  doc.text("Movimientos", M, tablaY - 2);

  autoTable(doc, {
    startY: tablaY,
    margin: { left: M, right: M },
    head: [["Fecha", "Detalle", "Cargo", "Abono", "Saldo"]],
    body,
    foot: [["", "SALDO PENDIENTE", "", "", soles(cliente.saldo_actual)]],
    styles: { fontSize: 8, cellPadding: 1.8, textColor: NEGRO },
    headStyles: { fillColor: ROJO, textColor: 255, fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: ROJO_CLARO, textColor: ROJO, fontStyle: "bold", fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 22 },
      2: { halign: "right", cellWidth: 26 },
      3: { halign: "right", cellWidth: 26 },
      4: { halign: "right", cellWidth: 28 },
    },
    didParseCell: (data) => {
      // La fila de arranque "Saldo anterior" va en gris cursiva.
      if (data.section === "body" && data.row.index === 0) {
        data.cell.styles.fontStyle = "italic";
        data.cell.styles.textColor = GRIS_TX;
      }
    },
  });

  // ── Nota final (solo si el saldo quedó a favor del cliente) ──
  if (cliente.saldo_actual < -0.009) {
    const lastY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
        ?.finalY ?? tablaY;
    let yNota = lastY + 6;
    if (yNota > H - 12) {
      doc.addPage();
      yNota = 20;
    }
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS_CL);
    doc.text("Saldo negativo: monto a favor del cliente.", M, yNota);
  }

  return doc.output("blob");
}

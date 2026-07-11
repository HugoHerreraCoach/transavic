// src/lib/reportes/pdf-estado-cuenta-avicola.ts
// Genera el ESTADO DE CUENTA de un cliente avícola como PDF A4 (client-side),
// para compartir por WhatsApp o descargar desde el modal (rediseño 11 jul 2026).
// jsPDF y jspdf-autotable se importan DINÁMICAMENTE para no inflar el bundle.
//
// Libro mayor POR DÍA con filtro por período; la aritmética vive en
// src/lib/avicola/estado-cuenta.ts (fuente única, compartida con el modal).
// Columnas: Fecha · Venta del día · Peso/Producto · Monto del día · Saldo anterior
// · Abonos · Saldo actual. Al pie: totales del período. EXCLUYE los anulados.

import type { ClienteAvicolaConSaldo, MovimientoAvicola } from "@/lib/avicola/types";
import { construirEstadoCuenta, type DiaEstadoCuenta } from "@/lib/avicola/estado-cuenta";

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

const kg = (n: number) => n.toLocaleString("es-PE", { maximumFractionDigits: 2 });

/** Texto de la columna Peso/Producto de un día (con o sin el precio por kilo). */
function textoProductos(dia: DiaEstadoCuenta, conPrecio: boolean): string {
  if (dia.items.length === 0) return "";
  return dia.items
    .map((it) =>
      conPrecio
        ? `${it.producto_nombre}  ${kg(it.peso_kg)} kg × ${soles(it.precio_kg)}`
        : `${it.producto_nombre}  ${kg(it.peso_kg)} kg`
    )
    .join("\n");
}

function textoGuias(dia: DiaEstadoCuenta): string {
  if (dia.guias.length === 0) return dia.hay_abono ? "Abono" : "—";
  return dia.guias.map((g) => `Guía ${g}`).join(", ");
}

export interface OpcionesEstadoCuenta {
  desde?: string | null;
  hasta?: string | null;
  conPrecio?: boolean;
}

export async function generarPdfEstadoCuenta(
  cliente: ClienteAvicolaConSaldo,
  historial: MovimientoAvicola[],
  opciones: OpcionesEstadoCuenta = {}
): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const desde = opciones.desde ?? null;
  const hasta = opciones.hasta ?? null;
  const conPrecio = opciones.conPrecio ?? true;

  const est = construirEstadoCuenta(cliente, historial, desde, hasta);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;

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

  // ── Datos del cliente + fecha de generación ──
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
  if (cliente.telefono) doc.text(`Tel.: ${cliente.telefono}`, M, 45.5);
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS_CL);
  doc.text(`Generado: ${generado}`, W - M, 35, { align: "right" });
  // Período mostrado
  const periodoTxt =
    desde || hasta
      ? `Período: ${desde ? fechaCorta(desde) : "inicio"} — ${hasta ? fechaCorta(hasta) : "hoy"}`
      : "Período: todo el historial";
  doc.text(periodoTxt, W - M, 40, { align: "right" });

  // ── Tabla: un día por fila ──
  const body: string[][] = est.dias.map((d) => [
    fechaCorta(d.fecha),
    textoGuias(d),
    textoProductos(d, conPrecio),
    d.hay_venta ? soles(d.venta_del_dia) : "",
    soles(d.saldo_anterior),
    d.hay_abono ? soles(d.abonos_del_dia) : "",
    soles(d.saldo_actual),
  ]);
  if (body.length === 0) {
    body.push(["", "Sin movimientos en el período", "", "", soles(est.saldo_inicial), "", soles(est.saldo_final)]);
  }

  const tablaY = 54;
  autoTable(doc, {
    startY: tablaY,
    margin: { left: M, right: M },
    head: [[
      "Fecha",
      "Venta del día",
      "Peso / Producto",
      "Monto del día",
      "Saldo anterior",
      "Abonos",
      "Saldo actual",
    ]],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, valign: "top" },
    headStyles: { fillColor: ROJO, textColor: 255, fontStyle: "bold", fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 20 },
      2: { cellWidth: "auto" },
      3: { halign: "right", cellWidth: 22 },
      4: { halign: "right", cellWidth: 23 },
      5: { halign: "right", cellWidth: 18, textColor: [22, 130, 60] },
      6: { halign: "right", cellWidth: 23, fontStyle: "bold" },
    },
  });

  // ── Totales del período (bloque destacado) ──
  const lastY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tablaY;
  let y = lastY + 8;
  if (y > H - 40) {
    doc.addPage();
    y = 20;
  }
  const boxW = 66;
  const boxX = W - M - boxW;
  const filas: { label: string; value: string; destacado?: boolean }[] = [
    { label: "Total vendido del período", value: soles(est.total_vendido) },
    { label: "Total abonado del período", value: soles(est.total_abonado) },
    { label: "Saldo pendiente final", value: soles(est.saldo_final), destacado: true },
  ];
  filas.forEach((f) => {
    if (f.destacado) {
      doc.setFillColor(...ROJO_CLARO);
      doc.setDrawColor(...ROJO);
      doc.roundedRect(boxX, y - 4.5, boxW, 8, 1.5, 1.5, "FD");
    }
    doc.setFont("helvetica", f.destacado ? "bold" : "normal");
    doc.setFontSize(f.destacado ? 10 : 9);
    doc.setTextColor(...(f.destacado ? ROJO : GRIS_TX));
    doc.text(f.label, boxX + 2, y);
    doc.text(f.value, boxX + boxW - 2, y, { align: "right" });
    y += f.destacado ? 9 : 6.5;
  });

  if (est.saldo_final < -0.009) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS_CL);
    doc.text("Saldo negativo: monto a favor del cliente.", M, y + 2);
  }

  return doc.output("blob");
}

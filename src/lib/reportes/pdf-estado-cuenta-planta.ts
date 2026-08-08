// src/lib/reportes/pdf-estado-cuenta-planta.ts
// Genera el ESTADO DE CUENTA de un cliente de PLANTA como PDF A4 (client-side),
// para compartir por WhatsApp o descargar desde el modal.
// jsPDF y jspdf-autotable se importan DINÁMICAMENTE para no inflar el bundle.
//
// Libro mayor POR DÍA con filtro por período; la aritmética vive en
// src/lib/planta/estado-cuenta.ts (fuente única, compartida con el modal).
//
// Calcado de pdf-estado-cuenta-avicola.ts, con dos diferencias de dominio:
//   - color VIOLETA (planta), no rojo (campo);
//   - las ventas al CONTADO no entran en la columna de saldo (ya se pagaron);
//     van al pie como total informativo del período.

import {
  ETIQUETA_MEDIO_PAGO_PLANTA,
  type ClientePlantaConSaldo,
  type ItemMovimientoPlanta,
  type MovimientoPlanta,
} from "@/lib/planta/types";
import {
  construirEstadoCuentaPlanta,
  type DiaEstadoCuentaPlanta,
} from "@/lib/planta/estado-cuenta";

const VIOLETA: [number, number, number] = [124, 58, 237];
const VIOLETA_CLARO: [number, number, number] = [245, 243, 255];
const GRIS_TX: [number, number, number] = [55, 65, 81];
const GRIS_CL: [number, number, number] = [156, 163, 175];
/** Fondo de la fila que cierra el día (el total). */
const GRIS_FONDO: [number, number, number] = [243, 244, 246];
const NEGRO: [number, number, number] = [23, 23, 23];

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-08-07" → "07/08/2026" (sin pasar por Date: evita el corrimiento UTC). */
function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Hora real del registro en Lima. */
function horaCorta(createdAt: string): string {
  const d = new Date(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

const cantidad = (n: number) => n.toLocaleString("es-PE", { maximumFractionDigits: 2 });

/** "Menudencia Mixta — 9 kg × S/ 5.00" */
function textoProducto(it: ItemMovimientoPlanta, conPrecio: boolean): string {
  const unidad = (it.unidad || "uni").toLowerCase();
  const detalle = conPrecio
    ? `${cantidad(it.cantidad)} ${unidad} × ${soles(it.precio_unitario)}`
    : `${cantidad(it.cantidad)} ${unidad}`;
  return `${it.producto_nombre} — ${detalle}`;
}

/** Qué pasó ese día, en una palabra. */
function textoConcepto(dia: DiaEstadoCuentaPlanta): string {
  const partes: string[] = [];
  if (dia.venta_credito > 0) partes.push("Crédito");
  if (dia.venta_contado > 0) partes.push("Contado");
  if (dia.hay_abono) partes.push("Abono");
  return partes.length > 0 ? partes.join(" + ") : "—";
}

/** Cada abono se imprime como bloque independiente: el cliente ve cada pago. */
function textoAbonos(dia: DiaEstadoCuentaPlanta): string {
  return dia.abonos
    .map((abono) => {
      const hora = horaCorta(abono.created_at);
      const medio = abono.medio_pago
        ? ETIQUETA_MEDIO_PAGO_PLANTA[abono.medio_pago]
        : "Otro";
      const nota = abono.observaciones?.trim().replace(/\s+/g, " ");
      return [
        `${hora ? `${hora} - ` : ""}${medio}`,
        `- ${soles(abono.monto)}`,
        `Saldo: ${soles(abono.saldo_posterior)}`,
        ...(nota ? [`Nota: ${nota}`] : []),
      ].join("\n");
    })
    .join("\n------\n");
}

/**
 * Arma las filas de la tabla: un día = un BLOQUE (una fila por producto + total).
 *
 * PURA y exportada a propósito, para poder probar las reglas sin generar un PDF.
 * Devuelve también los índices de las filas que cierran un día, que es lo que el
 * PDF pinta distinto.
 *
 * ⚠️ La columna "Monto" de la fila TOTAL es lo que movió el SALDO, o sea solo el
 * crédito. Si el día tuvo contado, se anota aparte para que los importes de los
 * productos no parezcan no cuadrar.
 */
export function construirFilasEstadoCuentaPlanta(
  dias: DiaEstadoCuentaPlanta[],
  conPrecio: boolean
): { body: string[][]; filasTotal: Set<number> } {
  const body: string[][] = [];
  const filasTotal = new Set<number>();

  dias.forEach((d) => {
    const columnasDelDia = (monto: string): string[] => [
      monto,
      soles(d.saldo_anterior),
      d.hay_abono ? textoAbonos(d) : "",
      soles(d.saldo_actual),
    ];

    // Día sin ítems (solo abono): una fila.
    if (d.items.length === 0) {
      body.push([
        fechaCorta(d.fecha),
        textoConcepto(d),
        "",
        ...columnasDelDia(d.venta_credito > 0 ? soles(d.venta_credito) : ""),
      ]);
      return;
    }

    // Los importes de la columna TIENEN que sumar el total: si no, el cliente
    // hace la cuenta, no le cuadra y se rompe la confianza en el documento
    // entero. El total manda, así que cualquier diferencia se muestra como
    // "Ajuste" en vez de esconderse.
    const totalDia = Math.round((d.venta_credito + d.venta_contado) * 100) / 100;
    const sumaItems =
      Math.round(d.items.reduce((acc, it) => acc + it.subtotal, 0) * 100) / 100;
    const desfase = Math.round((totalDia - sumaItems) * 100) / 100;
    const hayDesfase = Math.abs(desfase) > 0.01;

    d.items.forEach((it, i) => {
      body.push([
        i === 0 ? fechaCorta(d.fecha) : "",
        i === 0 ? textoConcepto(d) : "",
        textoProducto(it, conPrecio),
        soles(it.subtotal),
        "",
        "",
        "",
      ]);
    });
    if (hayDesfase) {
      body.push(["", "", "Ajuste", soles(desfase), "", "", ""]);
    }
    // Lo pagado en el acto no mueve el saldo: se dice explícitamente para que no
    // parezca que faltan importes en la columna de la derecha.
    if (d.venta_contado > 0) {
      body.push([
        "",
        "",
        "Pagado al contado (no suma a la deuda)",
        `- ${soles(d.venta_contado)}`,
        "",
        "",
        "",
      ]);
    }
    filasTotal.add(body.length);
    body.push([
      "",
      "",
      "TOTAL DEL DÍA A CRÉDITO",
      ...columnasDelDia(soles(d.venta_credito)),
    ]);
  });

  return { body, filasTotal };
}

export interface OpcionesEstadoCuentaPlanta {
  desde?: string | null;
  hasta?: string | null;
  conPrecio?: boolean;
}

export async function generarPdfEstadoCuentaPlanta(
  cliente: ClientePlantaConSaldo,
  historial: MovimientoPlanta[],
  opciones: OpcionesEstadoCuentaPlanta = {}
): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const desde = opciones.desde ?? null;
  const hasta = opciones.hasta ?? null;
  const conPrecio = opciones.conPrecio ?? true;

  const est = construirEstadoCuentaPlanta(cliente, historial, desde, hasta);
  const { body, filasTotal } = construirFilasEstadoCuentaPlanta(est.dias, conPrecio);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;

  // Banda superior
  doc.setFillColor(...VIOLETA);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(cliente.empresa, M, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("ESTADO DE CUENTA", M, 19);

  // Datos del cliente
  doc.setTextColor(...NEGRO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(cliente.nombre, M, 35);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_TX);
  let yDatos = 40.5;
  if (cliente.razon_social) {
    doc.text(cliente.razon_social, M, yDatos);
    yDatos += 5;
  }
  if (cliente.ruc_dni) {
    doc.text(`RUC/DNI: ${cliente.ruc_dni}`, M, yDatos);
    yDatos += 5;
  }
  if (cliente.telefono) {
    doc.text(`Tel.: ${cliente.telefono}`, M, yDatos);
  }

  const generado = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  const periodoTxt =
    desde || hasta
      ? `Período: ${desde ? fechaCorta(desde) : "inicio"} — ${hasta ? fechaCorta(hasta) : "hoy"}`
      : "Período: todo el historial";
  doc.setTextColor(...GRIS_CL);
  doc.text(`Generado: ${generado}`, W - M, 35, { align: "right" });
  doc.text(periodoTxt, W - M, 40, { align: "right" });

  const tablaY = 54;
  if (body.length === 0) {
    body.push([
      "",
      "Sin movimientos en el período",
      "",
      "",
      soles(est.saldo_inicial),
      "",
      soles(est.saldo_final),
    ]);
  }

  autoTable(doc, {
    startY: tablaY,
    margin: { left: M, right: M },
    head: [
      [
        "Fecha",
        "Concepto",
        "Producto",
        "Monto",
        "Saldo anterior",
        "Abonos separados",
        "Saldo actual",
      ],
    ],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, valign: "top" },
    headStyles: { fillColor: VIOLETA, textColor: 255, fontStyle: "bold", fontSize: 7 },
    // Desactivado: rayaría POR PRODUCTO y rompería la lectura del día como
    // bloque. La separación la da la fila de total.
    alternateRowStyles: { fillColor: false as unknown as undefined },
    // Un bloque no se parte entre páginas dejando el total huérfano (gotcha #63).
    rowPageBreak: "avoid",
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 20 },
      2: { cellWidth: "auto" },
      3: { halign: "right", cellWidth: 22 },
      4: { halign: "right", cellWidth: 23 },
      5: { halign: "left", cellWidth: 31, textColor: [22, 130, 60] },
      6: { halign: "right", cellWidth: 21, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section !== "body" || !filasTotal.has(data.row.index)) return;
      data.cell.styles.fillColor = GRIS_FONDO;
      data.cell.styles.fontStyle = "bold";
      if (data.column.index === 2) data.cell.styles.textColor = GRIS_TX;
    },
  });

  const lastY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
    tablaY;
  let y = lastY + 8;
  if (y > H - 46) {
    doc.addPage();
    y = 20;
  }

  const boxW = 70;
  const boxX = W - M - boxW;
  const filas: Array<{ label: string; value: string; destacado?: boolean }> = [
    { label: "Saldo inicial del período", value: soles(est.saldo_inicial) },
    { label: "Vendido a crédito", value: soles(est.total_credito) },
    { label: "Total abonado", value: soles(est.total_abonado) },
    { label: "Saldo pendiente final", value: soles(est.saldo_final), destacado: true },
  ];

  for (const f of filas) {
    if (f.destacado) {
      doc.setFillColor(...VIOLETA_CLARO);
      doc.setDrawColor(...VIOLETA);
      doc.roundedRect(boxX, y - 4.5, boxW, 8, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...VIOLETA);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...GRIS_TX);
    }
    doc.text(f.label, boxX + 2, y);
    doc.text(f.value, W - M - 2, y, { align: "right" });
    y += f.destacado ? 9 : 6.5;
  }

  // Lo pagado en el acto va aparte: no es deuda, pero el cliente quiere saber
  // cuánto compró en total.
  if (est.total_contado > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS_CL);
    doc.text(
      `Compras al contado del período (ya pagadas): ${soles(est.total_contado)}`,
      M,
      y
    );
    y += 5;
  }

  if (est.saldo_final < -0.009) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS_CL);
    doc.text("Saldo negativo: monto a favor del cliente.", M, y + 2);
  }

  return doc.output("blob");
}

// src/lib/reportes/pdf-estado-cuenta-avicola.ts
// Genera el ESTADO DE CUENTA de un cliente avícola como PDF A4 (client-side),
// para compartir por WhatsApp o descargar desde el modal (rediseño 11 jul 2026).
// jsPDF y jspdf-autotable se importan DINÁMICAMENTE para no inflar el bundle.
//
// Libro mayor POR DÍA con filtro por período; la aritmética vive en
// src/lib/avicola/estado-cuenta.ts (fuente única, compartida con el modal).
// Columnas: Fecha · Venta del día · Peso/Producto · Monto del día · Saldo anterior
// · Abonos · Saldo actual. Al pie: totales del período. EXCLUYE los anulados.

import {
  ETIQUETA_MEDIO_PAGO,
  type ClienteAvicolaConSaldo,
  type MovimientoAvicola,
} from "@/lib/avicola/types";
import { construirEstadoCuenta, type DiaEstadoCuenta } from "@/lib/avicola/estado-cuenta";

const ROJO: [number, number, number] = [220, 38, 38];
const ROJO_CLARO: [number, number, number] = [254, 242, 242];
const GRIS_TX: [number, number, number] = [55, 65, 81];
const GRIS_CL: [number, number, number] = [156, 163, 175];
/** Fondo de la fila que cierra el día (el total). */
const GRIS_FONDO: [number, number, number] = [243, 244, 246];
const NEGRO: [number, number, number] = [23, 23, 23];

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-07-07" → "07/07/2026" (sin pasar por Date: evita el corrimiento UTC). */
function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Hora real del registro en Lima. El abono conserva su fecha de negocio aparte. */
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

const kg = (n: number) => n.toLocaleString("es-PE", { maximumFractionDigits: 2 });

/** Descripción de un producto: "Gallina doble pechuga — 7.2 kg × S/ 12.50". */
function textoProducto(
  it: { producto_nombre: string; peso_kg: number; precio_kg: number },
  conPrecio: boolean
): string {
  const detalle = conPrecio
    ? `${kg(it.peso_kg)} kg × ${soles(it.precio_kg)}`
    : `${kg(it.peso_kg)} kg`;
  return `${it.producto_nombre} — ${detalle}`;
}

function textoGuias(dia: DiaEstadoCuenta): string {
  if (dia.guias.length === 0) return dia.hay_abono ? "Abono" : "—";
  return dia.guias.map((g) => `Guía ${g}`).join(", ");
}

/** Cada abono se imprime como bloque independiente. No volver a reemplazar esta
 * lista por `abonos_del_dia`: Antonio necesita que el cliente vea cada pago. */
function textoAbonos(dia: DiaEstadoCuenta): string {
  return dia.abonos
    .map((abono) => {
      const hora = horaCorta(abono.created_at);
      const medio = abono.medio_pago
        ? ETIQUETA_MEDIO_PAGO[abono.medio_pago]
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
 * PURA y exportada a propósito, para poder probar las reglas sin generar un PDF
 * (`pdf-estado-cuenta-avicola.test.ts`). Devuelve también los índices de las
 * filas que cierran un día, que es lo que el PDF pinta distinto.
 *
 * Antes cada día era UNA fila con todos los productos apelotonados en una celda
 * y un solo importe sumado: para comprobar el cobro había que sacar calculadora.
 */
export function construirFilasEstadoCuenta(
  dias: DiaEstadoCuenta[],
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

    // Día de solo abono (o sin ítems): una fila, como siempre.
    if (d.items.length === 0) {
      body.push([
        fechaCorta(d.fecha),
        textoGuias(d),
        "",
        ...columnasDelDia(d.hay_venta ? soles(d.venta_del_dia) : ""),
      ]);
      return;
    }

    // Los importes de la columna TIENEN que sumar el total: si no, el cliente
    // hace la cuenta, no le cuadra y se rompe la confianza en el documento
    // entero. El total manda (es el que mueve el saldo), así que cualquier
    // diferencia se muestra como "Ajuste" en vez de esconderse.
    // Hoy no debería pasar nunca — el API calcula el total sumando los ítems
    // (api/avicola/ventas/route.ts) y en producción no hay ni una venta
    // descuadrada —, pero un ajuste hecho a mano en la base no puede terminar
    // en un PDF que se contradice a sí mismo.
    const sumaItems = Math.round(d.items.reduce((acc, it) => acc + it.subtotal, 0) * 100) / 100;
    const desfase = Math.round((d.venta_del_dia - sumaItems) * 100) / 100;
    const hayDesfase = Math.abs(desfase) > 0.01;

    // Un solo producto y sin desfase: su importe YA es el total del día.
    // Repetirlo en una fila aparte sería el mismo número dos veces seguidas.
    if (d.items.length === 1 && !hayDesfase) {
      const it = d.items[0];
      body.push([
        fechaCorta(d.fecha),
        textoGuias(d),
        textoProducto(it, conPrecio),
        ...columnasDelDia(soles(it.subtotal)),
      ]);
      return;
    }

    d.items.forEach((it, i) => {
      body.push([
        i === 0 ? fechaCorta(d.fecha) : "",
        i === 0 ? textoGuias(d) : "",
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
    filasTotal.add(body.length);
    body.push(["", "", "TOTAL DEL DÍA", ...columnasDelDia(soles(d.venta_del_dia))]);
  });

  return { body, filasTotal };
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

  // ── Tabla: un día = un BLOQUE de filas (una por producto + el total) ──
  // La construcción vive en `construirFilasEstadoCuenta` (pura y con tests).
  const { body, filasTotal } = construirFilasEstadoCuenta(est.dias, conPrecio);

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
      "Producto",
      "Monto",
      "Saldo anterior",
      "Abonos separados",
      "Saldo actual",
    ]],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, valign: "top" },
    headStyles: { fillColor: ROJO, textColor: 255, fontStyle: "bold", fontSize: 7 },
    // Sin franjas alternas: ahora rayarían POR PRODUCTO y romperían la lectura
    // del día como bloque. La separación la da la fila de total.
    alternateRowStyles: { fillColor: false as unknown as undefined },
    // Un bloque no se parte entre páginas dejando el total huérfano.
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
      // La fila que cierra el día: en negrita y con fondo, para que el ojo
      // encuentre el total sin buscarlo.
      data.cell.styles.fillColor = GRIS_FONDO;
      data.cell.styles.fontStyle = "bold";
      if (data.column.index === 2) data.cell.styles.textColor = GRIS_TX;
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

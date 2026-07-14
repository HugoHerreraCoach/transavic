import type {
  EstadoCuentaProveedor,
  ProveedorFichaBasica,
} from "@/lib/proveedores/types";

const AZUL: [number, number, number] = [30, 64, 175];
const AZUL_CLARO: [number, number, number] = [239, 246, 255];
const GRIS: [number, number, number] = [75, 85, 99];
const VERDE: [number, number, number] = [5, 150, 105];
const ROJO: [number, number, number] = [220, 38, 38];

const dinero = (monto: number) =>
  `S/ ${monto.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fechaCorta = (fecha: string) => {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function detalleMovimiento(
  movimiento: EstadoCuentaProveedor["movimientos"][number]
) {
  if (movimiento.tipo === "deuda") {
    const productos = movimiento.items.map((item) => {
      const signo = item.tipo === "devolucion" ? "Dev. " : "";
      return `${signo}${item.producto_nombre}: ${item.peso_neto.toLocaleString("es-PE", {
        maximumFractionDigits: 2,
      })} kg x ${dinero(item.costo_unitario)} = ${dinero(item.subtotal)}`;
    });
    return [movimiento.documento || movimiento.concepto, ...productos].join("\n");
  }
  const aplicaciones = movimiento.aplicaciones.map(
    (app) => `${app.documento || "Deuda"}: ${dinero(app.monto)}`
  );
  return [
    movimiento.cuenta_nombre || "Cuenta no indicada",
    ...(movimiento.notas ? [`Ref.: ${movimiento.notas}`] : []),
    ...aplicaciones,
  ].join("\n");
}

export async function generarPdfEstadoCuentaProveedor(
  proveedor: ProveedorFichaBasica,
  estado: EstadoCuentaProveedor
): Promise<Blob> {
  const jspdfModule = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  // Next/Webpack expone default; Node (fixture de QA) expone el named export.
  const jsPDF =
    jspdfModule.jsPDF ??
    (jspdfModule.default as unknown as { jsPDF?: typeof jspdfModule.jsPDF }).jsPDF ??
    (jspdfModule.default as unknown as typeof jspdfModule.jsPDF);
  const autoTable =
    autoTableModule.default ??
    (autoTableModule as unknown as { autoTable: typeof autoTableModule.default }).autoTable;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const margen = 14;

  doc.setFillColor(...AZUL);
  doc.rect(0, 0, ancho, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("TRANSAVIC", margen, 11);
  doc.setFontSize(11);
  doc.text("ESTADO DE CUENTA DEL PROVEEDOR", margen, 20);

  doc.setTextColor(17, 24, 39);
  doc.setFontSize(12);
  doc.text(proveedor.razon_social, margen, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  const datos = [
    proveedor.ruc ? `RUC: ${proveedor.ruc}` : "Sin RUC",
    proveedor.telefono ? `Tel.: ${proveedor.telefono}` : null,
    proveedor.direccion || null,
  ].filter(Boolean);
  doc.text(datos.join(" | "), margen, 44, { maxWidth: ancho - margen * 2 });
  const periodo =
    estado.desde || estado.hasta
      ? `Periodo: ${estado.desde ? fechaCorta(estado.desde) : "inicio"} al ${
          estado.hasta ? fechaCorta(estado.hasta) : "hoy"
        }`
      : "Periodo: todo el historial";
  doc.text(periodo, ancho - margen, 38, { align: "right" });
  doc.text(
    `Generado: ${new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date())}`,
    ancho - margen,
    44,
    { align: "right" }
  );

  const body = estado.movimientos.map((movimiento) => [
    fechaCorta(movimiento.fecha),
    movimiento.tipo === "deuda"
      ? "Compra / deuda"
      : movimiento.tipo === "pago"
        ? "Pago"
        : "Contraasiento",
    detalleMovimiento(movimiento),
    movimiento.tipo === "deuda" || movimiento.tipo === "contraasiento"
      ? dinero(movimiento.monto)
      : "",
    movimiento.tipo === "pago" ? dinero(movimiento.monto) : "",
    dinero(movimiento.saldo_posterior),
  ]);
  if (body.length === 0) {
    body.push(["", "Sin movimientos", "", "", "", dinero(estado.saldo_final)]);
  }

  autoTable(doc, {
    startY: 52,
    margin: { left: margen, right: margen, bottom: 18 },
    head: [["Fecha", "Movimiento", "Documento / detalle", "Deuda", "Pago", "Saldo"]],
    body,
    rowPageBreak: "avoid",
    styles: { fontSize: 7.3, cellPadding: 1.7, valign: "top", textColor: [31, 41, 55] },
    headStyles: { fillColor: AZUL, textColor: 255, fontStyle: "bold", fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 22 },
      2: { cellWidth: "auto" },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 22, halign: "right", textColor: VERDE },
      5: { cellWidth: 23, halign: "right", fontStyle: "bold" },
    },
    didDrawPage: ({ pageNumber }) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(156, 163, 175);
      doc.text(`Pagina ${pageNumber}`, ancho - margen, alto - 8, { align: "right" });
      doc.text("Documento informativo de control interno", margen, alto - 8);
    },
  });

  const finalTabla =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 52;
  let y = finalTabla + 7;
  if (y > alto - 47) {
    doc.addPage();
    y = 20;
  }
  const cajaX = ancho - margen - 76;
  const filas = [
    ["Saldo al inicio", dinero(estado.saldo_inicial)],
    ["Compras / deudas", dinero(estado.total_comprado)],
    ["Pagos netos", dinero(estado.total_pagado)],
  ];
  doc.setFontSize(8.5);
  filas.forEach(([etiqueta, valor]) => {
    doc.setTextColor(...GRIS);
    doc.text(etiqueta, cajaX, y);
    doc.text(valor, ancho - margen, y, { align: "right" });
    y += 6;
  });

  doc.setFillColor(...AZUL_CLARO);
  doc.setDrawColor(...AZUL);
  doc.roundedRect(cajaX - 2, y - 4.5, 78, 10, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const esCredito = estado.saldo_favor > 0;
  doc.setTextColor(...(esCredito ? VERDE : estado.deuda_pendiente > 0 ? ROJO : AZUL));
  doc.text(esCredito ? "Saldo a favor" : "Deuda pendiente", cajaX, y + 1);
  doc.text(
    dinero(esCredito ? estado.saldo_favor : estado.deuda_pendiente),
    ancho - margen,
    y + 1,
    { align: "right" }
  );

  return doc.output("blob");
}

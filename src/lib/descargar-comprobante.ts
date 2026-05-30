// src/lib/descargar-comprobante.ts
// Descargas de comprobantes (PDF / XML firmado / CDR) reutilizables desde
// cualquier componente cliente: la pantalla de comprobantes y el botón
// "Facturado" en la lista de pedidos comparten estas funciones (sin duplicar).
// Importan jsPDF dinámicamente para no inflar el bundle inicial.

function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Genera y descarga el PDF (formato SUNAT) de un comprobante. */
export async function descargarPdfComprobante(id: string): Promise<void> {
  const res = await fetch(`/api/comprobantes/${id}`);
  if (!res.ok) throw new Error("No se pudo cargar el comprobante");
  const d = await res.json();
  const { generarPDFComprobante } = await import("@/lib/sunat/pdf-comprobante");
  const blob = generarPDFComprobante({
    tipo: d.tipo,
    serie: d.serie,
    numero: d.numero,
    serieNumero: d.serieNumero,
    fechaEmision: d.fechaEmision,
    cliente: {
      tipoDocumento: d.cliente?.tipoDocumento ?? undefined,
      numDocumento: d.cliente?.numDocumento ?? "",
      razonSocial: d.cliente?.razonSocial ?? "Cliente",
      direccion: d.cliente?.direccion ?? undefined,
    },
    items: d.items,
    totales: d.totales,
    moneda: d.moneda,
    hashCpe: d.hashCpe,
    observaciones: d.observaciones,
    empresa: d.empresa,
    emisor: d.emisor,
    formaPago: d.formaPago ?? undefined,
    fechaVencimiento: d.fechaVencimiento ?? undefined,
  });
  descargarBlob(blob, `${d.serieNumero || id}.pdf`);
}

/** Descarga el XML firmado del comprobante. */
export async function descargarXmlComprobante(id: string, serieNumero?: string): Promise<void> {
  const res = await fetch(`/api/comprobantes/${id}/xml`);
  if (!res.ok) throw new Error("No se pudo descargar el XML");
  descargarBlob(await res.blob(), `${serieNumero || id}.xml`);
}

/** Descarga la Constancia de Recepción (CDR) de SUNAT. */
export async function descargarCdrComprobante(id: string, serieNumero?: string): Promise<void> {
  const res = await fetch(`/api/comprobantes/${id}/cdr`);
  if (!res.ok) throw new Error("No se pudo descargar el CDR");
  descargarBlob(await res.blob(), `R-${serieNumero || id}.xml`);
}

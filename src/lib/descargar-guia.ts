// src/lib/descargar-guia.ts
// Descarga de archivos XML firmado y CDR de una Guía de Remisión Electrónica (GRE).

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

/** Descarga el XML firmado de la guía de remisión. */
export async function descargarXmlGuia(id: string, serieNumero?: string): Promise<void> {
  const res = await fetch(`/api/guias/${id}/xml`);
  if (!res.ok) throw new Error("No se pudo descargar el XML de la guía de remisión.");
  descargarBlob(await res.blob(), `${serieNumero || id}.xml`);
}

/** Descarga la Constancia de Recepción (CDR) de SUNAT para la guía. */
export async function descargarCdrGuia(id: string, serieNumero?: string): Promise<void> {
  const res = await fetch(`/api/guias/${id}/cdr`);
  if (!res.ok) throw new Error("No se pudo descargar el CDR de la guía de remisión.");
  descargarBlob(await res.blob(), `R-${serieNumero || id}.zip`);
}

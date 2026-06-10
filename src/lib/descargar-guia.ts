// src/lib/descargar-guia.ts
// Descargas de una Guía de Remisión Electrónica (GRE): PDF (jsPDF, igual que
// boletas/facturas — descarga el archivo, no abre pestaña), XML firmado y CDR.

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

// Datos del emisor para el punto de partida (mismos del imprimible /pedidos/[id]/gre).
const PARTIDA_EMISOR = "CAL. LAS ESMERALDAS NRO. 624 URB. BALCONCILLO - LA VICTORIA - LIMA - LIMA";

/** QR de SUNAT como dataURL (best-effort: si falla, el PDF sale sin QR). */
async function qrDataUrl(hashCpe: string | null): Promise<string | null> {
  if (!hashCpe) return null;
  try {
    const target = `https://e-factura.sunat.gob.pe/v1/contribuyente/gre/comprobantes/descargaqr?hashqr=${encodeURIComponent(hashCpe)}`;
    const res = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(target)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Genera y descarga el PDF de la guía (acepta el id de la guía o el pedido_id). */
export async function descargarPdfGuia(id: string): Promise<void> {
  const res = await fetch(`/api/guias/${id}`);
  if (!res.ok) throw new Error("No se pudo cargar la guía de remisión.");
  const g = await res.json();
  const imp = g.impresion || {};

  const distrito = (imp.distritoLlegada || "LIMA").toUpperCase();
  const puntoLlegada = imp.direccionLlegada
    ? `${String(imp.direccionLlegada).toUpperCase()}, ${distrito} - LIMA - LIMA`
    : `${distrito} - LIMA - LIMA`;

  const { generarPDFGuia } = await import("@/lib/sunat/pdf-guia");
  const blob = generarPDFGuia({
    serieNumero: g.serie_numero,
    rucEmisor: g.ruc_emisor,
    empresa: g.empresa,
    fechaEmision: new Date(g.created_at).toLocaleString("es-PE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    }),
    fechaInicioTraslado: new Date(g.fecha_inicio_traslado).toLocaleDateString("es-PE", {
      day: "2-digit", month: "2-digit", year: "numeric",
    }),
    motivoTraslado: g.motivo_traslado,
    modalidadTraslado: g.modalidad_traslado,
    indicadorM1L: !!imp.indicadorM1L,
    puntoPartida: PARTIDA_EMISOR,
    puntoLlegada,
    destinatario: {
      docTipo: g.cliente_doc_tipo,
      docNum: g.cliente_doc_num,
      razonSocial: g.cliente_razon_social,
    },
    comprobanteRelacionado: imp.comprobanteRelacionado || null,
    items: imp.items || [],
    pesoBrutoTotal: Number(g.peso_bruto_total) || 0,
    totalBultos: Number(g.total_bultos) || 1,
    vehiculoPlaca: g.vehiculo_placa,
    choferDocNum: g.chofer_doc_num,
    choferLicencia: g.chofer_licencia,
    qrDataUrl: await qrDataUrl(g.hash_cpe),
  });
  descargarBlob(blob, `${g.serie_numero || id}.pdf`);
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

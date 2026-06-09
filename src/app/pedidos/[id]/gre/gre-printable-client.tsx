// src/app/pedidos/[id]/gre/gre-printable-client.tsx
"use client";

import { useEffect, useRef } from "react";
import { FiPrinter, FiArrowLeft } from "react-icons/fi";

interface GrePrintableClientProps {
  guia: {
    id: string;
    rucEmisor: string;
    empresa: string;
    serieNumero: string;
    clienteDocTipo: string | null;
    clienteDocNum: string | null;
    clienteRazonSocial: string | null;
    pesoBrutoTotal: number;
    totalBultos: number;
    modalidadTraslado: string;
    motivoTraslado: string;
    indicadorM1L: boolean;
    fechaInicioTraslado: string;
    vehiculoPlaca: string | null;
    choferDocNum: string | null;
    choferLicencia: string | null;
    estado: string;
    hashCpe: string | null;
    created_at: string;
    clienteDireccion: string | null;
    clienteDistrito: string | null;
    clienteUbigeo: string;
    asesor: string;
    comprobanteRelacionado?: {
      serieNumero: string;
      tipo: string;
      ruc: string;
    } | null;
  };
  items: {
    codigo: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
  }[];
}

function motivoLabel(codigo: string): string {
  const map: Record<string, string> = {
    "01": "Venta",
    "02": "Compra",
    "03": "Venta con entrega a terceros",
    "04": "Traslado entre establecimientos de la misma empresa",
    "05": "Consignación",
    "06": "Devolución",
    "07": "Recojo de bienes transformados",
    "08": "Importación",
    "09": "Exportación",
    "13": "Otros",
    "14": "Venta sujeta a confirmación del comprador",
    "17": "Traslado de bienes para transformación",
    "18": "Recojo de bienes no transformados",
    "19": "Traslado emisor itinerante CP",
    "20": "Traslado a zona primaria",
  };
  return map[codigo] || `Código ${codigo}`;
}

function modalidadLabel(codigo: string): string {
  return codigo === "01" ? "Público" : "Privado";
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
  if (tipo === "08") return "Nota de Débito";
  return "Comprobante";
}

function unidadLabel(u: string): string {
  const up = u?.toUpperCase();
  if (up === "KGM" || up === "KG") return "KILOGRAMO";
  if (up === "NIU" || up === "UND" || up === "UNI") return "UNIDAD";
  if (up === "ZZ") return "UNIDAD";
  return up || "UNIDAD";
}

function formatCantidad(cant: number): string {
  if (cant % 1 === 0) return cant.toFixed(2);
  return cant.toString();
}

export default function GrePrintableClient({ guia, items }: GrePrintableClientProps) {
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleBeforePrint = () => {
      document.title = `GRE-${guia.serieNumero}`;
    };
    window.addEventListener("beforeprint", handleBeforePrint);

    // Auto-imprimir si el parámetro de consulta 'print' es true
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("print") === "true") {
        const timer = setTimeout(() => {
          window.print();
        }, 500);
        return () => {
          window.removeEventListener("beforeprint", handleBeforePrint);
          clearTimeout(timer);
        };
      }
    }

    return () => window.removeEventListener("beforeprint", handleBeforePrint);
  }, [guia.serieNumero]);

  // Datos del emisor según empresa
  const emisorConfig = guia.empresa === "avicola"
    ? {
        nombre: "RESURRECCION GAMARRA TONIO",
        nombreComercial: "AVÍCOLA DE TONY",
        direccion: "CAL. LAS ESMERALDAS NRO. 624 URB. BALCONCILLO",
        distrito: "LA VICTORIA",
        provincia: "LIMA",
        departamento: "LIMA",
        ubigeo: "150115",
      }
    : {
        nombre: "NEGOCIOS Y SERVICIOS TRANSAVIC S.A.C.",
        nombreComercial: "TRANSAVIC",
        direccion: "CAL. LAS ESMERALDAS NRO. 624 URB. BALCONCILLO",
        distrito: "LA VICTORIA",
        provincia: "LIMA",
        departamento: "LIMA",
        ubigeo: "150115",
      };

  const puntoPartida = `${emisorConfig.direccion} - ${emisorConfig.distrito} - ${emisorConfig.provincia} - ${emisorConfig.departamento}`;
  const puntoLlegada = guia.clienteDireccion
    ? `${guia.clienteDireccion.toUpperCase()}, ${(guia.clienteDistrito || "LIMA").toUpperCase()} - LIMA - LIMA`
    : `${(guia.clienteDistrito || "LIMA").toUpperCase()} - LIMA - LIMA`;

  // QR Code
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
    `https://e-factura.sunat.gob.pe/v1/contribuyente/gre/comprobantes/descargaqr?hashqr=${encodeURIComponent(guia.hashCpe || "")}`
  )}`;

  return (
    <div className="min-h-screen bg-slate-200 flex flex-col items-center py-6 print:bg-white print:py-0">

      {/* ── Toolbar de acciones (se oculta al imprimir) ── */}
      <div className="w-full max-w-[800px] mb-5 flex justify-between items-center print:hidden px-2 gap-3">
        <button
          onClick={() => window.close()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm"
        >
          <FiArrowLeft className="w-4 h-4" /> Cerrar
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg shadow-md transition active:scale-95"
        >
          <FiPrinter className="w-4 h-4" /> Imprimir / Descargar PDF
        </button>
      </div>

      {/* ── Documento A4 ── */}
      <div
        ref={printAreaRef}
        className="w-full max-w-[800px] bg-white shadow-xl print:shadow-none"
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "10.5px",
          color: "#111",
          lineHeight: "1.45",
          padding: "16mm 14mm 12mm 14mm",
          minHeight: "297mm",
          boxSizing: "border-box",
        }}
      >
        {/* ═══ CABECERA ═══ */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>

          {/* QR + Emisor */}
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flex: 1 }}>
            {/* QR */}
            <div style={{ flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="Código QR SUNAT"
                width={82}
                height={82}
                style={{ width: "82px", height: "82px", display: "block", border: "1px solid #ccc", padding: "2px" }}
              />
            </div>

            {/* Datos del emisor */}
            <div style={{ paddingTop: "2px" }}>
              <div style={{ fontSize: "15px", fontWeight: "bold", textTransform: "uppercase", color: "#000", letterSpacing: "-0.3px" }}>
                {emisorConfig.nombre}
              </div>
              <div style={{ fontSize: "9.5px", color: "#444", marginTop: "2px" }}>
                {emisorConfig.nombreComercial}
              </div>
              <div style={{ fontSize: "9px", color: "#555", marginTop: "8px", lineHeight: "1.5" }}>
                <span style={{ fontWeight: "bold" }}>Fecha y hora de emisión:&nbsp;</span>
                {guia.created_at}
              </div>
            </div>
          </div>

          {/* Recuadro SUNAT derecho */}
          <div style={{
            border: "1.5px solid #000",
            padding: "10px 14px",
            textAlign: "center",
            width: "220px",
            flexShrink: 0,
            borderRadius: "2px",
          }}>
            <div style={{ fontWeight: "bold", fontSize: "11px", letterSpacing: "0.2px" }}>
              RUC N° {guia.rucEmisor}
            </div>
            <div style={{ fontWeight: "bold", fontSize: "9.5px", marginTop: "6px", lineHeight: "1.4", textTransform: "uppercase" }}>
              Guía de Remisión Electrónica<br />Remitente
            </div>
            <div style={{
              fontWeight: "bold",
              fontSize: "13px",
              marginTop: "10px",
              paddingTop: "8px",
              borderTop: "1.5px solid #000",
              letterSpacing: "1px",
            }}>
              N° {guia.serieNumero}
            </div>
          </div>
        </div>

        {/* ═══ DATOS DEL TRASLADO (2 columnas) ═══ */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px", marginTop: "16px" }}>
          <tbody>
            <tr>
              <td style={{ paddingBottom: "4px", width: "50%", verticalAlign: "top" }}>
                <span style={{ fontWeight: "bold" }}>Fecha de inicio de Traslado: </span>
                {guia.fechaInicioTraslado}
              </td>
              <td style={{ paddingBottom: "4px", width: "50%", verticalAlign: "top", paddingLeft: "12px" }}>
                <span style={{ fontWeight: "bold" }}>Punto de Partida: </span>
                {puntoPartida}
              </td>
            </tr>
            <tr>
              <td style={{ paddingBottom: "4px", verticalAlign: "top" }}>
                <span style={{ fontWeight: "bold" }}>Motivo de Traslado: </span>
                {motivoLabel(guia.motivoTraslado)}
              </td>
              <td style={{ paddingBottom: "4px", verticalAlign: "top", paddingLeft: "12px" }}>
                <span style={{ fontWeight: "bold" }}>Punto de Llegada: </span>
                {puntoLlegada}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ DESTINATARIO ═══ */}
        <div style={{ fontSize: "10px", marginBottom: "4px", marginTop: "12px" }}>
          <span style={{ fontWeight: "bold" }}>Datos del Destinatario: </span>
          <span style={{ textTransform: "uppercase" }}>
            {guia.clienteRazonSocial?.toUpperCase() || "—"}
          </span>
          {guia.clienteDocNum && guia.clienteDocNum !== "0" && (
            <span>
              {" "}&mdash;{" "}{tipoDocLabel(guia.clienteDocTipo)} {guia.clienteDocNum}
            </span>
          )}
        </div>

        {/* ═══ DOCUMENTOS RELACIONADOS ═══ */}
        {guia.comprobanteRelacionado && (
          <div style={{ fontSize: "10px", marginBottom: "8px" }}>
            <span style={{ fontWeight: "bold" }}>Documentos Relacionados: </span>
            <span>
              {tipoComprobanteLabel(guia.comprobanteRelacionado.tipo)} N° {guia.comprobanteRelacionado.serieNumero}
              {" "}&mdash;{" "}RUC N° {guia.comprobanteRelacionado.ruc}
            </span>
          </div>
        )}

        {/* ═══ BIENES POR TRANSPORTAR ═══ */}
        <div style={{ fontWeight: "bold", fontSize: "10.5px", marginBottom: "5px", marginTop: "12px" }}>
          Bienes por transportar:
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9.5px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f0f0f0", borderTop: "1.5px solid #000", borderBottom: "1.5px solid #000" }}>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "32px", fontWeight: "bold" }}>N°</th>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "72px", fontWeight: "bold" }}>Bien<br />normalizado</th>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "62px", fontWeight: "bold" }}>Código<br />de Bien</th>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "62px", fontWeight: "bold" }}>Código<br />producto<br />SUNAT</th>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "62px", fontWeight: "bold" }}>Partida<br />arancelaria</th>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "58px", fontWeight: "bold" }}>Código<br />GTIN</th>
              <th style={{ padding: "4px 5px", textAlign: "left", borderRight: "1px solid #999", fontWeight: "bold" }}>Descripción Detallada</th>
              <th style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #999", width: "75px", fontWeight: "bold" }}>Unidad de<br />medida</th>
              <th style={{ padding: "4px 5px", textAlign: "right", width: "62px", fontWeight: "bold" }}>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid #bbb" }}>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>{idx + 1}</td>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>NO</td>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>-</td>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>-</td>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>-</td>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>-</td>
                <td style={{ padding: "4px 5px", textAlign: "left", borderRight: "1px solid #bbb", textTransform: "uppercase" }}>{it.descripcion}</td>
                <td style={{ padding: "4px 5px", textAlign: "center", borderRight: "1px solid #bbb" }}>{unidadLabel(it.unidad)}</td>
                <td style={{ padding: "4px 5px", textAlign: "right", fontWeight: "bold" }}>{formatCantidad(it.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Peso y bultos (texto plano, como el modelo oficial SUNAT) ── */}
        <div style={{ fontSize: "10px", marginTop: "8px" }}>
          <div><span style={{ fontWeight: "bold" }}>Unidad de Medida del Peso Bruto:</span> KGM</div>
          <div style={{ marginTop: "2px" }}><span style={{ fontWeight: "bold" }}>Peso Bruto total de la carga:</span> {guia.pesoBrutoTotal.toFixed(2)}</div>
          <div style={{ marginTop: "2px" }}><span style={{ fontWeight: "bold" }}>Total de bultos:</span> {guia.totalBultos}</div>
        </div>

        {/* ═══ DATOS DEL TRASLADO (detalles) ═══ */}
        <div style={{ fontSize: "10px", marginTop: "12px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Datos del traslado:</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ paddingBottom: "2px", width: "50%", verticalAlign: "top" }}>
                  <span style={{ fontWeight: "bold" }}>Modalidad de Traslado: </span>
                  {modalidadLabel(guia.modalidadTraslado)}
                </td>
                <td style={{ paddingBottom: "2px", width: "50%", verticalAlign: "top", paddingLeft: "12px" }}>
                  <span style={{ fontWeight: "bold" }}>Indicador de transbordo programado: </span>NO
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ paddingBottom: "2px", verticalAlign: "top" }}>
                  <span style={{ fontWeight: "bold" }}>Indicador de traslado en vehículos de categoría M1 o L: </span>
                  {guia.indicadorM1L ? "SI" : "NO"}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Datos del vehículo y conductor */}
          {(guia.vehiculoPlaca || guia.choferDocNum) && (
            <div style={{ marginTop: "6px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    {guia.vehiculoPlaca && (
                      <td style={{ paddingRight: "24px" }}>
                        <span style={{ fontWeight: "bold" }}>Vehículo (Placa): </span>
                        <span style={{ textTransform: "uppercase" }}>{guia.vehiculoPlaca}</span>
                      </td>
                    )}
                    {guia.choferDocNum && (
                      <td style={{ paddingRight: "24px" }}>
                        <span style={{ fontWeight: "bold" }}>Conductor (DNI): </span>
                        {guia.choferDocNum}
                      </td>
                    )}
                    {guia.choferLicencia && (
                      <td>
                        <span style={{ fontWeight: "bold" }}>Licencia: </span>
                        <span style={{ textTransform: "uppercase" }}>{guia.choferLicencia}</span>
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══ PIE DE PÁGINA ═══ */}
        <div style={{ marginTop: "48px" }}>
          <p style={{ fontSize: "8.5px", textAlign: "center", color: "#222", margin: 0, fontWeight: "bold" }}>
            Esta es una representación impresa sin valor tributario de la Guía de Remisión Electrónica generada en el sistema de la SUNAT. Puede verificarla utilizando su clave SOL.
          </p>
        </div>
      </div>

      {/* Estilos globales de impresión */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            background-color: #fff !important;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}

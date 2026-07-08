// src/app/dashboard/clientes-avicola/guia-avicola-modal.tsx
// Modal para compartir la GUÍA DE VENTA avícola por WhatsApp.
// Mecánica clonada de src/app/dashboard/ticket-share-modal.tsx:
// logo por empresa con cache-bust → dataURL → render off-screen del ticket →
// html-to-image (toJpeg, pixelRatio 2.5, skipFonts) → File + navigator.share.
// Extra: toggle "Con precio por kilo" / "Solo peso y total" persistido en
// localStorage (req. §8) — al cambiar se re-genera el JPEG.
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { toJpeg } from "html-to-image";
import type { GuiaAvicolaData } from "@/lib/avicola/types";
import { formatNumeroGuia } from "@/lib/correlativos";
import TicketGuiaAvicola from "./ticket-guia-avicola";
import { FiDownload, FiShare2, FiX, FiLoader, FiCheck } from "react-icons/fi";

/** Clave de localStorage con la última opción elegida por el usuario. */
const CLAVE_OPCION_GUIA = "transavic_avicola_opcion_guia";

/** Lee la opción guardada; default = true (con precio por kilo). */
function leerOpcionGuardada(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CLAVE_OPCION_GUIA) !== "solo_peso";
  } catch {
    return true;
  }
}

function guardarOpcion(conPrecio: boolean) {
  try {
    window.localStorage.setItem(
      CLAVE_OPCION_GUIA,
      conPrecio ? "con_precio" : "solo_peso"
    );
  } catch {
    // Sin localStorage (modo privado, etc.) — no pasa nada, solo no persiste.
  }
}

interface GuiaAvicolaModalProps {
  data: GuiaAvicolaData;
  onClose: () => void;
}

export default function GuiaAvicolaModal({ data, onClose }: GuiaAvicolaModalProps) {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoListo, setLogoListo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [imagenBlob, setImagenBlob] = useState<Blob | null>(null);
  const [incluirPrecios, setIncluirPrecios] = useState<boolean>(leerOpcionGuardada);
  const [puedeCompartir, setPuedeCompartir] = useState(false);

  const exportRef = useRef<HTMLDivElement>(null);

  const numeroFormateado = formatNumeroGuia(data.numero_guia);
  const nombreArchivo = `guia-avicola-${numeroFormateado}.jpg`;

  const generarImagen = useCallback(async () => {
    const ticketElement = exportRef.current;
    if (!ticketElement) return;

    try {
      const dataUrl = await toJpeg(ticketElement, {
        quality: 0.95,
        pixelRatio: 2.5,
        backgroundColor: "#ffffff",
        // Forzamos que no use caché interno de la librería
        cacheBust: true,
        skipFonts: true,
      });
      setImagenUrl(dataUrl);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      setImagenBlob(blob);
    } catch (error) {
      console.error("Error al generar la imagen de la guía:", error);
      alert("Hubo un error al generar la imagen. Inténtalo de nuevo.");
      onClose();
    } finally {
      setCargando(false);
    }
  }, [onClose]);

  // 1. Cargar el logo de la empresa con cache-bust y convertirlo a dataURL
  //    (igual que ticket-share-modal: precarga en un Image para asegurar
  //    que ya está decodificado antes de fotografiar el ticket).
  useEffect(() => {
    const cargarYPrepararLogo = async () => {
      setLogoDataUrl(null);
      setLogoListo(false);
      setCargando(true);

      try {
        const timestamp = new Date().getTime();
        const logoPath = `${
          data.cliente.empresa === "Transavic" ? "/transavic.jpg" : "/avicola.jpg"
        }?v=${timestamp}`;

        const response = await fetch(logoPath);
        if (!response.ok) throw new Error("No se pudo cargar el logo");

        const blob = await response.blob();
        const reader = new FileReader();

        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const img = new Image();
          img.onload = () => {
            setLogoDataUrl(dataUrl);
            setLogoListo(true);
          };
          img.onerror = () => {
            console.error("Error al precargar el logo en el objeto Image.");
            onClose();
          };
          img.src = dataUrl;
        };

        reader.readAsDataURL(blob);
      } catch (error) {
        console.error("Error al obtener el logo:", error);
        onClose();
      }
    };

    cargarYPrepararLogo();
  }, [data.cliente.empresa, onClose]);

  // 2. (Re)generar el JPEG cuando el logo está listo Y cuando cambia la
  //    opción con/sin precio (el ticket off-screen ya se re-renderizó).
  useEffect(() => {
    if (logoDataUrl && logoListo) {
      requestAnimationFrame(() => {
        generarImagen();
      });
    }
  }, [logoDataUrl, logoListo, incluirPrecios, generarImagen]);

  // 3. ¿El navegador puede compartir el archivo? (si no, se oculta el botón
  //    verde y queda solo "Descargar").
  useEffect(() => {
    if (
      !imagenBlob ||
      typeof navigator === "undefined" ||
      !navigator.share ||
      !navigator.canShare
    ) {
      setPuedeCompartir(false);
      return;
    }
    const archivo = new File([imagenBlob], nombreArchivo, { type: "image/jpeg" });
    setPuedeCompartir(navigator.canShare({ files: [archivo] }));
  }, [imagenBlob, nombreArchivo]);

  const cambiarOpcion = (conPrecio: boolean) => {
    if (conPrecio === incluirPrecios) return;
    guardarOpcion(conPrecio);
    setCargando(true);
    setIncluirPrecios(conPrecio);
  };

  const descargarImagen = () => {
    if (!imagenBlob) return;
    const url = URL.createObjectURL(imagenBlob);
    const link = document.createElement("a");
    link.download = nombreArchivo;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const compartirImagen = async () => {
    if (!imagenBlob || !navigator.share) return;
    const archivo = new File([imagenBlob], nombreArchivo, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try {
        await navigator.share({
          files: [archivo],
          title: `Guía de venta ${data.cliente.empresa}`,
          text: `Guía de venta N.º ${numeroFormateado} — ${data.cliente.nombre}`,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Error al compartir:", error);
        }
      }
    } else {
      alert("Tu navegador no soporta compartir archivos. Descarga la imagen.");
    }
  };

  const claseSegmentoActivo =
    "flex-1 py-3 px-2 text-sm sm:text-base font-bold bg-red-600 text-white";
  const claseSegmentoInactivo =
    "flex-1 py-3 px-2 text-sm sm:text-base font-semibold bg-white text-gray-700 hover:bg-gray-50";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
        {/* Header sticky: el botón X queda SIEMPRE visible aunque haya scroll. */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800">
            Guía de venta N.º {numeroFormateado}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-gray-500 hover:text-gray-800"
          >
            <FiX size={24} />
          </button>
        </div>

        <div className="px-6 pb-6 pt-4">
          {/* Toggle segmentado: con precio por kilo / solo peso y total */}
          <div
            className="flex rounded-lg border-2 border-gray-300 overflow-hidden mb-4"
            role="group"
            aria-label="Formato de la guía"
          >
            <button
              type="button"
              onClick={() => cambiarOpcion(true)}
              disabled={cargando}
              className={incluirPrecios ? claseSegmentoActivo : claseSegmentoInactivo}
            >
              Con precio por kilo
            </button>
            <button
              type="button"
              onClick={() => cambiarOpcion(false)}
              disabled={cargando}
              className={!incluirPrecios ? claseSegmentoActivo : claseSegmentoInactivo}
            >
              Solo peso y total
            </button>
          </div>

          {/* Ticket off-screen que se fotografía con html-to-image */}
          <div className="fixed top-0 left-[-9999px] z-[-1]">
            <div ref={exportRef} className="w-[500px]">
              <TicketGuiaAvicola
                data={data}
                incluirPrecios={incluirPrecios}
                logoDataUrl={logoDataUrl}
              />
            </div>
          </div>

          {/* Vista previa */}
          <div className="min-h-[300px] flex justify-center items-center">
            {cargando && (
              <div className="text-center">
                <FiLoader className="animate-spin text-red-600 mx-auto" size={40} />
                <p className="mt-2 text-gray-600">Generando imagen de la guía...</p>
              </div>
            )}
            {!cargando && imagenUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imagenUrl}
                alt="Vista previa de la guía de venta"
                className="max-w-full h-auto rounded-md border"
              />
            )}
          </div>

          {/* Botones de acción */}
          {!cargando && imagenBlob && (
            <div className="mt-6 flex flex-col gap-3">
              {puedeCompartir && (
                <button
                  onClick={compartirImagen}
                  className="w-full bg-green-500 text-white font-bold py-4 px-4 text-lg rounded-md hover:bg-green-600 transition-colors flex items-center justify-center"
                >
                  <FiShare2 className="mr-2" size={22} /> Enviar por WhatsApp
                </button>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={descargarImagen}
                  className="flex-1 bg-white border-2 border-gray-300 text-gray-800 font-bold py-3 px-4 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center"
                >
                  <FiDownload className="mr-2" /> Descargar
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 bg-gray-800 text-white font-bold py-3 px-4 rounded-md hover:bg-gray-900 transition-colors flex items-center justify-center"
                >
                  <FiCheck className="mr-2" /> Listo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

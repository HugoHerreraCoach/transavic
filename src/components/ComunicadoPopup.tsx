// src/components/ComunicadoPopup.tsx
"use client";

import { useEffect, useState } from "react";
import { FiX, FiCheckCircle } from "react-icons/fi";

interface ComunicadoPendiente {
  id: string;
  titulo: string;
  cuerpo: string;
  creado_por: string;
  created_at: string;
  imagenes: Array<{ id: string }>;
}

const POLL_INTERVAL_MS = 30_000;

export default function ComunicadoPopup() {
  const [pendientes, setPendientes] = useState<ComunicadoPendiente[]>([]);
  const [visible, setVisible] = useState(false);
  const [lightboxImgId, setLightboxImgId] = useState<string | null>(null);
  const [marcandoLeido, setMarcandoLeido] = useState(false);
  const [cerradosTemporales, setCerradosTemporales] = useState<string[]>([]);

  // El comunicado activo es siempre el primero en la cola (el más antiguo pendiente)
  const activo = pendientes[0] || null;

  const fetchPendientes = async () => {
    try {
      const res = await fetch("/api/comunicados/pendientes");
      if (!res.ok) return;
      const data = (await res.json()) as ComunicadoPendiente[];
      
      // Si la cola cambió o hay nuevos elementos, actualizamos
      setPendientes(data);
    } catch {
      // Silencioso (no crítico)
    }
  };

  useEffect(() => {
    fetchPendientes();
    const timer = setInterval(fetchPendientes, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Mostrar el popup si hay un comunicado activo y no está oculto
  useEffect(() => {
    if (activo && !cerradosTemporales.includes(activo.id)) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [activo, cerradosTemporales]);

  const handleMarcarLeido = async () => {
    if (!activo || marcandoLeido) return;
    setMarcandoLeido(true);
    try {
      const res = await fetch(`/api/comunicados/${activo.id}/leer`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("No se pudo marcar como leído");

      // Remover el primero localmente
      setPendientes((prev) => prev.slice(1));
    } catch (error) {
      console.error("Error al marcar leído:", error);
    } finally {
      setMarcandoLeido(false);
    }
  };

  const handleCerrarTemporal = () => {
    // Registramos que este comunicado fue cerrado temporalmente en esta navegación
    if (activo) {
      setCerradosTemporales((prev) => [...prev, activo.id]);
    }
    setVisible(false);
  };

  if (!activo || !visible) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3 sm:p-6 anim-fade">
        <div
          className="relative w-full max-w-xl rounded-2xl bg-white p-5 sm:p-6 shadow-2xl anim-modal border border-gray-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Botón Cerrar (Temporal) */}
          <button
            onClick={handleCerrarTemporal}
            aria-label="Cerrar temporalmente"
            className="absolute right-3 top-3 z-10 rounded-full bg-gray-100 p-2 text-gray-450 hover:text-gray-900 hover:bg-gray-200 active:scale-95 transition cursor-pointer"
          >
            <FiX size={18} />
          </button>

          {/* Icono / Header decorativo */}
          <div className="flex items-center gap-3 mb-4">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-50 text-red-600">
              📢
            </span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">
                Comunicado Oficial
              </span>
              <p className="text-xs text-gray-400">
                De: {activo.creado_por}
              </p>
            </div>
          </div>

          {/* Título y Cuerpo */}
          <div className="space-y-3.5 mb-5">
            <h2 className="text-lg font-bold text-gray-800 leading-snug pr-8">
              {activo.titulo}
            </h2>
            <div className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap max-h-60 overflow-y-auto bg-gray-50/50 p-4 rounded-xl border border-gray-100/30 scrollbar-thin">
              {activo.cuerpo}
            </div>
          </div>

          {/* Imágenes adjuntas si las hay */}
          {activo.imagenes && activo.imagenes.length > 0 && (
            <div className="mb-5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-2">
                Imágenes adjuntas (toca para ampliar)
              </span>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {activo.imagenes.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => setLightboxImgId(img.id)}
                    className="relative flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-gray-150 hover:opacity-90 active:scale-95 transition cursor-pointer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/comunicado-imagenes/${img.id}`}
                      alt="Adjunto de comunicado"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex gap-2">
            <button
              onClick={handleMarcarLeido}
              disabled={marcandoLeido}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 text-white rounded-xl font-bold shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {marcandoLeido ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <FiCheckCircle size={16} />
                  Entendido / Marcar como leído
                </>
              )}
            </button>
            <button
              onClick={handleCerrarTemporal}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold transition active:scale-95 cursor-pointer text-sm"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox para ampliar imagen */}
      {lightboxImgId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 anim-fade"
          onClick={() => setLightboxImgId(null)}
        >
          <button
            onClick={() => setLightboxImgId(null)}
            className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full shadow-lg active:scale-90 transition cursor-pointer"
          >
            <FiX size={24} />
          </button>
          <div
            className="max-w-4xl max-h-[85vh] overflow-hidden rounded-xl shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/comunicado-imagenes/${lightboxImgId}`}
              alt="Adjunto ampliado"
              className="w-full h-auto max-h-[85vh] object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </>
  );
}

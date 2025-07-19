// src/app/dashboard/ticket-share-modal.tsx (Corrección Final)

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { toJpeg } from 'html-to-image';
import { Pedido } from '@/lib/types';
import TicketPedido, { TicketDisplayData } from '@/components/TicketPedido';
import { FiDownload, FiShare2, FiX, FiLoader } from 'react-icons/fi';

interface TicketShareModalProps {
  pedido: Pedido;
  onClose: () => void;
}

export default function TicketShareModal({ pedido, onClose }: TicketShareModalProps) {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoListo, setLogoListo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [imagenBlob, setImagenBlob] = useState<Blob | null>(null);

  const exportTicketRef = useRef<HTMLDivElement>(null);
  
  // ✅ CORRECCIÓN FINAL AQUÍ
  // Añadimos un fallback para 'tipo_cliente' igual que hicimos con 'distrito'.
  const ticketData: TicketDisplayData = {
      ...pedido,
      distrito: pedido.distrito ?? 'No especificado',
      tipo_cliente: pedido.tipo_cliente ?? 'Frecuente', // Fallback para tipo_cliente
      fecha: pedido.fecha_pedido
  };

  const generarImagen = useCallback(async () => {
    const ticketElement = exportTicketRef.current;
    if (!ticketElement || !logoDataUrl || !logoListo) return;

    setCargando(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const dataUrl = await toJpeg(ticketElement, { quality: 0.95, pixelRatio: 2.5, backgroundColor: '#ffffff', cacheBust: true });
      setImagenUrl(dataUrl);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      setImagenBlob(blob);
    } catch (error) {
      console.error('Error al generar la imagen:', error);
      alert('Hubo un error al generar la imagen. Inténtalo de nuevo.');
      onClose();
    } finally {
      setCargando(false);
    }
  }, [logoDataUrl, logoListo, onClose]);

  useEffect(() => {
    const cargarLogo = async () => {
      setLogoListo(false);
      try {
        const logoPath = pedido.empresa === 'Transavic' ? '/transavic.jpg' : '/avicola.jpg';
        const response = await fetch(logoPath);
        if (!response.ok) throw new Error('No se pudo cargar el logo');
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => setLogoDataUrl(reader.result as string);
        reader.readAsDataURL(blob);
      } catch (error) {
        console.error("Error al obtener el logo:", error);
        onClose();
      }
    };
    cargarLogo();
  }, [pedido.empresa, onClose]);

  useEffect(() => {
    if (logoDataUrl && logoListo) {
      generarImagen();
    }
  }, [logoDataUrl, logoListo, generarImagen]);

  const descargarImagen = () => {
    if (!imagenBlob) return;
    const url = URL.createObjectURL(imagenBlob);
    const link = document.createElement('a');
    link.download = `pedido-${pedido.cliente.trim().replace(/\s+/g, '-')}.jpg`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const compartirImagen = async () => {
    if (!imagenBlob || !navigator.share) return;
    const file = new File([imagenBlob], `pedido-${pedido.id}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Pedido ${pedido.empresa}`, text: `Pedido para: ${pedido.cliente}` });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error('Error al compartir:', error);
      }
    } else {
        alert('Tu navegador no soporta compartir archivos. Por favor, descarga la imagen.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800">
            <FiX size={24} />
        </button>

        <div className="fixed top-0 left-[-9999px] z-[-1]">
          <div className="w-[500px]">
            <TicketPedido
              datos={ticketData}
              referencia={exportTicketRef}
              logoDataUrl={logoDataUrl}
              onLogoReady={() => setLogoListo(true)}
            />
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-800 mb-4">Compartir Ticket</h2>

        <div className="min-h-[300px] flex justify-center items-center">
            {cargando && (
                <div className='text-center'>
                    <FiLoader className="animate-spin text-blue-600 mx-auto" size={40} />
                    <p className="mt-2 text-gray-600">Generando imagen del ticket...</p>
                </div>
            )}
            {!cargando && imagenUrl && <img src={imagenUrl} alt="Vista previa del pedido" className="max-w-full h-auto rounded-md border" />}
        </div>

        {!cargando && imagenBlob && (
            <div className="mt-6 flex flex-col sm:flex-row gap-4">
              <button onClick={descargarImagen} className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center"> <FiDownload className="mr-2" /> Descargar </button>
              <button onClick={compartirImagen} disabled={!navigator.share} className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-gray-400"> <FiShare2 className="mr-2" /> WhatsApp </button>
            </div>
        )}
      </div>
    </div>
  );
}
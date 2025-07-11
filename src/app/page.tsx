'use client';

import { useState, useRef, useEffect, Ref } from 'react';
import { toPng } from 'html-to-image';
import {
  FiUser,
  FiPhone,
  FiMapPin,
  FiClipboard,
  FiClock,
  FiEdit2,
  FiDownload,
  FiShare2,
  FiCheckSquare,
  FiFileText,
  FiStar,
  FiCreditCard,
} from 'react-icons/fi';

const datosIniciales = {
    cliente: '',
    whatsapp: '',
    direccion: '',
    tipoCliente: 'Frecuente',
    estadoPago: 'Por pagar',
    detalle: '',
    horaEntrega: 'Lo antes posible',
    notas: '',
};

type TicketData = typeof datosIniciales;

interface TicketPedidoProps {
  datos: TicketData;
  referencia?: Ref<HTMLDivElement>;
}

// --- El Componente del Ticket (CON LA CORRECCIÓN DE HTML) ---
const TicketPedido: React.FC<TicketPedidoProps> = ({ datos, referencia }) => (
  <div
    ref={referencia}
    className="bg-white p-8 border-2 border-gray-300 rounded-lg text-black w-full"
  >
    <div className="text-center pb-4 border-b-2 border-dashed">
      <h1 className="text-3xl font-bold text-red-600">PEDIDO TRANSAVIC</h1>
    </div>
    <div className="mt-6 space-y-4 text-lg">

      {/* **CAMBIO: Reemplazamos <p> por <div> para un HTML válido** */}
      <div className="flex items-start">
        <FiUser className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">Cliente:</span>
          <span className="break-words">{datos.cliente}</span>
        </div>
      </div>

      <div className="flex items-start">
        <FiPhone className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">WhatsApp:</span>
          <span className="break-words">{datos.whatsapp}</span>
        </div>
      </div>

      <div className="flex items-start">
        <FiMapPin className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">Dirección:</span>
          <span className="break-words">{datos.direccion}</span>
        </div>
      </div>

      <div className="flex items-start">
        <FiStar className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">Tipo:</span>
          <span className="break-words">{datos.tipoCliente}</span>
        </div>
      </div>

      <div className="flex items-start">
        <FiCreditCard className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">Pago:</span>
          <span className={`font-bold break-words ${datos.estadoPago === 'Pagado' ? 'text-green-600' : 'text-orange-500'}`}>
              {datos.estadoPago}
          </span>
        </div>
      </div>

      <div className="pt-4 border-t border-dashed">
        <div className="flex items-start">
          <FiClipboard className="mr-3 text-gray-600 mt-1 flex-shrink-0" size={20} />
          <div className="flex-1 min-w-0">
            <span className="font-semibold mr-2">Detalle:</span>
            <span className="whitespace-pre-wrap break-words">{datos.detalle}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start">
        <FiClock className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">Hora:</span>
          <span className="break-words">{datos.horaEntrega}</span>
        </div>
      </div>
      
      <div className="flex items-start">
        <FiEdit2 className="mr-3 text-gray-600 mt-1 flex-shrink-0" size={20} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">Notas:</span>
          <span className="whitespace-pre-wrap break-words">{datos.notas}</span>
        </div>
      </div>
    </div>
  </div>
);

// --- La Página Principal ---
export default function Home() {
  const [formDatos, setFormDatos] = useState<TicketData>(datosIniciales);
  const [ticketDatos, setTicketDatos] = useState<TicketData>(datosIniciales);
  const [showTicket, setShowTicket] = useState(false);
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const exportTicketRef = useRef<HTMLDivElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormDatos({ ...formDatos, [e.target.name]: e.target.value });
  };

  useEffect(() => {
    if (!cargando) return;
    const generar = async () => {
      if (!exportTicketRef.current) return;
      try {
        const dataUrl = await toPng(exportTicketRef.current, {
            quality: 1.0,
            pixelRatio: 2,
            width: exportTicketRef.current.offsetWidth,
        });
        setImagenUrl(dataUrl);
      } catch (error) {
        console.error('Error al generar la imagen:', error);
        alert('Hubo un error al generar la imagen. Inténtalo de nuevo.');
      } finally {
        setCargando(false);
      }
    };
    setTimeout(generar, 50);
  }, [ticketDatos, cargando]);

  const handleGenerarClick = () => {
    setShowTicket(true);
    setImagenUrl(null);
    setCargando(true);
    setTicketDatos(formDatos);
  };

  const descargarImagen = () => {
    if (!imagenUrl) return;
    const link = document.createElement('a');
    link.download = `pedido-transavic-${formDatos.cliente.trim().replace(/\s+/g, '-') || 'cliente'}.png`;
    link.href = imagenUrl;
    link.click();
  };

  const compartirImagen = async () => {
    if (!imagenUrl) return;
    try {
      const response = await fetch(imagenUrl);
      const blob = await response.blob();
      const file = new File([blob], `pedido.png`, { type: blob.type });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Pedido TRANSAVIC',
          text: `Nuevo pedido para: ${formDatos.cliente}`,
        });
      } else {
        alert('Tu navegador no permite compartir archivos directamente.');
      }
    } catch (error) {
      console.error('Error al compartir:', error);
      alert('No se pudo compartir. Descarga la imagen para enviarla.');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-2 sm:p-8">
      {/* --- TICKET OCULTO PARA EXPORTACIÓN --- */}
      <div className="absolute top-0 left-[-9999px] pointer-events-none opacity-0">
        <div className="w-[500px] bg-white">
            <TicketPedido datos={ticketDatos} referencia={exportTicketRef} />
        </div>
      </div>

      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
        {/* --- COLUMNA IZQUIERDA: FORMULARIO --- */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg h-fit">
          <div className="flex items-center mb-6">
            <FiFileText className="text-red-600 mr-3" size={30} />
            <h1 className="text-2xl font-bold text-gray-800">Generador de Pedidos</h1>
          </div>
          <form className="space-y-4">
            <input type="text" name="cliente" value={formDatos.cliente} placeholder="Nombre del Cliente" onChange={handleChange} className="w-full p-3 border rounded-md" />
            <input type="text" name="whatsapp" value={formDatos.whatsapp} placeholder="Número de WhatsApp" onChange={handleChange} className="w-full p-3 border rounded-md" />
            <input type="text" name="direccion" value={formDatos.direccion} placeholder="Dirección de Entrega" onChange={handleChange} className="w-full p-3 border rounded-md" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de cliente</label>
                    <select name="tipoCliente" value={formDatos.tipoCliente} onChange={handleChange} className="w-full p-3 border rounded-md bg-white">
                        <option>Frecuente</option>
                        <option>Nuevo</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Estado de pago</label>
                    <select name="estadoPago" value={formDatos.estadoPago} onChange={handleChange} className="w-full p-3 border rounded-md bg-white">
                        <option>Por pagar</option>
                        <option>Pagado</option>
                    </select>
                </div>
            </div>
            <textarea name="detalle" value={formDatos.detalle} placeholder="Detalle del Pedido (Ej: 2 pollos enteros...)" rows={4} onChange={handleChange} className="w-full p-3 border rounded-md"></textarea>
            <input type="text" name="horaEntrega" value={formDatos.horaEntrega} placeholder="Horario de Entrega" onChange={handleChange} className="w-full p-3 border rounded-md" />
            <textarea name="notas" value={formDatos.notas} placeholder="Observaciones (Ej: Tocar el timbre...)" rows={3} onChange={handleChange} className="w-full p-3 border rounded-md"></textarea>
            <button
              type="button"
              onClick={handleGenerarClick}
              disabled={cargando}
              className="w-full bg-red-600 text-white font-bold py-3 px-4 rounded-md hover:bg-red-700 transition-colors disabled:bg-gray-400 flex items-center justify-center"
            >
              <FiCheckSquare className="mr-2" />
              {cargando ? 'Generando...' : 'Generar Pedido'}
            </button>
          </form>
        </div>

        {/* --- COLUMNA DERECHA: VISTA PREVIA Y ACCIONES --- */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg flex flex-col items-center">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Vista Previa del Ticket</h2>
          <div className="w-full max-w-md">
            {showTicket ? (
                <>
                    {imagenUrl && !cargando && (
                        <p className="text-center text-green-600 font-semibold mb-4 animate-pulse">
                        ¡Imagen generada con éxito!
                        </p>
                    )}
                    <TicketPedido datos={ticketDatos} />
                </>
            ) : (
                <div className="w-full border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center min-h-[480px]">
                    <p className="text-gray-400">El ticket aparecerá aquí</p>
                </div>
            )}
          </div>
          <div className="mt-6 w-full max-w-md">
            <div className="flex flex-col sm:flex-row gap-4">
              <button onClick={descargarImagen} disabled={!imagenUrl || cargando} className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center disabled:bg-blue-300 disabled:cursor-not-allowed">
                <FiDownload className="mr-2" /> Descargar
              </button>
              <button onClick={compartirImagen} disabled={!imagenUrl || cargando} className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-green-300 disabled:cursor-not-allowed">
                <FiShare2 className="mr-2" /> WhatsApp
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
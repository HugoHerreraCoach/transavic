// src/components/PedidoForm.tsx

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { toJpeg } from 'html-to-image';
import {  FiEdit2, FiDownload, FiShare2, FiCheckSquare, FiFileText, FiRotateCcw, FiSend } from 'react-icons/fi';
import MapInput from '@/components/MapInput';
import { User } from '@/lib/types';
import { formatFechaForTicket } from '@/lib/utils';
import TicketPedido from '@/components/TicketPedido';

type TicketData = {
  cliente: string;
  whatsapp: string;
  direccion: string;
  distrito: string;
  tipoCliente: string;
  detalle: string;
  horaEntrega: string;
  notas: string;
  empresa: string;
  fecha: string;
  latitude: number | null;
  longitude: number | null;
  asesorId: string;
  asesor_name?: string | null;
};

const getTodayString = () => new Date().toISOString().split('T')[0]; 
const datosIniciales: TicketData = { cliente: '', whatsapp: '', direccion: '', distrito: 'La Victoria', tipoCliente: 'Frecuente', detalle: '', horaEntrega: '', notas: '', empresa: 'Transavic', fecha: getTodayString(), latitude: null, longitude: null, asesorId: '' };
type AppState = 'editing' | 'previewing' | 'confirmed';



const distritos = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];


export default function PedidoForm({ asesores }: { asesores: User[] }) {
  const [appState, setAppState] = useState<AppState>('editing');
  const [formDatos, setFormDatos] = useState<TicketData>({
    ...datosIniciales,
    asesorId: asesores.length > 0 ? asesores[0].id : ''
  });
  const [ticketDatos, setTicketDatos] = useState<TicketData>(datosIniciales);
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [imagenBlob, setImagenBlob] = useState<Blob | null>(null);
  const [cargandoImagen, setCargandoImagen] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [cargandoLogo, setCargandoLogo] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof TicketData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoListo, setLogoListo] = useState(false);
  const [pendienteGeneracion, setPendienteGeneracion] = useState(false);
  const [triggerFocus, setTriggerFocus] = useState<boolean>(false);

  const exportTicketRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const empresaSelectorRef = useRef<HTMLDivElement>(null);
  const clienteInputRef = useRef<HTMLInputElement>(null);

  const cargarYEstablecerLogo = useCallback(async (empresa: string) => {
    setCargandoLogo(true);
    setLogoDataUrl(null);
    setLogoListo(false);
    try {
      const timestamp = new Date().getTime();
      const logoPath = empresa === 'Transavic' ? `/transavic.jpg?v=${timestamp}` : `/avicola.jpg?v=${timestamp}`;
      const response = await fetch(logoPath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Error al cargar imagen: ${response.status}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setLogoDataUrl(dataUrl);
        setCargandoLogo(false);
        const img = new Image();
        img.onload = () => setLogoListo(true);
        img.onerror = (error) => {
          console.error("Error al precargar imagen:", error);
          setCargandoLogo(false);
        };
        img.src = dataUrl;
      };
      reader.onerror = (error) => {
        console.error("Error en FileReader:", error);
        setCargandoLogo(false);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Error al obtener el logo:", error);
      setCargandoLogo(false);
    }
  }, []);

  useEffect(() => {
    cargarYEstablecerLogo(formDatos.empresa);
  }, [formDatos.empresa, cargarYEstablecerLogo]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        cargarYEstablecerLogo(formDatos.empresa);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [cargarYEstablecerLogo, formDatos.empresa]);

  const handleLogoReady = useCallback(() => {
    setLogoListo(true);
  }, []);

  const generarImagen = useCallback(async (): Promise<void> => {
    const ticketElement = exportTicketRef.current;
    if (!ticketElement || !logoDataUrl || !logoListo) return;

    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const dataUrl = await toJpeg(ticketElement, {
        quality: 0.95,
        pixelRatio: 2.5,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipFonts: true, // Evita problemas de CORS con las fuentes de Google Maps
      });
      setImagenUrl(dataUrl);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      setImagenBlob(blob);
    } catch (error) {
      console.error('Error al generar la imagen:', error);
      alert('Hubo un error al generar la imagen. Inténtalo de nuevo.');
      setAppState('editing');
    } finally {
      setPendienteGeneracion(false);
      setCargandoImagen(false);
    }
  }, [logoDataUrl, logoListo]);

  useEffect(() => {
    if (pendienteGeneracion && logoListo && logoDataUrl && appState === 'previewing') {
      generarImagen();
    }
  }, [pendienteGeneracion, logoListo, logoDataUrl, appState, generarImagen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    let finalValue = value;
    if (name === 'whatsapp') {
      // Al pegar, elimina espacios, el signo '+' y cualquier otro carácter que no sea un número.
      finalValue = value.replace(/[^0-9]/g, '');
    }
    setFormDatos(prev => ({ ...prev, [name]: finalValue }));
    if (errors[name as keyof TicketData]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleEmpresaChange = (empresa: string) => {
    setFormDatos(prev => ({ ...prev, empresa }));
  };

  const validateForm = () => {
    const newErrors: Partial<Record<keyof TicketData, string>> = {};
    if (!ticketDatos.cliente?.trim()) newErrors.cliente = 'El nombre del cliente es obligatorio.';
    if (!ticketDatos.detalle?.trim()) newErrors.detalle = 'El detalle del pedido es obligatorio.';
    if (!ticketDatos.whatsapp?.trim()) {
      newErrors.whatsapp = 'El número de WhatsApp es obligatorio.';
    } else if (!/^[0-9]+$/.test(ticketDatos.whatsapp.trim())) {
      newErrors.whatsapp = 'El número de WhatsApp solo debe contener dígitos numéricos.';
    }

    if (!ticketDatos.direccion?.trim()) {
      newErrors.direccion = 'La dirección es obligatoria.';
    }
    return newErrors;
  };

  const handleLocationChange = (lat: number, lng: number) => {
    setFormDatos(prev => ({ ...prev, latitude: lat, longitude: lng }));
  };

  const handleGenerarClick = () => {
    setErrors({}); 
    const fechaFormateadaParaTicket = formatFechaForTicket(formDatos.fecha);

    const asesorSeleccionado = asesores.find(asesor => asesor.id === formDatos.asesorId);
    const nombreAsesor = asesorSeleccionado ? asesorSeleccionado.name : null;

    setTicketDatos({ 
      ...formDatos, 
      fecha: fechaFormateadaParaTicket,
      asesor_name: nombreAsesor 
    });

    setCargandoImagen(true);
    setAppState('previewing');
    if (logoListo && logoDataUrl) {
      setPendienteGeneracion(true);
    } else {
      setPendienteGeneracion(true);
    }
  };

  const handleCambiarDatos = () => {
    setAppState('editing');
    setImagenUrl(null);
    setImagenBlob(null);
    setPendienteGeneracion(false);
  };

  const handleConfirmarPedido = async () => {
    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setAppState('editing');
      formRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (!imagenBlob) {
      alert("La imagen del ticket aún no se ha generado. Por favor, espera un momento.");
      return;
    }

    setIsSubmitting(true);
    try {

      // con el formato correcto (YYYY-MM-DD) que está en formDatos.
      const payloadParaApi = {
        ...ticketDatos,
        fecha: formDatos.fecha, 
      };

      const response = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadParaApi),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error recibido de la API:', errorData);
        const friendlyErrorMessage = errorData.error ? (typeof errorData.error === 'object' ? Object.values(errorData.error).flat().join(' ') : errorData.error) : 'Error al registrar.';
        throw new Error(friendlyErrorMessage);
      }
      setAppState('confirmed');
    } catch (error) {
      console.error('Fallo al confirmar el pedido:', error);
      alert(`No se pudo registrar el pedido: ${error instanceof Error ? error.message : 'Un error desconocido ocurrió.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNuevoPedido = () => {
    const empresaActual = formDatos.empresa;
    const fechaActual = getTodayString();
    const primerAsesorId = asesores.length > 0 ? asesores[0].id : '';
    const nuevoEstadoFormulario = {
      ...datosIniciales,
      empresa: empresaActual,
      fecha: fechaActual,
      asesorId: primerAsesorId, // Se asegura de que el asesor tenga un ID válido
    };
    setFormDatos(nuevoEstadoFormulario);
    setTicketDatos(datosIniciales);
    setImagenUrl(null);
    setImagenBlob(null);
    setPendienteGeneracion(false);
    setAppState('editing');
    setErrors({});
    setTriggerFocus(true);
  };

  useEffect(() => {
    if (triggerFocus) {
      clienteInputRef.current?.focus({ preventScroll: true });
      formRef.current?.scrollIntoView({ behavior: 'smooth' });

      setTriggerFocus(false);
    }
  }, [triggerFocus]);

  const descargarImagen = () => {
    if (!imagenBlob) return;
    const url = URL.createObjectURL(imagenBlob);
    const link = document.createElement('a');
    const fileName = `pedido-${ticketDatos.empresa.toLowerCase()}-${ticketDatos.cliente.trim().replace(/\s+/g, '-') || 'cliente'}.jpg`;
    link.download = fileName;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const compartirImagen = async (): Promise<void> => {
    if (!imagenBlob) {
      alert('El archivo aún no está listo. Por favor, espera un momento.');
      return;
    }
    const file = new File([imagenBlob], `pedido.jpg`, { type: 'image/jpeg' });
    if (navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Pedido ${ticketDatos.empresa}`, text: `Nuevo pedido para: ${ticketDatos.cliente}` });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error('Error al compartir:', error);
      }
    } else {
      alert('Tu navegador no soporta compartir archivos. Por favor, descarga la imagen y compártela manualmente.');
    }
  };

  const puedeGenerarPedido = !cargandoLogo && logoListo;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-2 sm:p-8">
      {/* Div oculto para generar la imagen, posicionado fuera de la pantalla para no afectar el layout */}
      <div className="fixed top-0 left-[-9999px] z-[-1] pointer-events-none">
        <div className="w-[500px] bg-white">
          <TicketPedido
            datos={ticketDatos}
            referencia={exportTicketRef}
            logoDataUrl={logoDataUrl}
            onLogoReady={handleLogoReady}
          />
        </div>
      </div>

      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
        <div className="bg-white p-6 rounded-xl shadow-lg h-fit">
          <div className="flex items-center mb-6">
            <FiFileText className="text-red-600 mr-3" size={30} />
            <h1 className="text-2xl font-bold text-gray-800">Datos del Pedido</h1>
          </div>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <fieldset disabled={appState !== 'editing'} className="space-y-4">
              <div ref={empresaSelectorRef}>
                <label className="block text-base font-medium text-gray-800 mb-2 text-center">Selecciona la empresa:</label>
                <div className="flex justify-center items-center gap-4">
                  <div
                    className={`p-2 border-2 rounded-lg transition-all duration-200 ${formDatos.empresa === 'Transavic' ? 'border-red-600 scale-105' : 'border-transparent'} ${appState !== 'editing' ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                    onClick={() => appState === 'editing' && handleEmpresaChange('Transavic')}
                  >
                    <img src="/transavic.jpg" alt="Logo de Transavic" className="h-20 w-auto object-contain" />
                  </div>
                  <div
                    className={`p-2 border-2 rounded-lg transition-all duration-200 ${formDatos.empresa === 'Avícola de Tony' ? 'border-red-600 scale-105' : 'border-transparent'} ${appState !== 'editing' ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                    onClick={() => appState === 'editing' && handleEmpresaChange('Avícola de Tony')}
                  >
                    <img src="/avicola.jpg" alt="Logo de Avícola de Tony" className="h-20 w-auto object-contain" />
                  </div>
                </div>
              </div>

              {/* ✅ NUEVO CAMPO DE ASESOR */}
              <div>
                <label htmlFor="asesorId" className="block text-sm font-medium text-gray-700 mb-1">Asesor:</label>
                <select
                  id="asesorId"
                  name="asesorId"
                  value={formDatos.asesorId}
                  onChange={handleChange}
                  className="w-full p-3 border rounded-md bg-white text-black disabled:bg-gray-200"
                  required
                >
                  {asesores.map((asesor) => (
                    <option key={asesor.id} value={asesor.id}>
                      {asesor.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* BLOQUE PARA LA FECHA */}
              <div>
                <label htmlFor="fecha" className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Entrega:
                </label>
                <input
                  type="date"
                  id="fecha"
                  name="fecha"
                  value={formDatos.fecha}
                  onChange={handleChange}
                  className="w-full p-3 border border-gray-300 rounded-md bg-white text-black disabled:bg-gray-200 appearance-none"
                  required
                />
              </div>

              <div>
                <input type="text" name="cliente" ref={clienteInputRef} value={formDatos.cliente} placeholder="Nombre del Cliente" onChange={handleChange} className={`w-full p-3 border rounded-md text-black placeholder:text-gray-400 disabled:bg-gray-200 ${errors.cliente ? 'border-red-500' : 'border-gray-300'}`} />
                {errors.cliente && <p className="text-red-500 text-sm mt-1">{errors.cliente}</p>}
              </div>
              <div>
                <input type="tel" inputMode="numeric" name="whatsapp" value={formDatos.whatsapp} placeholder="Número de WhatsApp" onChange={handleChange} className={`w-full p-3 border rounded-md text-black placeholder:text-gray-400 disabled:bg-gray-200 ${errors.whatsapp ? 'border-red-500' : 'border-gray-300'}`} />
                {errors.whatsapp && <p className="text-red-500 text-sm mt-1">{errors.whatsapp}</p>}
              </div>
              <div>
                <input type="text" name="direccion" value={formDatos.direccion} placeholder="Dirección de Entrega" onChange={handleChange} className={`w-full p-3 border rounded-md text-black placeholder:text-gray-400 disabled:bg-gray-200 ${errors.direccion ? 'border-red-500' : 'border-gray-300'}`} />
                {errors.direccion && <p className="text-red-500 text-sm mt-1">{errors.direccion}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mapa</label>
                <MapInput onLocationChange={handleLocationChange} />
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Distrito</label><select name="distrito" value={formDatos.distrito} onChange={handleChange} className="w-full p-3 border rounded-md bg-white text-black disabled:bg-gray-200">{distritos.map(distrito => (<option key={distrito} value={distrito}>{distrito}</option>))}</select></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Tipo de cliente</label><select name="tipoCliente" value={formDatos.tipoCliente} onChange={handleChange} className="w-full p-3 border rounded-md bg-white text-black disabled:bg-gray-200"><option>Frecuente</option><option>Nuevo</option></select></div>
              <div>
                <textarea name="detalle" value={formDatos.detalle} placeholder="Detalle del Pedido (Ej: 2 pollos enteros...)" rows={4} onChange={handleChange} className={`w-full p-3 border rounded-md text-black placeholder:text-gray-400 disabled:bg-gray-200 ${errors.detalle ? 'border-red-500' : 'border-gray-300'}`}></textarea>
                {errors.detalle && <p className="text-red-500 text-sm mt-1">{errors.detalle}</p>}
              </div>
              <input type="text" name="horaEntrega" value={formDatos.horaEntrega} placeholder="Horario de Entrega" onChange={handleChange} className="w-full p-3 border rounded-md text-black placeholder:text-gray-400 disabled:bg-gray-200" />
              <textarea name="notas" value={formDatos.notas} placeholder="Observaciones (Ej: Tocar el timbre...)" rows={3} onChange={handleChange} className="w-full p-3 border rounded-md text-black placeholder:text-gray-400 disabled:bg-gray-200"></textarea>
            </fieldset>
          </form>
          <div className="mt-6 space-y-4">
            {appState === 'editing' && (
              <button
                type="button"
                onClick={handleGenerarClick}
                disabled={!puedeGenerarPedido || isSubmitting}
                className="w-full bg-red-600 text-white font-bold py-3 px-4 rounded-md hover:bg-red-700 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-wait"
              >
                <FiCheckSquare className="mr-2" />
                {cargandoLogo ? 'Cargando logo...' : 'Generar Pedido'}
              </button>
            )}
            {appState === 'previewing' && (
              <div className="space-y-3">
                <button onClick={handleCambiarDatos} className="w-full bg-yellow-500 text-white font-bold py-3 px-4 rounded-md hover:bg-yellow-600 transition-colors flex items-center justify-center"> <FiEdit2 className="mr-2" /> Cambiar Datos </button>
                <button onClick={handleConfirmarPedido} disabled={cargandoImagen || !imagenBlob || isSubmitting} className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-md hover:bg-green-700 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-wait"> <FiSend className="mr-2" /> {isSubmitting ? 'Registrando...' : 'Registrar Pedido'} </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg flex flex-col items-center">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Vista Previa del Ticket</h2>
          <div className="w-full max-w-md">
            {appState === 'editing' ? (
              <div className="w-full border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center min-h-[480px]"><p className="text-gray-400">El ticket aparecerá aquí</p></div>
            ) : (
              <>
                {cargandoImagen && (
                  <div className="w-full border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center min-h-[480px] text-center text-blue-600 font-semibold animate-pulse">
                    <p>Generando imagen...</p>
                  </div>
                )}
                {!cargandoImagen && imagenUrl && (
                  <div><img src={imagenUrl} alt="Vista previa del pedido" /></div>
                )}
                {!cargandoImagen && appState === 'confirmed' && imagenUrl && (<p className="text-center text-green-600 font-semibold mt-4 animate-pulse">¡Pedido Confirmado! Listo para compartir.</p>)}
              </>
            )}
          </div>
          <div className="mt-6 w-full max-w-md space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <button onClick={descargarImagen} disabled={appState !== 'confirmed' || !imagenBlob} className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed"> <FiDownload className="mr-2" /> Descargar </button>
              <button onClick={compartirImagen} disabled={appState !== 'confirmed' || !imagenBlob} className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed"> <FiShare2 className="mr-2" /> WhatsApp </button>
            </div>
            {appState === 'confirmed' && (<button onClick={handleNuevoPedido} className="w-full bg-gray-700 text-white font-bold py-3 px-4 rounded-md hover:bg-gray-800 transition-colors flex items-center justify-center"> <FiRotateCcw className="mr-2" /> Registrar Nuevo Pedido </button>)}
          </div>
        </div>
      </div>
    </main>
  );
}
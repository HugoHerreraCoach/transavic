// src/components/PedidoForm.tsx

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { toJpeg } from 'html-to-image';
import {  FiEdit2, FiDownload, FiShare2, FiCheckSquare, FiFileText, FiRotateCcw, FiSend, FiStar, FiCheckCircle, FiUserCheck, FiAlertCircle } from 'react-icons/fi';
import MapInput from '@/components/MapInput';
import ProductSelector, { SelectedItem } from '@/components/ProductSelector';
import TimeRangePicker from '@/components/TimeRangePicker';
import ClienteAutocomplete, { ClienteData } from '@/components/ClienteAutocomplete';
import { User } from '@/lib/types';
import { formatFechaForTicket } from '@/lib/utils';
import TicketPedido from '@/components/TicketPedido';

type TicketData = {
  cliente: string;
  razonSocial: string;
  rucDni: string;
  whatsapp: string;
  direccion: string;
  direccionMapa: string;
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

// Usar zona horaria local (no UTC) para evitar que pedidos creados de noche tengan fecha del día siguiente
const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const datosIniciales: TicketData = { cliente: '', razonSocial: '', rucDni: '', whatsapp: '', direccion: '', direccionMapa: '', distrito: 'La Victoria', tipoCliente: 'Frecuente', detalle: '', horaEntrega: '', notas: '', empresa: 'Transavic', fecha: getTodayString(), latitude: null, longitude: null, asesorId: '' };
type AppState = 'editing' | 'previewing' | 'confirmed';

// Respuesta de GET /api/clientes/verificar — anti-duplicados entre asesoras.
// Solo afecta la oferta "Guardar como Cliente Frecuente"; el PEDIDO nunca se bloquea.
type DuplicadoCliente = {
  match: 'ruc_dni' | 'whatsapp' | 'nombre';
  exacto: boolean;
  asesora_nombre: string | null;
  es_mio: boolean;
  cliente_id: string | null;
  cliente_nombre: string | null;
};



const distritos = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];


export default function PedidoForm({ asesores }: { asesores: User[] }) {
  const [appState, setAppState] = useState<AppState>('editing');
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
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
  const [errors, setErrors] = useState<Partial<Record<keyof TicketData | 'ubicacion', string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoListo, setLogoListo] = useState(false);
  const [pendienteGeneracion, setPendienteGeneracion] = useState(false);
  const [triggerFocus, setTriggerFocus] = useState<boolean>(false);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  // Ítems precargados al DUPLICAR un pedido (siembran el ProductSelector vía
  // initialItems + remount). Sin esto, el duplicado nacía sin pedido_items y
  // Producción no podía registrar pesos (caso Manuel lince/Nikuya, 11 jun 2026).
  const [dupItems, setDupItems] = useState<SelectedItem[] | undefined>(undefined);
  const [clienteGuardadoId, setClienteGuardadoId] = useState<string | null>(null);
  const [showGuardarCliente, setShowGuardarCliente] = useState(false);
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  // Duplicado exacto (RUC/DNI o WhatsApp) detectado al confirmar el pedido.
  // Si es de OTRA asesora, se reemplaza el botón "Guardar como Cliente
  // Frecuente" por un aviso discreto. El pedido en sí NUNCA se bloquea.
  const [dupFrecuente, setDupFrecuente] = useState<DuplicadoCliente | null>(null);
  // Consulta EN VIVO mientras se escribe el celular/DNI/RUC (reemplaza la
  // pregunta manual en el grupo de WhatsApp "¿este número es de alguien?").
  // `null` = sin resultado todavía; objeto = match exacto; 'nuevo' = consulta
  // válida sin coincidencias. NUNCA bloquea el pedido (solo informa).
  const [dupEnVivo, setDupEnVivo] = useState<DuplicadoCliente | "nuevo" | null>(null);
  const [cargandoCliente, setCargandoCliente] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0); // Forces child components to reset

  // P1.7 — Duplicar pedido: si veníamos del botón "Duplicar" de la lista, se
  // guardó un payload en sessionStorage. Lo leemos, prellenamos los campos del
  // cliente (no los ítems estructurados, que viven aparte) y lo limpiamos para
  // que un refresh no vuelva a pre-cargar.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('transavic.duplicar');
      if (!raw) return;
      sessionStorage.removeItem('transavic.duplicar');
      const dup = JSON.parse(raw) as Partial<TicketData> & { items?: SelectedItem[] };
      setFormDatos((prev) => ({
        ...prev,
        cliente: dup.cliente ?? prev.cliente,
        whatsapp: dup.whatsapp ?? prev.whatsapp,
        direccion: dup.direccion ?? prev.direccion,
        direccionMapa: dup.direccionMapa ?? dup.direccion ?? prev.direccionMapa,
        distrito: dup.distrito ?? prev.distrito,
        tipoCliente: dup.tipoCliente ?? prev.tipoCliente,
        rucDni: dup.rucDni ?? prev.rucDni,
        razonSocial: dup.razonSocial ?? prev.razonSocial,
        notas: dup.notas ?? prev.notas,
        empresa: dup.empresa ?? prev.empresa,
        detalle: dup.detalle ?? prev.detalle,
        latitude: dup.latitude ?? prev.latitude,
        longitude: dup.longitude ?? prev.longitude,
      }));
      // Copiar TAMBIÉN los ítems estructurados: siembran selectedItems (lo que
      // viaja en el POST) y el ProductSelector (initialItems + remount con key).
      if (Array.isArray(dup.items) && dup.items.length > 0) {
        setSelectedItems(dup.items);
        setDupItems(dup.items);
        setFormResetKey((k) => k + 1);
      }
      setSuccessToast('📋 Cliente copiado del pedido anterior — revisa y ajusta lo que necesite.');
      setTimeout(() => setSuccessToast(null), 4000);
    } catch {
      /* sessionStorage no disponible o JSON inválido — ignorar */
    }
  }, []);

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
    
    // Validación de coordenadas GPS (obligatorio)
    if (ticketDatos.latitude === null || ticketDatos.longitude === null) {
      (newErrors as Record<string, string>).ubicacion = 'Debes seleccionar una ubicación en el mapa.';
    }
    return newErrors;
  };

  const handleLocationChange = (lat: number, lng: number) => {
    setFormDatos(prev => ({ ...prev, latitude: lat, longitude: lng }));
    if (errors.ubicacion) {
      setErrors(prev => ({ ...prev, ubicacion: undefined }));
    }
  };

  const handleClienteSelected = (cliente: ClienteData) => {
    setClienteGuardadoId(cliente.id || null);
    setFormDatos(prev => ({
      ...prev,
      cliente: cliente.nombre,
      razonSocial: cliente.razon_social || '',
      rucDni: cliente.ruc_dni || '',
      whatsapp: cliente.whatsapp || '',
      direccion: cliente.direccion || '',
      direccionMapa: cliente.direccion_mapa || '',
      distrito: cliente.distrito || prev.distrito,
      tipoCliente: cliente.tipo_cliente || prev.tipoCliente,
      horaEntrega: cliente.hora_entrega || prev.horaEntrega,
      notas: cliente.notas || prev.notas,
      empresa: cliente.empresa || prev.empresa,
      latitude: cliente.latitude || null,
      longitude: cliente.longitude || null,
    }));
  };

  // Al confirmarse el pedido (cuando aparece la oferta de guardar como
  // frecuente), verifica contra /api/clientes/verificar si el WhatsApp o el
  // RUC/DNI del form ya pertenecen a un cliente registrado. Solo cuentan los
  // matches EXACTOS; prioriza el de OTRA asesora (es el que oculta el botón).
  useEffect(() => {
    if (appState !== 'confirmed' || clienteGuardadoId) {
      setDupFrecuente(null);
      return;
    }
    const ruc = (formDatos.rucDni ?? '').trim();
    const wa = (formDatos.whatsapp ?? '').replace(/\D/g, '');
    if (!ruc && wa.length < 6) {
      setDupFrecuente(null);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams();
        if (ruc) params.set('ruc_dni', ruc);
        if (wa.length >= 6) params.set('whatsapp', wa);
        const res = await fetch(`/api/clientes/verificar?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const json = await res.json();
        const exactos: DuplicadoCliente[] = (json.duplicados ?? []).filter(
          (d: DuplicadoCliente) => d.exacto && (d.match === 'ruc_dni' || d.match === 'whatsapp')
        );
        const ajeno = exactos.find(d => !d.es_mio);
        setDupFrecuente(ajeno ?? exactos[0] ?? null);
      } catch {
        /* abortado o sin conexión — el backend igual valida al guardar */
      }
    })();
    return () => ctrl.abort();
  }, [appState, clienteGuardadoId, formDatos.rucDni, formDatos.whatsapp]);

  // Consulta EN VIVO mientras se LLENA el pedido (appState 'editing'): igual que
  // preguntar en el grupo de WhatsApp "¿este número/DNI/RUC es de alguien?".
  // Debounce 500ms; reusa /api/clientes/verificar (global, respuesta mínima).
  // NO bloquea el pedido — solo muestra un aviso. Si ya se cargó un cliente por
  // el buscador de nombre (clienteGuardadoId), no hace falta consultar.
  useEffect(() => {
    if (appState !== 'editing' || clienteGuardadoId) {
      setDupEnVivo(null);
      return;
    }
    const ruc = (formDatos.rucDni ?? '').trim();
    const wa = (formDatos.whatsapp ?? '').replace(/\D/g, '');
    // Umbral conservador para no consultar con datos a medio escribir.
    if (!ruc && wa.length < 8) {
      setDupEnVivo(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (ruc) params.set('ruc_dni', ruc);
        if (wa.length >= 8) params.set('whatsapp', wa);
        const res = await fetch(`/api/clientes/verificar?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const json = await res.json();
        const exactos: DuplicadoCliente[] = (json.duplicados ?? []).filter(
          (d: DuplicadoCliente) => d.exacto && (d.match === 'ruc_dni' || d.match === 'whatsapp')
        );
        const ajeno = exactos.find(d => !d.es_mio);
        setDupEnVivo(ajeno ?? exactos[0] ?? "nuevo");
      } catch {
        /* abortado o sin conexión — no es crítico, el pedido sigue su curso */
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [appState, clienteGuardadoId, formDatos.rucDni, formDatos.whatsapp]);

  // Cargar la ficha completa de un cliente PROPIO encontrado en la consulta en
  // vivo (autocompleta el form y enlaza el pedido al cliente, evitando duplicar).
  const cargarClientePropio = async (clienteId: string) => {
    setCargandoCliente(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}`);
      if (!res.ok) return;
      const cliente = await res.json();
      handleClienteSelected(cliente);
      setDupEnVivo(null);
    } catch {
      /* si falla, la asesora puede seguir llenando a mano */
    } finally {
      setCargandoCliente(false);
    }
  };

  const handleGuardarCliente = async () => {
    setGuardandoCliente(true);
    try {
      const body = {
        nombre: formDatos.cliente,
        razon_social: formDatos.razonSocial || null,
        ruc_dni: formDatos.rucDni || null,
        whatsapp: formDatos.whatsapp || null,
        direccion: formDatos.direccion || null,
        distrito: formDatos.distrito || null,
        tipo_cliente: formDatos.tipoCliente || null,
        hora_entrega: formDatos.horaEntrega || null,
        notas: formDatos.notas || null,
        empresa: formDatos.empresa || null,
        latitude: formDatos.latitude,
        longitude: formDatos.longitude,
      };
      const enviar = (permitirDuplicado: boolean) => fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permitirDuplicado ? { ...body, permitir_duplicado: true } : body),
      });
      let res = await enviar(false);
      // 409 + puede_forzar = admin ante un duplicado: confirmar explícito y reintentar.
      if (res.status === 409) {
        const errPeek = await res.clone().json().catch(() => null);
        if (errPeek?.error === 'cliente_duplicado' && errPeek.puede_forzar) {
          const confirmar = window.confirm(
            `${errPeek.mensaje || 'Ya existe un cliente con este documento/celular.'}\n\n¿Crear de todas formas?`
          );
          // Cancelar NO cierra la oferta: el admin conserva el contexto por si
          // quiere corregir el dato (mismo comportamiento que el modal de clientes).
          if (!confirmar) return;
          res = await enviar(true);
        }
      }
      if (res.ok) {
        setShowGuardarCliente(false);
        alert('✅ Cliente guardado como frecuente');
      } else if (res.status === 409) {
        // Cliente duplicado (RUC/DNI o WhatsApp ya registrados).
        const err = await res.json().catch(() => null);
        setShowGuardarCliente(false);
        if (err?.error === 'cliente_duplicado' && err.es_mio) {
          // Propio: no insistir — ya existe en su cartera. Marcamos el id para
          // que la oferta de guardar no vuelva a aparecer.
          if (err.cliente_id) setClienteGuardadoId(err.cliente_id);
          alert('Ya está guardado en tus clientes.');
        } else if (err?.error === 'cliente_duplicado') {
          // De otra asesora: aviso claro y se oculta la oferta de guardar.
          alert(err?.mensaje || `Cliente ya registrado · Ejecutiva responsable: ${err?.asesora_nombre || 'otra asesora'}.`);
          setDupFrecuente({
            match: err?.campo === 'whatsapp' ? 'whatsapp' : 'ruc_dni',
            exacto: true,
            asesora_nombre: err?.asesora_nombre ?? null,
            es_mio: false,
            cliente_id: null,
            cliente_nombre: null,
          });
        } else {
          alert('Error al guardar cliente');
        }
      } else {
        alert('Error al guardar cliente');
      }
    } catch {
      alert('Error al guardar cliente');
    } finally {
      setGuardandoCliente(false);
    }
  };

  const handleAddressChange = (address: string) => {
    setFormDatos(prev => ({ ...prev, direccionMapa: address }));
  };

  const handleGenerarClick = () => {
    // Validación temprana con formDatos
    const newErrors: Partial<Record<keyof TicketData | 'ubicacion', string>> = {};
    if (!formDatos.cliente?.trim()) newErrors.cliente = 'El nombre del cliente es obligatorio.';
    if (!formDatos.detalle?.trim()) newErrors.detalle = 'El detalle del pedido es obligatorio.';
    if (!formDatos.whatsapp?.trim()) {
      newErrors.whatsapp = 'El número de WhatsApp es obligatorio.';
    } else if (!/^[0-9]+$/.test(formDatos.whatsapp.trim())) {
      newErrors.whatsapp = 'El número de WhatsApp solo debe contener dígitos numéricos.';
    }
    if (!formDatos.direccion?.trim()) {
      newErrors.direccion = 'La dirección es obligatoria.';
    }
    if (formDatos.latitude === null || formDatos.longitude === null) {
      newErrors.ubicacion = 'Debes seleccionar una ubicación en el mapa.';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      formRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

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
        clienteId: clienteGuardadoId || null,
        fecha: formDatos.fecha,
        direccionMapa: formDatos.direccionMapa,
        items: selectedItems.length > 0 ? selectedItems.map(item => ({
          productoId: item.productoId,
          nombre: item.nombre,
          cantidad: item.cantidad,
          unidad: item.unidad,
        })) : undefined,
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
      const pedidoCreado = await response.json();
      setAppState('confirmed');
      // Toast prominente arriba derecha — visible aunque el usuario esté viendo el form izquierdo
      setSuccessToast(
        `✅ Pedido registrado: ${pedidoCreado.cliente || ticketDatos.cliente}`
      );
      // Scroll arriba para que el usuario vea claramente la confirmación
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (error) {
      console.error('Fallo al confirmar el pedido:', error);
      setErrorToast(
        `❌ No se pudo registrar: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );
      setTimeout(() => setErrorToast(null), 6000);
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
      asesorId: primerAsesorId,
    };
    setFormDatos(nuevoEstadoFormulario);
    setTicketDatos(datosIniciales);
    setImagenUrl(null);
    setImagenBlob(null);
    setPendienteGeneracion(false);
    setAppState('editing');
    setErrors({});
    // ✅ FIX: Reset ALL state that was previously missed
    setSelectedItems([]);
    setDupItems(undefined); // que el reset NO resucite los ítems del duplicado
    setClienteGuardadoId(null);
    setShowGuardarCliente(false);
    setGuardandoCliente(false);
    setFormResetKey(prev => prev + 1); // Force child components (ProductSelector) to reset
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
      {/* Toast de éxito/error — flotante arriba para visibilidad inmediata */}
      {successToast && (
        <div className="fixed top-20 right-4 z-50 max-w-sm bg-green-600 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 animate-bounce-in">
          <span className="font-medium">{successToast}</span>
        </div>
      )}
      {errorToast && (
        <div className="fixed top-20 right-4 z-50 max-w-sm bg-red-600 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-2">
          <span className="font-medium">{errorToast}</span>
        </div>
      )}
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
        <div className="bg-white p-6 rounded-xl shadow-lg h-fit min-w-0">
          <div className="flex items-center mb-6">
            <FiFileText className="text-red-600 mr-3" size={30} />
            <h1 className="text-2xl font-bold text-gray-800">Datos del Pedido</h1>
          </div>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <fieldset disabled={appState !== 'editing'} className="space-y-4 min-w-0">
              <div ref={empresaSelectorRef}>
                <label className="block text-base font-medium text-gray-800 mb-2 text-center">Selecciona la empresa:</label>
                <div className="flex justify-center items-center gap-4">
                  <div
                    className={`p-2 border-2 rounded-xl transition-all duration-200 ${formDatos.empresa === 'Transavic' ? 'border-red-600 bg-red-50/20 scale-105' : 'border-transparent'} ${appState !== 'editing' ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                    onClick={() => appState === 'editing' && handleEmpresaChange('Transavic')}
                  >
                    <img src="/transavic.jpg" alt="Logo de Transavic" className="h-20 w-auto object-contain rounded-lg" />
                  </div>
                  <div
                    className={`p-2 border-2 rounded-xl transition-all duration-200 ${formDatos.empresa === 'Avícola de Tony' ? 'border-amber-500 bg-amber-50/20 scale-105' : 'border-transparent'} ${appState !== 'editing' ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                    onClick={() => appState === 'editing' && handleEmpresaChange('Avícola de Tony')}
                  >
                    <img src="/avicola.jpg" alt="Logo de Avícola de Tony" className="h-20 w-auto object-contain rounded-lg" />
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
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="w-full p-3 border border-gray-300 rounded-md bg-white text-gray-900 font-medium disabled:bg-gray-200 appearance-none cursor-pointer"
                  required
                />
              </div>

              <div>
                <ClienteAutocomplete
                  value={formDatos.cliente}
                  onChange={(val) => {
                    setFormDatos(prev => ({ ...prev, cliente: val }));
                    if (clienteGuardadoId) setClienteGuardadoId(null);
                  }}
                  onClienteSelected={handleClienteSelected}
                  disabled={appState !== 'editing'}
                  hasError={!!errors.cliente}
                />
                {errors.cliente && <p className="text-red-500 text-sm mt-1">{errors.cliente}</p>}
              </div>
              <div>
                <input type="text" name="razonSocial" value={formDatos.razonSocial} placeholder="Razón Social / Nombre Legal (opcional)" onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200" />
              </div>
              <div>
                <input type="text" name="rucDni" value={formDatos.rucDni} placeholder="RUC / DNI (opcional)" onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200" />
              </div>
              <div>
                <input type="tel" inputMode="numeric" name="whatsapp" value={formDatos.whatsapp} placeholder="Número de WhatsApp" onChange={handleChange} className={`w-full p-3 border rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200 ${errors.whatsapp ? 'border-red-500' : 'border-gray-300'}`} />
                {errors.whatsapp && <p className="text-red-500 text-sm mt-1">{errors.whatsapp}</p>}
                {/* Consulta en vivo: ¿este celular/DNI/RUC ya es cliente de
                    alguien? Informativo, NUNCA bloquea el pedido. */}
                {appState === 'editing' && dupEnVivo && (
                  dupEnVivo === "nuevo" ? (
                    <p className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md py-2 px-3 flex items-center gap-1.5">
                      <FiCheckCircle className="flex-shrink-0" /> Cliente nuevo · sin registro previo
                    </p>
                  ) : dupEnVivo.es_mio ? (
                    <div className="mt-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-md py-2 px-3 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <FiUserCheck className="flex-shrink-0" />
                        <span className="truncate">Es tu cliente: <strong>{dupEnVivo.cliente_nombre}</strong></span>
                      </span>
                      <button
                        type="button"
                        onClick={() => dupEnVivo.cliente_id && cargarClientePropio(dupEnVivo.cliente_id)}
                        disabled={cargandoCliente}
                        className="flex-shrink-0 px-2.5 py-1 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {cargandoCliente ? 'Cargando…' : 'Cargar sus datos'}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md py-2 px-3 flex items-center gap-1.5">
                      <FiAlertCircle className="flex-shrink-0" /> Cliente ya registrado · Ejecutiva responsable: <strong>{dupEnVivo.asesora_nombre || 'otra asesora'}</strong>
                    </p>
                  )
                )}
              </div>
              <div>
                <input type="text" name="direccion" value={formDatos.direccion} placeholder="Dirección de Entrega" onChange={handleChange} className={`w-full p-3 border rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200 ${errors.direccion ? 'border-red-500' : 'border-gray-300'}`} />
                {errors.direccion && <p className="text-red-500 text-sm mt-1">{errors.direccion}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación en el Mapa <span className="text-red-500">*</span></label>
                <MapInput initialLat={formDatos.latitude} initialLng={formDatos.longitude} initialAddress={formDatos.direccionMapa} onLocationChange={handleLocationChange} onAddressChange={handleAddressChange} />
                {errors.ubicacion && <p className="text-red-500 text-sm mt-2">{errors.ubicacion}</p>}
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Distrito</label><select name="distrito" value={formDatos.distrito} onChange={handleChange} className="w-full p-3 border rounded-md bg-white text-gray-900 font-medium disabled:bg-gray-200">{distritos.map(distrito => (<option key={distrito} value={distrito}>{distrito}</option>))}</select></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Tipo de cliente</label><select name="tipoCliente" value={formDatos.tipoCliente} onChange={handleChange} className="w-full p-3 border rounded-md bg-white text-gray-900 font-medium disabled:bg-gray-200"><option>Frecuente</option><option>Nuevo</option></select></div>
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Productos del Catálogo</label>
                <ProductSelector
                  key={formResetKey}
                  empresa={formDatos.empresa}
                  initialItems={dupItems}
                  onChange={(items: SelectedItem[], detalleText: string) => {
                    setSelectedItems(items);
                    setFormDatos(prev => ({ ...prev, detalle: detalleText || prev.detalle }));
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Detalle del Pedido (auto-generado o manual)</label>
                <textarea name="detalle" value={formDatos.detalle} placeholder="Detalle del Pedido (Ej: 2 pollos enteros...)" rows={4} onChange={handleChange} className={`w-full p-3 border rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200 ${errors.detalle ? 'border-red-500' : 'border-gray-300'}`}></textarea>
                {errors.detalle && <p className="text-red-500 text-sm mt-1">{errors.detalle}</p>}
              </div>
              <TimeRangePicker
                value={formDatos.horaEntrega}
                onChange={(val) => setFormDatos(prev => ({ ...prev, horaEntrega: val }))}
                disabled={appState !== 'editing'}
              />
              <textarea name="notas" value={formDatos.notas} placeholder="Observaciones (Ej: Tocar el timbre...)" rows={3} onChange={handleChange} className="w-full p-3 border rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200"></textarea>
            </fieldset>
          </form>
          <div className="mt-6 space-y-4">
            {appState === 'editing' && (
              <button
                type="button"
                onClick={handleGenerarClick}
                disabled={!puedeGenerarPedido || isSubmitting}
                className={`w-full text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center disabled:bg-gray-400 disabled:cursor-wait cursor-pointer ${
                  formDatos.empresa === 'Avícola de Tony'
                    ? 'bg-amber-500 hover:bg-amber-600 shadow-md hover:shadow-lg active:scale-98'
                    : 'bg-red-600 hover:bg-red-700 shadow-md hover:shadow-lg active:scale-98'
                }`}
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
            {appState === 'confirmed' && (
              <>
                <button onClick={handleNuevoPedido} className="w-full bg-gray-700 text-white font-bold py-3 px-4 rounded-md hover:bg-gray-800 transition-colors flex items-center justify-center"> <FiRotateCcw className="mr-2" /> Registrar Nuevo Pedido </button>
                {/* Si el cliente ya pertenece a OTRA asesora, no se ofrece guardarlo
                    como frecuente (el pedido en sí ya quedó registrado igual). */}
                {!clienteGuardadoId && dupFrecuente && !dupFrecuente.es_mio && (
                  <p className="w-full text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md py-2.5 px-3">
                    ✓ Cliente ya registrado · Ejecutiva responsable: {dupFrecuente.asesora_nombre || 'otra asesora'}
                  </p>
                )}
                {!clienteGuardadoId && !showGuardarCliente && !(dupFrecuente && !dupFrecuente.es_mio) && (
                  <button onClick={() => setShowGuardarCliente(true)} className="w-full bg-amber-500 text-white font-bold py-3 px-4 rounded-md hover:bg-amber-600 transition-colors flex items-center justify-center"> <FiStar className="mr-2" /> Guardar como Cliente Frecuente </button>
                )}
                {showGuardarCliente && !(dupFrecuente && !dupFrecuente.es_mio) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-amber-800 font-medium">¿Guardar <strong>{formDatos.cliente}</strong> como cliente frecuente? Sus datos se auto-llenarán en futuros pedidos.</p>
                    <div className="flex gap-2">
                      <button onClick={handleGuardarCliente} disabled={guardandoCliente} className="flex-1 bg-amber-500 text-white font-semibold py-2 px-3 rounded-md hover:bg-amber-600 transition-colors text-sm disabled:bg-gray-300">{guardandoCliente ? 'Guardando...' : 'Sí, guardar'}</button>
                      <button onClick={() => setShowGuardarCliente(false)} className="flex-1 bg-gray-200 text-gray-700 font-semibold py-2 px-3 rounded-md hover:bg-gray-300 transition-colors text-sm">No, gracias</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
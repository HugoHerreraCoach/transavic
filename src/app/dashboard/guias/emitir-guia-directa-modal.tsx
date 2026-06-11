"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  FiX,
  FiTruck,
  FiAlertCircle,
  FiCheck,
  FiCalendar,
  FiSearch,
  FiTrash2,
  FiPlus,
  FiUser,
  FiPackage,
  FiMapPin,
  FiInfo,
  FiCheckCircle,
  FiAlertTriangle,
} from "react-icons/fi";
import { esReceptorIdentificado, esDniValido, esRucValido } from "@/lib/sunat/validacion-cliente";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";
import {
  DISTRITOS_LIMA,
  type MotorizadoUser,
  datosChoferDesdeMotorizado,
  validarChofer,
  consultarDocumento,
  matchDistritoLima,
  detectarDistritoEnDireccion,
  decidirAutollenadoDestino,
  fetchEntornoSunat,
} from "@/lib/guia-form-shared";

interface ClienteData {
  id?: string;
  nombre: string;
  razon_social?: string | null;
  ruc_dni?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  empresa?: string | null;
}

interface Producto {
  id: string;
  nombre: string;
  categoria: string;
  unidad: string;
  precio_venta: number | string | null;
  codigo: string | null;
}

interface ItemFila {
  producto_nombre: string;
  cantidad: number;
  unidad: string; // KGM | NIU
}

interface EmitirGuiaDirectaModalProps {
  onClose: () => void;
  onExito?: (serieNumero: string) => void;
}

type Empresa = "transavic" | "avicola";

interface EmpresaInfo {
  ruc: string;
  razonSocial: string;
}

// DISTRITOS_LIMA, MotorizadoUser, dividirNombreLocal, validarChofer, etc. viven en
// src/lib/guia-form-shared.ts — fuente única compartida con emitir-guia-modal.tsx.

const EMPRESA_UI: Record<Empresa, { logo: string; nombre: string; ring: string; bg: string; texto: string }> = {
  transavic: {
    logo: "/transavic.jpg",
    nombre: "Transavic",
    ring: "border-red-500 ring-2 ring-red-100",
    bg: "bg-red-50/50 border-red-200",
    texto: "text-red-700",
  },
  avicola: {
    logo: "/avicola.jpg",
    nombre: "Avícola de Tony",
    ring: "border-amber-500 ring-2 ring-amber-100",
    bg: "bg-amber-50/50 border-amber-200",
    texto: "text-amber-700",
  },
};

export default function EmitirGuiaDirectaModal({ onClose, onExito }: EmitirGuiaDirectaModalProps) {
  const [empresa, setEmpresa] = useState<Empresa>("transavic");
  const [empresasMap, setEmpresasMap] = useState<Record<Empresa, EmpresaInfo>>({
    transavic: { ruc: "20603723326", razonSocial: "TRANSAVIC S.A.C." },
    avicola: { ruc: "10101886196", razonSocial: "ANTONIO RESURRECCION" },
  });
  
  // Cliente
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [sugerenciasClientes, setSugerenciasClientes] = useState<ClienteData[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [showClientes, setShowClientes] = useState(false);
  const clientRef = useRef<HTMLDivElement>(null);

  const [clienteId, setClienteId] = useState<string | null>(null);
  const [clienteDocNum, setClienteDocNum] = useState("");
  const [clienteDocTipo, setClienteDocTipo] = useState("1"); // 1 = DNI, 6 = RUC
  const [clienteRazonSocial, setClienteRazonSocial] = useState("");
  
  const [direccionLlegada, setDireccionLlegada] = useState("");
  const [distritoLlegada, setDistritoLlegada] = useState("");

  // Conductor
  const [repartidores, setRepartidores] = useState<MotorizadoUser[]>([]);
  const [cargandoRepartidores, setCargandoRepartidores] = useState(false);
  const [errorRepartidores, setErrorRepartidores] = useState<string | null>(null);
  
  const [repartidorId, setRepartidorId] = useState("");
  const [choferDni, setChoferDni] = useState("");
  const [choferLicencia, setChoferLicencia] = useState("");
  const [choferNombres, setChoferNombres] = useState("");
  const [choferApellidos, setChoferApellidos] = useState("");
  const [vehiculoPlaca, setVehiculoPlaca] = useState("");
  // Con M1/L el chofer es opcional → sus campos se ocultan hasta que el usuario los pida
  // (mismo patrón que emitir-guia-modal.tsx).
  const [mostrarChofer, setMostrarChofer] = useState(false);

  // Entorno SUNAT real para el banner (null = cargando)
  const [esProduccion, setEsProduccion] = useState<boolean | null>(null);

  // Auto-búsqueda RENIEC/SUNAT del destinatario (apisperu)
  const [consultandoDest, setConsultandoDest] = useState(false);
  const [consultaDestMsg, setConsultaDestMsg] = useState<string | null>(null);
  const ultimoDocConsultado = useRef("");
  // Última dirección/distrito que NOSOTROS autollenamos desde la consulta RUC: permite
  // actualizar si el usuario corrige el RUC, sin pisar lo que escribió a mano ni lo
  // que vino de la ficha del cliente frecuente.
  const dirAutollenada = useRef<string | null>(null);
  const distAutollenado = useRef<string | null>(null);
  // Espejo del estado para leer el valor MÁS RECIENTE dentro de la consulta async
  // (un updater funcional que mute refs es impuro y Strict Mode lo doble-invoca).
  const direccionLlegadaRef = useRef("");
  const distritoLlegadaRef = useRef("");
  // true = el doc lo seteó handleSelectCliente (consulta "suave": solo llena vacíos);
  // false = lo tipeó el usuario (consulta "forzada": reemplaza dirección/distrito).
  const consultaSuaveRef = useRef(false);
  useEffect(() => { direccionLlegadaRef.current = direccionLlegada; }, [direccionLlegada]);
  useEffect(() => { distritoLlegadaRef.current = distritoLlegada; }, [distritoLlegada]);

  // Detalles de envío
  const getTodayLima = () => {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };
  const [fechaInicioTraslado, setFechaInicioTraslado] = useState(getTodayLima());
  const [motivoTraslado, setMotivoTraslado] = useState("01"); // Venta
  const [totalBultos, setTotalBultos] = useState(1);
  const [pesoBrutoTotal, setPesoBrutoTotal] = useState("");
  const [pesoModificado, setPesoModificado] = useState(false);
  const [indicadorM1L, setIndicadorM1L] = useState(true); // por defecto true (repartidores motorizados)

  // Catálogo de Productos y Carrito
  const [productos, setProductos] = useState<Producto[]>([]);
  const [items, setItems] = useState<ItemFila[]>([
    { producto_nombre: "", cantidad: 1, unidad: "NIU" }
  ]);
  const [busquedaProdQuery, setBusquedaProdQuery] = useState<{ [index: number]: string }>({});
  const [sugerenciasProds, setSugerenciasProds] = useState<{ [index: number]: Producto[] }>({});
  const [showSugerenciasProds, setShowSugerenciasProds] = useState<{ [index: number]: boolean }>({});
  const prodRefs = useRef<{ [index: number]: HTMLDivElement | null }>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ serieNumero: string; mensaje?: string } | null>(null);

  // Selector visual temático dinámico
  const theme = useMemo(() => {
    if (empresa === "transavic") {
      return {
        brandName: "Transavic",
        accent: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
        text: "text-red-600",
        textHover: "hover:text-red-700",
        ring: "focus:ring-red-500 focus:border-red-500",
        bgLight: "bg-red-50/20 border-red-100",
        badge: "bg-red-50 text-red-700 border-red-100",
      };
    } else {
      return {
        brandName: "Avícola de Tony",
        accent: "bg-amber-500 hover:bg-amber-600 focus:ring-amber-500",
        text: "text-amber-600",
        textHover: "hover:text-amber-700",
        ring: "focus:ring-amber-500 focus:border-amber-500",
        bgLight: "bg-amber-50/20 border-amber-100",
        badge: "bg-amber-50 text-amber-700 border-amber-100",
      };
    }
  }, [empresa]);

  // Carga robusta de repartidores
  const cargarMotorizados = async () => {
    setCargandoRepartidores(true);
    setErrorRepartidores(null);
    try {
      const res = await fetch("/api/users?role=repartidor");
      if (!res.ok) {
        throw new Error(`Error de servidor (${res.status})`);
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setRepartidores(data);
      } else {
        throw new Error("Formato de respuesta inválido");
      }
    } catch (err) {
      console.error("Error al cargar motorizados en Modal GRE Directo:", err);
      setErrorRepartidores(err instanceof Error ? err.message : "Error al conectar con la base de datos");
    } finally {
      setCargandoRepartidores(false);
    }
  };

  // Cargar Catálogo de Productos, Repartidores y Datos SUNAT de Empresas
  useEffect(() => {
    let active = true;
    
    // Productos
    fetch("/api/productos")
      .then((r) => r.json())
      .then((j) => {
        if (active) setProductos(Array.isArray(j.data) ? j.data : []);
      })
      .catch((err) => console.error("Error al cargar productos catálogo:", err));

    // Empresas
    fetch("/api/sunat/empresas")
      .then((r) => r.json())
      .then((d) => {
        if (active && d && !d.error) {
          setEmpresasMap(d);
        }
      })
      .catch((err) => console.error("Error al cargar RUCs de empresas:", err));

    // Entorno SUNAT real (banner Producción/Beta)
    fetchEntornoSunat().then((prod) => { if (active && prod !== null) setEsProduccion(prod); });

    if (active) {
      cargarMotorizados();
    }

    return () => {
      active = false;
    };
  }, []);

  // Auto-búsqueda del destinatario: al digitar un DNI(8)/RUC(11) consulta apisperu y
  // autocompleta la razón social; con RUC, además la dirección y el distrito de llegada
  // (regla compartida `decidirAutollenadoDestino`). Si el documento lo TIPEÓ el usuario
  // (consultaSuaveRef=false) la dirección fiscal REEMPLAZA lo que haya — tipear un RUC
  // es redefinir el destinatario. Si el doc vino de elegir un cliente frecuente
  // (consultaSuaveRef=true), solo se llenan los campos vacíos (su ficha manda).
  useEffect(() => {
    const numero = clienteDocNum.trim();
    if ((numero.length !== 8 && numero.length !== 11) || numero === ultimoDocConsultado.current) return;
    const suave = consultaSuaveRef.current;
    const t = setTimeout(async () => {
      ultimoDocConsultado.current = numero;
      setConsultandoDest(true);
      setConsultaDestMsg(null);
      const r = await consultarDocumento(numero);
      if (r.ok) {
        if (r.nombre && (!suave || !clienteRazonSocial.trim())) setClienteRazonSocial(r.nombre);
        if (numero.length === 11) {
          const dec = decidirAutollenadoDestino({
            forzar: !suave,
            direccionApi: r.direccion,
            distritoApi: r.distrito,
            direccionActual: direccionLlegadaRef.current,
            distritoActual: distritoLlegadaRef.current,
            dirAutollenada: dirAutollenada.current,
            distAutollenado: distAutollenado.current,
          });
          if (dec.direccion !== undefined) {
            dirAutollenada.current = dec.direccion;
            direccionLlegadaRef.current = dec.direccion;
            setDireccionLlegada(dec.direccion);
          }
          if (dec.distrito !== undefined) {
            distAutollenado.current = dec.distrito || null;
            distritoLlegadaRef.current = dec.distrito;
            setDistritoLlegada(dec.distrito);
          }
        }
        setConsultaDestMsg(r.nombre ? `✓ ${r.nombre}` : null);
      } else {
        setConsultaDestMsg(r.mensaje || "No se encontró el documento. Escríbelo a mano.");
      }
      setConsultandoDest(false);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDocNum]);

  // Búsqueda inteligente de clientes (Debounce 300ms)
  useEffect(() => {
    const q = busquedaCliente.trim();
    if (q.length < 2) {
      setSugerenciasClientes([]);
      setShowClientes(false);
      return;
    }

    const delay = setTimeout(async () => {
      setCargandoClientes(true);
      try {
        const res = await fetch(`/api/clientes?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSugerenciasClientes(Array.isArray(data) ? data.slice(0, 5) : []);
          setShowClientes(Array.isArray(data) && data.length > 0);
        }
      } catch (err) {
        console.error("Error buscando clientes:", err);
      } finally {
        setCargandoClientes(false);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [busquedaCliente]);

  // Cerrar sugerencias al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (clientRef.current && !clientRef.current.contains(event.target as Node)) {
        setShowClientes(false);
      }
      
      // Cerrar sugerencias de productos
      Object.keys(prodRefs.current).forEach((key) => {
        const idx = Number(key);
        const ref = prodRefs.current[idx];
        if (ref && !ref.contains(event.target as Node)) {
          setShowSugerenciasProds((prev) => ({ ...prev, [idx]: false }));
        }
      });
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calcular peso bruto dinámicamente si no ha sido modificado manualmente.
  // Suma EXACTA solo si TODOS los ítems están en kilogramos; con unidades mixtas
  // devuelve 0 (campo en blanco) para que el usuario ingrese el peso real —
  // nada de estimaciones (el peso debe coincidir con la factura).
  const pesoBrutoCalculado = useMemo(() => {
    const conNombre = items.filter((it) => it.producto_nombre.trim());
    if (conNombre.length === 0) return 0;
    const todosKg = conNombre.every((it) => it.unidad === "KGM");
    if (!todosKg) return 0;
    const sumWeight = conNombre.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
    return sumWeight > 0 ? Number(sumWeight.toFixed(2)) : 0;
  }, [items]);

  useEffect(() => {
    if (!pesoModificado) {
      setPesoBrutoTotal(pesoBrutoCalculado > 0 ? String(pesoBrutoCalculado) : "");
    }
  }, [pesoBrutoCalculado, pesoModificado]);

  // Hay bienes en kg Y en otras unidades → no se autocalcula el peso; se le pide
  // al usuario pesarlo e ingresarlo (mensaje bajo el campo Peso Bruto).
  const unidadesMixtas = useMemo(() => {
    const conNombre = items.filter((it) => it.producto_nombre.trim());
    return conNombre.length > 0 && !conNombre.every((it) => it.unidad === "KGM");
  }, [items]);

  // Validación de campos en tiempo real (SUNAT Checklist)
  const validezSunat = useMemo(() => {
    const doc = clienteDocNum.trim();
    const docValido = esReceptorIdentificado(doc);
    const docTipoValido = clienteDocTipo === "6" ? esRucValido(doc) : esDniValido(doc);
    const clienteIdentificado = docValido && docTipoValido;
    const clienteNombreValido = clienteRazonSocial.trim().length > 0;
    
    const direccionValida = direccionLlegada.trim().length > 0;
    const distritoValido = distritoLlegada.trim().length > 0;
    const puntoLlegadaValido = direccionValida && distritoValido;

    // Regla única compartida (guia-form-shared): con M1/L el chofer/placa son opcionales.
    const choferCheck = validarChofer({
      indicadorM1L,
      dni: choferDni,
      licencia: choferLicencia,
      nombres: choferNombres,
      apellidos: choferApellidos,
      placa: vehiculoPlaca,
    });
    const transportistaValido = choferCheck.ok;
    const transportistaExento = indicadorM1L && !mostrarChofer;

    const itemsValidos = items.some((it) => it.producto_nombre.trim().length > 0 && it.cantidad > 0);
    
    const bultosValido = totalBultos > 0;
    const pesoValido = pesoBrutoTotal.trim().length > 0 && parseFloat(pesoBrutoTotal) > 0;
    const cargaValida = bultosValido && pesoValido;

    return {
      cliente: clienteIdentificado && clienteNombreValido,
      clienteDetalles: { docValido, docTipoValido, nombreValido: clienteNombreValido },
      puntoLlegada: puntoLlegadaValido,
      puntoLlegadaDetalles: { direccionValida, distritoValido },
      transportista: transportistaValido,
      transportistaExento,
      transportistaFaltantes: choferCheck.faltantes,
      mercaderia: itemsValidos,
      carga: cargaValida,
      cargaDetalles: { bultosValido, pesoValido },
      todoValido: clienteIdentificado && clienteNombreValido && puntoLlegadaValido && transportistaValido && itemsValidos && cargaValida,
    };
  }, [clienteDocNum, clienteDocTipo, clienteRazonSocial, direccionLlegada, distritoLlegada, choferDni, choferLicencia, choferNombres, choferApellidos, vehiculoPlaca, items, totalBultos, pesoBrutoTotal, indicadorM1L, mostrarChofer]);

  // Selección de cliente
  const handleSelectCliente = (cli: ClienteData) => {
    setClienteId(cli.id || null);
    const doc = (cli.ruc_dni || "").trim();
    // La ficha del cliente manda: la consulta que dispare este doc será "suave"
    // (solo llena vacíos, no pisa la dirección de entrega guardada).
    consultaSuaveRef.current = true;
    setClienteDocNum(doc);
    setClienteDocTipo(doc.length === 11 ? "6" : "1");
    setClienteRazonSocial(cli.razon_social || cli.nombre || "");
    setDireccionLlegada(cli.direccion || "");
    direccionLlegadaRef.current = cli.direccion || "";
    // Distrito de la ficha NORMALIZADO contra el <select> ("Surco" → "Santiago de
    // Surco"); si no hay o no matchea, detectarlo en el texto de la dirección
    // (solo con coincidencia inequívoca; si no, queda libre para elegir a mano).
    const distritoFicha = matchDistritoLima(cli.distrito)
      ?? detectarDistritoEnDireccion(cli.direccion)
      ?? "";
    if (distritoFicha && distritoFicha !== cli.distrito) {
      distAutollenado.current = distritoFicha;
    }
    setDistritoLlegada(distritoFicha);
    distritoLlegadaRef.current = distritoFicha;
    setBusquedaCliente(cli.nombre);
    
    // Auto-empresa si el cliente tiene una asignada
    if (cli.empresa) {
      const normEmp = cli.empresa.toLowerCase();
      setEmpresa(normEmp.startsWith("av") ? "avicola" : "transavic");
    }

    setShowClientes(false);
  };

  // Cambio de repartidor (datos pre-llenados desde el helper compartido)
  const handleRepartidorChange = (id: string) => {
    setRepartidorId(id);
    const ch = datosChoferDesdeMotorizado(repartidores.find((r) => r.id === id));
    setChoferDni(ch.dni);
    setChoferLicencia(ch.licencia);
    setVehiculoPlaca(ch.placa);
    setChoferNombres(ch.nombres);
    setChoferApellidos(ch.apellidos);
    // Si eligió un motorizado a propósito, mostramos sus datos (aunque sea M1/L)
    if (id) setMostrarChofer(true);
  };

  // Se incluyen datos del chofer si NO es M1/L (obligatorios) o si el usuario los desplegó.
  const incluirChofer = !indicadorM1L || mostrarChofer;

  // Modificar ítems
  const updateItem = (i: number, patch: Partial<ItemFila>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { producto_nombre: "", cantidad: 1, unidad: "NIU" }]);
  };

  const removeItem = (i: number) => {
    setItems((prev) => {
      if (prev.length <= 1) return [{ producto_nombre: "", cantidad: 1, unidad: "NIU" }];
      return prev.filter((_, idx) => idx !== i);
    });
  };

  // Búsqueda interactiva de productos por fila
  const handleProdQueryChange = (idx: number, query: string) => {
    setBusquedaProdQuery((prev) => ({ ...prev, [idx]: query }));
    updateItem(idx, { producto_nombre: query });

    if (query.trim().length < 2) {
      setSugerenciasProds((prev) => ({ ...prev, [idx]: [] }));
      setShowSugerenciasProds((prev) => ({ ...prev, [idx]: false }));
      return;
    }

    // Filtrar catálogo local
    const filtrados = productos.filter((p) =>
      p.nombre.toLowerCase().includes(query.toLowerCase())
    );
    setSugerenciasProds((prev) => ({ ...prev, [idx]: filtrados.slice(0, 5) }));
    setShowSugerenciasProds((prev) => ({ ...prev, [idx]: filtrados.length > 0 }));
  };

  const handleSelectProducto = (idx: number, prod: Producto) => {
    updateItem(idx, {
      producto_nombre: prod.nombre,
      unidad: aUnitCodeSunat(prod.unidad),
    });
    setBusquedaProdQuery((prev) => ({ ...prev, [idx]: prod.nombre }));
    setShowSugerenciasProds((prev) => ({ ...prev, [idx]: false }));
  };

  // Enviar a SUNAT
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validezSunat.todoValido) return;

    setLoading(true);
    setError(null);

    const docLimpio = clienteDocNum.trim();

    try {
      const payload = {
        repartidor_id: incluirChofer ? (repartidorId || null) : null,
        fechaInicioTraslado,
        motivoTraslado,
        totalBultos: Number(totalBultos) || 1,
        pesoBrutoTotal: pesoBrutoTotal ? Number(pesoBrutoTotal) : null,
        vehiculo_placa: incluirChofer ? vehiculoPlaca.trim() : "",
        chofer_dni: incluirChofer ? choferDni.trim() : "",
        chofer_licencia: incluirChofer ? choferLicencia.trim() : "",
        chofer_nombres: incluirChofer ? choferNombres.trim() : "",
        chofer_apellidos: incluirChofer ? choferApellidos.trim() : "",
        indicadorM1L,
        direccion_llegada: direccionLlegada.trim(),
        distrito_llegada: distritoLlegada.trim(),
        cliente_doc_tipo: clienteDocTipo,
        cliente_doc_num: docLimpio,
        cliente_razon_social: clienteRazonSocial.trim(),
        empresa,
        items: items.filter((it) => it.producto_nombre.trim()).map((it) => ({
          producto_nombre: it.producto_nombre.trim(),
          cantidad: Number(it.cantidad),
          unidad: it.unidad,
        })),
      };

      const res = await fetch("/api/guias/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Ocurrió un error inesperado al emitir la guía.");
      }

      setSuccess({
        serieNumero: data.serieNumero,
        mensaje: data.mensaje || data.descripcion,
      });

      if (onExito) {
        onExito(data.serieNumero);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la guía");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto font-sans animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-slate-55 rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-200 flex flex-col my-8 max-h-[90vh] bg-white">
        
        {/* Franja superior de acento de transporte/guía (Amarillo/Ámbar Logística) */}
        <div className="h-1.5 w-full bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-400" />

        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-150 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shadow-inner">
              <FiTruck size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Emitir Guía de Remisión Electrónica</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Genera una GRE directa para SUNAT completando los campos obligatorios.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <FiX size={18} />
          </button>
        </div>

        {success ? (
          <div className="p-10 text-center max-w-md mx-auto my-auto space-y-5 animate-[scaleUp_0.3s_ease-out]">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto border border-green-200 shadow-md">
              <FiCheck size={32} />
            </div>
            <div className="space-y-2">
              <h4 className="text-base font-bold text-slate-800">¡Guía de Remisión Emitida!</h4>
              <p className="text-xs text-green-700 font-extrabold bg-green-50 border border-green-100 py-1.5 px-4 rounded-lg inline-block shadow-sm">
                {success.serieNumero}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed pt-2">
                {success.mensaje || "La guía ha sido aceptada por la SUNAT exitosamente en el sistema."}
              </p>
            </div>
            <div className="pt-4">
              <button
                onClick={() => {
                  onClose();
                  window.location.reload();
                }}
                className={`w-full py-2.5 text-white rounded-xl font-bold text-xs shadow-sm transition active:scale-95 ${theme.accent}`}
              >
                Entendido y Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              
              {error && (
                <div className="p-3.5 bg-red-50 border border-red-150 rounded-xl flex items-start gap-3 text-xs text-red-700 animate-[shake_0.4s_ease-in-out]">
                  <FiAlertCircle className="flex-shrink-0 mt-0.5" size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* Grid Principal Formulario (Col-span 2) vs Sidebar (Col-span 1) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                
                {/* COLUMNA IZQUIERDA Y CENTRAL: Formulario */}
                <div className="lg:col-span-2 space-y-6">

                  {/* Rediseño del Selector de Marca Emisora (Empresas Grid) */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Empresa / Marca Emisora
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      {(["transavic", "avicola"] as Empresa[]).map((emp) => {
                        const ui = EMPRESA_UI[emp];
                        const activo = empresa === emp;
                        return (
                          <button
                            key={emp}
                            type="button"
                            onClick={() => setEmpresa(emp)}
                            className={`relative flex items-center gap-3.5 rounded-xl border-2 p-3 text-left transition-all active:scale-[0.98] duration-200 cursor-pointer ${
                              activo ? `${ui.ring} ${ui.bg}` : "border-slate-200 bg-white hover:border-slate-350 hover:scale-[1.01]"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={ui.logo}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover border border-slate-200 flex-shrink-0 shadow-sm"
                            />
                            <div className="min-w-0">
                              <div className={`font-black text-xs truncate ${activo ? ui.texto : "text-slate-800"}`}>
                                {ui.nombre}
                              </div>
                              <div className="text-[10px] text-slate-400 font-bold truncate mt-0.5">
                                RUC {empresasMap[emp]?.ruc || "Cargando..."}
                              </div>
                            </div>
                            {activo && (
                              <FiCheckCircle className={`absolute top-2 right-2 h-4 w-4 ${ui.texto}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* SECCIÓN 1: TRASLADO Y DESTINO */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                      <FiMapPin className="text-indigo-500" size={15} />
                      1. Traslado y Destino
                    </h4>

                    {/* Autocomplete de Clientes */}
                    <div ref={clientRef} className="relative">
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">
                        Buscar Cliente Frecuente
                      </label>
                      <div className="relative">
                        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                          type="text"
                          value={busquedaCliente}
                          onChange={(e) => {
                            setBusquedaCliente(e.target.value);
                            if (!e.target.value.trim()) {
                              setClienteId(null);
                              setClienteDocNum("");
                              setClienteRazonSocial("");
                            }
                          }}
                          placeholder="Ingresa RUC, DNI o Nombre del Cliente..."
                          className={`w-full text-xs border border-slate-200 rounded-xl pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 transition shadow-sm ${theme.ring}`}
                        />
                        {cargandoClientes && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin block" />
                          </div>
                        )}
                      </div>

                      {showClientes && sugerenciasClientes.length > 0 && (
                        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-slate-100 animate-[slideDown_0.2s_ease-out]">
                          {sugerenciasClientes.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => handleSelectCliente(c)}
                              className="w-full px-4 py-2.5 text-left text-xs hover:bg-slate-50 flex flex-col gap-0.5 transition"
                            >
                              <span className="font-semibold text-slate-800">{c.nombre}</span>
                              <span className="text-[10px] text-slate-400">
                                {c.ruc_dni ? `Doc: ${c.ruc_dni}` : "Sin Doc"} · {c.direccion || "Sin dirección"}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Ficha datos de cliente receptor */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            Tipo Doc.
                          </label>
                          <select
                            value={clienteDocTipo}
                            onChange={(e) => {
                              setClienteDocTipo(e.target.value);
                              setClienteDocNum("");
                            }}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          >
                            <option value="1">DNI</option>
                            <option value="6">RUC</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            Nro Documento
                          </label>
                          <input
                            type="text"
                            maxLength={clienteDocTipo === "6" ? 11 : 8}
                            value={clienteDocNum}
                            onChange={(e) => {
                              // El usuario tipea el doc → la consulta será "forzada"
                              // (la dirección fiscal reemplaza lo precargado).
                              consultaSuaveRef.current = false;
                              setClienteDocNum(e.target.value.replace(/\D/g, ""));
                            }}
                            placeholder={clienteDocTipo === "6" ? "RUC 11 dígitos" : "DNI 8 dígitos"}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-mono font-bold"
                            required
                          />
                          {consultandoDest && <p className="text-[10px] text-slate-400 mt-1">Buscando…</p>}
                          {!consultandoDest && consultaDestMsg && (
                            <p className={`text-[10px] mt-1 ${consultaDestMsg.startsWith("✓") ? "text-green-600" : "text-amber-600"}`}>{consultaDestMsg}</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          Nombre o Razón Social Destinatario
                        </label>
                        <input
                          type="text"
                          value={clienteRazonSocial}
                          onChange={(e) => setClienteRazonSocial(e.target.value)}
                          placeholder="Nombre completo o Razón social..."
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required
                        />
                      </div>
                    </div>

                    {/* Dirección llegada */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          Dirección de Llegada (Destino)
                        </label>
                        <input
                          type="text"
                          value={direccionLlegada}
                          onChange={(e) => setDireccionLlegada(e.target.value)}
                          placeholder="Dirección exacta..."
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          Distrito
                        </label>
                        <select
                          value={distritoLlegada}
                          onChange={(e) => setDistritoLlegada(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required
                        >
                          <option value="">-- Seleccione --</option>
                          {DISTRITOS_LIMA.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Dirección de salida estática del almacén */}
                    <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl text-[10px] text-slate-500 flex items-start gap-2">
                      <FiMapPin className="text-slate-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-bold text-slate-700 block">Punto de Partida (Origen establecido)</span>
                        Cal. Las Esmeraldas 624, Balconcillo, La Victoria, Lima (Almacén Central)
                      </div>
                    </div>
                  </div>

                  {/* SECCIÓN 2: TRANSPORTE Y CONDUCTOR */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                      <FiUser className="text-indigo-500" size={15} />
                      2. Transporte y Conductor
                    </h4>

                    {/* Selector de conductores pre-registrados */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Seleccionar Conductor Registrado
                      </label>
                      <div className="relative">
                        <select
                          value={repartidorId}
                          onChange={(e) => handleRepartidorChange(e.target.value)}
                          disabled={cargandoRepartidores}
                          className={`w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 transition shadow-sm pr-9 ${theme.ring} ${cargandoRepartidores ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <option value="">
                            {cargandoRepartidores ? "Cargando motorizados..." : "-- Registrar a mano o Seleccionar Motorizado --"}
                          </option>
                          {repartidores.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} {(!r.chofer_dni || !r.chofer_licencia || !r.vehiculo_placa) ? "(Faltan datos en DB)" : ""}
                            </option>
                          ))}
                        </select>
                        {cargandoRepartidores && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin block" />
                          </div>
                        )}
                      </div>

                      {errorRepartidores && (
                        <div className="flex items-center justify-between p-2 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700">
                          <span>Error de conductores: {errorRepartidores}</span>
                          <button
                            type="button"
                            onClick={cargarMotorizados}
                            className="px-2 py-0.5 bg-white border border-red-200 rounded font-bold transition text-[9px] hover:bg-slate-50"
                          >
                            Reintentar
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Formulario de chofer y placa */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                      
                      {/* Checkbox Indicador M1/L */}
                      <label className="flex items-center gap-2 pb-2 border-b border-slate-200/80 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={indicadorM1L}
                          onChange={(e) => setIndicadorM1L(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 border-slate-300"
                        />
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">
                          Vehículo categoría M1 o L (Moto / Auto Ligero)
                        </span>
                      </label>
                      {indicadorM1L && (
                        <p className="text-[10px] text-indigo-600/90 leading-snug">
                          Con moto o auto ligero no necesitas placa ni datos del chofer (ideal para delivery externo).
                        </p>
                      )}

                      {/* Con M1/L los datos del chofer son opcionales: ocultos hasta que el usuario los pida */}
                      {!incluirChofer && (
                        <button
                          type="button"
                          onClick={() => setMostrarChofer(true)}
                          className="w-full text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 border border-dashed border-indigo-200 rounded-xl py-2 hover:bg-indigo-50/40 transition"
                        >
                          + Agregar datos del chofer (opcional)
                        </button>
                      )}

                      {incluirChofer && (
                      <>
                      {indicadorM1L && (
                        <div className="flex justify-end -mb-1">
                          <button
                            type="button"
                            onClick={() => setMostrarChofer(false)}
                            className="text-[10px] font-medium text-slate-400 hover:text-slate-600"
                          >
                            − Quitar datos del chofer (no requeridos con M1/L)
                          </button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                            Nombres Chofer {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                          </label>
                          <input
                            type="text"
                            value={choferNombres}
                            onChange={(e) => setChoferNombres(e.target.value)}
                            placeholder={indicadorM1L ? "No requerido" : "Nombres"}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                            required={!indicadorM1L}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                            Apellidos Chofer {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                          </label>
                          <input
                            type="text"
                            value={choferApellidos}
                            onChange={(e) => setChoferApellidos(e.target.value)}
                            placeholder={indicadorM1L ? "No requerido" : "Apellidos"}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                            required={!indicadorM1L}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                            DNI Chofer {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                          </label>
                          <input
                            type="text"
                            maxLength={8}
                            value={choferDni}
                            onChange={(e) => setChoferDni(e.target.value.replace(/\D/g, ""))}
                            placeholder={indicadorM1L ? "No requerido" : "8 dígitos"}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-mono font-bold"
                            required={!indicadorM1L}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                            Licencia de Conducir {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                          </label>
                          <input
                            type="text"
                            maxLength={20}
                            value={choferLicencia}
                            onChange={(e) => setChoferLicencia(e.target.value.toUpperCase())}
                            placeholder={indicadorM1L ? "No requerida" : "Nro Licencia"}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-mono font-bold"
                            required={!indicadorM1L}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                          Placa del Vehículo {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                        </label>
                        <input
                          type="text"
                          maxLength={10}
                          value={vehiculoPlaca}
                          onChange={(e) => setVehiculoPlaca(e.target.value.toUpperCase())}
                          placeholder={indicadorM1L ? "No requerida" : "Ej. A1B-234"}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-bold"
                          required={!indicadorM1L}
                        />
                      </div>
                      </>
                      )}
                    </div>

                    {/* Datos de envío (Carga) */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5 flex items-center gap-1">
                            <FiCalendar className="text-slate-400" />
                            Fecha de Traslado
                          </label>
                          <input
                            type="date"
                            value={fechaInicioTraslado}
                            onChange={(e) => setFechaInicioTraslado(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.2 focus:outline-none focus:ring-1.5 focus:ring-indigo-500 bg-white"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                            Motivo del Traslado
                          </label>
                          <select
                            value={motivoTraslado}
                            onChange={(e) => setMotivoTraslado(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                            required
                          >
                            <option value="01">Venta</option>
                            <option value="04">Traslado entre locales</option>
                            <option value="02">Compra</option>
                            <option value="05">Devolución</option>
                            <option value="13">Otros motivos</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                            Total Bultos
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={totalBultos}
                            onChange={(e) => setTotalBultos(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.2 focus:outline-none focus:ring-1.5 focus:ring-indigo-500 bg-white font-bold"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5 flex items-center gap-1">
                            Peso Bruto (Kg)
                            <span className="text-[9px] text-slate-400 font-normal">
                              {unidadesMixtas ? "(Ingrésalo a mano)" : "(Auto-calculado)"}
                            </span>
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={pesoBrutoTotal}
                            onChange={(e) => {
                              setPesoBrutoTotal(e.target.value);
                              setPesoModificado(true);
                            }}
                            placeholder={unidadesMixtas ? "Pesa la carga…" : "0.00"}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.2 focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-bold text-indigo-700 bg-indigo-50/30"
                            required
                          />
                        </div>
                      </div>
                      {unidadesMixtas && !pesoBrutoTotal && (
                        <p className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
                          Los productos tienen distintas unidades (kg y unidades), así que no
                          podemos calcular el peso por ti. Pesa la carga e ingresa el total en
                          kilogramos.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* SECCIÓN 3: DETALLE DE MERCADERÍA */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                      <FiPackage className="text-indigo-500" size={15} />
                      3. Detalle de Mercadería
                    </h4>

                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full border-collapse text-left text-xs bg-white">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                            <th className="px-4 py-2.5 w-7/12">Producto</th>
                            <th className="px-4 py-2.5 w-2/12 text-center">Cant.</th>
                            <th className="px-4 py-2.5 w-2/12">Unidad</th>
                            <th className="px-4 py-2.5 w-1/12 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150">
                          {items.map((it, idx) => {
                            const q = busquedaProdQuery[idx] ?? it.producto_nombre;
                            return (
                              <tr key={idx} className="hover:bg-slate-50/30">
                                
                                {/* Producto Autocomplete */}
                                <td className="px-3 py-2.5 relative">
                                  <div
                                    ref={(el) => {
                                      prodRefs.current[idx] = el;
                                    }}
                                    className="relative w-full"
                                  >
                                    <input
                                      type="text"
                                      value={q}
                                      onChange={(e) => handleProdQueryChange(idx, e.target.value)}
                                      placeholder="Ingresa nombre del producto..."
                                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500 bg-white"
                                      required
                                    />

                                    {showSugerenciasProds[idx] && sugerenciasProds[idx]?.length > 0 && (
                                      <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden divide-y divide-slate-100 max-h-48 overflow-y-auto">
                                        {sugerenciasProds[idx].map((p) => (
                                          <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => handleSelectProducto(idx, p)}
                                            className="w-full px-3 py-2 text-left text-[11px] hover:bg-slate-50 flex flex-col gap-0.5 transition"
                                          >
                                            <span className="font-semibold text-slate-800">{p.nombre}</span>
                                            <span className="text-[9px] text-slate-400">
                                              Categoría: {p.categoria} · Unidad: {p.unidad}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>

                                {/* Cantidad */}
                                <td className="px-3 py-2.5 text-center">
                                  <input
                                    type="number"
                                    min={0.1}
                                    step="0.1"
                                    value={it.cantidad}
                                    onChange={(e) => updateItem(idx, { cantidad: parseFloat(e.target.value) || 0 })}
                                    className="w-16 text-center text-xs border border-slate-200 rounded-lg py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-bold bg-white"
                                    required
                                  />
                                </td>

                                {/* Unidad */}
                                <td className="px-3 py-2.5">
                                  <select
                                    value={it.unidad}
                                    onChange={(e) => updateItem(idx, { unidad: e.target.value })}
                                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                                  >
                                    <option value="NIU">Unidad (NIU)</option>
                                    <option value="KGM">Kilos (KGM)</option>
                                  </select>
                                </td>

                                {/* Acciones */}
                                <td className="px-3 py-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(idx)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                                  >
                                    <FiTrash2 size={14} />
                                  </button>
                                </td>

                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      
                      {/* Botón Añadir Fila */}
                      <div className="bg-slate-50 p-2 flex justify-start border-t border-slate-150">
                        <button
                          type="button"
                          onClick={addItem}
                          className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition shadow-sm"
                        >
                          <FiPlus size={13} />
                          Agregar fila
                        </button>
                      </div>
                    </div>
                  </div>

                </div>

                {/* COLUMNA DERECHA: SIDEBAR DE VALIDACIONES SUNAT */}
                <div className="space-y-6">

                  {/* Panel de Marca Emisora Activa */}
                  <div className={`p-4 rounded-2xl border-2 flex items-center gap-3 bg-white ${theme.bgLight} transition-all duration-200 shadow-sm`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={EMPRESA_UI[empresa].logo}
                      alt={theme.brandName}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-inner flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Emisor Activo</span>
                      <strong className="text-xs text-slate-800 block leading-tight">{empresasMap[empresa]?.razonSocial}</strong>
                      <span className="text-[10px] font-mono text-slate-500 font-bold mt-0.5 block">RUC {empresasMap[empresa]?.ruc}</span>
                    </div>
                  </div>

                  {/* Checklist SUNAT Card */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
                      <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-inner">
                        <FiCheckCircle size={14} />
                      </div>
                      <span className="text-xs font-black text-slate-800">Checklist Validaciones SUNAT</span>
                    </div>
                    
                    <div className="space-y-3.5">
                      {/* Cliente */}
                      <div className="flex items-start gap-2.5 text-[11px]">
                        <div className="mt-0.5 flex-shrink-0">
                          {validezSunat.cliente ? (
                            <div className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center shadow-sm">
                              <FiCheck size={11} className="stroke-[4]" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 bg-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={`font-bold block ${validezSunat.cliente ? 'text-green-800' : 'text-slate-500'}`}>
                            1. Cliente Destinatario
                          </span>
                          {!validezSunat.cliente && (
                            <span className="text-[10px] text-slate-400 mt-0.5 block leading-normal">
                              {!validezSunat.clienteDetalles.docValido && "• Falta RUC (11 dígitos) o DNI (8)"}
                              {validezSunat.clienteDetalles.docValido && !validezSunat.clienteDetalles.docTipoValido && `• Nro de documento inválido para tipo ${clienteDocTipo === '6' ? 'RUC' : 'DNI'}`}
                              {validezSunat.clienteDetalles.docTipoValido && !validezSunat.clienteDetalles.nombreValido && "• Falta Razón Social/Nombre"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Punto Llegada */}
                      <div className="flex items-start gap-2.5 text-[11px]">
                        <div className="mt-0.5 flex-shrink-0">
                          {validezSunat.puntoLlegada ? (
                            <div className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center shadow-sm">
                              <FiCheck size={11} className="stroke-[4]" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 bg-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={`font-bold block ${validezSunat.puntoLlegada ? 'text-green-800' : 'text-slate-500'}`}>
                            2. Punto de Llegada (Destino)
                          </span>
                          {!validezSunat.puntoLlegada && (
                            <span className="text-[10px] text-slate-400 mt-0.5 block leading-normal">
                              {!validezSunat.puntoLlegadaDetalles.direccionValida && "• Falta dirección de destino"}
                              {validezSunat.puntoLlegadaDetalles.direccionValida && !validezSunat.puntoLlegadaDetalles.distritoValido && "• Falta seleccionar distrito"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Transportista */}
                      <div className="flex items-start gap-2.5 text-[11px]">
                        <div className="mt-0.5 flex-shrink-0">
                          {validezSunat.transportista ? (
                            <div className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center shadow-sm">
                              <FiCheck size={11} className="stroke-[4]" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 bg-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={`font-bold block ${validezSunat.transportista ? 'text-green-800' : 'text-slate-500'}`}>
                            3. Chofer y Vehículo
                          </span>
                          {validezSunat.transportistaExento && (
                            <span className="text-[10px] text-green-600 mt-0.5 block leading-normal">
                              Exento — vehículo M1/L (moto/auto ligero), SUNAT no exige chofer ni placa.
                            </span>
                          )}
                          {!validezSunat.transportista && (
                            <span className="text-[10px] text-slate-400 mt-0.5 block leading-normal">
                              {validezSunat.transportistaFaltantes.map((f) => `• ${f}`).join("  ")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Carga */}
                      <div className="flex items-start gap-2.5 text-[11px]">
                        <div className="mt-0.5 flex-shrink-0">
                          {validezSunat.carga ? (
                            <div className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center shadow-sm">
                              <FiCheck size={11} className="stroke-[4]" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 bg-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={`font-bold block ${validezSunat.carga ? 'text-green-800' : 'text-slate-500'}`}>
                            4. Datos de Carga
                          </span>
                          {!validezSunat.carga && (
                            <span className="text-[10px] text-slate-400 mt-0.5 block leading-normal">
                              {!validezSunat.cargaDetalles.bultosValido && "• Bultos debe ser mayor a 0"}
                              {validezSunat.cargaDetalles.bultosValido && !validezSunat.cargaDetalles.pesoValido && "• Peso bruto debe ser mayor a 0 Kg"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Mercaderia */}
                      <div className="flex items-start gap-2.5 text-[11px]">
                        <div className="mt-0.5 flex-shrink-0">
                          {validezSunat.mercaderia ? (
                            <div className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center shadow-sm">
                              <FiCheck size={11} className="stroke-[4]" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 bg-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={`font-bold block ${validezSunat.mercaderia ? 'text-green-800' : 'text-slate-500'}`}>
                            5. Detalle de Mercadería
                          </span>
                          {!validezSunat.mercaderia && (
                            <span className="text-[10px] text-slate-400 mt-0.5 block leading-normal">
                              • Falta agregar productos con nombre y cantidad
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Alerta de bloqueo */}
                    {!validezSunat.todoValido && (
                      <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2 text-[10px] text-amber-700 leading-normal">
                        <FiAlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={13} />
                        <span>Resuelve los elementos en rojo arriba para poder emitir la guía de remisión electrónica.</span>
                      </div>
                    )}
                  </div>

                  {/* Entorno SUNAT — refleja el entorno real (Producción vs Beta), no es texto fijo */}
                  {esProduccion === true ? (
                    <div className="p-4 bg-green-50/60 border border-green-100 rounded-2xl text-[11px] text-green-800 space-y-1.5 shadow-sm">
                      <span className="font-bold flex items-center gap-1 text-green-900">
                        <FiCheckCircle className="text-green-600" size={14} />
                        Producción (SUNAT real)
                      </span>
                      <p className="leading-relaxed text-slate-600 text-[10px]">
                        Esta guía se enviará a SUNAT como documento oficial. Revisa que los datos sean correctos antes de emitir.
                      </p>
                    </div>
                  ) : esProduccion === false ? (
                    <div className="p-4 bg-amber-50/60 border border-amber-100 rounded-2xl text-[11px] text-amber-800 space-y-1.5 shadow-sm">
                      <span className="font-bold flex items-center gap-1 text-amber-900">
                        <FiInfo className="text-amber-600" size={14} />
                        Entorno de Pruebas (SUNAT Beta)
                      </span>
                      <p className="leading-relaxed text-slate-600 text-[10px]">
                        Esta guía se emitirá en modo Beta (no es un documento oficial).
                      </p>
                    </div>
                  ) : null}

                </div>

              </div>

            </div>

            {/* Footer de Acciones */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-150 flex items-center justify-between gap-3">
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                <FiInfo className="text-slate-400" size={12} />
                Completa todos los datos antes de emitir a la SUNAT.
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-xs font-semibold rounded-xl transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || !validezSunat.todoValido}
                  className={`px-5 py-2 text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${theme.accent}`}
                >
                  {loading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Emitiendo a SUNAT...
                    </>
                  ) : (
                    <>
                      <FiTruck size={13} />
                      Emitir Guía
                    </>
                  )}
                </button>
              </div>
            </div>

          </form>
        )}

      </div>
    </div>
  );
}

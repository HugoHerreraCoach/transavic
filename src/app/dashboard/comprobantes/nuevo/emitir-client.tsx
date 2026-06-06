// src/app/dashboard/comprobantes/nuevo/emitir-client.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { esDniValido, esRucValido, tieneNombreEspecifico } from "@/lib/sunat/validacion-cliente";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";
import {
  FiArrowLeft,
  FiSearch,
  FiPlus,
  FiTrash2,
  FiFileText,
  FiCheckCircle,
  FiAlertCircle,
  FiLoader,
  FiDownload,
} from "react-icons/fi";

type Tipo = "01" | "03";
type Empresa = "transavic" | "avicola";
type FormaPago = "Contado" | "Credito";

interface EmpresaInfo {
  ruc: string;
  razonSocial: string;
}

interface Producto {
  id: string;
  nombre: string;
  categoria: string;
  unidad: string;
  precio_venta: number | string | null;
  codigo: string | null;
}

interface ClienteData {
  id?: string;
  nombre: string;
  razon_social?: string | null;
  ruc_dni?: string | null;
  direccion?: string | null;
}

interface Item {
  codigo?: string; // código interno del producto (del catálogo)
  descripcion: string;
  cantidad: number;
  unidad: string; // KGM | NIU
  precio: number; // CON IGV
}

/** Estilo visual por empresa para diferenciarla de un vistazo. */
const EMPRESA_UI: Record<Empresa, { logo: string; nombre: string; ring: string; bg: string; texto: string }> = {
  transavic: {
    logo: "/transavic.jpg",
    nombre: "Transavic",
    ring: "border-red-500 ring-2 ring-red-200",
    bg: "bg-red-50 border-red-350",
    texto: "text-red-700",
  },
  avicola: {
    logo: "/avicola.jpg",
    nombre: "Avícola de Tony",
    ring: "border-amber-500 ring-2 ring-amber-200",
    bg: "bg-amber-50 border-amber-300",
    texto: "text-amber-700",
  },
};

/** Mapea la unidad del catálogo a código SUNAT (helper compartido `aUnitCodeSunat`,
 *  mismo criterio que usan los endpoints de emisión). */
function unidadSunatDesde(u: string | null | undefined): "NIU" | "KGM" {
  return aUnitCodeSunat(u);
}

/** ¿La unidad del catálogo es INEQUÍVOCA? "kg"→KGM, "uni"/"unidad"→NIU.
 *  Las ambiguas ("uni/kg", "kg/uni") y las desconocidas devuelven `null`: en ese
 *  caso NO se debe sobrescribir la unidad que la fila ya tiene (la que la asesora
 *  eligió a mano o la que vino del pedido), para no degradarla en silencio a
 *  "Unidad". 53 de 88 productos son "uni/kg" y se venden por kilo o por unidad
 *  según el caso → solo la asesora sabe cuál, no hay que adivinar por ella. */
function unidadInequivoca(u: string | null | undefined): "NIU" | "KGM" | null {
  const s = (u || "").trim().toLowerCase();
  if (s.includes("/")) return null; // "uni/kg", "kg/uni" → ambiguo, no tocar
  if (
    s === "kg" ||
    s === "kgm" ||
    s === "kilo" ||
    s === "kilos" ||
    s === "kilogramo" ||
    s === "kilogramos"
  ) {
    return "KGM";
  }
  if (s === "uni" || s === "und" || s === "unidad" || s === "niu") return "NIU";
  return null; // valor desconocido → no tocar la unidad actual
}

/** Fecha local (YYYY-MM-DD) de hoy + `dias`. Para el selector de vencimiento. */
function isoLocalMasDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" (legible para el usuario). */
function formatFechaLegible(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Días (>=0) entre hoy y una fecha ISO. Lo que el backend espera como plazoDias. */
function diasHasta(iso: string): number {
  const hoy = isoLocalMasDias(0);
  const ms = new Date(iso + "T00:00:00").getTime() - new Date(hoy + "T00:00:00").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

interface ResultadoEmision {
  id?: string; // id del comprobante en DB (para descargar su PDF)
  sunatCaido?: boolean; // SUNAT no respondió (caído) → aviso amigable + emisión manual
  estado?: string;
  serieNumero?: string;
  codigoRespuesta?: string;
  descripcion?: string;
  error?: string;
  mensaje?: string;
}

const IGV_FACTOR = 1.18;
const money = (n: number) => `S/ ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

export default function EmitirComprobanteClient({
  empresas,
  pedidoIdProp,
  onClose,
}: {
  // `empresas` es opcional: cuando el form se usa embebido (ej. modal desde la
  // lista de pedidos) no viene del server, así que se trae de /api/sunat/empresas.
  empresas?: Record<Empresa, EmpresaInfo>;
  // Cuando se abre desde un pedido (modal): vincula la emisión a ese pedido.
  pedidoIdProp?: string | null;
  // Si está embebido en un modal: cerrar en vez de navegar.
  onClose?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Embebido en un modal (vino de un pedido con onClose) → el form va en UNA
  // columna apilada (un modal es más angosto que la página); como página, 3 columnas.
  const esModal = !!onClose;
  // Si "Facturar" en un pedido nos trajo acá (?pedido=<id> o pedidoIdProp), la
  // emisión queda vinculada a ese pedido (cobranza + badge "Facturado") vía
  // /api/comprobantes/emitir.
  const [pedidoId, setPedidoId] = useState<string | null>(null);
  const [pedidoCliente, setPedidoCliente] = useState<string | null>(null);
  // Empresas: del prop (página) o traídas del endpoint (modal embebido).
  const [empresasMap, setEmpresasMap] = useState<Record<Empresa, EmpresaInfo>>(
    empresas ?? {
      transavic: { ruc: "", razonSocial: "Transavic" },
      avicola: { ruc: "", razonSocial: "Avícola de Tony" },
    }
  );
  const [productos, setProductos] = useState<Producto[]>([]);
  const [tipo, setTipo] = useState<Tipo>("01");
  const [empresa, setEmpresa] = useState<Empresa>("transavic");
  const [formaPago, setFormaPago] = useState<FormaPago>("Contado");
  const [fechaVenc, setFechaVenc] = useState<string>(() => isoLocalMasDias(7));
  
  // Datos del receptor/cliente
  const [numDoc, setNumDoc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [direccionCliente, setDireccionCliente] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  // Aviso de comprobante duplicado: el backend responde 409 con el comprobante igual.
  const [duplicado, setDuplicado] = useState<{
    id: string;
    serieNumero: string;
    fecha: string;
    mensaje: string;
  } | null>(null);
  const [docInfo, setDocInfo] = useState<{ estado?: string | null; condicion?: string | null } | null>(null);
  
  // Búsqueda inteligente de clientes registrados
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [sugerenciasClientes, setSugerenciasClientes] = useState<ClienteData[]>([]);
  const [cargandoSugerencias, setCargandoSugerencias] = useState(false);
  const [showSugerencias, setShowSugerencias] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);
  
  const [consultando, setConsultando] = useState(false);
  const [consultaMsg, setConsultaMsg] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([
    { descripcion: "", cantidad: 1, unidad: "NIU", precio: 0 },
  ]);
  const [pulseIndex, setPulseIndex] = useState<number | null>(null);
  
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEmision | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  // Sistema de autorizaciones de precio mínimo
  const [autorizacionId, setAutorizacionId] = useState<string | null>(
    searchParams.get("autorizacion_id")
  );
  const [showModalAutorizacion, setShowModalAutorizacion] = useState(false);
  const [razonSolicitud, setRazonSolicitud] = useState("");
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Empresas: si no vinieron por prop (form embebido en un modal), las traemos.
  useEffect(() => {
    if (empresas) return;
    let active = true;
    fetch("/api/sunat/empresas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d) setEmpresasMap(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [empresas]);

  // Precarga al venir de "Facturar" en un pedido: traemos cliente + ítems del
  // pedido y los cargamos en este MISMO formulario (la única interfaz de
  // emisión). El pedidoId queda guardado para vincular el comprobante al pedido.
  useEffect(() => {
    const pid = pedidoIdProp ?? searchParams.get("pedido");
    if (!pid) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/pedidos/${pid}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        // La API devuelve { pedido: {...columnas}, items: [...] }.
        const ped = data.pedido || {};
        const pedItems = Array.isArray(data.items) ? data.items : [];
        setPedidoId(pid);
        setPedidoCliente(ped.cliente || ped.razon_social || null);
        const esAvicola = (ped.empresa || "").trim().toLowerCase().startsWith("av");
        setEmpresa(esAvicola ? "avicola" : "transavic");
        const doc = (ped.ruc_dni || "").trim();
        setNumDoc(doc);
        setRazonSocial((ped.razon_social || ped.cliente || "").trim());
        setTipo(doc.length === 11 ? "01" : "03");
        if (pedItems.length > 0) {
          setItems(
            pedItems.map(
              (it: {
                producto_nombre?: string;
                cantidad?: number | string;
                unidad?: string;
                precio_unitario?: number | string | null;
                codigo?: string | null;
              }) => ({
                descripcion: it.producto_nombre || "",
                cantidad: Number(it.cantidad) || 1,
                // Normalizamos a código SUNAT (KGM/NIU) para que el desplegable
                // muestre la unidad REAL del pedido. Si viniera cruda ("kg"), el
                // <select> (opciones NIU/KGM) no la mostraría y caería a "Unidad",
                // confundiendo a la asesora aunque el pedido diga kilos.
                unidad: unidadSunatDesde(it.unidad),
                precio: Number(it.precio_unitario) || 0,
                codigo: it.codigo || undefined,
              })
            )
          );
        }
      } catch {
        /* si falla, el form queda en blanco y el usuario puede llenarlo igual */
      }
    })();
    return () => {
      active = false;
    };
  }, [searchParams, pedidoIdProp]);

  const totales = useMemo(() => {
    const total = items.reduce(
      (s, it) => s + (Number(it.precio) || 0) * (Number(it.cantidad) || 0),
      0
    );
    const neto = total / IGV_FACTOR;
    return { neto, igv: total - neto, total };
  }, [items]);

  const docEsRuc = numDoc.trim().length === 11;
  // Cliente elegido del buscador que NO tiene documento válido (DNI/RUC): hay que
  // conseguirlo y consultarlo. Dispara el aviso guía en la sección del cliente.
  const clienteSinDoc =
    clienteId !== null && !esDniValido(numDoc) && !esRucValido(numDoc);
  const boletaGrande = tipo === "03" && totales.total > 700;
  const clienteOpcional = tipo === "03" && !boletaGrande;

  // Búsqueda interactiva de clientes (Debounce)
  useEffect(() => {
    const q = busquedaCliente.trim();
    if (q.length < 2) {
      setSugerenciasClientes([]);
      setShowSugerencias(false);
      return;
    }

    const delay = setTimeout(async () => {
      setCargandoSugerencias(true);
      try {
        const res = await fetch(`/api/clientes?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSugerenciasClientes(Array.isArray(data) ? data.slice(0, 5) : []);
          setShowSugerencias(Array.isArray(data) && data.length > 0);
        }
      } catch (err) {
        console.error("Error buscando clientes:", err);
      } finally {
        setCargandoSugerencias(false);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [busquedaCliente]);

  // Cerrar sugerencias al clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (clientSearchRef.current && !clientSearchRef.current.contains(event.target as Node)) {
        setShowSugerencias(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Al digitar RUC o DNI a mano, auto-detectar tipo y auto-consultar SUNAT/RENIEC
  useEffect(() => {
    const numero = numDoc.trim();
    if (numero.length === 8 || numero.length === 11) {
      // Auto-detectar tipo
      if (numero.length === 11) {
        setTipo("01"); // Factura
      } else {
        setTipo("03"); // Boleta
      }

      // Auto-consulta inteligente tras 600ms de inactividad si no se ha consultado aún
      const delay = setTimeout(() => {
        if (!docInfo && !consultando && razonSocial.trim().length === 0) {
          void consultarAutomatico(numero);
        }
      }, 600);

      return () => clearTimeout(delay);
    }
  }, [numDoc, docInfo, consultando, razonSocial]);

  async function consultarAutomatico(numero: string) {
    if (!/^\d{8}$|^\d{11}$/.test(numero)) return;
    setConsultando(true);
    setConsultaMsg(null);
    try {
      const res = await fetch("/api/consulta-documento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: numero.length === 11 ? "ruc" : "dni", numero }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setRazonSocial(j.razonSocial || j.nombreCompleto || "");
        if (j.direccion) setDireccionCliente(j.direccion);
        if (numero.length === 11) setDocInfo({ estado: j.estado, condicion: j.condicion });
      }
    } catch {
      // Falla silenciosa en auto-consulta para no interrumpir al usuario
    } finally {
      setConsultando(false);
    }
  }

  async function consultar() {
    const numero = numDoc.trim();
    if (!/^\d{8}$|^\d{11}$/.test(numero)) {
      setConsultaMsg("Ingresa un DNI (8 dígitos) o RUC (11 dígitos).");
      return;
    }
    setConsultando(true);
    setConsultaMsg(null);
    setDocInfo(null);
    try {
      const res = await fetch("/api/consulta-documento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: numero.length === 11 ? "ruc" : "dni", numero }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setRazonSocial(j.razonSocial || j.nombreCompleto || "");
        if (j.direccion) setDireccionCliente(j.direccion);
        if (numero.length === 11) setDocInfo({ estado: j.estado, condicion: j.condicion });
        setTipo(numero.length === 11 ? "01" : "03");
      } else {
        setConsultaMsg(j.error || "No se encontró el documento. Escribe los datos a mano.");
      }
    } catch {
      setConsultaMsg("No se pudo consultar. Escribe los datos a mano.");
    } finally {
      setConsultando(false);
    }
  }

  const handleSelectCliente = (cli: ClienteData) => {
    const doc = (cli.ruc_dni || "").trim();
    setNumDoc(doc);
    setBusquedaCliente(cli.nombre);
    setShowSugerencias(false);
    setClienteId(cli.id || null);

    if (doc.length === 11) {
      // RUC → FACTURA. NO usamos los datos informales del cliente (su "nombre" y su
      // dirección de ENTREGA): para una factura los datos legales (razón social +
      // dirección FISCAL) deben venir de SUNAT. Limpiamos razón social/dirección y
      // dejamos docInfo en null → la AUTO-CONSULTA (efecto de arriba) los trae
      // oficiales de SUNAT. Así la factura siempre sale fiel y "Consultar" pasa a
      // ser, en la práctica, obligatorio para identificar al cliente.
      setTipo("01");
      setRazonSocial("");
      setDireccionCliente("");
      setDocInfo(null);
    } else if (doc.length === 8) {
      // DNI → BOLETA (consumidor final): el nombre del cliente sí sirve.
      setTipo("03");
      setRazonSocial(cli.razon_social || cli.nombre || "");
      setDireccionCliente(cli.direccion || "");
      setDocInfo(null);
    } else {
      // Sin documento válido: para BOLETA, SUNAT permite emitir A NOMBRE del cliente,
      // así que conservamos su nombre y dirección (le sirven a la asesora y salen en
      // el comprobante). Para FACTURA igual hará falta el RUC: el aviso ámbar guía a
      // consultarlo (la consulta sobreescribe estos datos con los oficiales de SUNAT).
      setRazonSocial(cli.razon_social || cli.nombre || "");
      setDireccionCliente(cli.direccion || "");
      setDocInfo(null);
    }
  };

  const clearClienteSearch = () => {
    setBusquedaCliente("");
    setNumDoc("");
    setRazonSocial("");
    setDireccionCliente("");
    setClienteId(null);
    setDocInfo(null);
    setConsultaMsg(null);
  };

  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  
  const addItem = () =>
    setItems((prev) => [...prev, { descripcion: "", cantidad: 1, unidad: "NIU", precio: 0 }]);
  
  const removeItem = (i: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Cargar catálogo de productos
  useEffect(() => {
    fetch("/api/productos")
      .then((r) => r.json())
      .then((j) => setProductos(Array.isArray(j.data) ? j.data : []))
      .catch(() => setProductos([]));
  }, []);

  const onDescripcion = (i: number, valor: string) => {
    const patch: Partial<Item> = { descripcion: valor };
    const prod = productos.find(
      (p) => p.nombre.trim().toLowerCase() === valor.trim().toLowerCase()
    );
    if (prod) {
      patch.codigo = prod.codigo || undefined;
      // Solo fijamos la unidad si el catálogo es INEQUÍVOCO (kg o unidad). Si es
      // ambiguo ("uni/kg"), respetamos la unidad que la fila ya tiene (la que la
      // asesora eligió o la que vino del pedido) en vez de degradarla a "Unidad".
      const unidadCat = unidadInequivoca(prod.unidad);
      if (unidadCat) patch.unidad = unidadCat;
      const precio = Number(prod.precio_venta) || 0;
      if (precio > 0) patch.precio = precio;

      // Activar destello de autocompletado en esta fila
      setPulseIndex(i);
      setTimeout(() => setPulseIndex(null), 1200);
    }
    updateItem(i, patch);
  };

  // Cálculo reactivo de validaciones (No me hagas pensar)
  const reqs = useMemo(() => {
    const itemsCount = items.length;
    const itemsValidos = itemsCount > 0 && items.every(
      (it) => it.descripcion.trim() && it.cantidad > 0 && it.precio > 0
    );
    
    const docTrim = numDoc.trim();
    const docVacio = docTrim.length === 0;
    const rucValido = esRucValido(docTrim);
    const dniValido = esDniValido(docTrim);
    const docValido = rucValido || dniValido;
    const hayNombre = tieneNombreEspecifico(razonSocial);

    let clienteValido = false;
    let descCliente = "";

    if (tipo === "01") {
      if (rucValido && razonSocial.trim().length > 0) {
        clienteValido = true;
        descCliente = "RUC y Razón Social válidos.";
      } else if (!rucValido) {
        descCliente = "Las facturas exigen un RUC válido (11 dígitos, empieza en 10/15/16/17/20).";
      } else {
        descCliente = "Falta rellenar la Razón Social del cliente.";
      }
    } else {
      // BOLETA
      if (!docVacio && !docValido) {
        descCliente = "El documento no es válido. DNI = 8 dígitos reales (no 00000000); RUC = 11 dígitos.";
      } else if (boletaGrande && !docValido) {
        descCliente = "Las boletas mayores a S/700 exigen DNI (8 díg) o RUC (11 díg).";
      } else if (docValido) {
        clienteValido = true;
        descCliente = "Identificación del cliente válida.";
      } else {
        // Sin documento válido, monto < S/700. SUNAT permite emitir la boleta A
        // NOMBRE del cliente (sin DNI): si hay nombre, sale con ese nombre; si no,
        // a "CLIENTES VARIOS". El check queda verde porque ambos casos son válidos.
        clienteValido = true;
        descCliente = hayNombre
          ? `Sin DNI, esta boleta saldrá a nombre de "${razonSocial.trim()}". Si quieres que figure el DNI, agrégalo arriba.`
          : "Sin nombre ni documento, se emitirá a CLIENTES VARIOS (consumidor final, monto menor a S/700).";
      }
    }

    // Ítems cuyo precio está por debajo del mínimo del catálogo
    const itemsConPrecioBajo = items
      .filter((it) => it.descripcion.trim())
      .map((it) => {
        const prod = productos.find(
          (p) => p.nombre.trim().toLowerCase() === it.descripcion.trim().toLowerCase()
        );
        const minimo = prod && Number(prod.precio_venta) > 0 ? Number(prod.precio_venta) : 0;
        return minimo > 0 && Number(it.precio) < minimo
          ? { nombre: it.descripcion, precio_solicitado: Number(it.precio), precio_minimo: minimo, cantidad: Number(it.cantidad) }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const necesitaAutorizacion = itemsConPrecioBajo.length > 0 && !autorizacionId;

    return {
      itemsValidos,
      clienteValido,
      descCliente,
      itemsCount,
      itemsConPrecioBajo,
      necesitaAutorizacion,
      puedeEmitir: itemsValidos && clienteValido && !necesitaAutorizacion,
    };
  }, [items, numDoc, razonSocial, tipo, boletaGrande, productos, autorizacionId]);

  const puedeEmitir = reqs.puedeEmitir;

  // Descarga el PDF del comprobante recién emitido
  async function descargarPdf(id: string) {
    setDescargando(true);
    try {
      const res = await fetch(`/api/comprobantes/${id}`);
      if (!res.ok) throw new Error("detalle");
      const d = await res.json();
      const { generarPDFComprobante } = await import("@/lib/sunat/pdf-comprobante");
      const blob = generarPDFComprobante({
        tipo: d.tipo,
        serie: d.serie,
        numero: d.numero,
        serieNumero: d.serieNumero,
        fechaEmision: d.fechaEmision,
        cliente: {
          tipoDocumento: d.cliente?.tipoDocumento ?? undefined,
          numDocumento: d.cliente?.numDocumento ?? "",
          razonSocial: d.cliente?.razonSocial ?? "Cliente",
          direccion: d.cliente?.direccion ?? undefined,
        },
        items: d.items,
        totales: d.totales,
        moneda: d.moneda,
        hashCpe: d.hashCpe,
        observaciones: d.observaciones,
        empresa: d.empresa,
        emisor: d.emisor,
        formaPago: d.formaPago ?? undefined,
        fechaVencimiento: d.fechaVencimiento ?? undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.serieNumero || "comprobante"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErrorMsg("No se pudo descargar el PDF automáticamente. Puedes bajarlo desde 'Ver comprobantes'.");
    } finally {
      setDescargando(false);
    }
  }

  async function emitir(confirmarDuplicado = false) {
    setErrorMsg(null);
    setResultado(null);
    if (tipo === "01" && !docEsRuc) {
      setErrorMsg("Para FACTURA el receptor debe tener RUC (11 dígitos). Para personas naturales emite BOLETA.");
      return;
    }
    setEmitiendo(true);
    try {
      const plazo = formaPago === "Credito" ? diasHasta(fechaVenc) : 0;
      // Si venimos de un pedido → /emitir (vincula el comprobante al pedido, su
      // cobranza y el badge "Facturado"). Si es emisión suelta → /emitir-manual.
      // Misma interfaz para ambos; solo cambia el endpoint y el armado del payload.
      const res = pedidoId
        ? await fetch("/api/comprobantes/emitir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pedido_id: pedidoId,
              tipo,
              formaPago,
              plazoDias: plazo,
              confirmarDuplicado,
              autorizacion_id: autorizacionId ?? undefined,
              // Datos del receptor tal como están en el form (precargados del
              // pedido + editables/consultables por el usuario).
              cliente_override: {
                numDocumento: numDoc.trim(),
                razonSocial: razonSocial.trim(),
                direccion: direccionCliente.trim() || undefined,
              },
              items_override: items.map((it) => ({
                producto_nombre: it.descripcion.trim(),
                cantidad: Number(it.cantidad),
                unidad: it.unidad,
                precio_unitario: Number(it.precio),
                codigo: it.codigo,
              })),
            }),
          })
        : await fetch("/api/comprobantes/emitir-manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tipo,
              empresa,
              cliente: {
                id: clienteId || undefined,
                numDocumento: numDoc.trim(),
                razonSocial: razonSocial.trim(),
                direccion: direccionCliente.trim() || undefined,
              },
              items: items.map((it) => ({
                codigo: it.codigo,
                descripcion: it.descripcion.trim(),
                unidad: it.unidad,
                cantidad: Number(it.cantidad),
                precio_unitario: Number(it.precio),
              })),
              formaPago,
              plazoDias: plazo,
              confirmarDuplicado,
              autorizacion_id: autorizacionId ?? undefined,
            }),
          });
      const j = await res.json();
      if (res.status === 409 && j?.duplicado) {
        // El backend encontró un comprobante igual reciente: pedimos confirmación
        // antes de duplicar (no es un error, es una guarda).
        setDuplicado({
          id: j.duplicado.id,
          serieNumero: j.duplicado.serieNumero,
          fecha: j.duplicado.fecha,
          mensaje: typeof j.mensaje === "string" ? j.mensaje : "Ya existe un comprobante igual.",
        });
      } else if (!res.ok) {
        setErrorMsg(typeof j.error === "string" ? j.error : "No se pudo emitir. Revisa los datos.");
      } else {
        setResultado(j);
        const emitidoOk =
          j?.estado === "ACEPTADA" ||
          j?.estado === "ACEPTADA_CON_OBSERVACIONES" ||
          j?.estado === "PENDIENTE";
        if (j?.id && emitidoOk) void descargarPdf(j.id);
      }
    } catch {
      setErrorMsg("Error de conexión al emitir.");
    } finally {
      setEmitiendo(false);
    }
  }

  const aceptado =
    resultado?.estado === "ACEPTADA" || resultado?.estado === "ACEPTADA_CON_OBSERVACIONES";
  const pendiente = resultado?.estado === "PENDIENTE";

  function reset() {
    setResultado(null);
    setErrorMsg(null);
    setNumDoc("");
    setRazonSocial("");
    setDireccionCliente("");
    setDocInfo(null);
    setClienteId(null);
    setBusquedaCliente("");
    setItems([{ descripcion: "", cantidad: 1, unidad: "NIU", precio: 0 }]);
  }

  const theme = {
    bg: empresa === "transavic" ? "bg-red-600" : "bg-amber-500",
    bgHover: empresa === "transavic" ? "hover:bg-red-700" : "hover:bg-amber-600",
    text: empresa === "transavic" ? "text-red-600" : "text-amber-600",
    textHover: empresa === "transavic" ? "hover:text-red-700" : "hover:text-amber-700",
    ring: empresa === "transavic" ? "focus:ring-red-500 focus:border-red-500 border-gray-300" : "focus:ring-amber-500 focus:border-amber-500 border-gray-300",
    ringAccent: empresa === "transavic" ? "accent-red-600" : "accent-amber-500",
    buttonDisabled: empresa === "transavic" ? "disabled:bg-red-300" : "disabled:bg-amber-300",
    bgLight: empresa === "transavic" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200",
  };

  // Segmented Control Premium estilo iOS con micro-animaciones fluidas
  const SegmentedControl = <T extends string>({
    options,
    active,
    onChange,
  }: {
    options: { value: T; label: string }[];
    active: T;
    onChange: (val: T) => void;
  }) => (
    <div className="bg-gray-100/80 p-1 flex rounded-xl border border-gray-200/50 shadow-inner w-full">
      {options.map((opt) => {
        const isActive = opt.value === active;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer active:scale-98 flex items-center justify-center gap-1.5 ${
              isActive
                ? `${theme.bg} text-white shadow-md shadow-gray-200/30 scale-[1.01]`
                : "text-gray-600 hover:text-gray-800 hover:bg-white/40"
            }`}
          >
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto pb-16 px-4">
      {/* Volver y Título */}
      <button
        onClick={onClose ?? (() => router.push("/dashboard/comprobantes"))}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors font-semibold cursor-pointer"
      >
        <FiArrowLeft /> {onClose ? "Cerrar" : "Volver a comprobantes"}
      </button>
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-gray-150 pb-5">
        <div>
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-2 tracking-tight">
            <FiFileText className={theme.text} /> {pedidoId ? "Facturar pedido" : "Emitir comprobante"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {pedidoId
              ? `Facturando el pedido de ${pedidoCliente ?? "—"}. Al emitir, el comprobante queda vinculado al pedido. Puedes ajustar cantidades y precios abajo.`
              : "Generación manual de factura o boleta electrónica suelta (sin pedido asociado)."}
          </p>
        </div>

      </div>

      {/* SUNAT caído: aviso amigable */}
      {resultado?.sunatCaido && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-amber-800">
            <FiAlertCircle className="text-amber-600 flex-shrink-0" />
            SUNAT no está respondiendo en este momento
          </div>
          <p className="text-sm text-amber-800 mt-2 leading-relaxed">
            Es un problema de los <strong>servidores de SUNAT</strong>, no del
            sistema. El comprobante <strong>NO se emitió</strong>. Mientras SUNAT se
            normaliza, emítelo <strong>manualmente desde el portal de SUNAT
            (SEE-SOL)</strong> y vuelve a intentarlo aquí más tarde.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={reset}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 cursor-pointer"
            >
              Entendido
            </button>
            <button
              onClick={() => router.push("/dashboard/comprobantes")}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 cursor-pointer"
            >
              Ver comprobantes
            </button>
          </div>
        </div>
      )}

      {/* Resultado Exitoso / Fallido (Ticket Digital Premium) */}
      {resultado && !resultado.sunatCaido && (
        <div className="max-w-md mx-auto my-4 animate-[fadeIn_0.3s_ease-out]">
          <div className={`bg-white rounded-3xl shadow-2xl border-t-8 overflow-hidden relative border-b border-gray-200 ${
            aceptado 
              ? "border-t-green-500 shadow-green-100/20" 
              : pendiente 
                ? "border-t-amber-500 shadow-amber-100/20" 
                : "border-t-red-500 shadow-red-100/20"
          }`}>
            
            {/* Cabecera del Ticket */}
            <div className="p-6 text-center space-y-3 bg-gradient-to-b from-gray-50/50 to-white">
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={EMPRESA_UI[empresa].logo}
                  alt=""
                  className="h-16 w-16 rounded-2xl object-cover border-2 border-white shadow-md flex-shrink-0"
                />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Comprobante de Venta</span>
                <h3 className="text-lg font-black text-gray-800 leading-tight px-4">
                  {empresasMap[empresa].razonSocial}
                </h3>
                <span className="text-xs text-gray-500 font-bold block mt-0.5">RUC: {empresasMap[empresa].ruc}</span>
              </div>
              
              {/* Badge de Estado */}
              <div className="flex justify-center mt-2">
                <div className={`px-4 py-1.5 rounded-full font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm border ${
                  aceptado
                    ? "bg-green-50 text-green-700 border-green-200"
                    : pendiente
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-red-50 text-red-700 border-red-200"
                }`}>
                  {aceptado ? (
                    <FiCheckCircle size={13} className="text-green-600 animate-bounce" />
                  ) : (
                    <FiAlertCircle size={13} className={pendiente ? "text-amber-600 animate-pulse" : "text-red-600"} />
                  )}
                  <span>
                    {resultado.estado === "ACEPTADA" ? "ACEPTADO POR SUNAT" : resultado.estado}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Detalles del Comprobante */}
            <div className="px-6 pb-8 space-y-4">
              <div className="border-t border-dashed border-gray-200 pt-4 text-xs space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">Serie y Número:</span>
                  <span className="font-bold text-gray-800 font-mono text-sm">{resultado.serieNumero}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">Fecha Emisión:</span>
                  <span className="font-semibold text-gray-800">{formatFechaLegible(isoLocalMasDias(0))}</span>
                </div>
                <div className="flex justify-between items-start gap-4">
                  <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Cliente:</span>
                  <span className="font-bold text-gray-800 truncate text-right text-xs" title={razonSocial || "CLIENTES VARIOS"}>
                    {razonSocial || "CLIENTES VARIOS"}
                  </span>
                </div>
                {numDoc && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">Documento:</span>
                    <span className="font-semibold text-gray-800 font-mono">{numDoc}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">Forma de Pago:</span>
                  <span className="font-bold text-gray-800 uppercase tracking-wide text-[10px]">{formaPago === "Credito" ? `CRÉDITO (${diasHasta(fechaVenc)} días)` : "CONTADO"}</span>
                </div>
              </div>
              
              {/* Tabla de ítems en el Ticket */}
              <div className="border-t border-dashed border-gray-200 pt-4">
                <span className="block font-black text-gray-400 uppercase tracking-widest text-[9px] mb-2.5">Desglose de Ítems</span>
                <div className="max-h-36 overflow-y-auto space-y-2 pr-1.5 custom-scrollbar">
                  {items.map((it, idx) => (
                    <div key={idx} className="flex justify-between text-xs leading-snug">
                      <span className="text-gray-600 font-medium max-w-[240px] truncate">
                        {it.cantidad} {it.unidad.toLowerCase()} x {it.descripcion}
                      </span>
                      <span className="font-mono text-gray-800 font-bold">
                        {money(it.precio * it.cantidad)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Resumen Financiero */}
              <div className="border-t border-dashed border-gray-200 pt-4 space-y-1.5 text-xs">
                <div className="flex justify-between text-gray-500 font-medium">
                  <span>Op. Gravada (sin IGV):</span>
                  <span className="font-mono">{money(totales.neto)}</span>
                </div>
                <div className="flex justify-between text-gray-500 font-medium">
                  <span>IGV (18%):</span>
                  <span className="font-mono">{money(totales.igv)}</span>
                </div>
                <div className="flex justify-between font-black text-gray-850 text-base pt-2 border-t border-gray-200">
                  <span>TOTAL COMPROBANTE:</span>
                  <span className="font-mono text-gray-900">{money(totales.total)}</span>
                </div>
              </div>
              
              {/* Mensaje de SUNAT o Error */}
              {(resultado.descripcion || resultado.mensaje || resultado.error) && (
                <div className={`p-3 rounded-xl text-[11px] font-semibold border leading-normal ${
                  aceptado 
                    ? "bg-green-50/70 border-green-150 text-green-800" 
                    : pendiente 
                      ? "bg-amber-50/70 border-amber-150 text-amber-800" 
                      : "bg-red-50/70 border-red-150 text-red-800"
                }`}>
                  <p className="whitespace-pre-wrap">
                    {resultado.descripcion || resultado.mensaje || resultado.error}
                  </p>
                </div>
              )}
              
              {/* Acciones del Ticket */}
              <div className="border-t border-dashed border-gray-200 pt-4 space-y-2.5">
                {resultado.id && (aceptado || pendiente) && (
                  <button
                    onClick={() => resultado.id && descargarPdf(resultado.id)}
                    disabled={descargando}
                    className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-black hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-98 cursor-pointer"
                  >
                    {descargando ? <FiLoader className="animate-spin" /> : <FiDownload />}
                    {descargando ? "Generando PDF…" : "Descargar PDF Comprobante"}
                  </button>
                )}
                
                <div className="flex gap-2">
                  <button
                    onClick={reset}
                    className={`flex-1 py-2.5 ${theme.bg} hover:${theme.bgHover} text-white rounded-xl text-xs font-black shadow-sm transition-all active:scale-[0.97] cursor-pointer`}
                  >
                    Emitir otro
                  </button>
                  <button
                    onClick={() => router.push("/dashboard/comprobantes")}
                    className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all active:scale-[0.97] cursor-pointer"
                  >
                    Ver comprobantes
                  </button>
                </div>
              </div>
            </div>
            
            {/* Efecto visual de corte térmico en el footer */}
            <div className="h-2 w-full flex overflow-hidden absolute bottom-0 left-0 text-gray-100">
              {Array.from({ length: 30 }).map((_, i) => (
                <div key={i} className="w-4 h-4 bg-gray-50 rotate-45 transform origin-top-left -translate-y-2 border-t border-l border-gray-200/20 flex-shrink-0" />
              ))}
            </div>
            
          </div>
        </div>
      )}

      {/* Formulario Principal */}
      {!resultado && (
        <div className={`grid grid-cols-1 gap-6 animate-[fadeIn_0.2s_ease-out] ${esModal ? "" : "lg:grid-cols-3 items-start"}`}>
          
          {/* COLUMNA IZQUIERDA: Receptor e Items */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* ─────────────────────────────────────────────────────────────
                Paso 1 · Tipo de comprobante + Empresa.
                Ambos definen las REGLAS del resto del form: el tipo (factura
                vs boleta) cambia si el RUC es obligatorio; la empresa cambia
                colores y RUC emisor. Por eso van juntos arriba del todo.
            ───────────────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
              <SectionHeader paso={1} titulo="Tipo y empresa emisora" />

              {/* Tipo Factura/Boleta — antes vivía en la columna derecha; lo
                  movemos acá porque DEFINE el resto del flujo. */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Tipo de comprobante
                </label>
                <SegmentedControl
                  options={[
                    { value: "01", label: "Factura" },
                    { value: "03", label: "Boleta" },
                  ]}
                  active={tipo}
                  onChange={(val) => setTipo(val)}
                />
                <p className="text-[10px] text-gray-500 leading-snug pt-0.5">
                  {tipo === "01"
                    ? "RUC del cliente es obligatorio. Para empresas."
                    : "DNI o RUC del cliente. Para consumidor final."}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Empresa emisora
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {(["transavic", "avicola"] as Empresa[]).map((emp) => {
                    const ui = EMPRESA_UI[emp];
                    const activo = empresa === emp;
                    return (
                      <button
                        key={emp}
                        type="button"
                        onClick={() => setEmpresa(emp)}
                        className={`relative flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all active:scale-[0.98] duration-200 cursor-pointer ${
                          activo ? `${ui.ring} ${ui.bg}` : "border-gray-200 bg-white hover:border-gray-300 hover:scale-[1.01]"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ui.logo}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover border border-gray-100 flex-shrink-0 shadow-sm"
                        />
                        <div className="min-w-0">
                          <div className={`font-black text-xs truncate ${activo ? ui.texto : "text-gray-800"}`}>
                            {ui.nombre}
                          </div>
                          <div className="text-[10px] text-gray-400 font-bold truncate mt-0.5">RUC {empresasMap[emp].ruc}</div>
                        </div>
                        {activo && (
                          <FiCheckCircle className={`absolute top-2 right-2 h-4 w-4 ${ui.texto}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            
            {/* Card 1: Receptor / Cliente */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
              <SectionHeader paso={2} titulo="Datos del cliente / receptor" />


              <div className="space-y-4">
                {/* Buscador inteligente de Clientes Registrados */}
                <div ref={clientSearchRef} className="relative">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                    🔍 Buscar Cliente Registrado <span className="text-[10px] text-gray-400 font-normal lowercase">(Base de Datos)</span>
                  </label>
                  <div className="relative">
                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                      type="text"
                      value={busquedaCliente}
                      onChange={(e) => setBusquedaCliente(e.target.value)}
                      placeholder="Escribe el nombre, RUC o DNI del cliente..."
                      className={`w-full pl-9 pr-10 p-2.5 border rounded-lg text-sm bg-white text-black font-semibold focus:ring-2 focus:outline-none ${theme.ring}`}
                    />
                    {busquedaCliente && (
                      <button
                        type="button"
                        onClick={clearClienteSearch}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold p-1 cursor-pointer"
                        title="Limpiar campos"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  
                  {/* Sugerencias de clientes */}
                  {showSugerencias && sugerenciasClientes.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto">
                      <div className="px-3 py-1.5 text-[10px] font-black text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-gray-50/50">
                        Clientes Coincidentes ({sugerenciasClientes.length})
                      </div>
                      {sugerenciasClientes.map((cli) => (
                        <button
                          key={cli.id}
                          type="button"
                          onClick={() => handleSelectCliente(cli)}
                          className="w-full px-4 py-2.5 text-left hover:bg-gray-50 transition-colors flex flex-col justify-center border-b border-gray-50 last:border-0 cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-gray-900">{cli.nombre}</span>
                            {cli.ruc_dni && (
                              <span className={`text-[9px] px-2 py-0.5 font-bold rounded-full ${
                                cli.ruc_dni.length === 11 ? "bg-red-50 text-red-700 border border-red-100" : "bg-blue-50 text-blue-700 border border-blue-100"
                              }`}>
                                {cli.ruc_dni.length === 11 ? "RUC" : "DNI"}: {cli.ruc_dni}
                              </span>
                            )}
                          </div>
                          {cli.razon_social && cli.razon_social !== cli.nombre && (
                            <span className="text-xs text-gray-500 italic mt-0.5 truncate">{cli.razon_social}</span>
                          )}
                          {cli.direccion && (
                            <span className="text-[10px] text-gray-450 truncate mt-0.5">📍 {cli.direccion}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {cargandoSugerencias && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <FiLoader className="animate-spin text-gray-400" size={16} />
                    </div>
                  )}
                </div>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-gray-150"></div>
                  <span className="flex-shrink mx-3 text-[10px] text-gray-400 font-bold uppercase tracking-widest bg-white">
                    o ingresa los datos manualmente
                  </span>
                  <div className="flex-grow border-t border-gray-150"></div>
                </div>

                {clienteSinDoc && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <FiAlertCircle className="mt-0.5 flex-shrink-0" size={14} />
                    <span>
                      <strong>{razonSocial.trim() || "Este cliente"}</strong> no tiene RUC/DNI guardado.{" "}
                      {tipo === "01" ? "Para emitir la factura," : "Para identificarlo,"} escríbelo abajo
                      y toca <strong>Consultar</strong>: SUNAT trae sus datos y lo guardamos en su ficha
                      para la próxima.
                    </span>
                  </div>
                )}
                {/* RUC / DNI Input + Consultar button */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                    {tipo === "01"
                      ? "RUC del cliente (Requerido)"
                      : clienteOpcional
                        ? "DNI / RUC del cliente (Opcional)"
                        : "DNI / RUC del cliente (Requerido)"}
                  </label>
                  <div className="flex flex-col md:flex-row gap-2">
                    <input
                      value={numDoc}
                      onChange={(e) => {
                        setNumDoc(e.target.value.replace(/\D/g, ""));
                        setClienteId(null); // Limpiar vinculación al digitar a mano
                        setDocInfo(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && consultar()}
                      placeholder={tipo === "01" ? "RUC (11 dígitos)" : "DNI (8) o RUC (11)"}
                      inputMode="numeric"
                      maxLength={11}
                      className={`flex-1 p-2.5 border rounded-lg text-sm bg-white text-black font-semibold focus:ring-2 focus:outline-none ${theme.ring}`}
                    />
                    <button
                      type="button"
                      onClick={consultar}
                      disabled={consultando}
                      className="w-full md:w-auto shrink-0 px-4 py-2.5 bg-gray-800 text-white rounded-lg text-sm font-bold hover:bg-gray-900 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                    >
                      {consultando ? <FiLoader className="animate-spin" /> : <FiSearch />} Consultar
                    </button>
                  </div>
                  {consultaMsg && <p className="text-xs text-red-650 mt-1.5 font-bold">{consultaMsg}</p>}
                  {docInfo && (
                    <div className="mt-2 flex gap-2 text-[10px]">
                      <span
                        className={`px-2 py-0.5 rounded-full font-black ${
                          docInfo.estado === "ACTIVO" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {docInfo.estado || "—"}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-black ${
                          docInfo.condicion === "HABIDO" ? "bg-green-50 text-green-700 border border-green-200" : "bg-yellow-50 text-yellow-700 border border-yellow-250"
                        }`}
                      >
                        {docInfo.condicion || "—"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Razón Social */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                    {tipo === "01" ? "Razón social" : "Nombre completo"}
                  </label>
                  <input
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                    placeholder={tipo === "01" ? "Razón social (de la empresa)" : "Nombre completo del cliente"}
                    className={`w-full p-2.5 border rounded-lg text-sm bg-white text-black font-semibold focus:ring-2 focus:outline-none ${theme.ring}`}
                  />
                </div>

                {/* Dirección */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                    Dirección Fiscal / Entrega
                  </label>
                  <input
                    value={direccionCliente}
                    onChange={(e) => setDireccionCliente(e.target.value)}
                    placeholder="Dirección fiscal del cliente (se autocompleta con RUC)"
                    maxLength={250}
                    className={`w-full p-2.5 border rounded-lg text-sm bg-white text-black font-semibold focus:ring-2 focus:outline-none ${theme.ring}`}
                  />
                </div>
              </div>
            </div>

            {/* Card 2: Items / Detalle del Comprobante */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <SectionHeader paso={3} titulo="Ítems del comprobante" sinBorde />

                <button
                  type="button"
                  onClick={addItem}
                  className={`flex items-center gap-1 text-xs font-black ${theme.text} hover:${theme.textHover} transition-all duration-200 cursor-pointer active:scale-95`}
                >
                  <FiPlus /> Agregar ítem
                </button>
              </div>

              {/* Header de columnas para desktop */}
              <div className="hidden md:flex gap-2 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                <span className="w-20">Cód.</span>
                <span className="flex-1">Descripción (Catálogo / Libre)</span>
                <span className="w-20 text-center">Cant.</span>
                <span className="w-24">Unidad</span>
                <span className="w-28 pl-6">Precio c/IGV</span>
                <span className="w-10"></span>
              </div>

              {/* Lista de Items */}
              <div className="space-y-3">
                {items.map((it, i) => (
                  <div key={i} className="relative flex flex-col md:flex-row gap-2 md:items-center bg-gray-50 md:bg-transparent p-3.5 md:p-0 rounded-xl border md:border-none border-gray-200 transition-all">
                    {/* Mobile vs Desktop: Codigo & Descripcion */}
                    <div className="flex flex-col md:flex-row gap-2 flex-grow pr-8 md:pr-0">
                      {/* Código (Editable) */}
                      <div className="w-full md:w-20">
                        <label className="block md:hidden text-[9px] font-bold text-gray-455 uppercase mb-0.5">Código</label>
                        <input
                          value={it.codigo ?? ""}
                          onChange={(e) => updateItem(i, { codigo: e.target.value })}
                          placeholder="Cód."
                          title="Código interno del producto"
                          className={`w-full p-2 border rounded-lg text-sm bg-white text-gray-600 font-semibold focus:ring-2 focus:outline-none ${theme.ring} ${
                            pulseIndex === i ? "animate-pulse ring-2 ring-emerald-400 border-emerald-400 bg-emerald-50/10" : ""
                          }`}
                        />
                      </div>

                      {/* Descripción / Buscador de Catálogo */}
                      <div className="flex-1">
                        <label className="block md:hidden text-[9px] font-bold text-gray-455 uppercase mb-0.5">Producto (Buscador / Libre)</label>
                        <input
                          value={it.descripcion}
                          list="catalogo-productos"
                          onChange={(e) => onDescripcion(i, e.target.value)}
                          placeholder="Escribe el nombre del producto..."
                          className={`w-full p-2 border rounded-lg text-sm bg-white text-black font-semibold focus:ring-2 focus:outline-none ${theme.ring}`}
                        />
                      </div>
                    </div>

                    {/* Quantities, Unit, Price, and Remove */}
                    <div className="grid grid-cols-3 gap-2 w-full mt-2.5 pt-2.5 border-t border-gray-150 md:flex md:gap-2 md:items-center md:mt-0 md:pt-0 md:border-0 md:w-auto">
                      
                      {/* Cantidad */}
                      <div className="w-full md:w-20">
                        <label className="block md:hidden text-[9px] font-bold text-gray-455 uppercase mb-0.5">Cant.</label>
                        <input
                          type="number"
                          value={it.cantidad || ""}
                          min={0}
                          step="0.01"
                          onChange={(e) => updateItem(i, { cantidad: parseFloat(e.target.value) || 0 })}
                          className={`w-full p-2 border rounded-lg text-sm bg-white text-black text-center font-bold focus:ring-2 focus:outline-none ${theme.ring}`}
                        />
                      </div>

                      {/* Unidad */}
                      <div className="w-full md:w-24">
                        <label className="block md:hidden text-[9px] font-bold text-gray-455 uppercase mb-0.5">Unidad</label>
                        <select
                          value={it.unidad}
                          onChange={(e) => updateItem(i, { unidad: e.target.value })}
                          className={`w-full p-2 border rounded-lg text-sm bg-white text-black font-semibold focus:ring-2 focus:outline-none ${theme.ring} ${
                            pulseIndex === i ? "animate-pulse ring-2 ring-emerald-400 border-emerald-400 bg-emerald-50/10" : ""
                          }`}
                        >
                          <option value="NIU">Unidad</option>
                          <option value="KGM">Kg</option>
                        </select>
                      </div>

                      {/* Precio Unitario */}
                      <div className="w-full md:w-28 relative">
                        <label className="block md:hidden text-[9px] font-bold text-gray-455 uppercase mb-0.5">Precio c/IGV</label>
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 md:top-2 md:translate-y-0 text-gray-455 text-xs font-semibold">S/</span>
                        <input
                          type="number"
                          value={it.precio || ""}
                          min={0}
                          step="0.01"
                          onChange={(e) => updateItem(i, { precio: parseFloat(e.target.value) || 0 })}
                          placeholder="0.00"
                          className={`w-full pl-6 p-2 border rounded-lg text-sm bg-white text-black font-bold focus:ring-2 focus:outline-none ${theme.ring} ${
                            pulseIndex === i ? "animate-pulse ring-2 ring-emerald-400 border-emerald-400 bg-emerald-50/10" : ""
                          }`}
                        />
                      </div>
                    </div>

                    {/* Botón de Eliminar en Móvil (Esquina Superior Derecha) o en Escritorio (Fin de la fila) */}
                    <div className="absolute top-2 right-2 md:relative md:top-auto md:right-auto">
                      <label className="hidden md:block text-[9px] font-bold text-transparent mb-0.5">Acción</label>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        disabled={items.length === 1}
                        className="p-2 text-gray-455 hover:text-red-650 disabled:opacity-30 transition-colors rounded-lg hover:bg-red-50 cursor-pointer"
                        title="Quitar ítem"
                      >
                        <FiTrash2 size={16} />
                      </button>
                    </div>

                    {/* Error de precio mínimo por ítem */}
                    {(() => {
                      const prod = productos.find(
                        (p) => p.nombre.trim().toLowerCase() === it.descripcion.trim().toLowerCase()
                      );
                      const minimo = prod && Number(prod.precio_venta) > 0 ? Number(prod.precio_venta) : 0;
                      return minimo > 0 && Number(it.precio) < minimo ? (
                        <p className="w-full md:col-span-full text-xs text-red-600 mt-1 flex items-center gap-1">
                          <FiAlertCircle className="flex-shrink-0 w-3 h-3" />
                          Precio menor al mínimo del catálogo (S/ {minimo.toFixed(2)})
                        </p>
                      ) : null;
                    })()}
                  </div>
                ))}
              </div>

              {/* Catálogo datalist */}
              <datalist id="catalogo-productos">
                {productos.map((p) => (
                  <option key={p.id} value={p.nombre.trim()}>
                    {p.categoria}
                    {Number(p.precio_venta) > 0 ? ` · S/ ${Number(p.precio_venta).toFixed(2)}` : ""}
                  </option>
                ))}
              </datalist>

              <p className="text-[11px] text-gray-400 mt-2 font-medium bg-gray-50 p-2.5 rounded-lg border border-gray-100 leading-normal">
                💡 <strong>Consejo del catálogo:</strong> Al seleccionar un producto del catálogo se autocompletan el <strong>precio y la unidad</strong> solos. Los precios incluyen IGV y puedes editarlos a mano.
              </p>
            </div>
          </div>

          {/* COLUMNA DERECHA: Configuración y Totales (Sticky) */}
          <div className={`lg:col-span-1 space-y-6 ${esModal ? "" : "lg:sticky lg:top-4"}`}>


            {/* Card 4: Parámetros del Comprobante */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
              <SectionHeader paso={4} titulo="Forma de pago" />

              <div className="space-y-4">
                {/* Forma de Pago Segmented Control */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase">Forma de pago</label>
                  <SegmentedControl
                    options={[
                      { value: "Contado", label: "Contado" },
                      { value: "Credito", label: "Crédito" },
                    ]}
                    active={formaPago}
                    onChange={(val) => setFormaPago(val)}
                  />

                  {/* Configuración de Crédito */}
                  {formaPago === "Credito" && (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2 mt-2 animate-[slideDown_0.2s_ease-out]">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-gray-700 font-bold whitespace-nowrap">Vencimiento:</label>
                        <input
                          type="date"
                          value={fechaVenc}
                          min={isoLocalMasDias(0)}
                          onChange={(e) => setFechaVenc(e.target.value)}
                          className={`p-2 border rounded-lg text-xs bg-white text-gray-900 font-bold focus:ring-2 focus:outline-none ${theme.ring}`}
                        />
                      </div>
                      <div className="flex gap-1.5 justify-end">
                        {[7, 15, 30, 45].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setFechaVenc(isoLocalMasDias(d))}
                            className="px-2.5 py-1 text-[10px] font-black rounded-md border border-gray-200 text-gray-600 bg-white hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer active:scale-95 shadow-sm"
                          >
                            +{d}d
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 font-medium leading-normal pt-1.5 border-t border-gray-200">
                        🗓️ Vence el <strong>{formatFechaLegible(fechaVenc)}</strong> ({diasHasta(fechaVenc)} días). Crea deuda automática en Cobranzas.
                      </p>
                    </div>
                  )}

                  {/* Toda venta crea cobranza (sin excepción). Si el cliente ya
                      pagó, la asesora la marca como pagada en /cobranzas. */}
                  {formaPago === "Contado" && (
                    <p className="mt-2 text-[11px] text-gray-500 font-medium leading-normal bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                      Se registrará una <strong>cobranza pendiente</strong> para seguir el pago. Si el cliente ya pagó, márcala como pagada en <strong>Cobranzas</strong>.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Card 5: Resumen y Emisión */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
              <SectionHeader paso={5} titulo="Resumen y emitir" />


              <div className="space-y-2 text-xs font-semibold text-gray-500">
                <div className="flex justify-between">
                  <span>Op. gravada (sin IGV)</span>
                  <span className="font-mono">{money(totales.neto)}</span>
                </div>
                <div className="flex justify-between">
                  <span>IGV (18%)</span>
                  <span className="font-mono">{money(totales.igv)}</span>
                </div>
                <div className="flex justify-between font-black text-gray-900 text-lg pt-2 border-t border-gray-100">
                  <span>Total</span>
                  <span className={`font-mono ${theme.text}`}>{money(totales.total)}</span>
                </div>
              </div>

              {/* Panel de Validación Dinámica (No me hagas pensar) */}
              <div className="bg-gray-50 border border-gray-200/80 rounded-xl p-3.5 space-y-2.5 text-[11px] leading-snug">
                <span className="block font-black text-gray-400 uppercase tracking-wider text-[9px]">
                  📋 Requisitos del Comprobante
                </span>
                
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-gray-700">
                    <FiCheckCircle className="text-green-600 mt-0.5 flex-shrink-0" size={14} />
                    <div className="min-w-0">
                      <span>Emisor activo: <strong>{EMPRESA_UI[empresa].nombre}</strong></span>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    {reqs.clienteValido ? (
                      <FiCheckCircle className="text-green-600 mt-0.5 flex-shrink-0" size={14} />
                    ) : (
                      <FiAlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={14} />
                    )}
                    <div className="min-w-0">
                      <span className={reqs.clienteValido ? "text-gray-750" : "text-red-650 font-bold"}>
                        Receptor: {reqs.descCliente}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    {reqs.itemsValidos ? (
                      <FiCheckCircle className="text-green-600 mt-0.5 flex-shrink-0" size={14} />
                    ) : (
                      <FiAlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={14} />
                    )}
                    <div className="min-w-0">
                      <span className={reqs.itemsValidos ? "text-gray-750" : "text-red-650 font-bold"}>
                        Ítems: {reqs.itemsValidos 
                          ? `${reqs.itemsCount} producto(s) listo(s).`
                          : "Agrega productos con descripción, cantidad y precio válido."}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Banner de autorización activa */}
              {autorizacionId && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                  <FiCheckCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Autorización aprobada.</strong> Puedes emitir con el precio solicitado.
                    {" "}
                    <button
                      className="underline text-amber-700 hover:text-amber-900"
                      onClick={() => setAutorizacionId(null)}
                    >
                      Quitar
                    </button>
                  </span>
                </div>
              )}

              {/* Bloque de precio mínimo: error + botón de solicitar */}
              {reqs.necesitaAutorizacion && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-3 space-y-2">
                  <p className="text-xs text-red-700 font-semibold flex items-center gap-1.5">
                    <FiAlertCircle className="w-4 h-4 flex-shrink-0" />
                    Uno o más ítems tienen precio por debajo del mínimo del catálogo.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowModalAutorizacion(true)}
                    className="w-full py-2 text-xs font-semibold bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors active:scale-[0.97]"
                  >
                    Solicitar autorización al admin
                  </button>
                </div>
              )}

              {errorMsg && <p className="text-xs text-red-600 font-bold bg-red-50 p-2.5 rounded-lg border border-red-100 leading-normal">{errorMsg}</p>}

              <button
                onClick={() => emitir()}
                disabled={!puedeEmitir || emitiendo}
                className={`w-full py-3.5 ${theme.bg} hover:${theme.bgHover} text-white rounded-xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md hover:shadow-lg active:scale-98 cursor-pointer ${theme.buttonDisabled} disabled:cursor-not-allowed text-sm`}
              >
                {emitiendo ? <FiLoader className="animate-spin" /> : <FiFileText />}
                {emitiendo ? "Enviando a SUNAT…" : `Emitir ${tipo === "01" ? "factura" : "boleta"}`}
              </button>
              {emitiendo && (
                <p className="text-[11px] text-gray-500 text-center font-medium leading-snug -mt-1">
                  Espera unos segundos — SUNAT puede tardar hasta 10s en responder.
                  No cierres ni recargues esta pantalla.
                </p>
              )}
            </div>

          </div>

        </div>
      )}

      {/* Barra flotante de emisión para móviles (Shopify/Amazon style) */}
      {!resultado && (
        <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-gray-200/85 p-3.5 flex items-center justify-between z-30 shadow-[0_-8px_30px_rgb(0,0,0,0.12)]">
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider leading-none">Total a Facturar</span>
            <span className={`text-xl font-mono font-black ${theme.text} mt-0.5`}>{money(totales.total)}</span>
          </div>
          
          <button
            onClick={() => emitir()}
            disabled={!puedeEmitir || emitiendo}
            className={`px-5 py-3 ${theme.bg} hover:${theme.bgHover} text-white rounded-xl font-bold flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all text-xs ${theme.buttonDisabled}`}
          >
            {emitiendo ? <FiLoader className="animate-spin" /> : <FiFileText />}
            {emitiendo ? "Enviando…" : `Emitir ${tipo === "01" ? "factura" : "boleta"}`}
          </button>
        </div>
      )}

      {/* Aviso de comprobante DUPLICADO: guarda antes de emitir uno igual. */}
      {duplicado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 anim-fade">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden anim-modal">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex-shrink-0">
                <FiAlertCircle size={18} />
              </span>
              <h3 className="font-bold text-gray-900">Ya existe un comprobante igual</h3>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p className="text-gray-700">{duplicado.mensaje}</p>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-600">
                <span className="font-mono font-bold text-gray-900">{duplicado.serieNumero}</span>
                <span className="text-gray-400">
                  {" "}· emitido{" "}
                  {new Intl.DateTimeFormat("es-PE", {
                    timeZone: "America/Lima",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  }).format(new Date(duplicado.fecha))}
                </span>
              </div>
              <p className="text-gray-500">
                Si es una venta distinta, puedes emitirlo igual. Si fue por error, revisa el que ya existe.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => setDuplicado(null)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 active:scale-95 transition"
              >
                Cancelar
              </button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => window.open("/dashboard/comprobantes", "_blank")}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 active:scale-95 transition"
                >
                  <FiFileText size={15} /> Ver comprobante
                </button>
                <button
                  onClick={() => {
                    setDuplicado(null);
                    void emitir(true);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 active:scale-95 transition shadow-sm"
                >
                  Sí, emitir igual
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Solicitar autorización de precio mínimo */}
      {showModalAutorizacion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 anim-fade">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden anim-modal">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex-shrink-0">
                <FiAlertCircle size={18} />
              </span>
              <div>
                <h3 className="font-bold text-gray-900 text-sm">Solicitar autorización de precio</h3>
                <p className="text-xs text-gray-500 mt-0.5">El admin recibirá una notificación y podrá aprobar o rechazar</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Tabla de ítems con precio bajo */}
              <div className="bg-gray-50 rounded-xl p-3 text-xs">
                <p className="text-gray-500 font-medium mb-2">Ítems con precio por debajo del mínimo:</p>
                <div className="space-y-1.5">
                  {reqs.itemsConPrecioBajo.map((it, i) => (
                    <div key={i} className="flex justify-between items-center gap-2">
                      <span className="text-gray-800 font-medium truncate">{it.nombre}</span>
                      <span className="flex-shrink-0 text-gray-500">
                        S/ {it.precio_solicitado.toFixed(2)}{" "}
                        <span className="text-red-600">(mín. S/ {it.precio_minimo.toFixed(2)})</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Motivo opcional */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Motivo (opcional)
                </label>
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
                  rows={2}
                  placeholder="Ej: cliente fiel, descuento especial..."
                  value={razonSolicitud}
                  onChange={(e) => setRazonSolicitud(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 justify-end">
              <button
                onClick={() => { setShowModalAutorizacion(false); setRazonSolicitud(""); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                disabled={enviandoSolicitud}
                onClick={async () => {
                  setEnviandoSolicitud(true);
                  try {
                    const res = await fetch("/api/autorizaciones-precio", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        tipo,
                        empresa,
                        items: reqs.itemsConPrecioBajo,
                        razon: razonSolicitud.trim() || undefined,
                      }),
                    });
                    if (res.ok) {
                      setShowModalAutorizacion(false);
                      setRazonSolicitud("");
                      setToastMsg("Solicitud enviada. El admin la revisará y recibirás una notificación.");
                      setTimeout(() => setToastMsg(null), 5000);
                    } else {
                      const data = await res.json().catch(() => ({}));
                      setToastMsg(data.error || "No se pudo enviar la solicitud.");
                      setTimeout(() => setToastMsg(null), 4000);
                    }
                  } catch {
                    setToastMsg("Error de conexión al enviar la solicitud.");
                    setTimeout(() => setToastMsg(null), 4000);
                  } finally {
                    setEnviandoSolicitud(false);
                  }
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors active:scale-[0.97] font-medium"
              >
                {enviandoSolicitud ? "Enviando..." : "Enviar solicitud"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:w-96 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg anim-toast">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// SectionHeader — encabezado numerado de cada paso del wizard.
// El círculo con el número refuerza la idea de "primero hago el paso 1,
// después el 2, …" sin tener que leer la palabra "paso".
// ──────────────────────────────────────────────────────────
function SectionHeader({
  paso,
  titulo,
  sinBorde,
}: {
  paso: number;
  titulo: string;
  sinBorde?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${
        sinBorde ? "" : "border-b border-gray-100 pb-2"
      }`}
    >
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-black flex-shrink-0">
        {paso}
      </span>
      <h2 className="text-sm font-black text-gray-800 uppercase tracking-wider">
        {titulo}
      </h2>
    </div>
  );
}

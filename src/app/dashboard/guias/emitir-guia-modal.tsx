"use client";

import { useEffect, useState, useRef } from "react";
import { Pedido } from "@/lib/types";
import { FiX, FiTruck, FiAlertCircle, FiCheck, FiCalendar, FiFileText, FiMapPin, FiEdit2, FiInfo, FiEye, FiUser, FiPackage } from "react-icons/fi";
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

export interface ComprobanteInfo {
  id: string;
  /** Empresa emisora ('transavic' | 'avicola') — para el banner del emisor */
  empresa?: string | null;
  /** Campos devueltos por /api/comprobantes/[id] */
  cliente?: {
    numDocumento?: string | null;
    tipoDocumento?: string | null;
    razonSocial?: string | null;
    direccion?: string | null;
    distrito?: string | null;
  } | null;
  /** Campos devueltos por /api/comprobantes (lista) — snake_case */
  pedido_direccion?: string | null;
  pedido_distrito?: string | null;
  cliente_razon_social?: string | null;
  cliente_doc_num?: string | null;
  cliente_doc_tipo?: string | null;
}

interface EmitirGuiaModalProps {
  pedido?: Pedido | null;
  comprobante?: ComprobanteInfo | null;
  onClose: () => void;
  onExito?: (serieNumero: string) => void;
}

// DISTRITOS_LIMA, MotorizadoUser, dividirNombreLocal, validarChofer, etc. viven en
// src/lib/guia-form-shared.ts — fuente única compartida con emitir-guia-directa-modal.tsx.

/**
 * Peso bruto + aviso de mixtas a partir de los productos de la guía. El peso es la
 * suma EXACTA solo si TODOS los ítems están en kilogramos (igual que el backend, que
 * lo recalcula así). Con unidades mixtas (kg + uni) queda vacío para que la asesora
 * ingrese el peso real a mano. Misma fórmula en la carga inicial y al editar.
 */
function calcularPesoMixtas(
  items: Array<{ cantidad: number | string; unidad: string }>
): { pesoStr: string; mixtas: boolean } {
  const todosKg =
    items.length > 0 && items.every((it) => aUnitCodeSunat(it.unidad) === "KGM");
  const suma = todosKg
    ? items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0)
    : 0;
  return {
    pesoStr: todosKg && suma > 0 ? suma.toFixed(2) : "",
    mixtas: items.length > 0 && !todosKg,
  };
}

export default function EmitirGuiaModal({ pedido, comprobante, onClose, onExito }: EmitirGuiaModalProps) {
  const [repartidores, setRepartidores] = useState<MotorizadoUser[]>([]);
  const [repartidorId, setRepartidorId] = useState<string>("");
  const [choferDni, setChoferDni] = useState<string>("");
  const [choferLicencia, setChoferLicencia] = useState<string>("");
  const [choferNombres, setChoferNombres] = useState<string>("");
  const [choferApellidos, setChoferApellidos] = useState<string>("");
  const [vehiculoPlaca, setVehiculoPlaca] = useState<string>("");
  
  const [direccionLlegada, setDireccionLlegada] = useState<string>("");
  const [distritoLlegada, setDistritoLlegada] = useState<string>("");

  const [docTipoOverride, setDocTipoOverride] = useState<string>("1"); // 1 = DNI, 6 = RUC
  const [docNumOverride, setDocNumOverride] = useState<string>("");
  const [razonSocialOverride, setRazonSocialOverride] = useState<string>("");

  // Auto-búsqueda RENIEC/SUNAT del destinatario (apisperu) — espeja el form de comprobantes
  const [consultandoDest, setConsultandoDest] = useState(false);
  const [consultaDestMsg, setConsultaDestMsg] = useState<string | null>(null);
  const ultimoDocConsultado = useRef("");
  // Última dirección/distrito que NOSOTROS autollenamos desde la consulta RUC: permite
  // actualizar si el usuario corrige el RUC, sin pisar lo que escribió a mano ni lo
  // que vino del pedido (la dirección de ENTREGA manda sobre la fiscal).
  const dirAutollenada = useRef<string | null>(null);
  const distAutollenado = useRef<string | null>(null);
  // Espejo del estado para leer el valor MÁS RECIENTE dentro de la consulta async
  // (un updater funcional que mute refs es impuro y Strict Mode lo doble-invoca).
  const direccionLlegadaRef = useRef("");
  const distritoLlegadaRef = useRef("");
  useEffect(() => { direccionLlegadaRef.current = direccionLlegada; }, [direccionLlegada]);
  useEffect(() => { distritoLlegadaRef.current = distritoLlegada; }, [distritoLlegada]);

  // Entorno SUNAT real, para el banner (Beta vs Producción). null = aún cargando.
  const [esProduccion, setEsProduccion] = useState<boolean | null>(null);

  // Normalizar doc: puede venir de la API detalle (cliente.numDocumento) o de la lista (cliente_doc_num)
  const originalDoc = pedido?.ruc_dni
    || comprobante?.cliente?.numDocumento
    || comprobante?.cliente_doc_num
    || "";
  const necesitaOverride = !esReceptorIdentificado(originalDoc);

  // Modo de edición: por defecto iniciamos en true (detallado) hasta evaluar si cumple las condiciones de emisión rápida
  const [modoEdicion, setModoEdicion] = useState<boolean>(true);

  // Obtener fecha de hoy en huso horario de Lima (America/Lima) en formato YYYY-MM-DD
  const getTodayLima = () => {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };

  const [fechaInicioTraslado, setFechaInicioTraslado] = useState<string>(getTodayLima());
  const [motivoTraslado, setMotivoTraslado] = useState<string>("01"); // Venta
  const [totalBultos, setTotalBultos] = useState<number>(1);
  const [pesoBrutoTotal, setPesoBrutoTotal] = useState<string>("");
  const [indicadorM1L, setIndicadorM1L] = useState<boolean>(true);
  // Con M1/L los datos del chofer son opcionales → se ocultan y solo se piden si el usuario quiere
  // (o si el pedido ya trae un repartidor con datos). Sin M1/L, siempre visibles (obligatorios).
  const [mostrarChofer, setMostrarChofer] = useState<boolean>(false);
  // `cantidad` admite string para tolerar la edición (campo vacío mientras se tipea);
  // se convierte con Number() al calcular el peso, validar y enviar.
  const [items, setItems] = useState<Array<{ producto_nombre: string; cantidad: number | string; unidad: string }>>([]);
  const [cargandoItems, setCargandoItems] = useState<boolean>(false);
  // true cuando los bienes mezclan kg con otras unidades → el peso NO se autocalcula
  // y se le explica al usuario que debe pesar la carga e ingresarlo a mano.
  const [unidadesMixtas, setUnidadesMixtas] = useState<boolean>(false);
  // true cuando el comprobante/pedido traía un ítem "ENVIO" (flete): se excluye del
  // peso, los bultos y los bienes — la nota bajo el campo Peso lo hace transparente.
  const [envioExcluido, setEnvioExcluido] = useState<boolean>(false);
  // Datos públicos del emisor (RUC + razón social) para el banner de empresa.
  const [empresasMap, setEmpresasMap] = useState<Record<string, { ruc: string; razonSocial: string }> | null>(null);

  // Cargar ítems del origen para autocalcular peso y bultos. Si la guía sale de un
  // PEDIDO que ya tiene factura/boleta aceptada vinculada, los bienes y el peso se
  // toman de la FACTURA (misma fuente que usa el backend al emitir) — así el peso
  // del modal coincide EXACTO con el comprobante y no con las unidades del pedido.
  useEffect(() => {
    let active = true;
    const cargarItems = async () => {
      if (!pedido?.id && !comprobante?.id) return;

      setCargandoItems(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any = null;
        if (pedido?.id) {
          try {
            const resLista = await fetch(`/api/comprobantes?pedido_id=${pedido.id}`);
            if (resLista.ok) {
              const lista = await resLista.json();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const factura = (Array.isArray(lista?.data) ? lista.data : []).find((c: any) =>
                ["01", "03"].includes(c.tipo) && ["aceptado", "observado"].includes(c.estado)
              );
              if (factura?.id) {
                const resDet = await fetch(`/api/comprobantes/${factura.id}`);
                if (resDet.ok) data = await resDet.json();
              }
            }
          } catch {
            // sin factura vinculada → caemos a los ítems del pedido
          }
          if (!data) {
            const res = await fetch(`/api/pedidos/${pedido.id}`);
            if (!res.ok) throw new Error("Fallo al obtener ítems");
            data = await res.json();
          }
        } else if (comprobante?.id) {
          const res = await fetch(`/api/comprobantes/${comprobante.id}`);
          if (!res.ok) throw new Error("Fallo al obtener ítems");
          data = await res.json();
        }

        if (active && data) {
          const parsedItems = data.items || [];
          const mappedSinFiltrar = parsedItems
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((it: any) => ({
              producto_nombre: it.producto_nombre || it.descripcion || "Venta",
              cantidad: Number(it.cantidad_real ?? it.cantidad ?? 0),
              unidad: it.unidad || it.unidad_medida || it.unidadMedida || "NIU",
            }));
          // El flete ("ENVIO") es un servicio facturable, no un bien transportable
          const mappedItems = mappedSinFiltrar
            .filter((it: { producto_nombre: string }) => !/^env[ií]o$/i.test(it.producto_nombre.trim()));
          setEnvioExcluido(mappedSinFiltrar.length !== mappedItems.length);
          setItems(mappedItems);

          // Peso/bultos/mixtas desde los ítems (= el peso de la factura cuando todos
          // son kg). El recálculo al editar vive en el useEffect([items]) de abajo.
          const { pesoStr, mixtas } = calcularPesoMixtas(mappedItems);
          setTotalBultos(Math.max(1, mappedItems.length));
          setPesoBrutoTotal(pesoStr);
          setUnidadesMixtas(mixtas);

          // Punto de llegada = dirección de la FACTURA (pedido de Hugo: los clientes
          // piden que la guía coincida con la factura). Solo al emitir DESDE una
          // factura (`comprobante`). `data.cliente.direccion` viene del XML firmado
          // (parseCpeClienteDireccion) — fuente fiel y siempre disponible, a
          // diferencia de apisperu. El distrito se deriva del TEXTO de esa dirección
          // (el XML no lo trae estructurado; `data.cliente.distrito` es el del PEDIDO
          // y sería incoherente). Si no se detecta, queda vacío → la asesora lo elige
          // (el select está visible porque desde factura no se auto-simplifica).
          // Solo reemplaza la dirección PROVISIONAL del init; si la asesora ya la
          // editó a mano, se respeta.
          if (comprobante) {
            const dirFactura = (data.cliente?.direccion || "").trim();
            const sinEditarDir =
              !direccionLlegadaRef.current.trim() ||
              direccionLlegadaRef.current === dirAutollenada.current;
            if (dirFactura && sinEditarDir) {
              dirAutollenada.current = dirFactura;
              direccionLlegadaRef.current = dirFactura;
              setDireccionLlegada(dirFactura);
              const sinEditarDist =
                !distritoLlegadaRef.current.trim() ||
                distritoLlegadaRef.current === (distAutollenado.current ?? "");
              if (sinEditarDist) {
                const distFactura = detectarDistritoEnDireccion(dirFactura) ?? "";
                distAutollenado.current = distFactura || null;
                distritoLlegadaRef.current = distFactura;
                setDistritoLlegada(distFactura);
              }
            }
          }
        }
      } catch (err) {
        console.error("Error cargando ítems de origen:", err);
      } finally {
        if (active) setCargandoItems(false);
      }
    };

    cargarItems();
    return () => {
      active = false;
    };
  }, [pedido?.id, comprobante?.id]);

  // Al EDITAR cantidad/unidad de un producto, recalcular el peso y el aviso de mixtas.
  // No corre durante la carga inicial (cargarItems ya lo hizo) ni toca `totalBultos`
  // (no se agregan/quitan productos → su número no cambia; respeta un ajuste manual).
  // Con todo KGM el peso es la suma autoritativa (igual que el backend); con unidades
  // mixtas NO se toca el peso (es edición manual de la asesora).
  useEffect(() => {
    if (cargandoItems) return;
    const { pesoStr, mixtas } = calcularPesoMixtas(items);
    setUnidadesMixtas(mixtas);
    if (!mixtas) setPesoBrutoTotal(pesoStr);
  }, [items, cargandoItems]);

  // Edición de un producto a transportar (solo cantidad y unidad; la descripción es fija).
  const handleItemCantidad = (i: number, raw: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, cantidad: raw } : it)));
  const handleItemUnidad = (i: number, unidadUI: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, unidad: unidadUI } : it)));

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ serieNumero: string; mensaje?: string } | null>(null);

  // Inicializar campos de dirección, repartidor y override de destinatario
  useEffect(() => {
    if (pedido) {
      setRepartidorId(pedido.repartidor_id || "");
      setDireccionLlegada(pedido.direccion || "");
    } else if (comprobante) {
      // La API detalle devuelve cliente.direccion; la lista puede devolver pedido_direccion
      setDireccionLlegada(
        comprobante.cliente?.direccion || comprobante.pedido_direccion || ""
      );
    }

    // Distrito inicial NORMALIZADO contra el <select>: el dato guardado puede venir
    // coloquial ("Surco") y un valor que no coincide con ninguna opción deja el
    // select mudo en "-- Distrito --". Cascada: valor guardado normalizado →
    // detección inequívoca dentro del texto de la dirección → vacío (elige el usuario).
    const direccionInicial = pedido?.direccion
      || comprobante?.cliente?.direccion
      || comprobante?.pedido_direccion
      || "";
    const distritoCrudo = pedido?.distrito
      || comprobante?.cliente?.distrito
      || comprobante?.pedido_distrito
      || "";
    const distritoNormalizado = matchDistritoLima(distritoCrudo)
      ?? detectarDistritoEnDireccion(direccionInicial)
      ?? "";
    if (distritoNormalizado && distritoNormalizado !== distritoCrudo) {
      // Lo marcamos como autollenado nuestro (una consulta RUC posterior puede actualizarlo)
      distAutollenado.current = distritoNormalizado;
    }
    distritoLlegadaRef.current = distritoNormalizado;
    setDistritoLlegada(distritoNormalizado);
    // La dirección inicial es PROVISIONAL cuando viene de una factura: `cargarItems`
    // la reemplaza por la del XML de la factura. Marcarla como autollenada permite
    // ese reemplazo sin pisar lo que la asesora escriba a mano.
    dirAutollenada.current = direccionInicial;
    direccionLlegadaRef.current = direccionInicial;

    // Prellenar SIEMPRE el destinatario (visible y editable): la fuente más fiel
    // es la FACTURA (datos fiscales aceptados por SUNAT); el pedido es fallback —
    // muchos pedidos no tienen RUC registrado (caso GRUPO CULINARIA, 10 jun 2026).
    const docInicial = (comprobante?.cliente?.numDocumento
      || comprobante?.cliente_doc_num
      || pedido?.ruc_dni
      || "").trim();
    const razonInicial = comprobante?.cliente?.razonSocial
      || comprobante?.cliente_razon_social
      || pedido?.razon_social
      || pedido?.cliente
      || "";
    setRazonSocialOverride(razonInicial);
    setDocNumOverride(docInicial);
    setDocTipoOverride(
      docInicial.length === 11 ? "6"
        : docInicial.length === 8 ? "1"
          : (comprobante?.cliente?.tipoDocumento || comprobante?.cliente_doc_tipo || "1")
    );
    // El doc precargado no dispara la consulta "forzada" del DEBOUNCE (esa es solo
    // para cuando el usuario tipea el doc). La consulta de apertura de más abajo
    // decide: forzar la dirección fiscal si la GRE sale de una factura, o suave
    // (solo vacíos) si sale de un pedido.
    ultimoDocConsultado.current = docInicial;
  }, [pedido, comprobante]);

  // Cargar motorizados para rellenar datos
  useEffect(() => {
    let active = true;
    const cargarMotorizados = async () => {
      try {
        const res = await fetch("/api/users?role=repartidor");
        if (!res.ok) throw new Error("Error al consultar motorizados");
        const data = await res.json();
        if (active && Array.isArray(data)) {
          setRepartidores(data);

          const targetRepartidorId = pedido?.repartidor_id;
          if (targetRepartidorId) {
            const preselected = data.find((r) => r.id === targetRepartidorId);
            if (preselected) {
              setRepartidorId(preselected.id);
              const ch = datosChoferDesdeMotorizado(preselected);
              setChoferDni(ch.dni);
              setChoferLicencia(ch.licencia);
              setVehiculoPlaca(ch.placa);
              setChoferNombres(ch.nombres);
              setChoferApellidos(ch.apellidos);
              // Si el repartidor asignado trae DNI o placa, mostramos sus datos (no los ocultamos)
              if (preselected.chofer_dni || preselected.vehiculo_placa) setMostrarChofer(true);

              // Evaluar si los datos del repartidor, dirección y cliente están 100% listos para emisión rápida
              const tieneRepartidorListos = indicadorM1L || !!(preselected.chofer_dni && preselected.chofer_licencia && preselected.vehiculo_placa);
              const tieneDireccionListos = !!((pedido?.direccion || comprobante?.cliente?.direccion || comprobante?.pedido_direccion) && (pedido?.distrito || comprobante?.cliente?.distrito || comprobante?.pedido_distrito));
              // Desde una FACTURA no auto-simplificamos: la dirección/distrito se
              // fuerzan a los datos FISCALES vía la consulta RUC (async), así que
              // la asesora debe verlos en modo edición antes de emitir (y el select
              // de distrito queda visible por si el RUC no trajo uno reconocible).
              if (tieneRepartidorListos && tieneDireccionListos && !necesitaOverride && !comprobante) {
                setModoEdicion(false); // Activamos Modo Simplificado automáticamente
              }
            }
          }
        }
      } catch (err) {
        console.error("Error cargando repartidores:", err);
      }
    };

    cargarMotorizados();
    return () => {
      active = false;
    };
  }, [pedido?.repartidor_id, necesitaOverride, indicadorM1L]);

  // Cargar el entorno SUNAT real (para mostrar el banner correcto) y los datos
  // públicos del emisor (RUC + razón social) para el banner de empresa.
  useEffect(() => {
    let active = true;
    fetchEntornoSunat().then((prod) => { if (active && prod !== null) setEsProduccion(prod); });
    fetch("/api/sunat/empresas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && d && !d.error) setEmpresasMap(d); })
      .catch(() => { /* el banner cae al nombre sin RUC */ });
    return () => { active = false; };
  }, []);

  // Auto-búsqueda del destinatario: al digitar un DNI(8)/RUC(11) consulta apisperu y
  // autocompleta los Nombres o Razón Social; con RUC, además la dirección y el distrito
  // de llegada (regla compartida `decidirAutollenadoDestino`). Cuando el USUARIO tipea
  // el documento (suave=false) la dirección fiscal REEMPLAZA lo precargado — tipear un
  // RUC es redefinir el destinatario. La consulta automática al abrir (suave=true)
  // solo llena campos vacíos.
  async function consultarDestinatario(numero: string, opts?: { suave?: boolean }) {
    if (!/^\d{8}$|^\d{11}$/.test(numero)) return;
    ultimoDocConsultado.current = numero;
    setConsultandoDest(true);
    setConsultaDestMsg(null);
    const r = await consultarDocumento(numero);
    if (r.ok) {
      if (r.nombre) setRazonSocialOverride(r.nombre);
      if (numero.length === 11) {
        const dec = decidirAutollenadoDestino({
          forzar: !opts?.suave,
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
  }

  useEffect(() => {
    const numero = docNumOverride.trim();
    if ((numero.length !== 8 && numero.length !== 11) || numero === ultimoDocConsultado.current) return;
    const t = setTimeout(() => { void consultarDestinatario(numero); }, 600);
    return () => clearTimeout(t);
  }, [docNumOverride]);

  // Consulta del destinatario al abrir, según el origen:
  //  - Desde una FACTURA (hay `comprobante`): NO se consulta apisperu. La dirección
  //    de la guía debe coincidir con la FACTURA (pedido de Hugo, 12 jun 2026) y la
  //    fuente fiel es el XML firmado (lo que SUNAT aceptó), que `cargarItems` ya
  //    descarga y aplica al punto de llegada. apisperu es intermitente —no devuelve
  //    dirección para muchos RUC 10 (persona natural)— así que depender de él sería
  //    frágil justo para esos clientes.
  //  - Desde un PEDIDO (sin `comprobante`): consulta SUAVE — solo llena vacíos,
  //    nunca pisa la dirección de ENTREGA del pedido.
  //  Con DNI no aplica en ningún caso: apisperu no devuelve dirección.
  useEffect(() => {
    if (comprobante) return; // desde factura: la dirección la pone cargarItems (XML)
    const doc = (pedido?.ruc_dni || "").trim();
    if (doc.length !== 11) return;
    const direccionInicial = pedido?.direccion || "";
    const distritoInicial = matchDistritoLima(pedido?.distrito)
      ?? detectarDistritoEnDireccion(direccionInicial)
      ?? "";
    if (direccionInicial.trim() && distritoInicial.trim()) return;
    void consultarDestinatario(doc, { suave: true });
  }, [pedido, comprobante]);

  // Manejar cambio de motorizado (datos pre-llenados desde el helper compartido)
  const handleRepartidorChange = (id: string) => {
    setRepartidorId(id);
    const ch = datosChoferDesdeMotorizado(repartidores.find((r) => r.id === id));
    setChoferDni(ch.dni);
    setChoferLicencia(ch.licencia);
    setVehiculoPlaca(ch.placa);
    setChoferNombres(ch.nombres);
    setChoferApellidos(ch.apellidos);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Regla única compartida (guia-form-shared): con M1/L el chofer/placa son opcionales;
    // sin M1/L son obligatorios.
    const chofer = validarChofer({
      indicadorM1L,
      dni: choferDni,
      licencia: choferLicencia,
      nombres: choferNombres,
      apellidos: choferApellidos,
      placa: vehiculoPlaca,
    });
    if (!chofer.ok) {
      setError(`Faltan datos del transporte: ${chofer.faltantes.join(", ")}.`);
      setLoading(false);
      return;
    }

    if (!direccionLlegada.trim() || !distritoLlegada.trim()) {
      setError("La dirección y el distrito de llegada son obligatorios.");
      setLoading(false);
      return;
    }

    // El destinatario siempre es visible/editable → siempre se valida lo que se ve.
    if (docTipoOverride === "1" && !esDniValido(docNumOverride)) {
      setError("El DNI ingresado no es válido (debe tener 8 dígitos).");
      setLoading(false);
      return;
    }
    if (docTipoOverride === "6" && !esRucValido(docNumOverride)) {
      setError("El RUC ingresado no es válido (debe tener 11 dígitos).");
      setLoading(false);
      return;
    }
    if (!razonSocialOverride.trim()) {
      setError("Los nombres o la razón social del destinatario son obligatorios.");
      setLoading(false);
      return;
    }

    // Cantidades de los productos a transportar: deben ser > 0 (el usuario pudo editarlas).
    if (items.length > 0) {
      const invalida = items.find((it) => !(Number(it.cantidad) > 0));
      if (invalida) {
        setError(`La cantidad de "${invalida.producto_nombre}" debe ser mayor a 0.`);
        setLoading(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/guias/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedido_id: pedido?.id || null,
          comprobante_id: comprobante?.id || null,
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
          distrito_llegada: distritoLlegada.trim() || null,
          // Siempre se envía lo que el usuario VE en el bloque destinatario
          // (prellenado de la factura/pedido, editable).
          cliente_doc_tipo: docTipoOverride,
          cliente_doc_num: docNumOverride.trim(),
          cliente_razon_social: razonSocialOverride.trim(),
          // Productos a transportar: lo que el usuario VE y editó (precargado de la
          // factura). Si la lista está vacía (no cargó), el backend usa la factura.
          items:
            items.length > 0
              ? items.map((it) => ({
                  producto_nombre: it.producto_nombre,
                  cantidad: Number(it.cantidad),
                  unidad: it.unidad,
                }))
              : null,
        }),
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

  // El resumen (modo simplificado) muestra LO QUE SE VA A EMITIR: los campos
  // editables del bloque destinatario, no los datos originales del prop.
  const nombreCliente = razonSocialOverride
    || pedido?.cliente
    || comprobante?.cliente?.razonSocial
    || comprobante?.cliente_razon_social
    || "Cliente";
  const numDocumentoCliente = docNumOverride;
  // Validez del documento VISIBLE (el que se enviará) — gobierna el estilo del
  // bloque destinatario y la emisión rápida.
  const docDestinoValido = docTipoOverride === "6"
    ? esRucValido(docNumOverride)
    : esDniValido(docNumOverride);

  // Empresa emisora (espejo de empresaFromPedidoString del backend: la misma
  // heurística que usará la emisión, así el banner nunca miente). Define el RUC
  // (20 Transavic / 10 Avícola) y la serie (T001 / T002) de la guía.
  const empresaKey = (pedido?.empresa || comprobante?.empresa || "")
    .toLowerCase()
    .startsWith("av")
    ? "avicola"
    : "transavic";
  const EMPRESA_BANNER = {
    transavic: { logo: "/transavic.jpg", nombre: "Transavic", serie: "T001", chip: "bg-red-50 border-red-200 text-red-800" },
    avicola: { logo: "/avicola.jpg", nombre: "Avícola de Tony", serie: "T002", chip: "bg-amber-50 border-amber-200 text-amber-800" },
  } as const;
  const emisorUI = EMPRESA_BANNER[empresaKey];
  const emisorRuc = empresasMap?.[empresaKey]?.ruc;

  // Con M1/L los datos del chofer son opcionales (SUNAT los permite omitir).
  const choferOk = indicadorM1L || !!(repartidorId && choferDni && choferLicencia && vehiculoPlaca && choferNombres && choferApellidos);
  // Se incluyen datos del chofer si NO es M1/L (obligatorios) o si el usuario los desplegó.
  const incluirChofer = !indicadorM1L || mostrarChofer;
  const datosCompletosParaEmisionRapida =
    !!(choferOk && direccionLlegada && distritoLlegada && docDestinoValido && razonSocialOverride.trim());

  return (
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-auto overflow-hidden animate-fade-in border border-gray-100 font-sans">
      {/* Cabecera */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-semibold">
            <FiTruck size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-800">Guía de Remisión Electrónica</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Cliente: <span className="font-semibold text-gray-700">{nombreCliente}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Banner del EMISOR: de qué empresa/RUC saldrá la guía (T001 vs T002) */}
          <div
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border ${emisorUI.chip}`}
            title={`La guía se emitirá con el RUC de ${emisorUI.nombre} (serie ${emisorUI.serie})`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={emisorUI.logo} alt={emisorUI.nombre} className="w-6 h-6 rounded-md object-cover border border-white/60" />
            <div className="leading-tight">
              <span className="block text-[10px] font-bold">{emisorUI.nombre} · {emisorUI.serie}</span>
              <span className="block text-[9px] opacity-80 font-mono">{emisorRuc ? `RUC ${emisorRuc}` : "Emisor de la guía"}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <FiX size={18} />
          </button>
        </div>
      </div>

      {success ? (
        <div className="p-8 text-center max-w-md mx-auto">
          <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-200">
            <FiCheck size={24} />
          </div>
          <h4 className="text-sm font-bold text-gray-800 font-sans">¡Guía de Remisión Emitida!</h4>
          <p className="text-xs text-green-700 font-semibold mt-1.5 bg-green-50 border border-green-100 py-1 px-3 rounded-lg inline-block">
            {success.serieNumero}
          </p>
          <p className="text-xs text-gray-500 mt-3.5 leading-relaxed">
            {success.mensaje || "La guía ha sido aceptada por SUNAT exitosamente."}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <a
              href="/dashboard/guias"
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-xs shadow-sm active:scale-95 transition"
            >
              <FiFileText size={14} />
              Ver Guías Emitidas
            </a>
            <button
              onClick={onClose}
              className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition"
            >
              Cerrar Ventana
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
              <FiAlertCircle className="flex-shrink-0 mt-0.5" size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Entorno SUNAT — refleja el entorno real (Producción vs Beta), no es texto fijo */}
          {esProduccion === true ? (
            <div className="p-3.5 bg-green-50/70 border border-green-100 rounded-xl flex items-start gap-2.5 text-xs text-green-800">
              <FiCheck className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <span className="font-bold block text-green-900">Producción (SUNAT real)</span>
                Esta guía se enviará a SUNAT como documento oficial. Revisa que los datos sean correctos antes de emitir.
              </div>
            </div>
          ) : esProduccion === false ? (
            <div className="p-3.5 bg-amber-50/70 border border-amber-100/70 rounded-xl flex items-start gap-2.5 text-xs text-amber-800">
              <FiAlertCircle className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <span className="font-bold block text-amber-900">Entorno de Pruebas (SUNAT Beta)</span>
                Esta guía se emitirá en modo Beta (no es un documento oficial). Los errores de SUNAT se simulan con éxito local para no interrumpir las pruebas.
              </div>
            </div>
          ) : null}

          {/* MODO SIMPLIFICADO (CONFIRMACIÓN RÁPIDA EN 1 CLIC) */}
          {!modoEdicion ? (
            <div className="space-y-4 animate-fade-in max-w-lg mx-auto py-2">
              <div className="p-4 bg-indigo-50/30 rounded-2xl border border-indigo-100/50 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                    <FiInfo className="text-indigo-600" />
                    Resumen de Emisión Rápida
                  </h4>
                  <button
                    type="button"
                    onClick={() => setModoEdicion(true)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs font-bold flex items-center gap-1 transition"
                  >
                    <FiEdit2 size={12} />
                    Editar Detalles
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Destinatario</span>
                    <span className="font-semibold text-gray-800 truncate block">{nombreCliente}</span>
                    <span className="text-[10px] text-gray-500 block">Doc: {numDocumentoCliente || "Identificado"}</span>
                  </div>
                  
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Punto de Llegada</span>
                    <span className="font-semibold text-gray-800 block truncate">{direccionLlegada}</span>
                    <span className="text-[10px] text-gray-500 block">{distritoLlegada}</span>
                  </div>

                  <div className="space-y-1 col-span-2 pt-2 border-t border-indigo-50/80">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Conductor y Vehículo</span>
                    {incluirChofer ? (
                      <>
                        <span className="font-semibold text-gray-800 block">
                          🚚 {choferNombres} {choferApellidos}
                        </span>
                        <span className="text-[10px] text-gray-500 block">
                          DNI: {choferDni || "—"} | Licencia: {indicadorM1L && !choferLicencia ? "Omitida (M1/L)" : (choferLicencia || "—")} | Placa: <span className="font-bold text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded text-[10px]">{vehiculoPlaca || "—"}</span>
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-gray-500 block">
                        Sin datos del chofer — vehículo M1/L (moto / auto ligero), exento por SUNAT.
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 pt-2 border-t border-indigo-50/80">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Fecha Traslado</span>
                    <span className="font-semibold text-gray-800 flex items-center gap-1">
                      <FiCalendar size={12} className="text-gray-400" />
                      {fechaInicioTraslado}
                    </span>
                  </div>

                  <div className="space-y-1 pt-2 border-t border-indigo-50/80">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Carga Estimada</span>
                    <span className="font-semibold text-gray-800">
                      {totalBultos} Bulto(s) | {pesoBrutoTotal ? `${pesoBrutoTotal} kg` : "Auto-calcular"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botón de Emisión Rápida */}
              <div className="flex items-center justify-end gap-2.5 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2.5 border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-xl transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md active:scale-95 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Emitiendo Guía REST...
                    </>
                  ) : (
                    <>
                      <FiTruck size={14} />
                      Confirmar y Emitir Guía
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* MODO EDICIÓN DETALLADA (DISTRIBUCIÓN EN 2 COLUMNAS COMPACTAS) */
            <div className="space-y-4 animate-fade-in">
              {datosCompletosParaEmisionRapida && (
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Modo Edición Detallada</span>
                  <button
                    type="button"
                    onClick={() => setModoEdicion(false)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs font-bold flex items-center gap-1 transition"
                  >
                    <FiEye size={13} />
                    Ver Resumen Simplificado
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                
                {/* COLUMNA IZQUIERDA: CLIENTE Y TRASLADO */}
                <div className="space-y-4">
                  {(() => {
                    return (
                    <div className={`p-4 rounded-xl space-y-3 border ${docDestinoValido ? "bg-gray-50/60 border-gray-200" : "bg-amber-50/50 border-amber-100/50"}`}>
                      <h4 className={`text-[10px] font-bold flex items-center gap-1.5 uppercase tracking-wider ${docDestinoValido ? "text-gray-700" : "text-amber-950"}`}>
                        {docDestinoValido
                          ? <FiUser className="text-indigo-600" size={13} />
                          : <FiAlertCircle className="text-amber-600" size={13} />}
                        {docDestinoValido ? "Destinatario (SUNAT)" : "Destinatario Requerido (SUNAT)"}
                      </h4>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1">
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">
                            Tipo Doc
                          </label>
                          <select
                            value={docTipoOverride}
                            onChange={(e) => {
                              setDocTipoOverride(e.target.value);
                              setDocNumOverride("");
                            }}
                            className="w-full text-xs border border-gray-200 rounded-xl px-2 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-amber-500"
                          >
                            <option value="1">DNI</option>
                            <option value="6">RUC</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">
                            Documento
                          </label>
                          <input
                            type="text"
                            maxLength={docTipoOverride === "6" ? 11 : 8}
                            value={docNumOverride}
                            onChange={(e) => setDocNumOverride(e.target.value.replace(/\D/g, ""))}
                            placeholder={docTipoOverride === "6" ? "RUC 11 dígitos" : "DNI 8 dígitos"}
                            className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-amber-500"
                            required
                          />
                          {consultandoDest && <p className="text-[10px] text-gray-400 mt-1">Buscando…</p>}
                          {!consultandoDest && consultaDestMsg && (
                            <p className={`text-[10px] mt-1 ${consultaDestMsg.startsWith("✓") ? "text-green-600" : "text-amber-600"}`}>{consultaDestMsg}</p>
                          )}
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Nombres o Razón Social
                        </label>
                        <input
                          type="text"
                          value={razonSocialOverride}
                          onChange={(e) => setRazonSocialOverride(e.target.value)}
                          placeholder="Ej. Juan Pérez o Empresa SAC"
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-amber-500"
                          required
                        />
                      </div>
                    </div>
                    );
                  })()}

                  {/* Dirección y Distrito de Llegada */}
                  <div className="p-4 bg-indigo-50/20 border border-indigo-100/30 rounded-xl space-y-3">
                    <h4 className="text-[10px] font-bold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider">
                      <FiMapPin className="text-indigo-600" size={13} />
                      Punto de Llegada
                    </h4>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">
                        Dirección
                      </label>
                      <input
                        type="text"
                        value={direccionLlegada}
                        onChange={(e) => setDireccionLlegada(e.target.value)}
                        placeholder="Dirección del receptor"
                        className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">
                        Distrito
                      </label>
                      <select
                        value={distritoLlegada}
                        onChange={(e) => setDistritoLlegada(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                      >
                        <option value="">-- Distrito --</option>
                        {DISTRITOS_LIMA.map((dist) => (
                          <option key={dist} value={dist}>
                            {dist}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Detalles del Traslado (Carga, Motivo) */}
                  <div className="p-4 bg-gray-50/40 border border-gray-100/50 rounded-xl space-y-3">
                    <h4 className="text-[10px] font-bold text-gray-800 flex items-center gap-1.5 uppercase tracking-wider">
                      <FiPackage className="text-gray-500" size={13} />
                      Detalles del Envío
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Fecha Traslado
                        </label>
                        <input
                          type="date"
                          value={fechaInicioTraslado}
                          onChange={(e) => setFechaInicioTraslado(e.target.value)}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2 py-1.2 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Motivo Traslado
                        </label>
                        <select
                          value={motivoTraslado}
                          onChange={(e) => setMotivoTraslado(e.target.value)}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                        >
                          <option value="01">Venta</option>
                          <option value="14">Sujeto a conf.</option>
                          <option value="02">Compra</option>
                          <option value="04">Mismo estab.</option>
                          <option value="13">Otros</option>
                        </select>
                      </div>
                    </div>

                    {/* Productos a transportar: precargados de la factura, editables
                        (cantidad y unidad). Lo que el usuario VE aquí es lo que se emite. */}
                    {items.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-gray-500">
                          Productos a transportar
                        </label>
                        <div className="space-y-1.5">
                          {items.map((it, i) => (
                            <div
                              key={i}
                              className="grid grid-cols-[1fr_72px_60px] gap-2 items-center"
                            >
                              <span
                                className="text-xs text-gray-700 truncate"
                                title={it.producto_nombre}
                              >
                                {it.producto_nombre}
                              </span>
                              <input
                                type="number"
                                min={0.01}
                                step={0.01}
                                value={it.cantidad}
                                onChange={(e) => handleItemCantidad(i, e.target.value)}
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 text-right focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                              />
                              <select
                                value={aUnitCodeSunat(it.unidad) === "KGM" ? "kg" : "uni"}
                                onChange={(e) => handleItemUnidad(i, e.target.value)}
                                className="w-full text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                              >
                                <option value="kg">kg</option>
                                <option value="uni">uni</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {cargandoItems && (
                      <p className="text-[10px] text-gray-400">Cargando productos…</p>
                    )}

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Total Bultos
                        </label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={totalBultos}
                          onChange={(e) => setTotalBultos(parseInt(e.target.value) || 1)}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.2 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Peso Bruto (KGM)
                        </label>
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={pesoBrutoTotal}
                          onChange={(e) => setPesoBrutoTotal(e.target.value)}
                          placeholder={unidadesMixtas ? "Ingresa el peso en kg" : "Auto-calcular"}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.2 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                    {unidadesMixtas && !pesoBrutoTotal && (
                      <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
                        Los productos tienen distintas unidades (kg y unidades), así que no
                        podemos calcular el peso por ti. Pesa la carga e ingresa el total en
                        kilogramos.
                      </p>
                    )}
                    {envioExcluido && (
                      <p className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5 leading-snug">
                        El ítem <span className="font-semibold">ENVIO</span> (flete) no se
                        cuenta en el peso ni en los bultos — es un servicio, no mercadería.
                      </p>
                    )}
                  </div>
                </div>

                {/* COLUMNA DERECHA: REPARTIDOR Y VEHÍCULO */}
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-50/20 border border-indigo-100/30 rounded-xl space-y-3.5">
                    <h4 className="text-[10px] font-bold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider">
                      <FiUser className="text-indigo-600" size={13} />
                      Conductor y Transporte
                    </h4>
                    
                    {/* Checkbox Indicador M1/L */}
                    <label className="flex items-center gap-2 pb-2 border-b border-indigo-100/50 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={indicadorM1L}
                        onChange={(e) => setIndicadorM1L(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 border-slate-300"
                      />
                      <span className="text-[10px] font-bold text-indigo-950 uppercase tracking-wide">
                        Vehículo categoría M1 o L (Moto / Auto Ligero)
                      </span>
                    </label>
                    {indicadorM1L && (
                      <p className="text-[10px] text-indigo-600/90 -mt-1.5 leading-snug">
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
                          className="text-[10px] font-medium text-gray-400 hover:text-gray-600"
                        >
                          − Quitar datos del chofer (no requeridos con M1/L)
                        </button>
                      </div>
                    )}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1.5">
                        Seleccionar Repartidor
                      </label>
                      <select
                        value={repartidorId}
                        onChange={(e) => handleRepartidorChange(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1.5 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                        <option value="">-- Seleccionar Motorizado --</option>
                        {repartidores.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Nombres {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                        </label>
                        <input
                          type="text"
                          value={choferNombres}
                          onChange={(e) => setChoferNombres(e.target.value)}
                          placeholder={indicadorM1L ? "No requerido" : "Nombres chofer"}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required={!indicadorM1L}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Apellidos {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                        </label>
                        <input
                          type="text"
                          value={choferApellidos}
                          onChange={(e) => setChoferApellidos(e.target.value)}
                          placeholder={indicadorM1L ? "No requerido" : "Apellidos chofer"}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required={!indicadorM1L}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          DNI Conductor {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                        </label>
                        <input
                          type="text"
                          maxLength={15}
                          value={choferDni}
                          onChange={(e) => setChoferDni(e.target.value)}
                          placeholder={indicadorM1L ? "No requerido" : "DNI del chofer"}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required={!indicadorM1L}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Licencia {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                        </label>
                        <input
                          type="text"
                          maxLength={30}
                          value={choferLicencia}
                          onChange={(e) => setChoferLicencia(e.target.value)}
                          placeholder={indicadorM1L ? "No requerida" : "Licencia del chofer"}
                          className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                          required={!indicadorM1L}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">
                        Placa del Vehículo {indicadorM1L && <span className="text-[9px] text-indigo-500 font-normal">(Opcional)</span>}
                      </label>
                      <input
                        type="text"
                        maxLength={15}
                        value={vehiculoPlaca}
                        onChange={(e) => setVehiculoPlaca(e.target.value)}
                        placeholder={indicadorM1L ? "No requerida" : "Ej. C1A-098"}
                        className="w-full text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500"
                        required={!indicadorM1L}
                      />
                    </div>
                    </>
                    )}
                  </div>
                </div>

              </div>

              {/* Botones */}
              <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-xl transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm hover:shadow active:scale-95 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Emitiendo...
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
          )}
        </form>
      )}
    </div>
  );
}

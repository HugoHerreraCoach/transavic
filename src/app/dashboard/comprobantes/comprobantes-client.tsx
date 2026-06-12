// src/app/dashboard/comprobantes/comprobantes-client.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FiFileText,
  FiPlus,
  FiRefreshCw,
  FiDownload,
  FiCode,
  FiMail,
  FiX,
  FiRotateCcw,
  FiSend,
  FiXCircle,
  FiCalendar,
  FiSearch,
  FiFileMinus,
  FiSlash,
  FiCheckCircle,
  FiFile,
  FiCornerUpLeft,
  FiUser,
  FiLink,
  FiMoreVertical,
  FiAlertTriangle,
  FiClock,
  FiAlertCircle,
  FiDollarSign,
  FiInfo,
  FiTruck,
  FiExternalLink,
  FiPrinter,
} from "react-icons/fi";
import ModalShell from "@/components/ModalShell";
import EmitirGuiaModal, { ComprobanteInfo } from "../guias/emitir-guia-modal";
import EmitirGuiaDirectaModal from "../guias/emitir-guia-directa-modal";
import { Pedido } from "@/lib/types";
import { mensajeSunatAmigable, mensajeEstadoSinDetalle } from "@/lib/sunat/mensajes-amigables";


interface Comprobante {
  id: string;
  serie_numero: string;
  tipo: string;
  empresa: string;
  cliente_razon_social: string | null;
  cliente_doc_num: string | null;
  monto_total: string | number;
  estado: string;
  created_at: string;
  mensaje_sunat: string | null;
  pedido_id: string | null;
  pedido_cliente: string | null;
  // Quién emitió el comprobante (asesora/admin). Null en los sueltos viejos.
  emitido_por: string | null;
  // Vínculo NC ↔ comprobante original (lo devuelve GET /api/comprobantes):
  // en una NC (07) apuntan a la factura/boleta que acredita; en una
  // factura/boleta, `tiene_nc` indica si ya tiene una NC aceptada/observada.
  referencia_comprobante_id: string | null;
  referencia_serie_numero: string | null;
  referencia_tipo: string | null;
  referencia_cliente_razon_social: string | null;
  referencia_monto_total: string | number | null;
  tiene_nc: boolean;
  // Campos extra para Guías de Remisión (tipo='09'). Null en CPEs.
  peso_bruto_total: string | number | null;
  total_bultos: number | null;
  guia_serie_numero: string | null;
}

interface ComprobanteDetalle {
  id: string;
  rucEmisor: string;
  empresa: "transavic" | "avicola";
  emisor?: {
    ruc: string;
    razonSocial: string;
    nombreComercial: string;
    direccion: string;
    ubigeo?: string;
    departamento?: string;
    provincia?: string;
    distrito?: string;
  };
  tipo: string;
  serie: string;
  numero: number;
  serieNumero: string;
  fechaEmision: string;
  formaPago?: string | null;
  fechaVencimiento?: string | null;
  cliente: {
    tipoDocumento: string | null;
    numDocumento: string | null;
    razonSocial: string | null;
    direccion: string | null;
  };
  items: Array<{
    descripcion: string;
    unidadMedida: string;
    cantidad: number;
    precioUnitario: number;
    valorVenta: number;
    montoIGV: number;
    precioTotal: number;
  }>;
  totales: {
    totalGravadas: number;
    totalExoneradas: number;
    totalInafectas: number;
    totalIGV: number;
    totalISC: number;
    totalOtrosCargos: number;
    importeTotal: number;
  };
  moneda: string;
  hashCpe: string | null;
  observaciones: string[] | null;
}

// "No me hagas pensar": en lugar de un texto crudo en lowercase, devolvemos
// para cada estado: color del badge, label legible (Capitalized) e ícono.
// El badge resultante se renderiza con `<BadgeEstado />` más abajo.
function estadoUI(estado: string): {
  bg: string;
  text: string;
  label: string;
  Icon: typeof FiCheckCircle;
} {
  switch (estado) {
    case "aceptado":
      return { bg: "bg-green-100", text: "text-green-700", label: "Aceptado", Icon: FiCheckCircle };
    case "observado":
      return { bg: "bg-amber-100", text: "text-amber-700", label: "Observado", Icon: FiAlertTriangle };
    case "pendiente":
      return { bg: "bg-blue-100", text: "text-blue-700", label: "Pendiente", Icon: FiClock };
    case "rechazado":
      return { bg: "bg-red-100", text: "text-red-700", label: "Rechazado", Icon: FiXCircle };
    case "error":
      return { bg: "bg-red-100", text: "text-red-700", label: "Error", Icon: FiAlertCircle };
    case "anulado":
      return { bg: "bg-gray-200", text: "text-gray-700", label: "Anulado", Icon: FiSlash };
    default:
      return { bg: "bg-gray-100", text: "text-gray-700", label: estado, Icon: FiInfo };
  }
}

function colorEstado(estado: string): string {
  switch (estado) {
    case "aceptado":
      return "bg-green-100 text-green-700";
    case "rechazado":
      return "bg-red-100 text-red-700";
    case "observado":
      return "bg-amber-100 text-amber-700";
    case "pendiente":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function tipoLabel(tipo: string): string {
  return tipo === "01"
    ? "Factura"
    : tipo === "03"
      ? "Boleta"
      : tipo === "07"
        ? "Nota Crédito"
        : tipo === "09"
          ? "Guía Remisión"
          : tipo;
}

// Chip de TIPO (hermano de estadoUI): color + ícono propios para distinguir de un
// vistazo Factura / Boleta / Nota de Crédito. Colores elegidos para NO chocar con
// los de Estado (verde/ámbar/rojo/azul) ni Empresa (rojo/teal): factura=índigo,
// boleta=pizarra (neutro), NC=naranja (es un ajuste/reversa, mismo naranja que el
// botón "nota de crédito"). El chip usa rounded-md lleno → forma distinta del pill
// redondo de Estado y del borde de Empresa, así cada columna se lee aparte.
function tipoUI(tipo: string): {
  bg: string;
  text: string;
  label: string;
  Icon: typeof FiFileText;
} {
  switch (tipo) {
    case "01":
      return { bg: "bg-indigo-50", text: "text-indigo-700", label: "Factura", Icon: FiFileText };
    case "03":
      return { bg: "bg-slate-100", text: "text-slate-700", label: "Boleta", Icon: FiFile };
    case "07":
      return { bg: "bg-orange-50", text: "text-orange-700", label: "N. Crédito", Icon: FiCornerUpLeft };
    case "09":
      return { bg: "bg-amber-50", text: "text-amber-700", label: "Guía Rem.", Icon: FiTruck };
    default:
      return { bg: "bg-gray-100", text: "text-gray-700", label: tipoLabel(tipo), Icon: FiFileText };
  }
}

// "F001-00000011" → "F001-11": quita los ceros del correlativo para que el vínculo
// "anula F001-11" se lea rápido sin tanto cero.
function serieCorta(serieNumero: string): string {
  const [serie, num] = serieNumero.split("-");
  if (!num) return serieNumero;
  const n = Number(num);
  return Number.isFinite(n) ? `${serie}-${n}` : serieNumero;
}

function empresaLabel(empresa: string): string {
  if (empresa === "avicola") return "Avícola de Tony";
  if (empresa === "transavic") return "Transavic";
  return empresa;
}

function empresaBadgeColor(empresa: string): string {
  if (empresa === "avicola") return "bg-teal-100 text-teal-700 border-teal-200";
  if (empresa === "transavic") return "bg-red-100 text-red-700 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

/** Normaliza el valor de empresa de la fila al id que esperan los endpoints. */
function empresaApiId(empresa: string): "transavic" | "avicola" {
  return empresa === "avicola" ? "avicola" : "transavic";
}

/** Fecha en zona Lima (YYYY-MM-DD). offsetDias negativo = días atrás. */
function fechaLima(offsetDias = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDias * 24 * 60 * 60 * 1000));
}

/** Fecha y hora (zona Lima) de un ISO timestamp, para mostrar en la lista. */
function fechaHoraLima(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { fecha: "—", hora: "" };
  const fecha = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const hora = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return { fecha, hora };
}

// ──────────────────────────────────────────────────────────
// Helpers cliente: traer detalle + generar PDF
// ──────────────────────────────────────────────────────────

async function fetchDetalle(id: string): Promise<ComprobanteDetalle> {
  const res = await fetch(`/api/comprobantes/${id}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function generarPdfBlob(detalle: ComprobanteDetalle): Promise<Blob> {
  // Import dinámico para no cargar jsPDF en el bundle inicial
  const { generarPDFComprobante } = await import("@/lib/sunat/pdf-comprobante");
  return generarPDFComprobante({
    tipo: detalle.tipo,
    serie: detalle.serie,
    numero: detalle.numero,
    serieNumero: detalle.serieNumero,
    fechaEmision: detalle.fechaEmision,
    cliente: {
      tipoDocumento: detalle.cliente.tipoDocumento ?? undefined,
      numDocumento: detalle.cliente.numDocumento ?? "",
      razonSocial: detalle.cliente.razonSocial ?? "Cliente",
      direccion: detalle.cliente.direccion ?? undefined,
    },
    items: detalle.items,
    totales: {
      totalGravadas: detalle.totales.totalGravadas,
      totalExoneradas: detalle.totales.totalExoneradas,
      totalInafectas: detalle.totales.totalInafectas,
      totalIGV: detalle.totales.totalIGV,
      totalISC: detalle.totales.totalISC,
      totalOtrosCargos: detalle.totales.totalOtrosCargos,
      importeTotal: detalle.totales.importeTotal,
    },
    moneda: detalle.moneda,
    hashCpe: detalle.hashCpe,
    observaciones: detalle.observaciones,
    empresa: detalle.empresa,
    emisor: detalle.emisor,
    formaPago: detalle.formaPago ?? undefined,
    fechaVencimiento: detalle.fechaVencimiento ?? undefined,
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // dataUrl tiene formato "data:application/pdf;base64,XXXX"
      const base64 = dataUrl.split(",")[1] || dataUrl;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ──────────────────────────────────────────────────────────
// Modal de envío por email
// ──────────────────────────────────────────────────────────

function ModalEnviarEmail({
  comprobanteId,
  defaultEmail,
  onClose,
  onEnviado,
}: {
  comprobanteId: string;
  defaultEmail: string;
  onClose: () => void;
  onEnviado: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [cc, setCc] = useState("");
  const [mensaje, setMensaje] = useState(
    "¡Gracias por su preferencia! Adjuntamos su comprobante electrónico. Ante cualquier consulta sobre su pedido, escríbanos por este medio o por WhatsApp y con gusto le atenderemos."
  );
  const [incluirXML, setIncluirXML] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Al abrir el modal, traer el detalle para pre-llenar el email del cliente si lo tenemos
  useEffect(() => {
    let cancel = false;
    if (defaultEmail || !comprobanteId) return;
    (async () => {
      setCargandoDetalle(true);
      try {
        const d = await fetchDetalle(comprobanteId);
        if (!cancel && d.cliente && (d.cliente as { email?: string }).email) {
          setEmail((d.cliente as { email?: string }).email || "");
        }
      } catch {
        // Silencioso — el usuario igual puede tipear
      } finally {
        if (!cancel) setCargandoDetalle(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [comprobanteId, defaultEmail]);

  const enviar = async () => {
    setError(null);
    setEnviando(true);
    try {
      // 1. Traer detalle + generar PDF en cliente
      const detalle = await fetchDetalle(comprobanteId);
      const pdfBlob = await generarPdfBlob(detalle);
      const pdfBase64 = await blobToBase64(pdfBlob);

      // 2. Mandar al endpoint /enviar
      const res = await fetch(`/api/comprobantes/${comprobanteId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          cc: cc || undefined,
          mensaje: mensaje || undefined,
          pdfBase64,
          incluirXML,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onEnviado();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <FiMail className="text-red-600" />
            Enviar comprobante por correo
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Cerrar"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Para</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@ejemplo.com"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">
              CC (opcional)
            </label>
            <input
              type="email"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="contador@ejemplo.com"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">
              Mensaje adicional (opcional)
            </label>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Hola, le envío su comprobante adjunto…"
              rows={3}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={incluirXML}
              onChange={(e) => setIncluirXML(e.target.checked)}
              className="rounded"
            />
            Incluir XML firmado como adjunto
          </label>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            disabled={enviando}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={enviando || !email}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            <FiMail className="h-4 w-4" />
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────

function ModalNotaCredito({
  comprobante,
  onClose,
  onEmitida,
}: {
  comprobante: { id: string; serie_numero: string };
  onClose: () => void;
  onEmitida: (msg: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [tipoNC, setTipoNC] = useState("01");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMouseDownInside = useRef(true);

  const motivosNC = [
    { v: "01", label: "Anulación de la operación" },
    { v: "02", label: "Anulación por error en el RUC" },
    { v: "03", label: "Corrección por error en la descripción" },
    { v: "06", label: "Devolución total" },
    { v: "07", label: "Devolución por ítem" },
    { v: "09", label: "Disminución en el valor" },
    { v: "10", label: "Otros conceptos" },
  ];

  async function emitir() {
    if (motivo.trim().length < 5) {
      setError("El motivo debe tener al menos 5 caracteres.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/comprobantes/${comprobante.id}/nota-credito`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim(), tipoNotaCredito: tipoNC }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo emitir la nota de crédito.");
      } else {
        onEmitida(`Nota de crédito ${j.serieNumero ?? ""} (${j.estado ?? "—"})`);
        onClose();
      }
    } catch {
      setError("Error de conexión al emitir.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiRotateCcw className="text-orange-600" />
            Nota de crédito
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">
            Acredita / anula el comprobante{" "}
            <strong className="font-mono">{comprobante.serie_numero}</strong>.
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Motivo (catálogo SUNAT)
            </label>
            <select
              value={tipoNC}
              onChange={(e) => setTipoNC(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-orange-500"
            >
              {motivosNC.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.v} — {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Descripción del motivo
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={250}
              placeholder="Ej. Anulación por error en los datos del cliente"
              className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Cancelar
          </button>
          <button
            onClick={emitir}
            disabled={enviando}
            className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {enviando ? (
              <FiRefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <FiRotateCcw className="h-4 w-4" />
            )}
            Emitir nota de crédito
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Cambiar asesora encargada (solo admin) — reescribe `emitido_por`
// ──────────────────────────────────────────────────────────
function ModalAsignarAsesora({
  comprobante,
  asesoras,
  onClose,
  onGuardado,
}: {
  comprobante: { id: string; serie_numero: string; emitidoPor: string | null };
  asesoras: { id: string; name: string }[];
  onClose: () => void;
  onGuardado: (emitidoPor: string | null, msg: string) => void;
}) {
  // Pre-seleccionar la asesora actual si su nombre coincide con una de la lista.
  const actual = asesoras.find(
    (a) =>
      a.name.trim().toLowerCase() ===
      (comprobante.emitidoPor ?? "").trim().toLowerCase()
  );
  const [asesorId, setAsesorId] = useState<string>(actual?.id ?? "");
  const [guardando, setGuardando] = useState(false);
  const isMouseDownInside = useRef(true);
  const [error, setError] = useState<string | null>(null);
  // Cobranza vinculada (si la hay): se consulta al abrir para PREGUNTAR si
  // también se reasigna — la responsabilidad de cobrar suele acompañar a la venta.
  const [cobranza, setCobranza] = useState<{
    estado: string;
    monto: string;
    asesorName: string | null;
  } | null>(null);
  const [reasignarCobranza, setReasignarCobranza] = useState(true);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/comprobantes/${comprobante.id}/emisor`)
      .then((r) => (r.ok ? r.json() : { cobranza: null }))
      .then((j) => {
        if (!cancelado) setCobranza(j.cobranza ?? null);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [comprobante.id]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/comprobantes/${comprobante.id}/emisor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asesorId: asesorId || null,
          reasignarCobranza: reasignarCobranza && !!cobranza,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo guardar.");
      } else {
        const nombre = (j.emitidoPor ?? null) as string | null;
        const sufijo = j.cobranzaReasignada ? " (cobranza incluida)" : "";
        onGuardado(
          nombre,
          nombre
            ? `Asignado a ${nombre}${sufijo}`
            : `Se quitó la asesora (sin asignar)${sufijo}`
        );
        onClose();
      }
    } catch {
      setError("Error de conexión al guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiUser className="text-indigo-600" />
            Cambiar asesora
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">
            Define qué asesora ve el comprobante{" "}
            <strong className="font-mono">{comprobante.serie_numero}</strong> en su
            lista. Cambia el campo <strong>“Emitido por”</strong>.
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Asesora encargada
            </label>
            <select
              value={asesorId}
              onChange={(e) => setAsesorId(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— Sin asignar (solo el admin lo ve) —</option>
              {asesoras.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name.trim()}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-gray-400">
              Actual: {comprobante.emitidoPor?.trim() || "sin asignar"}
            </p>
          </div>
          {cobranza && (
            <label className="flex items-start gap-2.5 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={reasignarCobranza}
                onChange={(e) => setReasignarCobranza(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span className="text-xs text-gray-700">
                Reasignar también la cobranza vinculada (S/{" "}
                {Number(cobranza.monto).toFixed(2)} · {cobranza.estado})
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  Hoy la cobra: {cobranza.asesorName ?? "sin asesora"}. Con esto, la
                  nueva asesora será la responsable de cobrarla.
                </span>
              </span>
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {guardando ? (
              <FiRefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <FiUser className="h-4 w-4" />
            )}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Vincular comprobante a un pedido (admin o asesora dueña)
// Útil para facturas/boletas emitidas SIN pedido (venta de mostrador): se
// vinculan a un pedido existente para trazabilidad y mejor atribución de metas.
// ──────────────────────────────────────────────────────────
interface PedidoBuscado {
  id: string;
  cliente: string;
  detalle: string | null;
  estado: string;
  fecha_pedido: string | null;
}

function ModalVincularPedido({
  comprobante,
  onClose,
  onGuardado,
}: {
  comprobante: { id: string; serie_numero: string; pedidoId: string | null; pedidoCliente: string | null };
  onClose: () => void;
  onGuardado: (pedidoId: string | null, pedidoCliente: string | null, msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<PedidoBuscado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMouseDownInside = useRef(true);

  // Búsqueda de pedidos con debounce, reutilizando /api/buscar (scope por rol).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(term)}`);
        const j = await res.json().catch(() => ({}));
        setResultados(Array.isArray(j.pedidos) ? j.pedidos : []);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function vincular(pedidoId: string | null, clienteNombre: string | null) {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/comprobantes/${comprobante.id}/pedido`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo guardar.");
      } else {
        onGuardado(
          pedidoId,
          pedidoId ? clienteNombre : null,
          pedidoId ? `Vinculado al pedido de ${clienteNombre ?? "cliente"}` : "Pedido desvinculado"
        );
        onClose();
      }
    } catch {
      setError("Error de conexión al guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiLink className="text-indigo-600" />
            Vincular a pedido
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-sm text-gray-500">
            Conecta el comprobante{" "}
            <strong className="font-mono">{comprobante.serie_numero}</strong> con un pedido
            existente. Sirve para las ventas que se facturaron sin pedido.
          </p>

          {comprobante.pedidoId && (
            <div className="flex items-center justify-between gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
              <span className="text-sm text-indigo-800">
                Vinculado a: <strong>{comprobante.pedidoCliente?.trim() || "un pedido"}</strong>
              </span>
              <button
                onClick={() => vincular(null, null)}
                disabled={guardando}
                className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 whitespace-nowrap"
              >
                Desvincular
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Buscar pedido
            </label>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cliente o detalle del pedido…"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="min-h-[3rem]">
            {buscando && (
              <p className="text-sm text-gray-400 flex items-center gap-2 py-2">
                <FiRefreshCw className="h-4 w-4 animate-spin" /> Buscando…
              </p>
            )}
            {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
              <p className="text-sm text-gray-400 py-2">No se encontraron pedidos.</p>
            )}
            <div className="divide-y divide-gray-100">
              {resultados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => vincular(p.id, p.cliente)}
                  disabled={guardando || p.id === comprobante.pedidoId}
                  className="w-full text-left py-2.5 px-1 hover:bg-gray-50 disabled:opacity-40 flex items-start gap-2"
                >
                  <FiFileText className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 truncate">
                      {p.cliente?.trim() || "Sin nombre"}
                      {p.id === comprobante.pedidoId && (
                        <span className="ml-2 text-[11px] text-indigo-600">(ya vinculado)</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-gray-400 truncate">
                      {p.fecha_pedido ? `Entrega ${p.fecha_pedido} · ` : ""}
                      {p.estado}
                      {p.detalle ? ` · ${p.detalle}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Vincular Guía de Remisión a un comprobante (Factura/Boleta/NC)
// ──────────────────────────────────────────────────────────
interface ComprobanteBuscado {
  id: string;
  serie_numero: string;
  tipo: string;
  empresa: string;
  estado: string;
  monto_total: string | number;
  cliente_razon_social: string;
  cliente_doc_num: string;
}

function ModalVincularComprobante({
  guia,
  onClose,
  onGuardado,
}: {
  guia: {
    id: string;
    serie_numero: string;
    empresa: string;
    referencia_comprobante_id: string | null;
    referencia_serie_numero: string | null;
    referencia_tipo: string | null;
    referencia_cliente_razon_social: string | null;
    referencia_monto_total: string | number | null;
  };
  onClose: () => void;
  onGuardado: (
    comprobanteId: string | null,
    serieNumero: string | null,
    tipo: string | null,
    clienteRazonSocial: string | null,
    montoTotal: string | number | null,
    msg: string
  ) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ComprobanteBuscado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMouseDownInside = useRef(true);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(term)}`);
        const j = await res.json().catch(() => ({}));
        // Filtrar solo los comprobantes que sean de la misma empresa y no guías
        const filtered = (Array.isArray(j.comprobantes) ? j.comprobantes : [])
          .filter((c: ComprobanteBuscado) => c.empresa === guia.empresa && c.tipo !== "09");
        setResultados(filtered);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, guia.empresa]);

  async function vincular(
    comprobanteId: string | null,
    cpe: ComprobanteBuscado | null
  ) {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/guias/${guia.id}/comprobante`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comprobanteId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo guardar.");
      } else {
        onGuardado(
          comprobanteId,
          cpe ? cpe.serie_numero : null,
          cpe ? cpe.tipo : null,
          cpe ? cpe.cliente_razon_social : null,
          cpe ? cpe.monto_total : null,
          comprobanteId
            ? `Guía vinculada al comprobante ${cpe?.serie_numero}`
            : "Guía desvinculada del comprobante"
        );
        onClose();
      }
    } catch {
      setError("Error de conexión al guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiLink className="text-indigo-600" />
            Vincular a comprobante
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-sm text-gray-500">
            Conecta la guía de remisión{" "}
            <strong className="font-mono">{guia.serie_numero}</strong> con una factura, boleta o nota de crédito de{" "}
            <strong className="text-indigo-700">{empresaLabel(guia.empresa)}</strong>.
          </p>

          {guia.referencia_comprobante_id && (
            <div className="flex flex-col gap-1.5 p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-indigo-900 font-mono">
                  {tipoLabel(guia.referencia_tipo ?? "01")} {guia.referencia_serie_numero}
                </span>
                <button
                  onClick={() => vincular(null, null)}
                  disabled={guardando}
                  className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                >
                  Desvincular
                </button>
              </div>
              {(guia.referencia_cliente_razon_social || guia.referencia_monto_total != null) && (
                <div className="text-xs text-indigo-950 space-y-0.5">
                  {guia.referencia_cliente_razon_social && (
                    <div className="font-medium truncate">{guia.referencia_cliente_razon_social}</div>
                  )}
                  {guia.referencia_monto_total != null && (
                    <div className="font-mono text-indigo-700">Monto: S/ {Number(guia.referencia_monto_total).toFixed(2)}</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Buscar comprobante (N° o cliente)
            </label>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ej. F001-0002 o Nombre del cliente…"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="min-h-[3rem]">
            {buscando && (
              <p className="text-sm text-gray-400 flex items-center gap-2 py-2">
                <FiRefreshCw className="h-4 w-4 animate-spin" /> Buscando…
              </p>
            )}
            {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
              <p className="text-sm text-gray-400 py-2">No se encontraron comprobantes de esta empresa.</p>
            )}
            <div className="divide-y divide-gray-100">
              {resultados.map((c) => (
                <button
                  key={c.id}
                  onClick={() => vincular(c.id, c)}
                  disabled={guardando || c.id === guia.referencia_comprobante_id}
                  className="w-full text-left py-2.5 px-1 hover:bg-gray-50 disabled:opacity-40 flex items-start gap-2"
                >
                  <FiFileText className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 truncate">
                      {c.serie_numero} · {c.cliente_razon_social || "Sin nombre"}
                      {c.id === guia.referencia_comprobante_id && (
                        <span className="ml-2 text-[11px] text-indigo-600">(ya vinculada)</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-gray-400 truncate">
                      {tipoLabel(c.tipo)} · {c.estado} · S/ {c.monto_total}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Comunicación de Baja (RA-) — anula una factura aceptada (≤7 días)
// ──────────────────────────────────────────────────────────

function ModalComunicacionBaja({
  comprobante,
  onClose,
  onResuelto,
}: {
  comprobante: { id: string; serie_numero: string; empresa: string };
  onClose: () => void;
  onResuelto: (msg: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ticket: string | null; mensaje?: string } | null>(
    null
  );
  const [consultando, setConsultando] = useState(false);
  const [consulta, setConsulta] = useState<string | null>(null);
  const isMouseDownInside = useRef(true);

  const empresa = empresaApiId(comprobante.empresa);

  async function enviar() {
    if (motivo.trim().length < 10) {
      setError("El motivo debe tener al menos 10 caracteres.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/comprobantes/${comprobante.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo enviar la baja.");
      } else {
        setResultado({ ticket: j.ticket ?? null, mensaje: j.mensaje });
        onResuelto(
          `Baja enviada para ${comprobante.serie_numero}${j.ticket ? ` — ticket ${j.ticket}` : ""}`
        );
      }
    } catch {
      setError("Error de conexión al enviar la baja.");
    } finally {
      setEnviando(false);
    }
  }

  async function consultar() {
    if (!resultado?.ticket) return;
    setConsultando(true);
    setConsulta(null);
    try {
      const res = await fetch(`/api/comprobantes/consultar-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa,
          ticket: resultado.ticket,
          comprobanteId: comprobante.id,
        }),
      });
      const j = await res.json();
      if (!res.ok) setConsulta(typeof j.error === "string" ? j.error : "No se pudo consultar.");
      else setConsulta(`${j.estado}${j.mensaje ? ` — ${j.mensaje}` : ""}`);
    } catch {
      setConsulta("Error de conexión al consultar.");
    } finally {
      setConsultando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiXCircle className="text-red-600" />
            Comunicación de baja
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Anula ante SUNAT la factura{" "}
            <strong className="font-mono">{comprobante.serie_numero}</strong>. Solo se
            permite dentro de los <strong>7 días</strong> de emitida; pasado ese plazo, usa
            una nota de crédito.
          </p>
          {!resultado && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Motivo de la baja
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="Ej. Error en el RUC del cliente, se reemite correctamente"
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-red-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">Mínimo 10 caracteres.</p>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {resultado && (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                {resultado.mensaje || "Baja enviada a SUNAT."}
                {resultado.ticket && (
                  <div className="mt-1 text-xs text-green-700">
                    Ticket: <span className="font-mono">{resultado.ticket}</span>
                  </div>
                )}
              </div>
              {resultado.ticket && (
                <button
                  onClick={consultar}
                  disabled={consultando}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {consultando ? (
                    <FiRefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <FiSearch className="h-4 w-4" />
                  )}
                  Consultar estado del ticket
                </button>
              )}
              {consulta && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                  {consulta}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            {resultado ? "Cerrar" : "Cancelar"}
          </button>
          {!resultado && (
            <button
              onClick={enviar}
              disabled={enviando}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {enviando ? (
                <FiRefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <FiXCircle className="h-4 w-4" />
              )}
              Enviar baja a SUNAT
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Dar de Baja Guía de Remisión (GRE)
// ──────────────────────────────────────────────────────────

function ModalBajaGuia({
  comprobante,
  onClose,
  onResuelto,
}: {
  comprobante: { id: string; serie_numero: string; empresa: string };
  onClose: () => void;
  onResuelto: (msg: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [tipoBaja, setTipoBaja] = useState("1"); // 1: Antes del traslado, 2: Durante el traslado por cambio de destinatario
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMouseDownInside = useRef(true);

  // Formatear la serie y número
  const parts = comprobante.serie_numero.split("-");
  const serie = parts[0] || "T001";
  const numero = parts[1] ? parseInt(parts[1], 10).toString() : "0";

  async function enviar() {
    if (motivo.trim().length < 10) {
      setError("El motivo debe tener al menos 10 caracteres.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const labelTipoBaja = tipoBaja === "1" ? "Antes de iniciar el traslado" : "Durante el traslado, por cambio de destinatario";
      const res = await fetch(`/api/guias/${comprobante.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim(), tipo_baja: labelTipoBaja }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo anular la guía localmente.");
      } else {
        onResuelto(`Guía ${comprobante.serie_numero} anulada localmente con éxito.`);
        onClose();
      }
    } catch {
      setError("Error de conexión al anular la guía.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiSlash className="text-red-600" />
            Dar de Baja — Guía de Remisión
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <FiX className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Alerta Importante de SUNAT */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-850 text-xs">
            <FiInfo className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold">Acción manual requerida en SUNAT SOL</p>
              <p className="mt-0.5 text-amber-750 leading-relaxed">
                SUNAT no permite anular guías de remisión mediante API (sistema externo). 
                Debes ingresar a tu portal SOL y realizar la baja manualmente.
              </p>
            </div>
          </div>

          {/* Pasos para dar de baja */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Pasos para realizar la baja:</h4>
            <ol className="text-xs text-gray-600 space-y-2 list-decimal list-inside pl-1">
              <li className="leading-relaxed">
                Ingresa al portal <a href="https://www.sunat.gob.pe/sol.html" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-semibold">SUNAT SOL <FiExternalLink className="h-3 w-3" /></a> con tu RUC y Clave SOL.
              </li>
              <li className="leading-relaxed">
                Navega a: <strong className="text-gray-700">Empresas &gt; Guías de Remisión Electrónica &gt; Guía de Remisión Electrónica &gt; Baja de GRE</strong>.
              </li>
              <li className="leading-relaxed">
                Completa los datos de la guía que se muestran abajo y haz clic en <strong className="text-gray-700">Siguiente &gt; Dar de baja</strong>:
              </li>
            </ol>

            {/* Datos precargados para SUNAT */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs grid grid-cols-2 gap-3 mt-2">
              <div>
                <span className="block text-gray-400 font-medium uppercase text-[10px]">Tipo de GRE</span>
                <span className="font-bold text-gray-800">GRE - Remitente</span>
              </div>
              <div>
                <span className="block text-gray-400 font-medium uppercase text-[10px]">Empresa (Emisor)</span>
                <span className="font-bold text-gray-800">{comprobante.empresa}</span>
              </div>
              <div>
                <span className="block text-gray-400 font-medium uppercase text-[10px]">Serie de la GRE</span>
                <span className="font-mono font-bold text-gray-850 bg-white border border-gray-200 px-1.5 py-0.5 rounded shadow-sm inline-block">{serie}</span>
              </div>
              <div>
                <span className="block text-gray-400 font-medium uppercase text-[10px]">Número de la GRE</span>
                <span className="font-mono font-bold text-gray-850 bg-white border border-gray-200 px-1.5 py-0.5 rounded shadow-sm inline-block">{numero}</span>
              </div>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Formulario Local */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Registrar baja en nuestro sistema:</h4>
            
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Tipo de baja (SUNAT)
              </label>
              <select
                value={tipoBaja}
                onChange={(e) => setTipoBaja(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-red-500"
              >
                <option value="1">Antes de iniciar el traslado</option>
                <option value="2">Durante el traslado, por cambio de destinatario</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Motivo de la baja (Mín. 10 caracteres)
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={250}
                placeholder="Ej. Cambio en la fecha de despacho del pedido o error en los productos"
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-red-500"
              />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</p>}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 bg-slate-50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-755 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={enviando || motivo.trim().length < 10}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            {enviando ? (
              <FiRefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <FiSlash className="h-4 w-4" />
            )}
            Confirmar Baja Local
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Resumen Diario de Boletas (RC-)
// ──────────────────────────────────────────────────────────

function ModalResumenDiario({
  onClose,
  onResuelto,
}: {
  onClose: () => void;
  onResuelto: (msg: string) => void;
}) {
  const [empresa, setEmpresa] = useState<"transavic" | "avicola">("transavic");
  const [fecha, setFecha] = useState<string>(fechaLima(-1)); // por defecto: ayer
  const [conteo, setConteo] = useState<number | null>(null);
  const [cargandoConteo, setCargandoConteo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    ticket: string | null;
    mensaje?: string;
    boletasIncluidas?: number;
    resumenId?: string;
    skipped?: boolean;
  } | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [consulta, setConsulta] = useState<string | null>(null);
  const isMouseDownInside = useRef(true);
  const [previos, setPrevios] = useState<
    Array<{
      id: string;
      fecha_referencia: string;
      ticket: string | null;
      estado: string;
      boletas_incluidas: number | null;
    }>
  >([]);
  const [consultandoId, setConsultandoId] = useState<string | null>(null);
  const [reloadPrevios, setReloadPrevios] = useState(0);

  // Resúmenes ya enviados de esta empresa — permite consultar tickets de días previos.
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/comprobantes/resumenes?empresa=${empresa}`);
        const j = await res.json();
        if (!cancel && res.ok) setPrevios(j.resumenes ?? []);
      } catch {
        // silencioso
      }
    })();
    return () => {
      cancel = true;
    };
  }, [empresa, reloadPrevios]);

  async function consultarPrevio(r: { id: string; ticket: string | null }) {
    if (!r.ticket) return;
    setConsultandoId(r.id);
    try {
      const res = await fetch(`/api/comprobantes/consultar-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, ticket: r.ticket, resumenId: r.id }),
      });
      const j = await res.json();
      if (res.ok) {
        setPrevios((prev) =>
          prev.map((x) => (x.id === r.id ? { ...x, estado: j.estado ?? x.estado } : x))
        );
      }
    } catch {
      // silencioso
    } finally {
      setConsultandoId(null);
    }
  }

  // Cuenta de boletas del día seleccionado (refresca al cambiar empresa/fecha)
  useEffect(() => {
    let cancel = false;
    setConteo(null);
    setResultado(null);
    setConsulta(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    (async () => {
      setCargandoConteo(true);
      try {
        const res = await fetch(
          `/api/comprobantes/resumen-diario?fecha=${fecha}&empresa=${empresa}`
        );
        const j = await res.json();
        if (!cancel && res.ok) setConteo(j.total ?? 0);
      } catch {
        // silencioso
      } finally {
        if (!cancel) setCargandoConteo(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [empresa, fecha]);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/comprobantes/resumen-diario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, empresa }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "No se pudo enviar el resumen.");
      } else {
        setResultado({
          ticket: j.ticket ?? null,
          mensaje: j.mensaje,
          boletasIncluidas: j.boletasIncluidas,
          resumenId: j.resumenId,
          skipped: j.skipped,
        });
        onResuelto(
          j.skipped
            ? `El resumen del ${fecha} ya estaba enviado.`
            : `Resumen del ${fecha} enviado (${j.boletasIncluidas ?? 0} boletas).`
        );
        setReloadPrevios((n) => n + 1);
      }
    } catch {
      setError("Error de conexión al enviar el resumen.");
    } finally {
      setEnviando(false);
    }
  }

  async function consultar() {
    if (!resultado?.ticket) return;
    setConsultando(true);
    setConsulta(null);
    try {
      const res = await fetch(`/api/comprobantes/consultar-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa,
          ticket: resultado.ticket,
          resumenId: resultado.resumenId,
        }),
      });
      const j = await res.json();
      if (!res.ok) setConsulta(typeof j.error === "string" ? j.error : "No se pudo consultar.");
      else setConsulta(`${j.estado}${j.mensaje ? ` — ${j.mensaje}` : ""}`);
    } catch {
      setConsulta("Error de conexión al consultar.");
    } finally {
      setConsultando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <FiCalendar className="text-red-600" />
            Resumen diario de boletas
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            SUNAT exige enviar un resumen de las boletas del día. El sistema lo manda
            automáticamente cada madrugada; aquí puedes enviarlo o reenviarlo manualmente.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Empresa
              </label>
              <select
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value as "transavic" | "avicola")}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-red-500"
              >
                <option value="transavic">Transavic</option>
                <option value="avicola">Avícola de Tony</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Fecha
              </label>
              <input
                type="date"
                value={fecha}
                max={fechaLima(0)}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
            {cargandoConteo
              ? "Contando boletas…"
              : conteo === null
                ? "—"
                : conteo === 0
                  ? "No hay boletas para esta fecha."
                  : `${conteo} boleta(s) se incluirán en el resumen.`}
          </div>

          {previos.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                Resúmenes enviados
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {previos.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded px-2 py-1.5"
                  >
                    <span className="text-gray-700 whitespace-nowrap">
                      {String(r.fecha_referencia).slice(0, 10)} · {r.boletas_incluidas ?? 0} bol.
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${colorEstado(r.estado)}`}
                    >
                      {r.estado}
                    </span>
                    {r.ticket ? (
                      <button
                        onClick={() => consultarPrevio(r)}
                        disabled={consultandoId === r.id}
                        className="text-blue-600 hover:underline disabled:opacity-50 flex items-center gap-1"
                      >
                        {consultandoId === r.id ? (
                          <FiRefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <FiSearch className="h-3 w-3" />
                        )}
                        Consultar
                      </button>
                    ) : (
                      <span className="text-gray-400">sin ticket</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {resultado && (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                {resultado.mensaje || "Resumen procesado."}
                {resultado.ticket && (
                  <div className="mt-1 text-xs text-green-700">
                    Ticket: <span className="font-mono">{resultado.ticket}</span>
                  </div>
                )}
              </div>
              {resultado.ticket && (
                <button
                  onClick={consultar}
                  disabled={consultando}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {consultando ? (
                    <FiRefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <FiSearch className="h-4 w-4" />
                  )}
                  Consultar estado del ticket
                </button>
              )}
              {consulta && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                  {consulta}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            {resultado ? "Cerrar" : "Cancelar"}
          </button>
          <button
            onClick={enviar}
            disabled={enviando || cargandoConteo || conteo === 0}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {enviando ? (
              <FiRefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <FiSend className="h-4 w-4" />
            )}
            {resultado ? "Reenviar" : "Enviar resumen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modal: Exportar reporte contable a Excel (con período)
// El contador necesita el reporte por rango de fechas. Presets rápidos
// (Este mes / Mes anterior / Hoy / Todo) + rango personalizado. Respeta los
// filtros de tipo/empresa que estén activos en la lista.
// ──────────────────────────────────────────────────────────
function primerDiaDelMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function ultimoDiaDelMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  // Día 0 del mes siguiente = último del actual. UTC para no depender de TZ.
  const dia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
}
function mesAnteriorISO(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)); // m-2 = mes anterior (0-based)
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
const NOMBRE_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
function etiquetaMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${NOMBRE_MES[m - 1]} ${y}`;
}

type PresetExcel = "mes" | "mesAnterior" | "hoy" | "todo" | "custom";

function ModalExportarExcel({
  filtroTipo,
  filtroEmpresa,
  onClose,
}: {
  filtroTipo: string;
  filtroEmpresa: string;
  onClose: () => void;
}) {
  const hoy = fechaLima(0);
  const [preset, setPreset] = useState<PresetExcel>("mes");
  const [desde, setDesde] = useState<string>(primerDiaDelMes(hoy));
  const [hasta, setHasta] = useState<string>(hoy);

  const aplicarPreset = (p: PresetExcel) => {
    setPreset(p);
    if (p === "mes") {
      setDesde(primerDiaDelMes(hoy));
      setHasta(hoy);
    } else if (p === "mesAnterior") {
      const ini = mesAnteriorISO(hoy);
      setDesde(ini);
      setHasta(ultimoDiaDelMes(ini));
    } else if (p === "hoy") {
      setDesde(hoy);
      setHasta(hoy);
    } else if (p === "todo") {
      setDesde("");
      setHasta("");
    }
    // "custom" no toca las fechas — el usuario las edita a mano.
  };

  const descargar = () => {
    const params = new URLSearchParams();
    if (filtroTipo !== "all") params.set("tipo", filtroTipo);
    if (filtroEmpresa !== "all") params.set("empresa", filtroEmpresa);
    if (preset !== "todo" && desde) params.set("desde", desde);
    if (preset !== "todo" && hasta) params.set("hasta", hasta);
    window.location.assign(`/api/comprobantes/export-xlsx?${params.toString()}`);
    onClose();
  };

  const presets: Array<{ id: PresetExcel; label: string }> = [
    { id: "mes", label: `Este mes (${etiquetaMes(hoy)})` },
    { id: "mesAnterior", label: `Mes anterior (${etiquetaMes(mesAnteriorISO(hoy))})` },
    { id: "hoy", label: "Solo hoy" },
    { id: "todo", label: "Todos (sin filtro de fecha)" },
    { id: "custom", label: "Rango personalizado" },
  ];

  const hayFiltros = filtroTipo !== "all" || filtroEmpresa !== "all";
  const rangoInvalido =
    preset !== "todo" && desde && hasta && desde > hasta;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <FiFile className="text-emerald-600" />
            Exportar a Excel
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700">
            <FiX />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Reporte contable con <strong>resumen, registro de ventas y detalle</strong> por
            tipo. Elige el período a exportar:
          </p>

          {/* Presets */}
          <div className="grid grid-cols-1 gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => aplicarPreset(p.id)}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2 ${
                  preset === p.id
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                    preset === p.id ? "border-emerald-500 bg-emerald-500" : "border-gray-300"
                  }`}
                />
                {p.label}
              </button>
            ))}
          </div>

          {/* Rango de fechas (visible salvo en "Todo") */}
          {preset !== "todo" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Desde</label>
                <input
                  type="date"
                  value={desde}
                  max={hasta || undefined}
                  onChange={(e) => {
                    setDesde(e.target.value);
                    setPreset("custom");
                  }}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Hasta</label>
                <input
                  type="date"
                  value={hasta}
                  min={desde || undefined}
                  onChange={(e) => {
                    setHasta(e.target.value);
                    setPreset("custom");
                  }}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
          )}

          {rangoInvalido && (
            <p className="text-xs text-red-600 font-medium">
              La fecha &quot;desde&quot; no puede ser posterior a &quot;hasta&quot;.
            </p>
          )}

          {/* Aviso de filtros heredados de la lista */}
          {hayFiltros && (
            <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 flex items-start gap-2">
              <FiInfo className="flex-shrink-0 mt-0.5" />
              <span>
                Se respetan los filtros activos:
                {filtroTipo !== "all" && <strong> Tipo = {tipoLabel(filtroTipo)}</strong>}
                {filtroTipo !== "all" && filtroEmpresa !== "all" && " ·"}
                {filtroEmpresa !== "all" && <strong> Empresa = {empresaLabel(filtroEmpresa)}</strong>}
                . Quita los filtros en la lista si quieres exportar todo.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={descargar}
            disabled={!!rangoInvalido}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <FiDownload className="h-4 w-4" />
            Descargar Excel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ComprobantesClient({ userRole }: { userRole: string }) {
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pagina, setPagina] = useState(1);
  // Si vinimos con ?pedido_id=… (link desde el badge "Facturado" de /dashboard),
  // filtramos los comprobantes de ese pedido y mostramos un banner para volver.
  const searchParams = useSearchParams();
  const pedidoIdFiltro = searchParams?.get("pedido_id") || null;
  // Inicializar filtro de tipo desde query param ?tipo= (ej. cuando se viene
  // desde /dashboard/guias redirect a /dashboard/comprobantes?tipo=09)
  const tipoParam = searchParams?.get("tipo") || "all";
  const [filtroTipo, setFiltroTipo] = useState<string>(tipoParam);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("all");
  // Estado se filtra en cliente (tipo/empresa van al API); evita re-fetch.
  const [filtroEstado, setFiltroEstado] = useState<string>("all");
  // Búsqueda local sobre lo ya traído: matchea serie_numero, cliente y doc.
  // El usuario escribe "F001-23" o "Lucy" o "20123…" y filtra al toque.
  const [busqueda, setBusqueda] = useState<string>("");
  const [accionEnProgreso, setAccionEnProgreso] = useState<string | null>(null);
  // Menú "⋯" de acciones por fila (posición fija para escapar del overflow de la tabla).
  const [menuAcciones, setMenuAcciones] = useState<{
    c: Comprobante;
    triggerEl: HTMLElement;
  } | null>(null);
  const [modalEnviar, setModalEnviar] = useState<{
    id: string;
    defaultEmail: string;
  } | null>(null);
  const [modalNC, setModalNC] = useState<{ id: string; serie_numero: string } | null>(null);
  const [modalBaja, setModalBaja] = useState<{
    id: string;
    serie_numero: string;
    empresa: string;
  } | null>(null);
  const [modalBajaGuia, setModalBajaGuia] = useState<{
    id: string;
    serie_numero: string;
    empresa: string;
  } | null>(null);
  // Cambiar la asesora encargada de un comprobante (solo admin): reescribe
  // `emitido_por` → así el comprobante aparece en la lista de esa asesora.
  const [modalAsesora, setModalAsesora] = useState<{
    id: string;
    serie_numero: string;
    emitidoPor: string | null;
  } | null>(null);
  // Lista de asesoras para el modal de reasignación (solo se llena si admin).
  const [asesoras, setAsesoras] = useState<{ id: string; name: string }[]>([]);
  // Vincular un comprobante (sin pedido o con uno equivocado) a un pedido existente.
  const [modalVincular, setModalVincular] = useState<{
    id: string;
    serie_numero: string;
    pedidoId: string | null;
    pedidoCliente: string | null;
  } | null>(null);
  // Vincular una guía de remisión a un comprobante (factura/boleta/NC).
  const [modalVincularComprobante, setModalVincularComprobante] = useState<{
    id: string;
    serie_numero: string;
    comprobanteId: string | null;
    referenciaSerieNumero: string | null;
    referenciaTipo: string | null;
    referenciaClienteRazonSocial: string | null;
    referenciaMontoTotal: string | number | null;
  } | null>(null);
  const [showEmitirGuiaDirecta, setShowEmitirGuiaDirecta] = useState(false);
  const [modalResumen, setModalResumen] = useState(false);
  // Modal de exportación a Excel: el contador elige el período antes de bajar.
  const [modalExcel, setModalExcel] = useState(false);
  // Menú discreto de admin (⋯) en la toolbar. El Resumen Diario de boletas se
  // envía SOLO por cron (2am Lima); acá queda solo como respaldo por si el cron
  // falló algún día — no como acción que el admin deba recordar hacer.
  const [menuAdmin, setMenuAdmin] = useState(false);
  // Nota de crédito: admin y la asesora dueña del comprobante, sobre facturas/boletas
  // ya aceptadas u observadas. (La lista ya viene scopeada a los comprobantes de la
  // asesora; el backend revalida que solo acredite los de sus pedidos.)
  const puedeNotaCredito = (c: Comprobante) =>
    (userRole === "admin" || userRole === "asesor") &&
    (c.estado === "aceptado" || c.estado === "observado") &&
    (c.tipo === "01" || c.tipo === "03");
  // Reintentar:
  //  - Comprobantes: solo admin, sobre rechazado/error (reusa el correlativo).
  //  - Guías (09): admin o la asesora dueña, sobre error/pendiente/rechazado o una
  //    guía ATASCADA en "emitiendo" (reusa el MISMO número; si SUNAT ya la tenía,
  //    el reintento lo detecta y la marca aceptada). Las rechazadas SÍ se
  //    reintentan: un rechazo no registra el documento, el número sigue libre.
  const puedeReintentar = (c: Comprobante) =>
    c.tipo === "09"
      ? (userRole === "admin" || userRole === "asesor") &&
        ["error", "pendiente", "emitiendo", "rechazado"].includes(c.estado)
      : // CPE: admin o la asesora dueña (el endpoint valida el scope real) —
        // antes era solo-admin y la asesora quedaba bloqueada esperando por un
        // fallo que suele ser solo de conexión (caso F002-83, 12 jun 2026).
        (userRole === "admin" || userRole === "asesor") &&
        (c.estado === "error" || c.estado === "rechazado");
  // Comunicación de baja: solo admin, sobre FACTURAS aceptadas/observadas (boletas → resumen).
  // Días transcurridos desde la emisión (para la regla de la Comunicación de Baja).
  const diasDesde = (iso: string) =>
    (Date.now() - new Date(iso).getTime()) / 86_400_000;
  // Comunicación de Baja DESHABILITADA en la UI (decisión de negocio): en la
  // práctica se usa SIEMPRE la Nota de Crédito — cubre factura y boleta, en
  // cualquier momento, y es lo que el cliente conoce. La baja es más frágil
  // (solo facturas, solo ≤7 días). El endpoint /anular sigue disponible; para
  // reactivar el botón, poner ANULAR_HABILITADO = true.
  const ANULAR_HABILITADO = false;
  const puedeAnular = (c: Comprobante) =>
    ANULAR_HABILITADO &&
    userRole === "admin" &&
    c.tipo === "01" &&
    (c.estado === "aceptado" || c.estado === "observado") &&
    diasDesde(c.created_at) <= 7;
  const [toast, setToast] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalEmitirGuiaCpe, setModalEmitirGuiaCpe] = useState<{ pedido?: Pedido | null; comprobante?: ComprobanteInfo | null } | null>(null);
  const [cargandoPedidoId, setCargandoPedidoId] = useState<string | null>(null);
  const [cargandoComprobanteId, setCargandoComprobanteId] = useState<string | null>(null);


  const fetchData = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filtroTipo !== "all") params.set("tipo", filtroTipo);
      if (filtroEmpresa !== "all") params.set("empresa", filtroEmpresa);
      // Si vinimos con ?pedido_id= (ej. link del badge "Facturado"), filtramos.
      if (pedidoIdFiltro) params.set("pedido_id", pedidoIdFiltro);
      const qs = params.toString();
      const url = qs ? `/api/comprobantes?${qs}` : "/api/comprobantes";
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setComprobantes((await res.json()).data ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroTipo, filtroEmpresa, pedidoIdFiltro]);

  // Volver a la página 1 cuando cambia cualquier filtro (incluida la búsqueda).
  useEffect(() => {
    setPagina(1);
  }, [filtroTipo, filtroEmpresa, filtroEstado, busqueda]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Recalcular posición del menú de acciones al hacer scroll o resize en lugar de cerrarlo
  const [scrollTrigger, setScrollTrigger] = useState(0);
  useEffect(() => {
    if (!menuAcciones) return;
    const handleUpdate = () => setScrollTrigger((prev) => prev + 1);
    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate, true);
    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate, true);
    };
  }, [menuAcciones]);

  // Cerrar el menú de acciones si el usuario hace clic afuera del menú
  useEffect(() => {
    if (!menuAcciones) return;
    const clickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".menu-acciones-dropdown") ||
        target.closest(".btn-trigger-acciones")
      ) {
        return;
      }
      setMenuAcciones(null);
    };
    document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, [menuAcciones]);

  // Cargar la lista de asesoras una sola vez (solo admin) para el modal "Cambiar
  // asesora". /api/users?role=asesor devuelve un array plano [{id, name}].
  useEffect(() => {
    if (userRole !== "admin") return;
    fetch("/api/users?role=asesor")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAsesoras(Array.isArray(d) ? d : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const descargarPDF = async (c: Comprobante) => {
    setAccionEnProgreso(c.id + "-pdf");
    try {
      const detalle = await fetchDetalle(c.id);
      const blob = await generarPdfBlob(detalle);
      downloadBlob(blob, `${c.serie_numero}.pdf`);
      setToast({ tipo: "ok", msg: `PDF descargado: ${c.serie_numero}.pdf` });
    } catch (err) {
      setToast({ tipo: "error", msg: `Error generando PDF: ${(err as Error).message}` });
    } finally {
      setAccionEnProgreso(null);
    }
  };

  // PDF de la GUÍA (tipo 09): se genera con jsPDF y se DESCARGA (no abre pestaña),
  // igual que las boletas/facturas.
  const descargarPDFGuia = async (c: Comprobante) => {
    setAccionEnProgreso(c.id + "-pdf");
    try {
      const { descargarPdfGuia } = await import("@/lib/descargar-guia");
      await descargarPdfGuia(c.id);
      setToast({ tipo: "ok", msg: `PDF descargado: ${c.serie_numero}.pdf` });
    } catch (err) {
      setToast({ tipo: "error", msg: `Error generando PDF: ${(err as Error).message}` });
    } finally {
      setAccionEnProgreso(null);
    }
  };

  const descargarXML = async (c: Comprobante) => {
    setAccionEnProgreso(c.id + "-xml");
    try {
      // Guías usan endpoint distinto (/api/guias/:id/xml)
      const endpoint = c.tipo === "09"
        ? `/api/guias/${c.id}/xml`
        : `/api/comprobantes/${c.id}/xml`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      downloadBlob(blob, `${c.serie_numero}.xml`);
      setToast({ tipo: "ok", msg: `XML descargado: ${c.serie_numero}.xml` });
    } catch (err) {
      setToast({ tipo: "error", msg: (err as Error).message });
    } finally {
      setAccionEnProgreso(null);
    }
  };

  // Descarga el CDR (constancia ZIP que SUNAT devuelve al aceptar el comprobante).
  const descargarCDR = async (c: Comprobante) => {
    setAccionEnProgreso(c.id + "-cdr");
    try {
      // Guías usan endpoint distinto (/api/guias/:id/cdr)
      const endpoint = c.tipo === "09"
        ? `/api/guias/${c.id}/cdr`
        : `/api/comprobantes/${c.id}/cdr`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      downloadBlob(blob, `R-${c.serie_numero}.zip`);
      setToast({ tipo: "ok", msg: `CDR descargado: R-${c.serie_numero}.zip` });
    } catch (err) {
      setToast({ tipo: "error", msg: (err as Error).message });
    } finally {
      setAccionEnProgreso(null);
    }
  };

  // Reintenta enviar a SUNAT un comprobante en error/rechazado (reusa el mismo
  // correlativo). Las guías (09) tienen su propio endpoint que reusa el MISMO número.
  const reintentarEnvio = async (c: Comprobante) => {
    setAccionEnProgreso(c.id + "-retry");
    try {
      const endpoint = c.tipo === "09"
        ? `/api/guias/${c.id}/reintentar`
        : `/api/comprobantes/${c.id}/reintentar`;
      const res = await fetch(endpoint, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || j.detalle || `HTTP ${res.status}`);
      setToast({
        tipo: j.exito ? "ok" : "error",
        msg: j.mensaje || j.descripcion || (j.exito ? "Reintento enviado" : "SUNAT volvió a rechazar"),
      });
      fetchData();
    } catch (err) {
      setToast({ tipo: "error", msg: `Reintento falló: ${(err as Error).message}` });
    } finally {
      setAccionEnProgreso(null);
    }
  };

  // Filtros en cliente sobre lo ya traído. Estado y búsqueda se aplican acá;
  // tipo y empresa van al API. La búsqueda matchea sin distinguir mayúsculas
  // contra serie_numero, cliente_razon_social y cliente_doc_num (lo más útil
  // para la asesora: "F001-23", "Lucy", o el RUC).
  //
  // El filtro de estado se simplificó (mayo 2026) de 7 estados SUNAT crudos a
  // 4 grupos que el usuario sí entiende. Los grupos cuadran EXACTO con los KPIs
  // de arriba (para que el KPI "Con problemas" clickeable filtre lo mismo):
  //   - aceptados  → aceptado + observado (SUNAT los validó; son fiscales OK)
  //   - problemas  → rechazado + error (hay que reintentar / emitir NC)
  //   - anulados   → anulado
  // "pendiente" es transitorio (segundos) y tiene su propio KPI; queda dentro
  // de "Todos", sin chip propio.
  const perteneceAlEstado = (estado: string): boolean => {
    switch (filtroEstado) {
      case "aceptados":
        return estado === "aceptado" || estado === "observado";
      case "problemas":
        return estado === "rechazado" || estado === "error";
      case "anulados":
        return estado === "anulado";
      default:
        return true; // "all"
    }
  };
  const qNorm = busqueda.trim().toLowerCase();
  const comprobantesFiltrados = comprobantes
    .filter((c) => perteneceAlEstado(c.estado))
    .filter((c) => {
      if (!qNorm) return true;
      return (
        c.serie_numero.toLowerCase().includes(qNorm) ||
        (c.cliente_razon_social ?? "").toLowerCase().includes(qNorm) ||
        (c.cliente_doc_num ?? "").toLowerCase().includes(qNorm) ||
        (c.pedido_cliente ?? "").toLowerCase().includes(qNorm)
      );
    });

  // Stats de cabecera: se calculan sobre lo TRAÍDO (no sobre lo filtrado en
  // cliente). Así la asesora ve siempre "cuántos hay en error", aunque tenga
  // un filtro de estado activo. El total monetario sí sigue lo visible para
  // que cuadre con la tabla.
  const statsTotalCount = comprobantes.length;
  // Aceptados incluye "observado" (SUNAT los validó igual). Con problemas =
  // rechazado + error. Estos conteos cuadran con los grupos del filtro de estado.
  const statsAceptados = comprobantes.filter(
    (c) => c.estado === "aceptado" || c.estado === "observado"
  ).length;
  const statsProblemas = comprobantes.filter(
    (c) => c.estado === "rechazado" || c.estado === "error"
  ).length;
  const statsPendientes = comprobantes.filter((c) => c.estado === "pendiente").length;
  const totalMontoFiltrado = comprobantesFiltrados.reduce(
    (acc, c) => acc + Number(c.monto_total || 0),
    0
  );

  // Paginación en cliente: páginas de PAGINA_TAM filas para que la lista no se
  // abulte cuando hay muchos comprobantes.
  const PAGINA_TAM = 15;
  const totalPaginas = Math.max(1, Math.ceil(comprobantesFiltrados.length / PAGINA_TAM));
  const paginaActual = Math.min(pagina, totalPaginas);
  const comprobantesPagina = comprobantesFiltrados.slice(
    (paginaActual - 1) * PAGINA_TAM,
    paginaActual * PAGINA_TAM
  );

  // Abre el menú "⋯" anclado al botón (posición FIJA para que no lo recorte el
  // overflow-x de la tabla). Toggle: si ya estaba abierto en esa fila, lo cierra.
  const abrirMenuAcciones = (e: React.MouseEvent, c: Comprobante) => {
    const triggerEl = e.currentTarget as HTMLElement;
    setMenuAcciones((m) => {
      if (m?.c.id === c.id) return null;
      return { c, triggerEl };
    });
  };

  // Celda de acciones (desktop + móvil): acción primaria PDF/Imprimir visible + menú "⋯"
  // con el resto. Las guías (tipo='09') muestran "Imprimir" en lugar de "PDF".
  const celdaAcciones = (c: Comprobante) => {
    const isLoadingPdf = accionEnProgreso === c.id + "-pdf";
    const abierto = menuAcciones?.c.id === c.id;
    const esGuia = c.tipo === "09";

    return (
      <div className="flex items-center justify-end gap-1">
        {esGuia ? (
          <button
            onClick={() => descargarPDFGuia(c)}
            disabled={isLoadingPdf}
            title="Descargar PDF de la Guía de Remisión"
            className="px-2.5 py-1.5 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 rounded-md flex items-center gap-1 disabled:opacity-50"
          >
            {isLoadingPdf ? <FiRefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FiDownload className="h-3.5 w-3.5" />}
            PDF
          </button>
        ) : (
          <button
            onClick={() => descargarPDF(c)}
            disabled={isLoadingPdf}
            title="Descargar PDF (representación impresa)"
            className="px-2.5 py-1.5 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 rounded-md flex items-center gap-1 disabled:opacity-50"
          >
            {isLoadingPdf ? <FiRefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FiDownload className="h-3.5 w-3.5" />}
            PDF
          </button>
        )}
        <button
          onClick={(e) => abrirMenuAcciones(e, c)}
          title={esGuia ? "Más acciones (XML, CDR)" : "Más acciones (XML, CDR, correo, nota de crédito, anular…)"}
          aria-label="Más acciones"
          className={`p-1.5 rounded-md border btn-trigger-acciones ${
            abierto
              ? "bg-gray-100 border-gray-300 text-gray-700"
              : "border-gray-200 text-gray-500 hover:bg-gray-100"
          }`}
        >
          <FiMoreVertical className="h-4 w-4" />
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="inline-block h-6 w-6 border-2 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
        <div className="mt-2 text-sm">Cargando comprobantes…</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* ── Header: título + acción primaria muy visible. Acciones secundarias
            (Excel, Resumen, Refrescar) bajan a la toolbar de la tabla. ── */}
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiFileText className="text-red-600" />
            Comprobantes SUNAT
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Facturas, boletas, notas de crédito y guías de remisión emitidas a SUNAT
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setShowEmitirGuiaDirecta(true)}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <FiTruck />
            Emitir guía
          </button>
          <Link
            href="/dashboard/comprobantes/nuevo"
            className="px-4 py-2.5 bg-red-600 text-white hover:bg-red-700 rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-colors"
          >
            <FiPlus />
            Emitir comprobante
          </Link>
        </div>
      </header>

      {/* ── KPIs: lo que la asesora necesita ver al abrir la pantalla.
            Total · Aceptados · Problemas (rechazado/error/observado) · Pendientes
            de SUNAT. El monto se ve abajo en el footer porque cambia con los
            filtros visibles. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard
          color="gray"
          icon={<FiFileText />}
          label="Total en lista"
          value={statsTotalCount}
          hint={`${tipoLabel(filtroTipo === "all" ? "" : filtroTipo) || "Todos"} · ${
            filtroEmpresa === "all" ? "Ambas empresas" : empresaLabel(filtroEmpresa)
          }`}
        />
        <KpiCard
          color="green"
          icon={<FiCheckCircle />}
          label="Aceptados"
          value={statsAceptados}
          hint="OK ante SUNAT"
        />
        <KpiCard
          color="red"
          icon={<FiAlertTriangle />}
          label="Con problemas"
          value={statsProblemas}
          hint="Rechazo o error"
          highlight={statsProblemas > 0}
          onClick={statsProblemas > 0 ? () => setFiltroEstado("problemas") : undefined}
        />
        <KpiCard
          color="blue"
          icon={<FiClock />}
          label="Pendientes"
          value={statsPendientes}
          hint="Esperando respuesta"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center justify-between">
          <span>⚠️ No pude cargar los comprobantes: {error}</span>
          <button
            onClick={fetchData}
            className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Banner cuando vinimos desde el badge "Facturado" de un pedido */}
      {pedidoIdFiltro && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FiInfo className="flex-shrink-0" />
            Mostrando solo los comprobantes del pedido <code className="px-1.5 py-0.5 bg-white border border-emerald-200 rounded font-mono text-xs">{pedidoIdFiltro.slice(0, 8)}…</code>
          </span>
          <Link
            href="/dashboard/comprobantes"
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900 underline"
          >
            Quitar filtro
          </Link>
        </div>
      )}

      {/* ── Toolbar: buscador + acciones secundarias (Excel · Resumen · Refrescar).
            Buscador es lo más útil del día a día; las otras acciones se ven pero
            no compiten con el botón "Emitir comprobante" del header. ── */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por número (F001-23), cliente o RUC/DNI…"
            className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700"
              aria-label="Limpiar búsqueda"
            >
              <FiX size={14} />
            </button>
          )}
        </div>
        {userRole === "admin" && (
          <button
            onClick={() => setModalExcel(true)}
            title="Exportar reporte contable a Excel (elige el período)"
            className="px-3 py-2 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg flex items-center gap-1 font-medium"
          >
            <FiFile />
            Excel
          </button>
        )}
        <button
          onClick={fetchData}
          disabled={refreshing}
          title="Refrescar"
          className="px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
        >
          <FiRefreshCw className={refreshing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refrescar</span>
        </button>
        {/* Menú discreto de admin (⋯). El Resumen Diario de boletas se envía solo
            por cron (2am); queda acá como respaldo, no como acción pendiente. */}
        {userRole === "admin" && (
          <div className="relative">
            <button
              onClick={() => setMenuAdmin((v) => !v)}
              title="Más acciones SUNAT"
              aria-label="Más acciones SUNAT"
              className={`px-2 py-2 text-xs rounded-lg border ${
                menuAdmin
                  ? "bg-gray-100 border-gray-300 text-gray-700"
                  : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              <FiMoreVertical />
            </button>
            {menuAdmin && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuAdmin(false)} />
                <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-40">
                  <button
                    onClick={() => { setMenuAdmin(false); setModalResumen(true); }}
                    className="w-full px-3 py-2 flex items-start gap-2.5 hover:bg-gray-50 text-left"
                  >
                    <FiCalendar className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium text-gray-700">
                        Resumen diario de boletas
                      </span>
                      <span className="block text-[11px] text-gray-500 leading-snug">
                        Se envía solo cada noche. Entra solo si quieres revisar o reenviarlo.
                      </span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Filtros: 3 dimensiones independientes (Tipo · Empresa · Estado).
            La etiqueta corta a la izquierda + chips con swatch de color. ── */}
      <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-4">
        <GrupoFiltro
          titulo="Tipo"
          activo={filtroTipo}
          onChange={setFiltroTipo}
          opciones={[
            { v: "all", l: "Todos" },
            { v: "01", l: "Facturas", swatch: "bg-indigo-500" },
            { v: "03", l: "Boletas", swatch: "bg-slate-400" },
            { v: "07", l: "N. Crédito", swatch: "bg-orange-500" },
            { v: "09", l: "Guías", swatch: "bg-amber-500" },
          ]}
        />
        <GrupoFiltro
          titulo="Empresa"
          activo={filtroEmpresa}
          onChange={setFiltroEmpresa}
          opciones={[
            { v: "all", l: "Ambas" },
            { v: "transavic", l: "Transavic", swatch: "bg-red-500" },
            { v: "avicola", l: "Avícola de Tony", swatch: "bg-teal-500" },
          ]}
        />
        <GrupoFiltro
          titulo="Estado"
          activo={filtroEstado}
          onChange={setFiltroEstado}
          opciones={[
            { v: "all", l: "Todos" },
            { v: "aceptados", l: "Aceptados", swatch: "bg-green-500" },
            { v: "problemas", l: "Con problemas", swatch: "bg-red-500" },
          ]}
        />
      </div>

      {/* Mobile: card layout (más legible que tabla con 7 columnas en 375px) */}
      <div className="sm:hidden space-y-3">
        {comprobantesFiltrados.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            Sin comprobantes emitidos todavía
          </div>
        )}
        {comprobantesPagina.map((c) => {
          return (
            <div key={c.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between mb-2 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold text-gray-800">
                    {c.serie_numero}
                  </div>
                  {c.tipo === "07" && c.referencia_serie_numero && (
                    <button
                      onClick={() => setBusqueda(c.referencia_serie_numero ?? "")}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-orange-700 hover:underline active:scale-[0.98]"
                    >
                      <FiCornerUpLeft size={11} className="flex-shrink-0" />
                      anula {serieCorta(c.referencia_serie_numero)}
                    </button>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {(() => {
                      const t = tipoUI(c.tipo);
                      return (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${t.bg} ${t.text}`}>
                          <t.Icon size={10} className="flex-shrink-0" />
                          {t.label}
                        </span>
                      );
                    })()}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${empresaBadgeColor(c.empresa)}`}
                    >
                      {empresaLabel(c.empresa)}
                    </span>
                    {c.tipo !== "07" && c.tiene_nc && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                        <FiCornerUpLeft size={10} className="flex-shrink-0" />
                        con N. Crédito
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {(() => {
                    const ui = estadoUI(c.estado);
                    return (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${ui.bg} ${ui.text}`}
                      >
                        <ui.Icon size={10} />
                        {ui.label}
                      </span>
                    );
                  })()}
                  {(() => {
                    const f = fechaHoraLima(c.created_at);
                    return (
                      <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
                        {f.fecha} · {f.hora}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="mb-2">
                <div className="text-sm font-medium text-gray-800">
                  {c.cliente_razon_social ?? c.pedido_cliente}
                </div>
                {c.cliente_doc_num && (
                  <div className="text-[10px] text-gray-400 font-mono">
                    {c.cliente_doc_num}
                  </div>
                )}
                {c.tipo === "09" ? (
                  c.referencia_serie_numero && (
                    <div className="mt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setBusqueda(c.referencia_serie_numero ?? "");
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-dashed border-blue-300 hover:bg-blue-100 hover:border-blue-400 transition-colors cursor-pointer active:scale-95"
                        title={`Buscar y ver comprobante ${c.referencia_serie_numero}`}
                      >
                        <FiLink size={10} className="flex-shrink-0" />
                        Ver {tipoLabel(c.referencia_tipo ?? "")} {c.referencia_serie_numero}
                      </button>
                    </div>
                  )
                ) : (
                  c.guia_serie_numero && (
                    <div className="mt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setBusqueda(c.guia_serie_numero ?? "");
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-dashed border-amber-300 hover:bg-amber-100 hover:border-amber-400 transition-colors cursor-pointer active:scale-95"
                        title={`Buscar y ver guía ${c.guia_serie_numero}`}
                      >
                        <FiLink size={10} className="flex-shrink-0" />
                        Ver Guía {c.guia_serie_numero}
                      </button>
                    </div>
                  )
                )}
                {c.emitido_por && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500">
                    <FiUser size={11} className="text-gray-400 flex-shrink-0" />
                    Emitió: {c.emitido_por}
                  </div>
                )}
              </div>
              {(c.estado === "rechazado" ||
                c.estado === "error" ||
                c.estado === "observado") &&
                (() => {
                  // Sin mensaje guardado (filas históricas) → fallback por estado:
                  // la asesora siempre debe saber si el documento vale y qué hacer.
                  const msg = c.mensaje_sunat
                    ? mensajeSunatAmigable(c.mensaje_sunat)
                    : (() => {
                        const def = mensajeEstadoSinDetalle(c.estado);
                        return def ? { amigable: def, tecnico: def } : null;
                      })();
                  if (!msg) return null;
                  return (
                    <div
                      className="mb-2 text-[11px] text-red-600 line-clamp-3"
                      title={msg.tecnico}
                    >
                      ⚠ {msg.amigable}
                    </div>
                  );
                })()}
              <div className="text-right text-lg font-bold mb-3">
                {c.tipo === "09" ? (
                  <span className="text-amber-700 text-sm font-semibold">
                    {c.peso_bruto_total != null ? `${Number(c.peso_bruto_total).toFixed(2)} kg` : "—"}
                    {c.total_bultos != null ? ` / ${c.total_bultos} bulto${c.total_bultos === 1 ? "" : "s"}` : ""}
                  </span>
                ) : (
                  <span className="text-red-600">S/ {Number(c.monto_total).toFixed(2)}</span>
                )}
              </div>
              <div className="border-t pt-2">{celdaAcciones(c)}</div>
            </div>
          );
        })}
      </div>

      {/* Desktop: tabla (sin cambios) */}
      <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Serie-Número</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Cliente</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-center">Estado</th>
              <th className="px-3 py-2 text-left">Empresa</th>
              <th className="px-3 py-2 text-left">Emitido por</th>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {comprobantesFiltrados.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-gray-400 py-8">
                  Sin comprobantes emitidos todavía
                </td>
              </tr>
            )}
            {comprobantesPagina.map((c) => {
              return (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-mono font-medium text-gray-800">{c.serie_numero}</div>
                    {c.tipo === "07" && c.referencia_serie_numero && (
                      <button
                        onClick={() => setBusqueda(c.referencia_serie_numero ?? "")}
                        title={`Ver la factura/boleta ${c.referencia_serie_numero} que esta nota de crédito anula`}
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-orange-700 hover:underline active:scale-[0.98]"
                      >
                        <FiCornerUpLeft size={11} className="flex-shrink-0" />
                        anula {serieCorta(c.referencia_serie_numero)}
                      </button>
                    )}
                    {c.tipo !== "07" && c.tiene_nc && (
                      <span className="mt-0.5 flex w-fit items-center gap-1 text-[10px] font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                        <FiCornerUpLeft size={10} className="flex-shrink-0" />
                        con N. Crédito
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const t = tipoUI(c.tipo);
                      return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${t.bg} ${t.text}`}>
                          <t.Icon size={11} className="flex-shrink-0" />
                          {t.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {c.cliente_razon_social ?? c.pedido_cliente}
                    </div>
                    {c.cliente_doc_num && (
                      <div className="text-[10px] text-gray-400 font-mono">
                        {c.cliente_doc_num}
                      </div>
                    )}
                    {c.tipo === "09" ? (
                      c.referencia_serie_numero && (
                        <div className="mt-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBusqueda(c.referencia_serie_numero ?? "");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-dashed border-blue-300 hover:bg-blue-100 hover:border-blue-400 transition-colors cursor-pointer active:scale-95"
                            title={`Buscar y ver comprobante ${c.referencia_serie_numero}`}
                          >
                            <FiLink size={10} className="flex-shrink-0" />
                            Ver {tipoLabel(c.referencia_tipo ?? "")} {c.referencia_serie_numero}
                          </button>
                        </div>
                      )
                    ) : (
                      c.guia_serie_numero && (
                        <div className="mt-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBusqueda(c.guia_serie_numero ?? "");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-dashed border-amber-300 hover:bg-amber-100 hover:border-amber-400 transition-colors cursor-pointer active:scale-95"
                            title={`Buscar y ver guía ${c.guia_serie_numero}`}
                          >
                            <FiLink size={10} className="flex-shrink-0" />
                            Ver Guía {c.guia_serie_numero}
                          </button>
                        </div>
                      )
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {c.tipo === "09" ? (
                      <span className="text-amber-700 text-xs font-semibold">
                        {c.peso_bruto_total != null ? `${Number(c.peso_bruto_total).toFixed(2)} kg` : "—"}
                        {c.total_bultos != null ? (<><br />{c.total_bultos} bulto{c.total_bultos === 1 ? "" : "s"}</>) : ""}
                      </span>
                    ) : (
                      <>S/ {Number(c.monto_total).toFixed(2)}</>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {(() => {
                      const ui = estadoUI(c.estado);
                      const conProblema =
                        (c.estado === "rechazado" || c.estado === "error") ||
                        (c.estado === "observado" && !!c.mensaje_sunat);
                      return (
                        <div className="flex items-center justify-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${ui.bg} ${ui.text}`}
                          >
                            <ui.Icon size={10} />
                            {ui.label}
                          </span>
                          {conProblema && (
                            <span
                              title={(() => {
                                if (!c.mensaje_sunat) {
                                  return mensajeEstadoSinDetalle(c.estado) ?? "";
                                }
                                const msg = mensajeSunatAmigable(c.mensaje_sunat);
                                return msg.amigable === msg.tecnico
                                  ? msg.tecnico
                                  : `${msg.amigable}\n\nDetalle técnico: ${msg.tecnico}`;
                              })()}
                              className="text-red-600 cursor-help"
                              aria-label="Motivo SUNAT"
                            >
                              <FiInfo size={13} />
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border font-medium ${empresaBadgeColor(c.empresa)}`}
                    >
                      {empresaLabel(c.empresa)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {c.emitido_por ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                        <FiUser size={12} className="text-gray-400 flex-shrink-0" />
                        {c.emitido_por}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {(() => {
                      const f = fechaHoraLima(c.created_at);
                      return (
                        <div className="text-xs text-gray-700 tabular-nums">
                          {f.fecha}
                          <span className="block text-[10px] text-gray-400">{f.hora}</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    {celdaAcciones(c)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: total $$ del filtro visible (lo más útil para contabilidad)
          + paginación si aplica. El total siempre aparece, aunque haya 1 sola
          página, para que la asesora confirme cuánto suma lo que ve. */}
      <div className="flex items-center justify-between gap-2 mt-4 text-sm flex-wrap">
        <span className="text-gray-500">
          <strong className="text-gray-700">{comprobantesFiltrados.length}</strong>{" "}
          comprobante{comprobantesFiltrados.length === 1 ? "" : "s"}
          {totalPaginas > 1 && ` · página ${paginaActual} de ${totalPaginas}`}
          {comprobantesFiltrados.length > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-md font-mono text-xs">
              <FiDollarSign className="h-3 w-3 text-gray-400" />
              <strong className="text-gray-800">S/ {totalMontoFiltrado.toFixed(2)}</strong>
              <span className="text-gray-500">en pantalla</span>
            </span>
          )}
        </span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={paginaActual <= 1}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ‹ Anterior
            </button>
            <button
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaActual >= totalPaginas}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente ›
            </button>
          </div>
        )}
      </div>

      {/* Menú "⋯" de acciones (posición FIJA, escapa del overflow-x de la tabla) */}
      {menuAcciones && (
        <div
          className="fixed z-50 w-60 bg-white rounded-xl shadow-xl border border-gray-200 py-1.5 flex flex-col text-left divide-y divide-gray-100 max-h-[80vh] overflow-y-auto menu-acciones-dropdown animate-fade-in"
          style={(() => {
            const r = menuAcciones.triggerEl.getBoundingClientRect();
            const showAbove = r.bottom > window.innerHeight * 0.6;
            const left = Math.max(8, r.right - 240);
            if (showAbove) {
              return {
                bottom: `${window.innerHeight - r.top + 6}px`,
                left: `${left}px`,
              };
            } else {
              return {
                top: `${r.bottom + 6}px`,
                left: `${left}px`,
              };
            }
          })()}
        >
            {(() => {
              const c = menuAcciones.c;
              const esGuia = c.tipo === "09";
              const tieneCdr = c.estado === "aceptado" || c.estado === "observado";
              const itemCls =
                "w-full px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-gray-50 text-left text-gray-700 transition-colors";
              
              const MenuHeader = ({ children }: { children: React.ReactNode }) => (
                <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50 select-none">
                  {children}
                </div>
              );

              return (
                <>
                  {/* SECCIÓN 1: DOCUMENTOS SUNAT */}
                  <div className="py-1">
                    <MenuHeader>Documentos SUNAT</MenuHeader>
                    <button onClick={() => { setMenuAcciones(null); descargarXML(c); }} className={itemCls}>
                      <FiCode className="h-4 w-4 text-blue-600 flex-shrink-0" /> Descargar XML
                    </button>
                    {tieneCdr && (
                      <button onClick={() => { setMenuAcciones(null); descargarCDR(c); }} className={itemCls}>
                        <FiCheckCircle className="h-4 w-4 text-teal-600 flex-shrink-0" /> Descargar CDR
                      </button>
                    )}
                    {esGuia && (
                      <a
                        href={`/pedidos/${c.pedido_id ?? c.id}/gre?print=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMenuAcciones(null)}
                        className={itemCls}
                      >
                        <FiPrinter className="h-4 w-4 text-slate-600 flex-shrink-0" /> Imprimir guía
                      </a>
                    )}
                  </div>

                  {/* SECCIÓN 2: COMUNICACIÓN */}
                  {!esGuia && (
                    <div className="py-1">
                      <MenuHeader>Comunicación</MenuHeader>
                      <button onClick={() => { setMenuAcciones(null); setModalEnviar({ id: c.id, defaultEmail: "" }); }} className={itemCls}>
                        <FiMail className="h-4 w-4 text-emerald-600 flex-shrink-0" /> Enviar por correo
                      </button>
                    </div>
                  )}

                  {/* SECCIÓN 3: EMISIONES RELACIONADAS */}
                  {(!esGuia || puedeNotaCredito(c) || puedeAnular(c) || (esGuia && c.estado !== "anulado")) && (
                    <div className="py-1">
                      <MenuHeader>Emisiones Relacionadas</MenuHeader>
                      {!esGuia && (
                        <button
                          onClick={async () => {
                            setMenuAcciones(null);
                            if (c.pedido_id) {
                              setCargandoPedidoId(c.pedido_id);
                              try {
                                const res = await fetch(`/api/pedidos/${c.pedido_id}`);
                                if (!res.ok) throw new Error("Error al obtener el pedido");
                                const data = await res.json();
                                if (data?.pedido) {
                                  // Pasar TAMBIÉN la factura: el pedido puede no tener RUC/razón
                                  // social registrados (caso GRUPO CULINARIA) y el modal debe
                                  // prellenar el destinatario con los datos fiscales de la factura.
                                  setModalEmitirGuiaCpe({ pedido: data.pedido, comprobante: c });
                                } else {
                                  setToast({ tipo: "error", msg: "No se pudo cargar el pedido asociado." });
                                }
                              } catch (err) {
                                setToast({ tipo: "error", msg: err instanceof Error ? err.message : "Error al cargar el pedido." });
                              } finally {
                                setCargandoPedidoId(null);
                              }
                            } else {
                              setCargandoComprobanteId(c.id);
                              try {
                                const res = await fetch(`/api/comprobantes/${c.id}`);
                                if (!res.ok) throw new Error("Error al obtener el comprobante");
                                const data = await res.json();
                                if (data) {
                                  setModalEmitirGuiaCpe({ comprobante: data });
                                } else {
                                  setToast({ tipo: "error", msg: "No se pudo cargar el comprobante asociado." });
                                }
                              } catch (err) {
                                setToast({ tipo: "error", msg: err instanceof Error ? err.message : "Error al cargar el comprobante." });
                              } finally {
                                setCargandoComprobanteId(null);
                              }
                            }
                          }}
                          disabled={!!(c.pedido_id && cargandoPedidoId === c.pedido_id) || cargandoComprobanteId === c.id}
                          className={itemCls}
                        >
                          <FiTruck className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                          {(c.pedido_id && cargandoPedidoId === c.pedido_id) || cargandoComprobanteId === c.id
                            ? "Cargando..."
                            : "Emitir guía de remisión"}
                        </button>
                      )}
                      {!esGuia && puedeNotaCredito(c) && (
                        <button
                          onClick={() => { setMenuAcciones(null); setModalNC({ id: c.id, serie_numero: c.serie_numero }); }}
                          className="w-full px-3 py-2 text-sm flex items-start gap-2.5 hover:bg-orange-50 text-left text-gray-700 transition-colors"
                        >
                          <FiFileMinus className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium text-orange-700">Emitir nota de crédito</span>
                            <span className="block text-[11px] text-gray-500 leading-tight">Devolución, descuento o corrección</span>
                          </span>
                        </button>
                      )}
                      {!esGuia && puedeAnular(c) && (
                        <button
                          onClick={() => { setMenuAcciones(null); setModalBaja({ id: c.id, serie_numero: c.serie_numero, empresa: c.empresa }); }}
                          className="w-full px-3 py-2 text-sm flex items-start gap-2.5 hover:bg-red-50 text-left text-gray-700 transition-colors"
                        >
                          <FiSlash className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium text-red-700">Anular (baja SUNAT)</span>
                            <span className="block text-[11px] text-gray-500 leading-tight">Solo dentro de 7 días</span>
                          </span>
                        </button>
                      )}
                      {esGuia && c.estado !== "anulado" && (
                        <button
                          onClick={() => {
                            setMenuAcciones(null);
                            setModalBajaGuia({ id: c.id, serie_numero: c.serie_numero, empresa: c.empresa });
                          }}
                          className="w-full px-3 py-2 text-sm flex items-start gap-2.5 hover:bg-red-50 text-left text-gray-700 transition-colors"
                        >
                          <FiSlash className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium text-red-700">Dar de Baja</span>
                            <span className="block text-[11px] text-gray-500 leading-tight">Anular guía en portal SUNAT</span>
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* SECCIÓN 4: GESTIÓN */}
                  <div className="py-1">
                    <MenuHeader>Gestión</MenuHeader>
                    {!esGuia && (
                      <button
                        onClick={() => { setMenuAcciones(null); setModalVincular({ id: c.id, serie_numero: c.serie_numero, pedidoId: c.pedido_id, pedidoCliente: c.pedido_cliente }); }}
                        className={itemCls}
                      >
                        <FiLink className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                        {c.pedido_id ? "Cambiar pedido vinculado" : "Vincular a pedido"}
                      </button>
                    )}
                    {esGuia && (
                      <button
                        onClick={() => {
                          setMenuAcciones(null);
                          setModalVincularComprobante({
                            id: c.id,
                            serie_numero: c.serie_numero,
                            comprobanteId: c.referencia_comprobante_id,
                            referenciaSerieNumero: c.referencia_serie_numero,
                            referenciaTipo: c.referencia_tipo,
                            referenciaClienteRazonSocial: c.referencia_cliente_razon_social,
                            referenciaMontoTotal: c.referencia_monto_total,
                          });
                        }}
                        className={itemCls}
                      >
                        <FiLink className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                        {c.referencia_comprobante_id ? "Cambiar factura/boleta vinculada" : "Vincular a factura/boleta"}
                      </button>
                    )}
                    {!esGuia && userRole === "admin" && (
                      <button
                        onClick={() => { setMenuAcciones(null); setModalAsesora({ id: c.id, serie_numero: c.serie_numero, emitidoPor: c.emitido_por }); }}
                        className={itemCls}
                      >
                        <FiUser className="h-4 w-4 text-indigo-600 flex-shrink-0" /> Cambiar asesora
                      </button>
                    )}
                    {puedeReintentar(c) && (
                      <button onClick={() => { setMenuAcciones(null); reintentarEnvio(c); }} className={`${itemCls} text-indigo-700 font-medium`}>
                        <FiSend className="h-4 w-4 flex-shrink-0" />
                        {esGuia ? "Reintentar emisión (mismo número)" : "Reintentar envío"}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
        </div>
      )}

      {/* Modal de envío email */}
      {modalEnviar && (
        <ModalEnviarEmail
          comprobanteId={modalEnviar.id}
          defaultEmail={modalEnviar.defaultEmail}
          onClose={() => setModalEnviar(null)}
          onEnviado={() =>
            setToast({ tipo: "ok", msg: "Correo enviado correctamente" })
          }
        />
      )}

      {modalNC && (
        <ModalNotaCredito
          comprobante={modalNC}
          onClose={() => setModalNC(null)}
          onEmitida={(msg) => {
            setToast({ tipo: "ok", msg });
            fetchData();
          }}
        />
      )}

      {modalAsesora && (
        <ModalAsignarAsesora
          comprobante={modalAsesora}
          asesoras={asesoras}
          onClose={() => setModalAsesora(null)}
          onGuardado={(emitidoPor, msg) => {
            const cid = modalAsesora.id;
            setComprobantes((prev) =>
              prev.map((c) => (c.id === cid ? { ...c, emitido_por: emitidoPor } : c))
            );
            setToast({ tipo: "ok", msg });
          }}
        />
      )}

      {modalVincular && (
        <ModalVincularPedido
          comprobante={modalVincular}
          onClose={() => setModalVincular(null)}
          onGuardado={(pedidoId, pedidoCliente, msg) => {
            const cid = modalVincular.id;
            setComprobantes((prev) =>
              prev.map((c) =>
                c.id === cid ? { ...c, pedido_id: pedidoId, pedido_cliente: pedidoCliente } : c
              )
            );
            setToast({ tipo: "ok", msg });
          }}
        />
      )}

      {modalVincularComprobante && (
        <ModalVincularComprobante
          guia={{
            id: modalVincularComprobante.id,
            serie_numero: modalVincularComprobante.serie_numero,
            empresa: comprobantes.find(x => x.id === modalVincularComprobante.id)?.empresa || "transavic",
            referencia_comprobante_id: modalVincularComprobante.comprobanteId,
            referencia_serie_numero: modalVincularComprobante.referenciaSerieNumero,
            referencia_tipo: modalVincularComprobante.referenciaTipo,
            referencia_cliente_razon_social: modalVincularComprobante.referenciaClienteRazonSocial,
            referencia_monto_total: modalVincularComprobante.referenciaMontoTotal,
          }}
          onClose={() => setModalVincularComprobante(null)}
          onGuardado={(comprobanteId, serieNumero, tipo, clienteRazonSocial, montoTotal, msg) => {
            const gid = modalVincularComprobante.id;
            setComprobantes((prev) =>
              prev.map((c) =>
                c.id === gid
                  ? {
                      ...c,
                      referencia_comprobante_id: comprobanteId,
                      referencia_serie_numero: serieNumero,
                      referencia_tipo: tipo,
                      referencia_cliente_razon_social: clienteRazonSocial,
                      referencia_monto_total: montoTotal,
                    }
                  : c
              )
            );
            setToast({ tipo: "ok", msg });
            fetchData();
          }}
        />
      )}

      {showEmitirGuiaDirecta && (
        <EmitirGuiaDirectaModal
          onClose={() => setShowEmitirGuiaDirecta(false)}
          onExito={(serieNumero) => {
            setShowEmitirGuiaDirecta(false);
            setToast({ tipo: "ok", msg: `Guía ${serieNumero} emitida con éxito.` });
            fetchData();
          }}
        />
      )}

      {modalBaja && (
        <ModalComunicacionBaja
          comprobante={modalBaja}
          onClose={() => setModalBaja(null)}
          onResuelto={(msg) => {
            setToast({ tipo: "ok", msg });
            fetchData();
          }}
        />
      )}

      {modalBajaGuia && (
        <ModalBajaGuia
          comprobante={modalBajaGuia}
          onClose={() => setModalBajaGuia(null)}
          onResuelto={(msg) => {
            setToast({ tipo: "ok", msg });
            fetchData();
          }}
        />
      )}

      {modalResumen && (
        <ModalResumenDiario
          onClose={() => setModalResumen(false)}
          onResuelto={(msg) => setToast({ tipo: "ok", msg })}
        />
      )}

      {/* Modal de exportación a Excel con período */}
      {modalExcel && (
        <ModalExportarExcel
          filtroTipo={filtroTipo}
          filtroEmpresa={filtroEmpresa}
          onClose={() => setModalExcel(false)}
        />
      )}

      {/* Modal de Emisión de Guía de Remisión */}
      {modalEmitirGuiaCpe && (
        <ModalShell onClose={() => setModalEmitirGuiaCpe(null)}>
          <EmitirGuiaModal
            pedido={modalEmitirGuiaCpe.pedido}
            comprobante={modalEmitirGuiaCpe.comprobante}
            onClose={() => setModalEmitirGuiaCpe(null)}
            onExito={(serieNumero) => {
              setToast({ tipo: "ok", msg: `Guía ${serieNumero} emitida exitosamente` });
              fetchData();
            }}
          />
        </ModalShell>
      )}


      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.tipo === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Aviso amigable (sin jerga técnica) */}
      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <strong>ℹ️ Cómo funciona:</strong> al emitir, el comprobante se transmite
        a <strong>SUNAT</strong> automáticamente para su validación (esto{" "}
        <strong>no</strong> es un correo al cliente). Para enviárselo al cliente
        por correo —adjuntando el <strong>PDF y el XML</strong>— abre el menú{" "}
        <strong>⋯</strong> del comprobante y elige{" "}
        <strong>“Enviar por correo”</strong>: solo se envía cuando tú lo indicas.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// KpiCard — métrica destacada en cabecera. Opcional onClick para que la
// asesora con un clic filtre por "Con problemas" sin tener que armar el filtro.
// ──────────────────────────────────────────────────────────
function KpiCard({
  color,
  icon,
  label,
  value,
  hint,
  highlight,
  onClick,
}: {
  color: "gray" | "green" | "red" | "blue";
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const palette: Record<typeof color, { bg: string; iconBg: string; text: string }> = {
    gray: { bg: "bg-white border-gray-200", iconBg: "bg-gray-100 text-gray-600", text: "text-gray-800" },
    green: { bg: "bg-white border-gray-200", iconBg: "bg-green-100 text-green-600", text: "text-gray-800" },
    red: { bg: highlight ? "bg-red-50 border-red-300" : "bg-white border-gray-200", iconBg: "bg-red-100 text-red-600", text: highlight ? "text-red-700" : "text-gray-800" },
    blue: { bg: "bg-white border-gray-200", iconBg: "bg-blue-100 text-blue-600", text: "text-gray-800" },
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`text-left border rounded-xl px-3 py-2.5 shadow-sm ${palette[color].bg} ${
        onClick ? "hover:shadow-md transition-shadow cursor-pointer" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${palette[color].iconBg}`}>
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${palette[color].text}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{hint}</div>}
    </Tag>
  );
}

// ──────────────────────────────────────────────────────────
// GrupoFiltro — una fila de filtros con su label corta a la izquierda.
// Cada opción puede llevar un "swatch" (puntito de color) para que el ojo
// asocie color con estado/empresa sin leer.
// ──────────────────────────────────────────────────────────
function GrupoFiltro({
  titulo,
  activo,
  onChange,
  opciones,
}: {
  titulo: string;
  activo: string;
  onChange: (v: string) => void;
  opciones: Array<{ v: string; l: string; swatch?: string }>;
}) {
  return (
    <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 w-full sm:w-20 flex-shrink-0 sm:pt-2">
        {titulo}
      </span>
      <div className="flex gap-2 flex-wrap">
        {opciones.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              activo === o.v
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {o.swatch && <span className={`w-2 h-2 rounded-full ${o.swatch}`} />}
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FiCheckCircle,
  FiXCircle,
  FiClock,
  FiAlertTriangle,
  FiUser,
  FiFileText,
  FiChevronDown,
} from "react-icons/fi";

interface ItemAutorizacion {
  nombre: string;
  precio_solicitado: number;
  precio_minimo: number;
  cantidad: number;
}

interface Autorizacion {
  id: string;
  asesora_id: string;
  asesora_nombre: string;
  tipo: "01" | "03";
  empresa: string;
  items_json: ItemAutorizacion[];
  razon: string | null;
  estado: "pendiente" | "aprobada" | "rechazada";
  razon_rechazo: string | null;
  aprobada_por: string | null;
  created_at: string;
  resuelta_at: string | null;
  usada_at: string | null;
  cliente_json: { numDocumento?: string; razonSocial?: string } | null;
}

type Filtro = "pendiente" | "aprobada" | "rechazada";

const tipoLabel: Record<string, string> = { "01": "Factura", "03": "Boleta" };
const empresaLabel: Record<string, string> = {
  transavic: "Transavic",
  avicola: "Avícola de Tony",
};

function formatFecha(iso: string) {
  return new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diferencia(solicitado: number, minimo: number) {
  return minimo - solicitado;
}

interface ModalRechazoProps {
  id: string;
  asesoraNombre: string;
  onConfirm: (id: string, motivo: string) => void;
  onCancel: () => void;
  cargando: boolean;
}

function ModalRechazo({ id, asesoraNombre, onConfirm, onCancel, cargando }: ModalRechazoProps) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4 anim-modal">
        <h3 className="font-semibold text-gray-900 mb-1">Rechazar solicitud</h3>
        <p className="text-sm text-gray-500 mb-4">
          Motivo del rechazo para {asesoraNombre}
        </p>
        <textarea
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
          rows={3}
          placeholder="Explica brevemente el motivo..."
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            disabled={!motivo.trim() || cargando}
            onClick={() => onConfirm(id, motivo.trim())}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors active:scale-[0.97]"
          >
            {cargando ? "Rechazando..." : "Rechazar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardAutorizacion({
  auth: a,
  onAprobar,
  onRechazar,
  cargandoId,
  esAdmin,
}: {
  auth: Autorizacion;
  onAprobar: (id: string) => void;
  onRechazar: (id: string, asesoraNombre: string) => void;
  cargandoId: string | null;
  esAdmin: boolean;
}) {
  const [expandido, setExpandido] = useState(true);
  const esPendiente = a.estado === "pendiente";
  const cargando = cargandoId === a.id;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FiUser className="w-4 h-4 text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{a.asesora_nombre}</span>
            <span className="text-xs text-gray-400">{formatFecha(a.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md">
              <FiFileText className="w-3 h-3" />
              {tipoLabel[a.tipo] ?? a.tipo}
            </span>
            <span className="text-xs text-gray-500">{empresaLabel[a.empresa] ?? a.empresa}</span>
          </div>
          {a.cliente_json && (a.cliente_json.razonSocial || a.cliente_json.numDocumento) && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {a.cliente_json.razonSocial && (
                <span className="text-xs text-gray-600 font-medium truncate">
                  {a.cliente_json.razonSocial}
                </span>
              )}
              {a.cliente_json.numDocumento && (
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {a.cliente_json.razonSocial ? "· " : ""}{a.cliente_json.numDocumento}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Badge de estado */}
          {a.estado === "pendiente" && (
            <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              <FiClock className="w-3 h-3" /> Pendiente
            </span>
          )}
          {a.estado === "aprobada" && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
              <FiCheckCircle className="w-3 h-3" /> Aprobada
            </span>
          )}
          {a.estado === "rechazada" && (
            <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
              <FiXCircle className="w-3 h-3" /> Rechazada
            </span>
          )}
          <button
            onClick={() => setExpandido((v) => !v)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <FiChevronDown
              className={`w-4 h-4 transition-transform ${expandido ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Cuerpo expandible */}
      {expandido && (
        <div className="border-t border-gray-50 px-4 py-3 space-y-3">
          {/* Tabla de ítems */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="pb-1 font-medium pr-4">Producto</th>
                  <th className="pb-1 font-medium pr-4 text-right tabular-nums">Cant.</th>
                  <th className="pb-1 font-medium pr-4 text-right tabular-nums">Precio solicitado</th>
                  <th className="pb-1 font-medium pr-4 text-right tabular-nums">Precio mínimo</th>
                  <th className="pb-1 font-medium text-right tabular-nums text-red-600">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {a.items_json.map((it, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="py-1.5 pr-4 text-gray-800 font-medium">{it.nombre}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">{it.cantidad}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-gray-700">
                      S/ {Number(it.precio_solicitado).toFixed(2)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-gray-500">
                      S/ {Number(it.precio_minimo).toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-semibold text-red-600">
                      -S/ {diferencia(Number(it.precio_solicitado), Number(it.precio_minimo)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Razón de la asesora */}
          {a.razon && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
              <span className="text-xs font-medium text-gray-400 block mb-0.5">Motivo indicado</span>
              {a.razon}
            </div>
          )}

          {/* Resultado (no pendientes) */}
          {a.estado !== "pendiente" && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                a.estado === "aprobada"
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              <span className="text-xs font-medium block mb-0.5">
                {a.estado === "aprobada" ? "Aprobada" : "Rechazada"} por {a.aprobada_por ?? "Admin"}
                {a.resuelta_at ? ` · ${formatFecha(a.resuelta_at)}` : ""}
                {a.usada_at ? ` · Usada ${formatFecha(a.usada_at)}` : ""}
              </span>
              {a.razon_rechazo && <span>{a.razon_rechazo}</span>}
            </div>
          )}

          {/* Botones de gestión (solo admin, solo pendientes) */}
          {esPendiente && esAdmin && (
            <div className="flex gap-2 pt-1">
              <button
                disabled={cargando}
                onClick={() => onAprobar(a.id)}
                className="flex-1 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors active:scale-[0.97]"
              >
                {cargando ? "Procesando..." : "Aprobar"}
              </button>
              <button
                disabled={cargando}
                onClick={() => onRechazar(a.id, a.asesora_nombre)}
                className="flex-1 py-2 text-sm font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-40 transition-colors active:scale-[0.97]"
              >
                Rechazar
              </button>
            </div>
          )}
          {esPendiente && !esAdmin && (
            <p className="text-xs text-gray-400 pt-1">
              Esperando la respuesta del administrador. Te llegará una notificación.
            </p>
          )}

          {/* Asesora: usar una aprobada disponible (pre-llena el form de emisión) */}
          {!esAdmin && a.estado === "aprobada" && !a.usada_at && (
            <Link
              href={`/dashboard/comprobantes/nuevo?autorizacion_id=${a.id}`}
              className="block w-full py-2.5 text-center text-sm font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors active:scale-[0.97]"
            >
              Emitir con esta autorización
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function AutorizacionesClient({ esAdmin = true }: { esAdmin?: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [autorizaciones, setAutorizaciones] = useState<Autorizacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoId, setCargandoId] = useState<string | null>(null);
  const [modalRechazo, setModalRechazo] = useState<{
    id: string;
    nombre: string;
  } | null>(null);
  const [toast, setToast] = useState<{ msg: string; tipo: "ok" | "error" } | null>(null);

  const mostrarToast = (msg: string, tipo: "ok" | "error" = "ok") => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3500);
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/autorizaciones-precio?estado=${filtro}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setAutorizaciones(Array.isArray(data) ? data : []);
    } catch {
      mostrarToast("Error al cargar autorizaciones", "error");
    } finally {
      setCargando(false);
    }
  }, [filtro]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const handleAprobar = async (id: string) => {
    setCargandoId(id);
    try {
      const res = await fetch(`/api/autorizaciones-precio/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "aprobada" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        mostrarToast(data.error || "Error al aprobar", "error");
        return;
      }
      mostrarToast("Autorización aprobada. La asesora recibió una notificación.");
      cargar();
    } finally {
      setCargandoId(null);
    }
  };

  const handleRechazar = async (id: string, motivo: string) => {
    setCargandoId(id);
    try {
      const res = await fetch(`/api/autorizaciones-precio/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "rechazada", razon_rechazo: motivo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        mostrarToast(data.error || "Error al rechazar", "error");
        return;
      }
      mostrarToast("Solicitud rechazada. La asesora fue notificada.");
      setModalRechazo(null);
      cargar();
    } finally {
      setCargandoId(null);
    }
  };

  const pendientes = autorizaciones.filter((a) => a.estado === "pendiente").length;

  const filtros: { key: Filtro; label: string }[] = [
    { key: "pendiente", label: "Pendientes" },
    { key: "aprobada", label: "Aprobadas" },
    { key: "rechazada", label: "Rechazadas" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Autorizaciones de precio</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Solicitudes de las asesoras para emitir comprobantes por debajo del precio mínimo del catálogo
        </p>
      </div>

      {/* Chips de filtro */}
      <div className="flex gap-2 flex-wrap">
        {filtros.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              filtro === f.key
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f.label}
            {f.key === "pendiente" && pendientes > 0 && filtro !== "pendiente" && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {pendientes}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={cargar}
          className="ml-auto text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Actualizar
        </button>
      </div>

      {/* Contenido */}
      {cargando ? (
        <div className="text-center py-12 text-sm text-gray-400">Cargando...</div>
      ) : autorizaciones.length === 0 ? (
        <div className="text-center py-12">
          <FiAlertTriangle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">
            {filtro === "pendiente"
              ? "No hay solicitudes pendientes"
              : filtro === "aprobada"
              ? "No hay autorizaciones aprobadas"
              : "No hay solicitudes rechazadas"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {autorizaciones.map((a) => (
            <CardAutorizacion
              key={a.id}
              auth={a}
              onAprobar={handleAprobar}
              onRechazar={(id, nombre) => setModalRechazo({ id, nombre })}
              cargandoId={cargandoId}
              esAdmin={esAdmin}
            />
          ))}
        </div>
      )}

      {/* Modal de rechazo */}
      {modalRechazo && (
        <ModalRechazo
          id={modalRechazo.id}
          asesoraNombre={modalRechazo.nombre}
          onConfirm={(id, motivo) => handleRechazar(id, motivo)}
          onCancel={() => setModalRechazo(null)}
          cargando={cargandoId === modalRechazo.id}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium anim-toast ${
            toast.tipo === "ok"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

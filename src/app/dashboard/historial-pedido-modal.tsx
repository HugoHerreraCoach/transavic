// src/app/dashboard/historial-pedido-modal.tsx
// Modal (solo admin) con el historial de correcciones de un pedido.
// Lee /api/pedidos/[id]/ediciones y muestra una línea de tiempo: quién corrigió,
// cuándo, y qué campo cambió (antes → después).
'use client';

import { useEffect, useState } from 'react';
import { FiX, FiClock, FiArrowRight } from 'react-icons/fi';

interface CambioCampo {
  campo: string;
  etiqueta: string;
  antes: string;
  despues: string;
}
interface Edicion {
  id: string;
  usuario_nombre: string;
  usuario_rol: string | null;
  cambios: CambioCampo[];
  created_at: string;
}

interface Props {
  pedidoId: string;
  pedidoCliente: string;
  isOpen: boolean;
  onClose: () => void;
}

const ROL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  asesor: 'Asesora',
  repartidor: 'Repartidor',
  produccion: 'Producción',
};

function formatFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function HistorialPedidoModal({ pedidoId, pedidoCliente, isOpen, onClose }: Props) {
  const [ediciones, setEdiciones] = useState<Edicion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    setCargando(true);
    setError(null);
    setEdiciones(null);
    (async () => {
      try {
        const res = await fetch(`/api/pedidos/${pedidoId}/ediciones`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'No se pudo cargar el historial');
        }
        const j = await res.json();
        if (!cancel) setEdiciones((j.ediciones ?? []) as Edicion[]);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Error desconocido');
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [isOpen, pedidoId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 anim-fade"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto anim-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky con X siempre visible */}
        <div className="p-5 border-b flex justify-between items-start sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-gray-800">
              <FiClock className="text-gray-400 flex-shrink-0" />
              <h2 className="text-lg font-bold">Historial de cambios</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{pedidoCliente}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-1 flex-shrink-0"
            aria-label="Cerrar"
          >
            <FiX size={22} />
          </button>
        </div>

        <div className="p-5">
          {cargando && <p className="text-sm text-gray-500">Cargando historial…</p>}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
              {error}
            </p>
          )}

          {ediciones && ediciones.length === 0 && !error && (
            <div className="text-center py-8">
              <FiClock className="mx-auto text-gray-300 mb-2" size={28} />
              <p className="text-sm text-gray-500">
                Este pedido no tiene correcciones registradas todavía.
              </p>
            </div>
          )}

          {ediciones && ediciones.length > 0 && (
            <ol className="space-y-4">
              {ediciones.map((ed) => (
                <li key={ed.id} className="border-l-2 border-gray-200 pl-4 relative">
                  <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-red-500" />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-800">
                      {ed.usuario_nombre?.trim() || 'Usuario'}
                    </span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {formatFecha(ed.created_at)}
                    </span>
                  </div>
                  {ed.usuario_rol && (
                    <div className="text-[11px] text-gray-400 mb-1.5">
                      {ROL_LABEL[ed.usuario_rol] ?? ed.usuario_rol}
                    </div>
                  )}
                  <ul className="space-y-1.5">
                    {ed.cambios.map((c, i) => (
                      <li key={i} className="text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
                        <div className="font-medium text-gray-600 mb-0.5">{c.etiqueta}</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="line-through text-gray-400 break-all">
                            {c.antes || '—'}
                          </span>
                          <FiArrowRight className="text-gray-300 flex-shrink-0" size={12} />
                          <span className="text-gray-800 font-medium break-all">
                            {c.despues || '—'}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

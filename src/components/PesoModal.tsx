// src/components/PesoModal.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { Pedido } from '@/lib/types';
import { FiX, FiSave } from 'react-icons/fi';

interface PesoModalProps {
  pedido: Pedido | null;
  isOpen: boolean;
  onClose: () => void;
  onGuardar: (pedidoId: string, nuevoDetalleFinal: string) => Promise<void>;
}

export default function PesoModal({ pedido, isOpen, onClose, onGuardar }: PesoModalProps) {
  const [pesoInfo, setPesoInfo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && pedido) {
      setPesoInfo(pedido.detalle_final || '');
      // Auto-focus al abrir
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, pedido]);

  if (!isOpen || !pedido) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await onGuardar(pedido.id, pesoInfo);
      onClose();
    } catch (error) {
      console.error(error);
      alert("Error al guardar el peso");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-800">⚖️ Ingresar Peso</h2>
            <p className="text-xs text-gray-500 truncate max-w-[250px]">{pedido.cliente}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full shadow-sm">
            <FiX size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Detalle Final / Peso Exacto
          </label>
          <input
            ref={inputRef}
            type="text"
            className="w-full border-2 border-indigo-100 rounded-xl p-3 text-gray-900 font-semibold focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
            placeholder="Ej: 14.50 kg"
            value={pesoInfo}
            onChange={(e) => setPesoInfo(e.target.value)}
          />
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {guardando ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <FiSave /> Guardar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// src/app/dashboard/print-modal.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { FiPrinter, FiX, FiCalendar, FiPackage, FiLoader } from 'react-icons/fi';
import { Pedido } from '@/lib/types';
import { getLocalDateString } from '@/lib/utils';

interface Asesora {
  id: string;
  name: string;
}

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPrint: (pedidos: Pedido[], formato: 'A4' | 'Ticket') => void;
  userRole: string;
  asesoras?: Asesora[];
}

type DatePreset = 'hoy' | 'ayer' | 'manana' | 'rango';

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function PrintModal({ isOpen, onClose, onPrint, userRole, asesoras = [] }: PrintModalProps) {
  const [preset, setPreset] = useState<DatePreset>('hoy');
  const [fechaInicio, setFechaInicio] = useState(getLocalDateString(0));
  const [fechaFin, setFechaFin] = useState(getLocalDateString(0));
  const [empresa, setEmpresa] = useState('');
  const [asesorId, setAsesorId] = useState('');
  const [formato, setFormato] = useState<'A4' | 'Ticket'>('A4');
  const [count, setCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Actualizar fechas según preset
  useEffect(() => {
    switch (preset) {
      case 'hoy':
        setFechaInicio(getLocalDateString(0));
        setFechaFin(getLocalDateString(0));
        break;
      case 'ayer':
        setFechaInicio(getLocalDateString(-1));
        setFechaFin(getLocalDateString(-1));
        break;
      case 'manana':
        setFechaInicio(getLocalDateString(1));
        setFechaFin(getLocalDateString(1));
        break;
      // 'rango' — el usuario elige manualmente
    }
  }, [preset]);

  // Obtener conteo cuando cambian los filtros
  const fetchCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const params = new URLSearchParams({
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        count_only: 'true',
      });
      if (empresa) params.set('empresa', empresa);
      if (asesorId) params.set('asesor_id', asesorId);

      const res = await fetch(`/api/pedidos/print?${params}`);
      if (res.ok) {
        const json = await res.json();
        setCount(json.count);
      }
    } catch {
      setCount(null);
    } finally {
      setLoadingCount(false);
    }
  }, [fechaInicio, fechaFin, empresa, asesorId]);

  useEffect(() => {
    if (isOpen) fetchCount();
  }, [isOpen, fetchCount]);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const params = new URLSearchParams({
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
      });
      if (empresa) params.set('empresa', empresa);
      if (asesorId) params.set('asesor_id', asesorId);

      const res = await fetch(`/api/pedidos/print?${params}`);
      if (res.ok) {
        const json = await res.json();
        onPrint(json.data, formato);
      } else {
        alert('Error al obtener los pedidos');
      }
    } catch {
      alert('Error de conexión');
    } finally {
      setPrinting(false);
    }
  };

  if (!isOpen) return null;

  const presetButtons: { key: DatePreset; label: string }[] = [
    { key: 'hoy', label: 'Hoy' },
    { key: 'ayer', label: 'Ayer' },
    { key: 'manana', label: 'Mañana' },
    { key: 'rango', label: 'Rango' },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md pointer-events-auto mx-4">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <FiPrinter className="text-gray-600" size={20} />
              Imprimir Pedidos
            </h2>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all">
              <FiX size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            {/* Fecha — Presets */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <FiCalendar size={13} /> Fecha
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {presetButtons.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setPreset(key)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                      preset === key
                        ? 'bg-gray-800 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Fecha info o rango */}
              {preset !== 'rango' ? (
                <p className="text-xs text-gray-400 mt-2">
                  📅 {formatDateDisplay(fechaInicio)}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium">Desde</label>
                    <input
                      type="date"
                      value={fechaInicio}
                      onChange={(e) => setFechaInicio(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium">Hasta</label>
                    <input
                      type="date"
                      value={fechaFin}
                      onChange={(e) => setFechaFin(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Empresa */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <FiPackage size={13} /> Empresa
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { value: '', label: 'Todas' },
                  { value: 'Transavic', label: 'Transavic' },
                  { value: 'Avícola de Tony', label: 'Avícola' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setEmpresa(value)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                      empresa === value
                        ? 'bg-gray-800 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Asesora — solo admin */}
            {userRole === 'admin' && asesoras.length > 0 && (
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">
                  👤 Asesora
                </label>
                <select
                  value={asesorId}
                  onChange={(e) => setAsesorId(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                >
                  <option value="">Todas las asesoras</option>
                  {asesoras.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}

            {/* Formato */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">
                📄 Formato
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { value: 'A4' as const, label: '📄 A4 (2 columnas)', desc: 'Para PC / impresora normal' },
                  { value: 'Ticket' as const, label: '🧾 Ticket', desc: 'Para ticketera 80mm' },
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    onClick={() => setFormato(value)}
                    className={`px-3 py-2.5 rounded-lg text-left transition-all ${
                      formato === value
                        ? 'bg-gray-800 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    <div className={`text-[10px] mt-0.5 ${formato === value ? 'text-gray-300' : 'text-gray-400'}`}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
            {/* Preview count */}
            <div className="text-sm text-gray-500">
              {loadingCount ? (
                <span className="flex items-center gap-1.5"><FiLoader className="animate-spin" size={14} /> Contando...</span>
              ) : count !== null ? (
                <span className="font-semibold">
                  {count === 0 ? (
                    <span className="text-amber-600">No hay pedidos</span>
                  ) : (
                    <span className="text-gray-700">{count} pedido{count !== 1 ? 's' : ''}</span>
                  )}
                </span>
              ) : null}
            </div>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handlePrint}
                disabled={printing || count === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-gray-800 rounded-lg hover:bg-gray-900 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm"
              >
                <FiPrinter size={15} />
                {printing ? 'Preparando...' : 'Imprimir'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// src/components/TimeRangePicker.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { FiClock } from 'react-icons/fi';

interface TimeRangePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Genera opciones de hora cada 15 minutos de 5:00 AM a 11:00 PM */
function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let h = 5; h <= 23; h++) {
    for (let m = 0; m < 60; m += 15) {
      const h24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const h12 = h % 12 || 12;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const label = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
      options.push({ value: h24, label });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

function to12h(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

function parseRangeString(value: string): { desde: string; hasta: string } {
  if (!value || !value.trim()) return { desde: '', hasta: '' };
  const parts = value.split(' - ');
  const parse12hTo24h = (str: string): string => {
    const trimmed = str.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return '';
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  };
  if (parts.length === 2) {
    return { desde: parse12hTo24h(parts[0]), hasta: parse12hTo24h(parts[1]) };
  }
  return { desde: parse12hTo24h(parts[0]), hasta: '' };
}

export default function TimeRangePicker({ value, onChange, disabled = false }: TimeRangePickerProps) {
  const parsed = parseRangeString(value);
  const [desde, setDesde] = useState(parsed.desde);
  const [hasta, setHasta] = useState(parsed.hasta);

  useEffect(() => {
    const newParsed = parseRangeString(value);
    setDesde(newParsed.desde);
    setHasta(newParsed.hasta);
  }, [value]);

  const buildFormattedString = useCallback((d: string, h: string) => {
    const d12 = to12h(d);
    const h12 = to12h(h);
    if (d12 && h12) return `${d12} - ${h12}`;
    if (d12) return d12;
    return '';
  }, []);

  const handleDesdeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDesde = e.target.value;
    setDesde(newDesde);
    onChange(buildFormattedString(newDesde, hasta));
  };

  const handleHastaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newHasta = e.target.value;
    setHasta(newHasta);
    onChange(buildFormattedString(desde, newHasta));
  };

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Horario de Entrega
      </label>
      <div className="flex items-end gap-2 p-3 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50/50">
        {/* Desde */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-center">Desde</span>
          <div className="relative">
            <FiClock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
            <select
              value={desde}
              onChange={handleDesdeChange}
              disabled={disabled}
              className="w-full pl-8 pr-2 py-2.5 border border-gray-300 rounded-xl bg-white text-gray-900 font-medium text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 disabled:bg-gray-200 disabled:cursor-not-allowed transition-all"
            >
              <option value="">-- : --</option>
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Separador */}
        <div className="flex items-center pb-1">
          <span className="text-gray-400 font-bold text-lg">→</span>
        </div>

        {/* Hasta */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-center">Hasta</span>
          <div className="relative">
            <FiClock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
            <select
              value={hasta}
              onChange={handleHastaChange}
              disabled={disabled}
              className="w-full pl-8 pr-2 py-2.5 border border-gray-300 rounded-xl bg-white text-gray-900 font-medium text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 disabled:bg-gray-200 disabled:cursor-not-allowed transition-all"
            >
              <option value="">-- : --</option>
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Preview */}
      {(desde || hasta) && (
        <p className="mt-1.5 text-xs text-gray-500 flex items-center gap-1">
          <FiClock size={11} />
          <span>Se guardará: <strong className="text-gray-700">{buildFormattedString(desde, hasta)}</strong></span>
        </p>
      )}
    </div>
  );
}


'use client';

import { useState } from 'react';
import { FiSettings } from 'react-icons/fi';

type Column = 'distrito' | 'tipo_cliente' | 'hora_entrega' | 'notas' | 'empresa';

interface ColumnCustomizerProps {
  visibleColumns: Record<Column, boolean>;
  onColumnChange: (column: Column, visible: boolean) => void;
}

export default function ColumnCustomizer({ visibleColumns, onColumnChange }: ColumnCustomizerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const columnLabels: Record<Column, string> = {
    distrito: 'Distrito',
    tipo_cliente: 'Tipo de Cliente',
    hora_entrega: 'Hora de Entrega',
    notas: 'Notas',
    empresa: 'Empresa',
  };

  return (
    <div className="relative inline-block text-left print:hidden">
      <div>
        <button
          type="button"
          className="inline-flex justify-center w-full rounded-md border cursor-pointer border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          onClick={() => setIsOpen(!isOpen)}
        >
          <FiSettings className="mr-2 -ml-1 h-5 w-5" aria-hidden="true" />
          Personalizar Columnas
        </button>
      </div>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
            <div className="px-4 py-2 text-sm text-gray-700 font-semibold">Columnas Adicionales</div>
            {Object.keys(visibleColumns).map((col) => (
              <label key={col} className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 text-indigo-600 transition duration-150 ease-in-out"
                  checked={visibleColumns[col as Column]}
                  onChange={(e) => onColumnChange(col as Column, e.target.checked)}
                />
                <span className="ml-3">{columnLabels[col as Column]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

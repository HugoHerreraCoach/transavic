// src/app/dashboard/print-button.tsx
'use client';

import { useState } from 'react';
import { FiPrinter, FiChevronDown } from 'react-icons/fi';

interface PrintButtonProps {
  onSelectFormat: (formato: 'A4' | 'Ticket') => void;
}

export default function PrintButton({ onSelectFormat }: PrintButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handlePrint = (formato: 'A4' | 'Ticket') => {
    setIsOpen(false);
    onSelectFormat(formato);
  };

  return (
    <div className="relative print:hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors cursor-pointer w-full sm:w-auto"
      >
        <FiPrinter />
        Imprimir
        <FiChevronDown />
      </button>

      {isOpen && (
        <>
          {/* Overlay para cerrar */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
            <button
              onClick={() => handlePrint('A4')}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition-colors border-b border-gray-50 flex items-center gap-2"
            >
              <span className="text-lg">📄</span> Formato A4 (PC)
            </button>
            <button
              onClick={() => handlePrint('Ticket')}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition-colors flex items-center gap-2"
            >
              <span className="text-lg">🧾</span> Formato Ticketera
            </button>
          </div>
        </>
      )}
    </div>
  );
}
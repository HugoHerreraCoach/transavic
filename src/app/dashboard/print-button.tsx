// src/app/dashboard/print-button.tsx
'use client'; // Esta directiva lo convierte en un Componente de Cliente

import { FiPrinter } from 'react-icons/fi';

export default function PrintButton() {
  return (
    <button 
      onClick={() => window.print()}
      className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
    >
      <FiPrinter />
      Imprimir
    </button>
  );
}
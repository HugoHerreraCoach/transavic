// src/components/ClienteAutocomplete.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FiSearch, FiStar } from 'react-icons/fi';

export interface ClienteData {
  id?: string;
  nombre: string;
  razon_social?: string | null;
  ruc_dni?: string | null;
  whatsapp?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  tipo_cliente?: string | null;
  hora_entrega?: string | null;
  notas?: string | null;
  empresa?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  direccion_mapa?: string | null;
}

interface ClienteAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onClienteSelected: (cliente: ClienteData) => void;
  disabled?: boolean;
  hasError?: boolean;
}

export default function ClienteAutocomplete({
  value,
  onChange,
  onClienteSelected,
  disabled = false,
  hasError = false,
}: ClienteAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<ClienteData[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Búsqueda con debounce
  const searchClientes = useCallback(async (query: string) => {
    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/clientes?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
        setIsOpen(data.length > 0);
      }
    } catch (err) {
      console.error('Error buscando clientes:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchClientes(val), 300);
  };

  const handleSelect = (cliente: ClienteData) => {
    onChange(cliente.nombre);
    onClienteSelected(cliente);
    setIsOpen(false);
    setSuggestions([]);
  };

  // Cerrar al clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => { if (suggestions.length > 0) setIsOpen(true); }}
          disabled={disabled}
          placeholder="Nombre del Cliente (busca o escribe uno nuevo)"
          className={`w-full pl-9 pr-3 p-3 border rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal disabled:bg-gray-200 ${hasError ? 'border-red-500' : 'border-gray-300'}`}
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin" />
          </div>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
            Clientes frecuentes
          </div>
          {suggestions.map((cliente) => (
            <button
              key={cliente.id}
              type="button"
              onClick={() => handleSelect(cliente)}
              className="w-full px-3 py-2.5 text-left hover:bg-red-50 transition-colors flex items-start gap-2.5 border-b border-gray-50 last:border-0 cursor-pointer"
            >
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center mt-0.5">
                <FiStar size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{cliente.nombre}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                  {cliente.whatsapp && <span>📱 {cliente.whatsapp}</span>}
                  {cliente.distrito && <span>📍 {cliente.distrito}</span>}
                  {cliente.ruc_dni && <span>🆔 {cliente.ruc_dni}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

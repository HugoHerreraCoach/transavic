// src/components/SearchableSelect.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { FiSearch, FiChevronDown, FiX } from "react-icons/fi";

interface Option {
  id: string;
  nombre: string;
  subtext?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  required?: boolean;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccione una opción...",
  searchPlaceholder = "Buscar...",
  className = "",
  required = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Cerrar al hacer clic fuera del componente
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Enfocar buscador cuando se abre
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearch("");
    }
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.id === value);

  const filteredOptions = options.filter(
    (opt) =>
      opt.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (opt.subtext && opt.subtext.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Input invisible para soporte nativo de formularios HTML5 required */}
      <input
        type="text"
        required={required}
        value={value}
        onChange={() => {}}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        tabIndex={-1}
      />

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-300 bg-gray-50 py-2.5 px-3.5 text-left text-xs text-gray-900 shadow-sm transition-colors hover:border-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
      >
        <span className={selectedOption ? "text-gray-900 font-medium" : "text-gray-400"}>
          {selectedOption
            ? `${selectedOption.nombre}${selectedOption.subtext ? ` (${selectedOption.subtext})` : ""}`
            : placeholder}
        </span>
        <FiChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown Card */}
      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200 bg-white shadow-xl max-h-60 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Search Box */}
          <div className="p-2 border-b border-gray-100 flex items-center bg-gray-50/50">
            <FiSearch className="text-gray-400 h-3.5 w-3.5 ml-2" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // Enter NO debe enviar el <form> padre: selecciona la primera opción filtrada.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredOptions.length > 0) {
                    onChange(filteredOptions[0].id);
                    setIsOpen(false);
                    triggerRef.current?.focus();
                  }
                } else if (e.key === "Escape") {
                  // Escape cierra SOLO el dropdown (no el modal padre) y devuelve el foco al trigger.
                  e.preventDefault();
                  e.stopPropagation();
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }
              }}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent border-0 py-1.5 px-2.5 text-xs text-gray-900 focus:outline-none focus:ring-0 placeholder-gray-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="p-1 hover:bg-gray-200 rounded-full transition-colors"
              >
                <FiX className="h-3 w-3 text-gray-400" />
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="overflow-y-auto max-h-48 divide-y divide-gray-50 scrollbar-visible">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChange(opt.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left py-2 px-3.5 text-xs transition-colors flex flex-col justify-center ${
                    value === opt.id
                      ? "bg-indigo-50 text-indigo-950 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="truncate">{opt.nombre}</span>
                  {opt.subtext && (
                    <span className="text-[10px] text-gray-400 font-normal truncate mt-0.5">{opt.subtext}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="py-4 px-3 text-center text-[11px] text-gray-400">
                No se encontraron resultados
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

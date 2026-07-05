// src/app/dashboard/crm-leads/components/TagSelector.tsx
import React, { useState, useRef, useEffect } from "react";
import { FiPlus, FiX, FiTag } from "react-icons/fi";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagSelectorProps {
  leadId: string;
  assignedTags: string[]; // IDs de etiquetas asignadas
  globalTags: Tag[]; // Todas las etiquetas configuradas en settings
  readOnly?: boolean;
  onSaveTags: (newTags: string[]) => Promise<void>;
}

export default function TagSelector({
  leadId,
  assignedTags = [],
  globalTags = [],
  readOnly = false,
  onSaveTags,
}: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Crear un mapa para acceso rápido
  const tagsMap = React.useMemo(() => {
    const map: Record<string, Tag> = {};
    globalTags.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [globalTags]);

  const handleAddTag = async (tagId: string) => {
    const updated = [...assignedTags, tagId];
    await onSaveTags(updated);
    setIsOpen(false);
    setFilter("");
  };

  const handleRemoveTag = async (tagId: string) => {
    if (readOnly) return;
    if (!confirm("¿Quitar esta etiqueta de este cliente?")) return;
    const updated = assignedTags.filter((id) => id !== tagId);
    await onSaveTags(updated);
  };

  const availableTags = globalTags.filter(
    (t) => !assignedTags.includes(t.id) && t.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1.5">
        <FiTag size={12} /> Etiquetas del Cliente
      </label>

      {/* Listado de badges */}
      <div className="flex flex-wrap gap-1.5">
        {assignedTags.map((tagId) => {
          const tag = tagsMap[tagId];
          if (!tag) return null;
          return (
            <span
              key={tagId}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black text-white shadow-xs select-none"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tagId)}
                  className="ml-1 hover:text-black/30 transition-colors cursor-pointer"
                >
                  <FiX size={10} />
                </button>
              )}
            </span>
          );
        })}

        {!readOnly && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent border-dashed hover:border-gray-400 transition-all cursor-pointer"
            >
              <FiPlus size={10} className="mr-0.5" /> Asignar
            </button>

            {/* Popover */}
            {isOpen && (
              <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-1.5 bg-gray-50 border-b border-gray-100">
                  <input
                    type="text"
                    placeholder="Buscar etiqueta..."
                    className="w-full text-[10px] bg-white border border-gray-200 rounded p-1 focus:border-indigo-500 outline-none"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="max-h-36 overflow-y-auto p-1">
                  {availableTags.length === 0 ? (
                    <p className="text-center text-[10px] text-gray-400 py-2.5">
                      {filter ? "Sin resultados" : "No hay más"}
                    </p>
                  ) : (
                    availableTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleAddTag(tag.id)}
                        className="w-full text-left flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 rounded-lg text-[10px] transition-colors group cursor-pointer"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }}></span>
                        <span className="text-gray-700 font-semibold group-hover:text-gray-900">{tag.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

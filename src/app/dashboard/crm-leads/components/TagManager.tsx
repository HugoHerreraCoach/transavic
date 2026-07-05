// src/app/dashboard/crm-leads/components/TagManager.tsx
import React, { useState, useEffect } from "react";
import { FiX, FiPlus, FiEdit2, FiTrash2, FiSave, FiTag } from "react-icons/fi";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_COLORS = [
  "#ef4444", // Rojo
  "#f97316", // Naranja
  "#f59e0b", // Ámbar
  "#10b981", // Esmeralda
  "#06b6d4", // Cian
  "#3b82f6", // Azul
  "#6366f1", // Índigo
  "#8b5cf6", // Violeta
  "#ec4899", // Rosa
  "#64748b", // Pizarra
];

export default function TagManager({ isOpen, onClose }: TagManagerProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const fetchTags = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setTags(data.crm_tags || []);
      }
    } catch (e) {
      console.error("Error al cargar etiquetas:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setConfirmDeleteId(null);
      fetchTags();
    }
  }, [isOpen]);

  const resetForm = () => {
    setName("");
    setColor(PRESET_COLORS[0]);
    setEditingTag(null);
    setIsCreating(false);
    setSaving(false);
  };

  const handleEdit = (tag: Tag) => {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setIsCreating(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("El nombre de la etiqueta es obligatorio.");
      return;
    }

    setSaving(true);
    try {
      let updatedTags = [...tags];

      const newTag: Tag = {
        id: editingTag?.id || Date.now().toString(),
        name: name.trim(),
        color,
      };

      if (editingTag) {
        updatedTags = updatedTags.map((t) => (t.id === editingTag.id ? newTag : t));
      } else {
        if (tags.some((t) => t.name.toLowerCase() === newTag.name.toLowerCase())) {
          alert("Ya existe una etiqueta con este nombre.");
          setSaving(false);
          return;
        }
        updatedTags.push(newTag);
      }

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_tags",
          value: updatedTags,
        }),
      });

      if (!res.ok) throw new Error("Error en servidor");
      setTags(updatedTags);
      resetForm();
    } catch (e) {
      console.error(e);
      alert("Error al guardar la etiqueta.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;

    setDeletingId(id);
    try {
      const updatedTags = tags.filter((t) => t.id !== id);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_tags",
          value: updatedTags,
        }),
      });

      if (!res.ok) throw new Error("Error en servidor");
      setTags(updatedTags);
      setConfirmDeleteId(null);
    } catch (e) {
      console.error(e);
      alert("Error al eliminar.");
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-xl h-[70vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-1.5">
            🏷️ Gestionar Etiquetas del CRM
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <FiX size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* List Section (Left) */}
          <div className="w-1/2 border-r border-gray-100 flex flex-col overflow-y-auto p-4 space-y-2">
            <div className="flex justify-between items-center mb-2 shrink-0">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Etiquetas Disponibles</span>
              {!isCreating && !editingTag && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:underline cursor-pointer"
                >
                  <FiPlus size={10} /> Agregar Nueva
                </button>
              )}
            </div>

            {loading ? (
              <div className="text-center py-10 text-xs text-gray-400">Cargando etiquetas...</div>
            ) : tags.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-400 italic">No hay etiquetas registradas. Crea una.</div>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  onClick={() => handleEdit(tag)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex justify-between items-center gap-2 ${
                    editingTag?.id === tag.id
                      ? "bg-indigo-50/60 border-indigo-200"
                      : "bg-gray-50/50 border-gray-100 hover:bg-gray-50 hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                    <span className="font-semibold text-xs text-gray-700 truncate">{tag.name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {confirmDeleteId === tag.id ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(tag.id);
                          }}
                          disabled={deletingId === tag.id}
                          className="px-2 py-1 text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === tag.id ? "Eliminando..." : "Eliminar"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          disabled={deletingId === tag.id}
                          className="px-2 py-1 text-[10px] font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(tag);
                          }}
                          className="p-1 text-gray-400 hover:text-indigo-600 rounded-md hover:bg-white"
                        >
                          <FiEdit2 size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(tag.id);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded-md hover:bg-white"
                        >
                          <FiTrash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Form Section (Right) */}
          <div className="w-1/2 p-5 bg-gray-50/20 overflow-y-auto flex flex-col justify-between">
            {isCreating || editingTag ? (
              <div className="space-y-4 flex-1">
                <h4 className="font-bold text-xs text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-1.5">
                  {editingTag ? "Editar Etiqueta" : "Crear Etiqueta"}
                </h4>

                {/* Tag Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nombre de Etiqueta</label>
                  <input
                    type="text"
                    required
                    maxLength={25}
                    placeholder="ej. Cliente Mayorista"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>

                {/* Color Preset Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Color</label>
                  <div className="grid grid-cols-5 gap-2">
                    {PRESET_COLORS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setColor(preset)}
                        className={`w-7 h-7 rounded-full border border-black/10 transition-transform relative ${
                          color === preset ? "scale-110 shadow-md ring-2 ring-indigo-500/50" : "hover:scale-105"
                        }`}
                        style={{ backgroundColor: preset }}
                      />
                    ))}
                  </div>
                </div>

                {/* Form Buttons */}
                <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <FiSave size={12} /> {saving ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-gray-400">
                <FiTag size={40} className="mb-2 opacity-25" />
                <p className="text-xs">Selecciona una etiqueta para editarla o presiona &quot;Agregar Nueva&quot; para crearla.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

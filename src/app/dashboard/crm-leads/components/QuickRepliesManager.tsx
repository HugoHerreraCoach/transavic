// src/app/dashboard/crm-leads/components/QuickRepliesManager.tsx
import React, { useState, useEffect } from "react";
import { FiX, FiPlus, FiEdit2, FiTrash2, FiSave, FiImage, FiFileText } from "react-icons/fi";
import imageCompression from "browser-image-compression";

interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "document";
  mediaName?: string;
}

interface QuickRepliesManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickRepliesManager({ isOpen, onClose }: QuickRepliesManagerProps) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form State
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");
  const [mediaFileBase64, setMediaFileBase64] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | "document" | null>(null);

  // Cargar respuestas desde el endpoint central de settings
  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setReplies(data.crm_quick_replies || []);
      }
    } catch (e) {
      console.error("Error al cargar respuestas rápidas:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setConfirmDeleteId(null);
      fetchSettings();
    }
  }, [isOpen]);

  const resetForm = () => {
    setShortcut("");
    setText("");
    setMediaFileBase64(null);
    setMediaName(null);
    setMediaType(null);
    setEditingReply(null);
    setIsCreating(false);
    setSaving(false);
  };

  const handleEdit = (reply: QuickReply) => {
    setEditingReply(reply);
    setShortcut(reply.shortcut);
    setText(reply.text);
    setMediaFileBase64(reply.mediaUrl || null);
    setMediaType(reply.mediaType || null);
    setMediaName(reply.mediaName || null);
    setIsCreating(false);
  };

  // Convertir archivos a Base64 para almacenamiento autónomo en Neon
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let processedFile = file;
    // Si es imagen, comprimir
    if (file.type.startsWith("image/")) {
      try {
        processedFile = await imageCompression(file, {
          maxSizeMB: 0.2, // Mantener peso muy bajo para DB
          maxWidthOrHeight: 800,
          useWebWorker: true,
        });
      } catch (err) {
        console.warn("Fallo de compresión, subiendo original:", err);
      }
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setMediaFileBase64(reader.result as string);
      setMediaName(file.name);
      if (file.type.startsWith("image/")) setMediaType("image");
      else if (file.type.startsWith("video/")) setMediaType("video");
      else setMediaType("document");
    };
    reader.readAsDataURL(processedFile);
  };

  const handleSave = async () => {
    if (!shortcut.trim() || !text.trim()) {
      alert("El atajo y el texto de la respuesta son obligatorios.");
      return;
    }

    setSaving(true);
    try {
      let updatedReplies = [...replies];

      const newReply: QuickReply = {
        id: editingReply?.id || Date.now().toString(),
        shortcut: shortcut.replace(/\s+/g, "").toLowerCase(), // Limpiar atajo
        text,
        mediaUrl: mediaFileBase64 || undefined,
        mediaType: mediaType || undefined,
        mediaName: mediaName || undefined,
      };

      if (editingReply) {
        updatedReplies = updatedReplies.map((r) => (r.id === editingReply.id ? newReply : r));
      } else {
        // Validar atajo único
        if (replies.some((r) => r.shortcut === newReply.shortcut)) {
          alert("Ya existe una respuesta rápida con este atajo.");
          setSaving(false);
          return;
        }
        updatedReplies.push(newReply);
      }

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_quick_replies",
          value: updatedReplies,
        }),
      });

      if (!res.ok) throw new Error("Error en servidor");
      setReplies(updatedReplies);
      resetForm();
    } catch (e) {
      console.error(e);
      alert("Error al guardar la respuesta rápida.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;

    setDeletingId(id);
    try {
      const updatedReplies = replies.filter((r) => r.id !== id);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_quick_replies",
          value: updatedReplies,
        }),
      });

      if (!res.ok) throw new Error("Error en servidor");
      setReplies(updatedReplies);
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
      <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-1.5">
            ⚡ Respuestas Rápidas del CRM
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
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tus Atajos</span>
              {!isCreating && !editingReply && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:underline cursor-pointer"
                >
                  <FiPlus size={10} /> Agregar Nuevo
                </button>
              )}
            </div>

            {loading ? (
              <div className="text-center py-10 text-xs text-gray-400">Cargando atajos...</div>
            ) : replies.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-400 italic">No hay atajos registrados. Crea uno nuevo.</div>
            ) : (
              replies.map((reply) => (
                <div
                  key={reply.id}
                  onClick={() => handleEdit(reply)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex justify-between items-start gap-2 ${
                    editingReply?.id === reply.id
                      ? "bg-indigo-50/60 border-indigo-200"
                      : "bg-gray-50/50 border-gray-100 hover:bg-gray-50 hover:border-gray-200"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-bold text-xs text-indigo-600 block">/{reply.shortcut}</span>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">{reply.text}</p>
                    {reply.mediaType && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] bg-purple-50 border border-purple-100 text-purple-600 px-1.5 py-0.2 rounded mt-1 font-bold">
                        📎 {reply.mediaType}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {confirmDeleteId === reply.id ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(reply.id);
                          }}
                          disabled={deletingId === reply.id}
                          className="px-2 py-1 text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === reply.id ? "Eliminando..." : "Eliminar"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          disabled={deletingId === reply.id}
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
                            handleEdit(reply);
                          }}
                          className="p-1 text-gray-400 hover:text-indigo-600 rounded-md hover:bg-white"
                        >
                          <FiEdit2 size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(reply.id);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded-md hover:bg-white"
                        >
                          <FiTrash2 size={12} />
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
            {isCreating || editingReply ? (
              <div className="space-y-4 flex-1">
                <h4 className="font-bold text-xs text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-1.5">
                  {editingReply ? "Editar Atajo" : "Crear Atajo"}
                </h4>

                {/* Shortcut Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Atajo (Sin espacios)</label>
                  <div className="flex items-center">
                    <span className="text-gray-400 font-mono font-bold text-sm bg-gray-100 border border-r-0 border-gray-200 px-2 py-2 rounded-l-xl">/</span>
                    <input
                      type="text"
                      required
                      placeholder="ej. precio_pollo"
                      value={shortcut}
                      onChange={(e) => setShortcut(e.target.value)}
                      className="w-full border border-gray-200 rounded-r-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                  </div>
                </div>

                {/* Text Message */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Texto del Mensaje</label>
                  <textarea
                    required
                    placeholder="Escribe el mensaje. Puedes usar variables como {{nombre}} o {{asesor}}..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white resize-none"
                  />
                  <div className="flex flex-wrap gap-1 mt-1 text-[9px] text-gray-400">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">{"{{nombre}}"} = Cliente</span>
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">{"{{asesor}}"} = Asesora</span>
                  </div>
                </div>

                {/* Multimedia Attachments */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Archivo Adjunto (Opcional)</label>
                  {mediaFileBase64 ? (
                    <div className="flex items-center gap-2 p-2 bg-purple-50 border border-purple-100 rounded-xl w-full">
                      {mediaType === "image" ? (
                        <img src={mediaFileBase64} alt="Preview" className="w-10 h-10 object-cover rounded-lg border border-purple-200 shrink-0" />
                      ) : (
                        <FiFileText className="w-8 h-8 text-purple-500 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-purple-700 font-bold block truncate">{mediaName}</span>
                        <span className="text-[9px] text-purple-400 block capitalize">{mediaType}</span>
                      </div>
                      <button
                        onClick={() => {
                          setMediaFileBase64(null);
                          setMediaName(null);
                          setMediaType(null);
                        }}
                        className="text-red-500 hover:text-red-700 p-1 text-xs font-bold"
                      >
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-200 hover:border-indigo-400 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer relative">
                      <FiImage className="text-gray-400 text-lg" />
                      <span className="text-[10px] text-gray-500">Seleccionar Imagen/Archivo</span>
                      <input
                        type="file"
                        accept="image/*,video/*,application/pdf"
                        onChange={handleFileChange}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </div>
                  )}
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
                <FiPlus size={40} className="mb-2 opacity-25" />
                <p className="text-xs">Selecciona un atajo para editarlo o presiona &quot;Agregar Nuevo&quot; para crearlo.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

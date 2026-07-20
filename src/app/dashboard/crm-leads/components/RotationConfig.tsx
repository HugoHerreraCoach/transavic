// src/app/dashboard/crm-leads/components/RotationConfig.tsx
"use client";

import React, { useState, useEffect } from "react";
import {
  FiUser,
  FiSave,
  FiRefreshCw,
  FiSliders,
  FiTrendingUp,
  FiLayers,
  FiCheck,
  FiX,
  FiHelpCircle,
  FiMenu,
  FiActivity,
  FiStar,
} from "react-icons/fi";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { User } from "@/lib/types";

interface RotationConfigProps {
  onClose: () => void;
}

interface GoldenTicketConfig {
  sequenceIndex: number;
  sequencePattern: number[];
  dailyResetHour: number;
  lastResetDate: string | null;
}

const DEFAULT_CONFIG: GoldenTicketConfig = {
  sequenceIndex: 0,
  sequencePattern: [1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 3],
  dailyResetHour: 8,
  lastResetDate: null,
};

export default function RotationConfig({ onClose }: RotationConfigProps) {
  const [advisors, setAdvisors] = useState<User[]>([]);
  const [config, setConfig] = useState<GoldenTicketConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tipo: "ok" | "error"; txt: string } | null>(null);

  // Campos del formulario para la secuencia
  const [sequenceInput, setSequenceInput] = useState("");
  const [resetHourInput, setResetHourInput] = useState(8);

  const showToast = (tipo: "ok" | "error", txt: string) => {
    setToast({ tipo, txt });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, settingsRes] = await Promise.all([
        fetch("/api/users?role=asesor"),
        fetch("/api/settings"),
      ]);

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        // Ordenar asesores por orden_rotacion de forma ascendente
        const sortedAdvisors = (usersData || []).sort(
          (a: User, b: User) => (a.orden_rotacion ?? 99) - (b.orden_rotacion ?? 99)
        );
        setAdvisors(sortedAdvisors);
      }

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        const distConfig = settingsData.crm_lead_distribution || DEFAULT_CONFIG;
        setConfig(distConfig);
        setSequenceInput(distConfig.sequencePattern?.join(", ") || "1, 1, 2, 1, 3");
        setResetHourInput(distConfig.dailyResetHour ?? 8);
      }
    } catch (e) {
      console.error("Error al cargar configuración de rotación:", e);
      showToast("error", "No se pudieron cargar los datos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Guardar la configuración de distribución de leads
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);

    try {
      const pattern = sequenceInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);

      if (pattern.length === 0) {
        showToast("error", "La secuencia debe contener al menos un número de Nivel válido (ej: 1, 2).");
        setSavingSettings(false);
        return;
      }

      const updatedConfig: GoldenTicketConfig = {
        ...config,
        sequencePattern: pattern,
        dailyResetHour: resetHourInput,
      };

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_lead_distribution",
          value: updatedConfig,
        }),
      });

      if (!res.ok) throw new Error("Error en POST /api/settings");

      setConfig(updatedConfig);
      showToast("ok", "Configuración de distribución guardada.");
    } catch (error) {
      console.error(error);
      showToast("error", "Error al guardar la configuración.");
    } finally {
      setSavingSettings(false);
    }
  };

  // Restablecer el índice de secuencia a 0
  const handleResetSequenceIndex = async () => {
    setSavingSettings(true);
    try {
      const updatedConfig = { ...config, sequenceIndex: 0 };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_lead_distribution",
          value: updatedConfig,
        }),
      });

      if (!res.ok) throw new Error("Error");

      setConfig(updatedConfig);
      showToast("ok", "Secuencia restablecida a 0.");
    } catch (e) {
      showToast("error", "Error al restablecer la secuencia.");
    } finally {
      setSavingSettings(false);
    }
  };

  // Modificar campo de usuario individual (activo_rotacion, orden_rotacion, leads_recibidos_hoy)
  const handleUpdateUserField = async (userId: string, fields: Partial<User>) => {
    setUpdatingUser(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });

      if (!res.ok) throw new Error("Error");

      const updated = await res.json();
      setAdvisors((prev) =>
        prev
          .map((a) => (a.id === userId ? { ...a, ...updated } : a))
          .sort((a, b) => (a.orden_rotacion ?? 99) - (b.orden_rotacion ?? 99))
      );
      showToast("ok", "Asesora actualizada correctamente.");
    } catch (e) {
      console.error(e);
      showToast("error", "No se pudo actualizar la asesora.");
    } finally {
      setUpdatingUser(null);
    }
  };

  // Manejar el reordenamiento por arrastrar y soltar
  const handleDragEnd = async (result: any) => {
    if (!result.destination) return;

    const sourceIdx = result.source.index;
    const destIdx = result.destination.index;
    if (sourceIdx === destIdx) return;

    const reorderedList = Array.from(advisors);
    const [movedItem] = reorderedList.splice(sourceIdx, 1);
    reorderedList.splice(destIdx, 0, movedItem);

    // Asignar nuevas posiciones secuenciales de orden
    const updatedList = reorderedList.map((item, index) => ({
      ...item,
      orden_rotacion: index + 1,
    }));

    // Actualizar estado local inmediatamente
    setAdvisors(updatedList);
    setSavingSettings(true);

    try {
      // Guardar cambios en la base de datos para los asesores modificados
      const promises = updatedList.map((item) =>
        fetch(`/api/users/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orden_rotacion: item.orden_rotacion }),
        })
      );
      await Promise.all(promises);
      showToast("ok", "Orden de reparto actualizado correctamente.");
    } catch (error) {
      console.error("Error al guardar orden de rotación:", error);
      showToast("error", "Error al guardar el nuevo orden.");
    } finally {
      setSavingSettings(false);
    }
  };

  // Reiniciar todas las cargas diarias a 0
  const handleResetAllLoads = async () => {
    if (!confirm("¿Estás seguro de que deseas reiniciar a 0 los contadores de todas las asesoras?")) return;
    setLoading(true);

    try {
      const promises = advisors.map((a) =>
        fetch(`/api/users/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads_recibidos_hoy: 0 }),
        })
      );
      await Promise.all(promises);
      await loadData();
      showToast("ok", "Se reiniciaron todos los contadores de leads del día.");
    } catch (e) {
      console.error(e);
      showToast("error", "Ocurrió un error al reiniciar contadores.");
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-slate-50">
      {/* Toast de notificaciones */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm animate-in fade-in slide-in-from-top-4 duration-300 ${
            toast.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {toast.tipo === "ok" ? <FiCheck /> : <FiX />}
          <span>{toast.txt}</span>
        </div>
      )}

      {/* Cabecera */}
      <div className="flex justify-between items-center pb-5 border-b border-gray-200/60 shrink-0">
        <div>
          <h1 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <span className="text-indigo-600">🎫</span> Reparto Automático de Leads
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Arrastra y ordena las asesoras para definir el orden de prioridad y distribuye equitativamente los prospectos.
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold shadow-xs cursor-pointer active:scale-95 transition-all"
        >
          Volver al Chat
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-indigo-600">
          <FiRefreshCw className="animate-spin text-3xl mb-3" />
          <span className="text-xs text-gray-500 font-medium">Cargando configuración de rotación...</span>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Listado de Asesoras (Columna Izquierda y Central) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-xs overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-150 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                  <FiUser className="text-indigo-500" /> Asesoras en la Rotación
                </h3>
                <button
                  onClick={handleResetAllLoads}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/50 rounded-xl text-[10px] font-bold transition-all cursor-pointer active:scale-95"
                >
                  Reiniciar Cargas Diarias
                </button>
              </div>

              {advisors.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  No se encontraron asesoras comerciales registradas.
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="advisors-list">
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="divide-y divide-gray-150"
                      >
                        {advisors.map((asesora, index) => {
                          const isActive = asesora.activo_rotacion !== false;
                          const order = index + 1;
                          const countToday = asesora.leads_recibidos_hoy || 0;

                          return (
                            <Draggable key={asesora.id} draggableId={asesora.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`flex flex-col sm:flex-row sm:items-center p-4 gap-4 transition-all ${
                                    snapshot.isDragging
                                      ? "bg-indigo-50/50 shadow-md border-y border-indigo-150"
                                      : !isActive
                                      ? "bg-gray-50/40 opacity-70"
                                      : "hover:bg-slate-50/50"
                                  }`}
                                >
                                  {/* Drag Handle */}
                                  <div
                                    {...provided.dragHandleProps}
                                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors cursor-grab active:cursor-grabbing self-center"
                                    title="Arrastra para reordenar"
                                  >
                                    <FiMenu size={16} />
                                  </div>

                                  {/* Info Badge de Posición */}
                                  <div className="shrink-0 flex items-center justify-center">
                                    <span
                                      className={`w-6 h-6 rounded-lg font-bold text-xs flex items-center justify-center ${
                                        !isActive
                                          ? "bg-gray-200 text-gray-400"
                                          : order === 1
                                          ? "bg-amber-100 text-amber-700 border border-amber-200"
                                          : order === 2
                                          ? "bg-slate-100 text-slate-700 border border-slate-200"
                                          : "bg-indigo-50 text-indigo-700 border border-indigo-100"
                                      }`}
                                    >
                                      {order}°
                                    </span>
                                  </div>

                                  {/* Avatar e Información Personal */}
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div
                                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 ${
                                        !isActive
                                          ? "bg-gray-400"
                                          : order === 1
                                          ? "bg-indigo-600"
                                          : "bg-indigo-500"
                                      }`}
                                    >
                                      {asesora.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="truncate">
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-800 text-sm truncate">
                                          {asesora.name}
                                        </span>
                                        {isActive && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                            <FiActivity className="mr-0.5" /> Activa
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] text-gray-400 block mt-0.5 truncate">
                                        ID: {asesora.id.substring(0, 8)}... | Rol: {asesora.role}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Controles de Estado y Carga */}
                                  <div className="flex flex-wrap items-center gap-4 self-center justify-end">
                                    {/* Switch de Rotación */}
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-bold text-gray-400 uppercase">Rotación</span>
                                      <button
                                        onClick={() =>
                                          handleUpdateUserField(asesora.id, {
                                            activo_rotacion: !isActive,
                                          })
                                        }
                                        disabled={updatingUser === asesora.id}
                                        className={`w-11 h-6 rounded-full transition-colors relative outline-none cursor-pointer ${
                                          isActive ? "bg-indigo-600" : "bg-gray-200"
                                        }`}
                                      >
                                        <div
                                          className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                                            isActive ? "left-6" : "left-1"
                                          }`}
                                        ></div>
                                      </button>
                                    </div>

                                    {/* Contador de Leads */}
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-bold text-gray-400 uppercase">Hoy</span>
                                      <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white shadow-xs">
                                        <button
                                          onClick={() =>
                                            handleUpdateUserField(asesora.id, {
                                              leads_recibidos_hoy: Math.max(0, countToday - 1),
                                            })
                                          }
                                          disabled={!isActive || countToday === 0 || updatingUser === asesora.id}
                                          className="px-2 py-1 bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-50 text-[10px] font-bold cursor-pointer"
                                        >
                                          -
                                        </button>
                                        <span className="px-3 text-xs font-bold text-gray-800 min-w-[28px] text-center">
                                          {countToday}
                                        </span>
                                        <button
                                          onClick={() =>
                                            handleUpdateUserField(asesora.id, {
                                              leads_recibidos_hoy: countToday + 1,
                                            })
                                          }
                                          disabled={!isActive || updatingUser === asesora.id}
                                          className="px-2 py-1 bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-50 text-[10px] font-bold cursor-pointer"
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>

            {/* Panel Informativo */}
            <div className="bg-slate-100 p-4 border border-gray-200/50 rounded-2xl">
              <h4 className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                <FiHelpCircle className="text-indigo-500" /> ¿Cómo funciona la rotación por arrastre?
              </h4>
              <ul className="text-[11px] text-gray-500 mt-2 space-y-1.5 list-disc pl-4">
                <li>
                  <strong>Prioridad por posición:</strong> La asesora en la posición <strong>1°</strong> tiene la prioridad principal de reparto. Puedes arrastrar y soltar usando el icono de menú (<FiMenu className="inline" />) para cambiar este orden en vivo.
                </li>
                <li>
                  <strong>Carga equitativa:</strong> El sistema prioriza entregar los nuevos leads a la asesora de mayor prioridad que tenga la <strong>menor cantidad de leads recibidos en el día</strong> (columna "Hoy").
                </li>
                <li>
                  <strong>Pausa temporal:</strong> Si una asesora se ausenta, desactiva su interruptor de "Rotación". Esto la mantendrá en la lista pero evitará que el algoritmo le asigne nuevos leads temporalmente.
                </li>
              </ul>
            </div>
          </div>

          {/* Configuración de Algoritmo de Rotación (Columna Derecha) */}
          <div className="space-y-6">
            {/* Configurar secuencia */}
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-xs overflow-hidden p-5">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3 mb-4">
                <FiSliders className="text-indigo-500" /> Secuencia de Reparto
              </h3>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                {/* Patrón de secuencia */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">
                    Patrón de Prioridad (Posiciones)
                  </label>
                  <input
                    type="text"
                    value={sequenceInput}
                    onChange={(e) => setSequenceInput(e.target.value)}
                    placeholder="Ej. 1, 1, 2, 1, 3, 1, 2"
                    className="w-full px-3 py-2 border border-gray-200 bg-white text-gray-800 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-gray-400 block mt-1">
                    Ingresa los números de posición separados por comas. El sistema ciclará por esta secuencia para determinar qué turno recibe el siguiente lead.
                  </span>
                </div>

                {/* Hora de reset */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">
                    Reinicio Diario (Lima)
                  </label>
                  <select
                    value={resetHourInput}
                    onChange={(e) => setResetHourInput(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 border border-gray-200 bg-white text-gray-800 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    {Array.from({ length: 24 }).map((_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, "0")}:00 {i >= 12 ? "PM" : "AM"}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-gray-400 block mt-1">
                    Hora en la que se restablecen los contadores de leads del día a 0 y la secuencia regresa al inicio.
                  </span>
                </div>

                {/* Botón Guardar */}
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2 font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <FiSave size={13} />
                  {savingSettings ? "Guardando..." : "Guardar Configuración"}
                </button>
              </form>
            </div>

            {/* Estado del Motor de Rotación */}
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-xs p-5 space-y-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3">
                <FiTrendingUp className="text-indigo-500" /> Estado del Motor
              </h3>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Índice de Turno:</span>
                  <span className="font-bold text-gray-800">
                    {config.sequenceIndex ?? 0}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Turno de Prioridad:</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                    Posición {config.sequencePattern ? config.sequencePattern[(config.sequenceIndex ?? 0) % config.sequencePattern.length] : 1}°
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Último Reinicio:</span>
                  <span className="font-bold text-gray-800">
                    {config.lastResetDate || "Nunca"}
                  </span>
                </div>

                <button
                  onClick={handleResetSequenceIndex}
                  disabled={savingSettings}
                  className="w-full py-2 bg-slate-100 hover:bg-gray-200/70 text-gray-700 rounded-xl text-xs font-bold border border-gray-200/50 cursor-pointer transition-all active:scale-95"
                >
                  Restablecer Turno a 0
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


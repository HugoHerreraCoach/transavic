// src/app/dashboard/crm-leads/components/RotationConfig.tsx
"use client";

import React, { useState, useEffect } from "react";
import {
  FiUser,
  FiSave,
  FiRefreshCw,
  FiSliders,
  FiTrendingUp,
  FiCheck,
  FiX,
  FiHelpCircle,
  FiActivity,
  FiUserMinus,
  FiMove,
} from "react-icons/fi";
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
  const [draggedAdvisor, setDraggedAdvisor] = useState<User | null>(null);

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
        setAdvisors(usersData || []);
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
      setAdvisors((prev) => prev.map((a) => (a.id === userId ? { ...a, ...updated } : a)));
      showToast("ok", "Asesora actualizada correctamente.");
    } catch (e) {
      console.error(e);
      showToast("error", "No se pudo actualizar la asesora.");
    } finally {
      setUpdatingUser(null);
    }
  };

  // Drag and Drop Handlers (Native HTML5)
  const handleDragStart = (e: React.DragEvent, advisor: User) => {
    setDraggedAdvisor(advisor);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetTier: number) => {
    e.preventDefault();
    if (!draggedAdvisor) return;

    const isMovingToInactive = targetTier === 0;

    // Optimistic Update
    setAdvisors((prev) =>
      prev.map((a) => {
        if (a.id === draggedAdvisor.id) {
          return {
            ...a,
            activo_rotacion: !isMovingToInactive,
            orden_rotacion: isMovingToInactive ? (a.orden_rotacion || 1) : targetTier,
          };
        }
        return a;
      })
    );

    try {
      const res = await fetch(`/api/users/${draggedAdvisor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activo_rotacion: !isMovingToInactive,
          orden_rotacion: isMovingToInactive ? undefined : targetTier,
        }),
      });

      if (!res.ok) throw new Error("Error");

      const updated = await res.json();
      setAdvisors((prev) => prev.map((a) => (a.id === draggedAdvisor.id ? { ...a, ...updated } : a)));
      showToast("ok", `${draggedAdvisor.name} movida correctamente.`);
    } catch (error) {
      console.error(error);
      showToast("error", "No se pudo mover la asesora.");
      loadData(); // Revert to database state
    } finally {
      setDraggedAdvisor(null);
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

  // Obtener asesores por nivel de prioridad
  const getAdvisorsByTier = (tier: number) => {
    if (tier === 0) {
      // Fuera de rotación (inactivas)
      return advisors.filter((a) => a.activo_rotacion === false);
    }
    // Activas en un nivel específico
    return advisors.filter((a) => a.activo_rotacion !== false && (a.orden_rotacion || 1) === tier);
  };

  const TIERS = [
    { id: 1, name: "Nivel 1 (Alta)", color: "bg-emerald-600 border-emerald-700 text-white", iconColor: "text-emerald-500" },
    { id: 2, name: "Nivel 2 (Media)", color: "bg-amber-500 border-amber-600 text-white", iconColor: "text-amber-500" },
    { id: 3, name: "Nivel 3 (Baja)", color: "bg-indigo-500 border-indigo-600 text-white", iconColor: "text-indigo-500" },
    { id: 0, name: "Fuera de Rotación", color: "bg-rose-600 border-rose-700 text-white", iconColor: "text-rose-500" },
  ];

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
            Arrastra y suelta las asesoras entre los niveles de prioridad para organizar el flujo del motor de reparto.
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
        <div className="mt-6 flex flex-col xl:flex-row gap-6 items-start">
          {/* Tablero Kanban (Columna Izquierda y Central) */}
          <div className="flex-1 w-full space-y-6">
            <div className="flex justify-between items-center bg-white p-4 border border-gray-200/60 rounded-2xl shadow-xs">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                <FiUser className="text-indigo-500" /> Tablero de Niveles
              </h3>
              <button
                onClick={handleResetAllLoads}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/50 rounded-xl text-[10px] font-bold transition-all cursor-pointer active:scale-95"
              >
                Reiniciar Cargas Diarias
              </button>
            </div>

            {/* Columnas Kanban */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {TIERS.map((tier) => {
                const tierAdvisors = getAdvisorsByTier(tier.id);
                const isInactiveColumn = tier.id === 0;

                return (
                  <div
                    key={tier.id}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, tier.id)}
                    className={`bg-white rounded-2xl shadow-xs border border-gray-200/80 overflow-hidden flex flex-col min-h-[350px] transition-colors ${
                      draggedAdvisor ? "ring-2 ring-indigo-200 bg-indigo-50/10" : ""
                    }`}
                  >
                    {/* Encabezado del Nivel */}
                    <div className={`px-4 py-3 ${tier.color} font-bold text-xs flex items-center justify-between`}>
                      <div className="flex items-center gap-1.5">
                        {isInactiveColumn ? <FiUserMinus size={14} /> : <FiUser size={14} />}
                        <span>{tier.name}</span>
                      </div>
                      <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px]">
                        {tierAdvisors.length}
                      </span>
                    </div>

                    {/* Lista de Tarjetas */}
                    <div className="p-3 flex-1 space-y-3 overflow-y-auto">
                      {tierAdvisors.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-10">
                          <FiUserMinus className="opacity-30 mb-2" size={24} />
                          <p className="text-[10px] font-semibold">Vacío</p>
                        </div>
                      ) : (
                        tierAdvisors.map((asesora) => {
                          const countToday = asesora.leads_recibidos_hoy || 0;
                          return (
                            <div
                              key={asesora.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, asesora)}
                              className={`flex flex-col p-3 bg-white border border-gray-150 rounded-xl hover:shadow-md cursor-grab active:cursor-grabbing transition-all ${
                                draggedAdvisor?.id === asesora.id ? "opacity-40" : ""
                              }`}
                            >
                              {/* Fila 1: Grip & Nombre */}
                              <div className="flex items-center gap-2 mb-2">
                                <FiMove className="text-gray-400 shrink-0" size={13} />
                                <div
                                  className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] text-white shrink-0 ${
                                    isInactiveColumn
                                      ? "bg-gray-400"
                                      : tier.id === 1
                                      ? "bg-emerald-500"
                                      : tier.id === 2
                                      ? "bg-amber-500"
                                      : "bg-indigo-500"
                                  }`}
                                >
                                  {asesora.name.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="truncate min-w-0 flex-1">
                                  <span className="font-bold text-gray-800 text-xs block truncate">
                                    {asesora.name}
                                  </span>
                                </div>
                              </div>

                              {/* Fila 2: Cargas "Hoy" */}
                              <div className="flex items-center justify-between border-t border-gray-100 pt-2 mt-1">
                                <span className="text-[9px] font-extrabold text-gray-400 uppercase">Leads Hoy</span>
                                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-slate-50">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdateUserField(asesora.id, {
                                        leads_recibidos_hoy: Math.max(0, countToday - 1),
                                      });
                                    }}
                                    disabled={countToday === 0 || updatingUser === asesora.id}
                                    className="px-1.5 py-0.5 hover:bg-gray-200 text-[10px] font-bold text-gray-500 disabled:opacity-50 cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <span className="px-2 text-[10px] font-bold text-gray-800 min-w-[20px] text-center bg-white">
                                    {countToday}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdateUserField(asesora.id, {
                                        leads_recibidos_hoy: countToday + 1,
                                      });
                                    }}
                                    disabled={updatingUser === asesora.id}
                                    className="px-1.5 py-0.5 hover:bg-gray-200 text-[10px] font-bold text-gray-500 disabled:opacity-50 cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Panel Informativo */}
            <div className="bg-slate-100 p-4 border border-gray-200/50 rounded-2xl">
              <h4 className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                <FiHelpCircle className="text-indigo-500" /> ¿Cómo funciona la rotación por niveles?
              </h4>
              <ul className="text-[11px] text-gray-500 mt-2 space-y-1.5 list-disc pl-4">
                <li>
                  <strong>Asignación por Nivel:</strong> El sistema evalúa el "Patrón de Prioridad" (secuencia de la derecha). Si el turno actual marca "Posición 1", el lead va a las asesoras en el <strong>Nivel 1 (Alta)</strong>.
                </li>
                <li>
                  <strong>Equidad dentro del Nivel:</strong> Dentro del nivel seleccionado, el lead se le entrega a la asesora que tenga **menos leads recibidos hoy** para mantener el equilibrio.
                </li>
                <li>
                  <strong>Desactivar asesoras:</strong> Arrastra a una asesora a la columna <strong>Fuera de Rotación</strong> si se encuentra ausente o de descanso. No recibirá ningún lead de forma automática.
                </li>
              </ul>
            </div>
          </div>

          {/* Configuración de Algoritmo de Rotación (Columna Derecha) */}
          <div className="w-full xl:w-[320px] shrink-0 space-y-6">
            {/* Configurar secuencia */}
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-xs p-5">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3 mb-4">
                <FiSliders className="text-indigo-500" /> Secuencia de Reparto
              </h3>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">
                    Patrón de Prioridad (Niveles)
                  </label>
                  <input
                    type="text"
                    value={sequenceInput}
                    onChange={(e) => setSequenceInput(e.target.value)}
                    placeholder="Ej. 1, 1, 2, 1, 3, 1, 2"
                    className="w-full px-3 py-2 border border-gray-200 bg-white text-gray-800 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-gray-400 block mt-1">
                    Ingresa los números de nivel (1, 2 o 3) separados por comas. El sistema ciclará por esta secuencia.
                  </span>
                </div>

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
                  <span className="text-gray-400">Nivel de Turno:</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                    Nivel {config.sequencePattern ? config.sequencePattern[(config.sequenceIndex ?? 0) % config.sequencePattern.length] : 1}
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

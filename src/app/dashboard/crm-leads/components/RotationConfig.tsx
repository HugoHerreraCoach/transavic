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
  FiPlay,
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
      // Parsear la secuencia ingresada (debe ser lista de enteros separados por comas)
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
      setAdvisors(advisors.map((a) => (a.id === userId ? { ...a, ...updated } : a)));
      showToast("ok", "Asesora actualizada correctamente.");
    } catch (e) {
      console.error(e);
      showToast("error", "No se pudo actualizar la asesora.");
    } finally {
      setUpdatingUser(null);
    }
  };

  // Reiniciar todas las cargas diarias a 0
  const handleResetAllLoads = async () => {
    if (!confirm("¿Estás seguro de que deseas reiniciar a 0 los contadores de todas las asesoras?")) return;
    setLoading(true);

    try {
      // Para ser limpios, hacemos PATCH por cada asesora activa
      const promises = advisors.map((a) =>
        fetch(`/api/users/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads_recibidos_hoy: 0 }),
        })
      );
      await Promise.all(promises);

      // Recargar datos
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

      {/* Título de la página */}
      <div className="flex justify-between items-center pb-5 border-b border-gray-200/60 shrink-0">
        <div>
          <h1 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <span className="text-indigo-600">🎫</span> Reparto Automático de Leads
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Distribuye de forma automática y equitativa los prospectos entrantes de WhatsApp entre las asesoras comerciales.
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
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-sm overflow-hidden">
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

              <div className="divide-y divide-gray-100">
                {advisors.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">
                    No se encontraron asesoras comerciales registradas.
                  </div>
                ) : (
                  advisors.map((asesora) => {
                    const isActive = asesora.activo_rotacion !== false;
                    const tier = asesora.orden_rotacion || 1;
                    const countToday = asesora.leads_recibidos_hoy || 0;

                    return (
                      <div
                        key={asesora.id}
                        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3 transition-colors ${
                          !isActive ? "bg-gray-50/40 opacity-70" : ""
                        }`}
                      >
                        {/* Nombre e info */}
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 ${
                              !isActive
                                ? "bg-gray-400"
                                : tier === 1
                                ? "bg-emerald-500"
                                : tier === 2
                                ? "bg-amber-500"
                                : "bg-slate-500"
                            }`}
                          >
                            {asesora.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold text-gray-800 text-sm block">
                              {asesora.name}
                            </span>
                            <span className="text-[10px] text-gray-400 block mt-0.5">
                              ID: {asesora.id.substring(0, 8)}... | Rol: {asesora.role}
                            </span>
                          </div>
                        </div>

                        {/* Controles de Rotación */}
                        <div className="flex flex-wrap items-center gap-4">
                          {/* Toggle Activo */}
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
                                isActive ? "bg-indigo-600" : "bg-gray-300"
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                                  isActive ? "left-6" : "left-1"
                                }`}
                              ></div>
                            </button>
                          </div>

                          {/* Prioridad / Tier */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">Prioridad</span>
                            <select
                              value={tier}
                              disabled={!isActive || updatingUser === asesora.id}
                              onChange={(e) =>
                                handleUpdateUserField(asesora.id, {
                                  orden_rotacion: parseInt(e.target.value, 10),
                                })
                              }
                              className="border border-gray-200 bg-white text-gray-800 rounded-lg p-1 text-xs outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                            >
                              <option value={1}>Nivel 1 (Alta)</option>
                              <option value={2}>Nivel 2 (Media)</option>
                              <option value={3}>Nivel 3 (Baja)</option>
                            </select>
                          </div>

                          {/* Leads Recibidos Hoy */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">Hoy</span>
                            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                              <button
                                onClick={() =>
                                  handleUpdateUserField(asesora.id, {
                                    leads_recibidos_hoy: Math.max(0, countToday - 1),
                                  })
                                }
                                disabled={!isActive || countToday === 0 || updatingUser === asesora.id}
                                className="px-2 py-1 bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-50 text-[10px] font-bold"
                              >
                                -
                              </button>
                              <span className="px-3 text-xs font-bold text-gray-800 min-w-[28px] text-center bg-white">
                                {countToday}
                              </span>
                              <button
                                onClick={() =>
                                  handleUpdateUserField(asesora.id, {
                                    leads_recibidos_hoy: countToday + 1,
                                  })
                                }
                                disabled={!isActive || updatingUser === asesora.id}
                                className="px-2 py-1 bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-50 text-[10px] font-bold"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Panel Informativo de Tiers */}
            <div className="bg-slate-100 p-4 border border-gray-200/50 rounded-2xl">
              <h4 className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                <FiHelpCircle className="text-indigo-500" /> ¿Cómo funciona la rotación?
              </h4>
              <ul className="text-[11px] text-gray-500 mt-2 space-y-1.5 list-disc pl-4">
                <li>
                  <strong>Niveles de Prioridad</strong>: En cada asignación, el sistema consulta el patrón configurado para saber qué Nivel le toca recibir el lead.
                </li>
                <li>
                  <strong>Equidad de Carga</strong>: Dentro del Nivel seleccionado, el lead se le asigna a la asesora activa con **menor número de prospectos recibidos hoy**.
                </li>
                <li>
                  <strong>Botón de Ausencia</strong>: Si una asesora está de vacaciones o enferma, puedes apagar su rotación para que no reciba leads.
                </li>
                <li>
                  <strong>Reinicio Diario</strong>: A las 8:00 AM de cada día (hora de Lima), los contadores se restablecen automáticamente a 0 y la secuencia vuelve a empezar.
                </li>
              </ul>
            </div>
          </div>

          {/* Configuración de Algoritmo de Rotación (Columna Derecha) */}
          <div className="space-y-6">
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-sm overflow-hidden p-5">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3 mb-4">
                <FiSliders className="text-indigo-500" /> Configurar Secuencia
              </h3>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                {/* Patrón de secuencia */}
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
                    Ingresa números de Nivel separados por comas. El sistema ciclará por este patrón. (Ej. 1,1,2 = dos leads al Nivel 1 por cada lead al Nivel 2).
                  </span>
                </div>

                {/* Hora de reset */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">
                    Hora de Reinicio Diario (Lima)
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
                    Hora en la que se limpian los leads de hoy y se reinicia la secuencia.
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
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-sm p-5 space-y-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3">
                <FiTrendingUp className="text-indigo-500" /> Estado del Motor
              </h3>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Índice Actual:</span>
                  <span className="font-bold text-gray-800">
                    {config.sequenceIndex ?? 0}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Próximo Nivel:</span>
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
                  Restablecer Secuencia a 0
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

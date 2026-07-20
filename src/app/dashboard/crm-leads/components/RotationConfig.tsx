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
  tierPercentages?: Record<string, number>;
}

const DEFAULT_CONFIG: GoldenTicketConfig = {
  sequenceIndex: 0,
  sequencePattern: [1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 3],
  dailyResetHour: 8,
  lastResetDate: null,
  tierPercentages: { "1": 60, "2": 25, "3": 15 },
};

export default function RotationConfig({ onClose }: RotationConfigProps) {
  const [advisors, setAdvisors] = useState<User[]>([]);
  const [config, setConfig] = useState<GoldenTicketConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tipo: "ok" | "error"; txt: string } | null>(null);
  const [draggedAdvisor, setDraggedAdvisor] = useState<User | null>(null);

  // Estados locales para los porcentajes de reparto
  const [percent1, setPercent1] = useState(60);
  const [percent2, setPercent2] = useState(25);
  const [percent3, setPercent3] = useState(15);
  const [resetHourInput, setResetHourInput] = useState(8);

  // Auto-balance de porcentajes (No me hagas pensar)
  const handlePercent1Change = (val: number) => {
    const v1 = Math.max(0, Math.min(100, val));
    setPercent1(v1);
    const remaining = 100 - v1;
    if (percent2 + percent3 === 0) {
      setPercent2(Math.round(remaining * 0.6));
      setPercent3(remaining - Math.round(remaining * 0.6));
    } else {
      const ratio = percent2 / (percent2 + percent3 || 1);
      const newP2 = Math.round(remaining * ratio);
      setPercent2(newP2);
      setPercent3(remaining - newP2);
    }
  };

  const handlePercent2Change = (val: number) => {
    const v2 = Math.max(0, Math.min(100, val));
    setPercent2(v2);
    const remaining = 100 - v2;
    if (percent1 + percent3 === 0) {
      setPercent1(Math.round(remaining * 0.8));
      setPercent3(remaining - Math.round(remaining * 0.8));
    } else {
      const ratio = percent1 / (percent1 + percent3 || 1);
      const newP1 = Math.round(remaining * ratio);
      setPercent1(newP1);
      setPercent3(remaining - newP1);
    }
  };

  const handlePercent3Change = (val: number) => {
    const v3 = Math.max(0, Math.min(100, val));
    setPercent3(v3);
    const remaining = 100 - v3;
    if (percent1 + percent2 === 0) {
      setPercent1(Math.round(remaining * 0.7));
      setPercent2(remaining - Math.round(remaining * 0.7));
    } else {
      const ratio = percent1 / (percent1 + percent2 || 1);
      const newP1 = Math.round(remaining * ratio);
      setPercent1(newP1);
      setPercent2(remaining - newP1);
    }
  };

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
        setResetHourInput(distConfig.dailyResetHour ?? 8);

        const percentages = distConfig.tierPercentages || { "1": 60, "2": 25, "3": 15 };
        setPercent1(percentages["1"] ?? 60);
        setPercent2(percentages["2"] ?? 25);
        setPercent3(percentages["3"] ?? 15);
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

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);

    try {
      const sum = percent1 + percent2 + percent3;
      if (sum !== 100) {
        showToast("error", `Los porcentajes deben sumar exactamente 100% (actual: ${sum}%).`);
        setSavingSettings(false);
        return;
      }

      // Generar automáticamente el patrón cíclico equilibrado de 20 pasos
      const steps = 20;
      const t1Count = Math.round((percent1 / 100) * steps);
      const t2Count = Math.round((percent2 / 100) * steps);
      const t3Count = steps - t1Count - t2Count;

      const newPattern: number[] = [];
      let t1Left = t1Count, t2Left = t2Count, t3Left = t3Count;
      for (let i = 0; i < steps; i++) {
        if (i % 5 === 0 && t3Left > 0) { t3Left--; newPattern.push(3); }
        else if (i % 3 === 0 && t2Left > 0) { t2Left--; newPattern.push(2); }
        else if (t1Left > 0) { t1Left--; newPattern.push(1); }
        else if (t2Left > 0) { t2Left--; newPattern.push(2); }
        else if (t3Left > 0) { t3Left--; newPattern.push(3); }
        else newPattern.push(1);
      }

      const updatedConfig: GoldenTicketConfig = {
        ...config,
        sequencePattern: newPattern,
        dailyResetHour: resetHourInput,
        tierPercentages: {
          "1": percent1,
          "2": percent2,
          "3": percent3,
        },
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
      showToast("ok", "Configuración de reparto guardada.");
    } catch (error) {
      console.error(error);
      showToast("error", "Error al guardar la configuración.");
    } finally {
      setSavingSettings(false);
    }
  };

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
      loadData();
    } finally {
      setDraggedAdvisor(null);
    }
  };

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

  const getAdvisorsByTier = (tier: number) => {
    if (tier === 0) {
      return advisors.filter((a) => a.activo_rotacion === false);
    }
    return advisors.filter((a) => a.activo_rotacion !== false && (a.orden_rotacion || 1) === tier);
  };

  const TIERS = [
    { id: 1, name: "Nivel 1 (Alta)", color: "bg-emerald-600 border-emerald-700 text-white" },
    { id: 2, name: "Nivel 2 (Media)", color: "bg-amber-500 border-amber-600 text-white" },
    { id: 3, name: "Nivel 3 (Baja)", color: "bg-indigo-500 border-indigo-600 text-white" },
    { id: 0, name: "Fuera de Rotación", color: "bg-rose-600 border-rose-700 text-white" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-slate-50">
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
            Arrastra y clasifica las asesoras según su nivel de prioridad para distribuir de forma automática los nuevos prospectos.
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
        <div className="mt-6 flex flex-col xl:flex-row gap-6 items-start w-full">
          {/* Tablero Kanban (Columna Izquierda y Central) */}
          <div className="flex-1 w-full space-y-6">
            <div className="flex justify-between items-center bg-white p-4 border border-gray-200/60 rounded-2xl shadow-xs">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                <FiUser className="text-indigo-500" /> Miembros de la Rotación
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
                    className={`bg-white rounded-2xl shadow-xs border border-gray-200/80 overflow-hidden flex flex-col min-h-[300px] transition-colors ${
                      draggedAdvisor ? "ring-2 ring-indigo-200 bg-indigo-50/10" : ""
                    }`}
                  >
                    {/* Encabezado del Nivel */}
                    <div className={`px-3 py-2.5 ${tier.color} font-bold text-xs flex items-center justify-between`}>
                      <div className="flex items-center gap-1.5">
                        {isInactiveColumn ? <FiUserMinus size={13} /> : <FiUser size={13} />}
                        <span>{tier.name}</span>
                      </div>
                      <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px]">
                        {tierAdvisors.length}
                      </span>
                    </div>

                    {/* Lista de Tarjetas - Altura ultra-compacta (single-row) */}
                    <div className="p-2.5 flex-1 space-y-2 overflow-y-auto max-h-[360px]">
                      {tierAdvisors.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-12">
                          <FiUserMinus className="opacity-30 mb-1" size={20} />
                          <p className="text-[10px] font-bold">Vacio</p>
                        </div>
                      ) : (
                        tierAdvisors.map((asesora) => {
                          const countToday = asesora.leads_recibidos_hoy || 0;
                          return (
                            <div
                              key={asesora.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, asesora)}
                              className={`flex items-center justify-between p-2 bg-white border border-gray-150 rounded-xl hover:shadow-xs cursor-grab active:cursor-grabbing transition-all ${
                                draggedAdvisor?.id === asesora.id ? "opacity-40" : ""
                              }`}
                            >
                              {/* Grip, Iniciales y Nombre (Inline) */}
                              <div className="flex items-center gap-2 min-w-0">
                                <FiMove className="text-gray-400 shrink-0" size={12} />
                                <div
                                  className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[9px] text-white shrink-0 ${
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
                                <span className="font-bold text-gray-800 text-[11px] truncate">
                                  {asesora.name}
                                </span>
                              </div>

                              {/* Contador Leads Hoy (Inline) */}
                              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-slate-50 shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUpdateUserField(asesora.id, {
                                      leads_recibidos_hoy: Math.max(0, countToday - 1),
                                    });
                                  }}
                                  disabled={countToday === 0 || updatingUser === asesora.id}
                                  className="px-1.5 py-0.5 hover:bg-gray-200 text-[9px] font-bold text-gray-500 disabled:opacity-50 cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="px-1.5 text-[9px] font-extrabold text-gray-800 min-w-[16px] text-center bg-white">
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
                                  className="px-1.5 py-0.5 hover:bg-gray-200 text-[9px] font-bold text-gray-500 disabled:opacity-50 cursor-pointer"
                                >
                                  +
                                </button>
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

            {/* Secuencia Cíclica (Visualizador de Pasos - Golden Ticket) */}
            <div className="bg-white border border-gray-250/60 rounded-2xl p-5 shadow-xs">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3 mb-4">
                <FiTrendingUp className="text-indigo-500" /> Secuencia de Turnos Activa
              </h3>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                El motor de reparto cicla a través de estos 20 casilleros para decidir qué prioridad recibe el lead entrante.
                La bolilla con borde grueso indica el **Próximo Turno** a entregar:
              </p>

              <div className="flex flex-wrap gap-1.5 pb-2">
                {config.sequencePattern?.map((tier, idx) => {
                  const isActive = (config.sequenceIndex ?? 0) % config.sequencePattern.length === idx;
                  return (
                    <div
                      key={idx}
                      className={`relative w-8 h-8 rounded-full flex flex-col items-center justify-center text-[10px] font-black text-white transition-all shadow-xs ${
                        tier === 1
                          ? "bg-emerald-600"
                          : tier === 2
                          ? "bg-amber-500"
                          : "bg-indigo-500"
                      } ${
                        isActive
                          ? "ring-4 ring-indigo-600 ring-offset-2 scale-110 z-10"
                          : "opacity-45"
                      }`}
                      title={isActive ? "¡Próximo Turno!" : `Paso ${idx + 1}`}
                    >
                      <span>N{tier}</span>
                      <span className="text-[7px] opacity-80 font-normal absolute -bottom-0.5">
                        {idx + 1}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 mt-4 pt-3 text-xs text-gray-600">
                <div>
                  Turno actual: <strong className="text-indigo-600">{(config.sequenceIndex ?? 0) % (config.sequencePattern?.length || 20) + 1} / 20</strong>
                  <span className="mx-2">|</span>
                  Siguiente lead asignado a:{" "}
                  <strong className="text-gray-800 bg-slate-100 px-2 py-0.5 rounded font-bold">
                    Nivel {config.sequencePattern ? config.sequencePattern[(config.sequenceIndex ?? 0) % config.sequencePattern.length] : 1}
                  </strong>
                </div>
                <button
                  onClick={handleResetSequenceIndex}
                  disabled={savingSettings}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-gray-200 text-gray-700 rounded-xl text-[10px] font-bold border border-gray-250 cursor-pointer active:scale-95 transition-all"
                >
                  Restablecer Ciclo al Inicio (1)
                </button>
              </div>
            </div>
          </div>

          {/* Configuración de Algoritmo de Rotación (Columna Derecha) */}
          <div className="w-full xl:w-[320px] shrink-0 space-y-6">
            {/* Porcentajes de Reparto (Range Sliders Auto-balanceables) */}
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-xs p-5 space-y-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm border-b border-gray-100 pb-3">
                <FiSliders className="text-indigo-500" /> Distribución de Carga
              </h3>
              <p className="text-[10px] text-gray-400 leading-normal">
                Define qué porcentaje del total de leads recibirá cada nivel. Al ajustar un control, los otros se adaptan automáticamente para mantener el total en 100%.
              </p>

              <form onSubmit={handleSaveSettings} className="space-y-4 pt-2">
                {/* Nivel 1 */}
                <div className="space-y-1 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100/50">
                  <div className="flex justify-between items-center text-xs font-bold text-emerald-800">
                    <span>Nivel 1 (Alta)</span>
                    <span>{percent1}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={percent1}
                    onChange={(e) => handlePercent1Change(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-emerald-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                </div>

                {/* Nivel 2 */}
                <div className="space-y-1 bg-amber-50/50 p-3 rounded-xl border border-amber-100/50">
                  <div className="flex justify-between items-center text-xs font-bold text-amber-800">
                    <span>Nivel 2 (Media)</span>
                    <span>{percent2}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={percent2}
                    onChange={(e) => handlePercent2Change(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-amber-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                {/* Nivel 3 */}
                <div className="space-y-1 bg-indigo-50/50 p-3 rounded-xl border border-indigo-100/50">
                  <div className="flex justify-between items-center text-xs font-bold text-indigo-800">
                    <span>Nivel 3 (Baja)</span>
                    <span>{percent3}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={percent3}
                    onChange={(e) => handlePercent3Change(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Validador de Suma */}
                <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-3">
                  <span className="text-gray-400 font-medium">Suma Total:</span>
                  <span className="font-extrabold text-emerald-600 flex items-center gap-1">
                    <FiCheck /> 100%
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">
                    Reinicio Diario Automático
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
                  <span className="text-[9px] text-gray-400 block mt-1 leading-normal">
                    Hora (Zona Horaria Lima) en la que se vacían a 0 los contadores diarios de leads y el ciclo vuelve al primer turno.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <FiSave size={13} />
                  {savingSettings ? "Guardando..." : "Guardar Distribución"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

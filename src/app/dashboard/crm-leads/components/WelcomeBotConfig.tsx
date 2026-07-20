// src/app/dashboard/crm-leads/components/WelcomeBotConfig.tsx
import React, { useState, useEffect } from "react";
import { FiX, FiSave, FiClock } from "react-icons/fi";

interface WelcomeBotConfigProps {
  onClose: () => void;
}

interface BotSettings {
  isActive: boolean;
  welcomeMessage: string;
  button1Text: string;
  response1: string;
  button2Text: string;
  response2: string;
  fallbackMessage: string;
  fallbackMessageNight: string;
  dayStartHour: number;
  dayStartMinute: number;
  dayEndHour: number;
  dayEndMinute: number;
  fallbackDelaySeconds: number;
  workingDays: number[];
}

const DEFAULT_SETTINGS: BotSettings = {
  isActive: false,
  welcomeMessage: "¡Hola! Bienvenido a Transavic / Avícola de Tony. ¿En qué podemos ayudarte hoy?",
  button1Text: "Ver catálogo de precios",
  response1: "¡Hola! Puedes revisar nuestros productos en stock y precios actualizados en: [LINK]",
  button2Text: "Realizar un pedido",
  response2: "Excelente. Por favor bríndanos tu nombre y dirección de despacho para transferirte con un asesor.",
  fallbackMessage: "Disculpa, entiendo que deseas atención humana. De inmediato te transfiero con una de nuestras asesoras.",
  fallbackMessageNight: "Nuestro horario de atención es de Lunes a Sábado de 8 AM a 8 PM. Por favor déjanos tu mensaje y te responderemos a primera hora mañana 🌙.",
  dayStartHour: 8,
  dayStartMinute: 0,
  dayEndHour: 20,
  dayEndMinute: 0,
  fallbackDelaySeconds: 60,
  workingDays: [1, 2, 3, 4, 5, 6], // Lun - Sáb
};

const DAY_NAMES = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
];

export default function WelcomeBotConfig({ onClose }: WelcomeBotConfigProps) {
  const [settings, setSettings] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.crm_welcome_bot) {
            setSettings({ ...DEFAULT_SETTINGS, ...data.crm_welcome_bot });
          }
        }
      } catch (error) {
        console.error("Error fetching bot settings:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "crm_welcome_bot",
          value: settings,
        }),
      });

      if (res.ok) {
        alert("Configuración del bot de bienvenida guardada correctamente.");
        onClose();
      } else {
        throw new Error();
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Error al guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = <K extends keyof BotSettings>(field: K, value: BotSettings[K]) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const toggleDay = (dayValue: number) => {
    const currentDays = settings.workingDays || [];
    const newDays = currentDays.includes(dayValue)
      ? currentDays.filter((d) => d !== dayValue)
      : [...currentDays, dayValue].sort((a, b) => a - b);
    handleChange("workingDays", newDays);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-lg h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
            <h3 className="font-bold text-gray-900 flex items-center gap-1.5">
              🤖 Configurar Bot de Bienvenida
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
              <FiX size={20} />
            </button>
          </div>
          {/* Spinner mientras carga la configuración */}
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Cargando configuración...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-lg h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-1.5">
            🤖 Configurar Bot de Bienvenida
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <FiX size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Activar/Desactivar */}
          <div className="flex items-center justify-between p-3 bg-indigo-50/30 border border-indigo-100/50 rounded-2xl">
            <div>
              <span className="font-bold text-gray-800 block">Estado del Bot</span>
              <span className="text-[10px] text-gray-400 block mt-0.5">Activa o desactiva la respuesta automática de bienvenida.</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.isActive}
                onChange={(e) => handleChange("isActive", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* Mensaje de Bienvenida */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Mensaje de Saludo Principal</label>
            <textarea
              value={settings.welcomeMessage}
              onChange={(e) => handleChange("welcomeMessage", e.target.value)}
              rows={3}
              placeholder="Hola, bienvenido..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>

          {/* Horario de Atención */}
          <div className="p-3 bg-gray-50 rounded-2xl space-y-3">
            <span className="font-bold text-gray-700 flex items-center gap-1">
              <FiClock /> Horario Comercial (hora de Lima)
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Hora de Inicio</label>
                <div className="flex gap-2">
                  <select
                    value={settings.dayStartHour}
                    onChange={(e) => handleChange("dayStartHour", parseInt(e.target.value))}
                    className="w-full border border-gray-200 bg-white rounded-lg p-1.5"
                  >
                    {Array.from({ length: 24 }).map((_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <select
                    value={settings.dayStartMinute}
                    onChange={(e) => handleChange("dayStartMinute", parseInt(e.target.value))}
                    className="w-full border border-gray-200 bg-white rounded-lg p-1.5"
                  >
                    {[0, 15, 30, 45].map((m) => (
                      <option key={m} value={m}>
                        {m.toString().padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Hora de Cierre</label>
                <div className="flex gap-2">
                  <select
                    value={settings.dayEndHour}
                    onChange={(e) => handleChange("dayEndHour", parseInt(e.target.value))}
                    className="w-full border border-gray-200 bg-white rounded-lg p-1.5"
                  >
                    {Array.from({ length: 24 }).map((_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <select
                    value={settings.dayEndMinute}
                    onChange={(e) => handleChange("dayEndMinute", parseInt(e.target.value))}
                    className="w-full border border-gray-200 bg-white rounded-lg p-1.5"
                  >
                    {[0, 15, 30, 45].map((m) => (
                      <option key={m} value={m}>
                        {m.toString().padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Días laborales */}
            <div className="space-y-1 pt-1">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Días Laborales</label>
              <div className="flex justify-between gap-1 mt-1">
                {DAY_NAMES.map((day) => {
                  const active = settings.workingDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`flex-1 py-1 rounded-md font-bold text-[10px] transition-colors border cursor-pointer ${
                        active
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Mensajes Fuera de Horario */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Mensaje Fuera de Horario (Noche/Feriados)</label>
            <textarea
              value={settings.fallbackMessageNight}
              onChange={(e) => handleChange("fallbackMessageNight", e.target.value)}
              rows={2}
              placeholder="Hola, estamos descansando..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>

          {/* Mensaje de Handoff (IA) */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Mensaje al Transferir a Asesora</label>
            <textarea
              value={settings.fallbackMessage}
              onChange={(e) => handleChange("fallbackMessage", e.target.value)}
              rows={2}
              placeholder="Te transfiero con un asesor..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50/50 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <FiSave size={14} /> {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

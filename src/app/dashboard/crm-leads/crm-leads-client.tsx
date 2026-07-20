// src/app/dashboard/crm-leads/crm-leads-client.tsx
"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  FiUser,
  FiMessageSquare,
  FiCheck,
  FiPlus,
  FiSend,
  FiActivity,
  FiX,
  FiPhone,
  FiInfo,
  FiBookOpen,
  FiChevronLeft,
  FiSearch,
  FiFilter,
  FiTag,
  FiPaperclip,
  FiMic,
  FiZap,
  FiExternalLink,
  FiMenu,
  FiChevronDown,
  FiCopy,
  FiRefreshCw,
  FiEdit,
} from "react-icons/fi";
import { Lead, LeadEstado, LeadMensaje } from "@/lib/types";

// Importar subcomponentes del CRM
import AudioRecorder from "./components/AudioRecorder";
import QuickReplySelector from "./components/QuickReplySelector";
import QuickRepliesManager from "./components/QuickRepliesManager";
import WelcomeBotConfig from "./components/WelcomeBotConfig";
import TagManager from "./components/TagManager";
import TagSelector from "./components/TagSelector";
import TemplateModal from "./components/TemplateModal";
import RotationConfig from "./components/RotationConfig";
import PedidoForm from "@/components/PedidoForm";
import GuiaModulo from "@/components/GuiaModulo";
import { usePollingVisible } from "@/lib/use-polling-visible";
import { useToast, ToastContainer } from "@/components/Toast";
import imageCompression from "browser-image-compression";

// Columnas fijas del Kanban
const ESTADOS_KANBAN: LeadEstado[] = ["Nuevo", "Contactado", "Calificado", "Propuesta", "Cerrado", "Perdido"];


interface CrmLeadsClientProps {
  sessionUser: {
    id: string;
    name: string;
    role: string;
  };
}

// Etiqueta global del CRM (guardada en settings.crm_tags)
type EtiquetaCrm = {
  id: string;
  name: string;
  color: string;
};

// Respuesta rápida del CRM (guardada en settings.crm_quick_replies)
type RespuestaRapida = {
  id: string;
  title: string;
  shortcut: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "document" | "dynamic_card";
};

/**
 * ¿El bot está generando una respuesta para este lead AHORA?
 *
 * Se exige que la marca `bot_pensando_desde` sea RECIENTE (< 60 s): si un fallo
 * dejara el flag colgado en la base, el indicador se apaga solo en lugar de
 * quedarse encendido para siempre.
 */
const VENTANA_BOT_ESCRIBIENDO_MS = 60_000;

const esBotEscribiendo = (desde: string | Date | null | undefined): boolean => {
  if (!desde) return false;
  const t = new Date(desde).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < VENTANA_BOT_ESCRIBIENDO_MS;
};

// Helpers para Separadores de Fecha
const isDifferentDay = (date1Str: string | Date, date2Str: string | Date) => {
  if (!date1Str || !date2Str) return true;
  const d1 = new Date(date1Str);
  const d2 = new Date(date2Str);
  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
};

const formatDateSeparator = (dateStr: string | Date) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
    return "Hoy";
  }
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return "Ayer";
  }
  return d.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const RUBROS_CRM = ['Restaurante', 'Cafetería', 'Avícola', 'Chifa', 'Fast food', 'Market / Minimarket', 'Tienda / Bodega', 'Casa / Hogar', 'Otro'];
const DISTRITOS_CRM = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];

export default function CrmLeadsClient({ sessionUser }: CrmLeadsClientProps) {
  // Configuración de vista
  const [viewMode, setViewMode] = useState<"chat" | "rotacion">("chat");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [asesores, setAsesores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Filtros
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAsesor, setSelectedAsesor] = useState("todos");
  const [selectedEmpresa, setSelectedEmpresa] = useState("Transavic");
  const [selectedChatbot, setSelectedChatbot] = useState("todos");
  const [selectedEstadoFilter, setSelectedEstadoFilter] = useState("todos");

  // Filtro avanzado y etiquetas
  const [globalTags, setGlobalTags] = useState<EtiquetaCrm[]>([]);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [activeChatDropdown, setActiveChatDropdown] = useState<string | null>(null);

  // Pestañas de la lista de chats
  const [activeChatTab, setActiveChatTab] = useState<"todos" | "mios" | "pendientes" | "no_leidos" | "ia">("todos");

  // Modales y Panels
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showBotConfig, setShowBotConfig] = useState(false);
  const [showRepliesManager, setShowRepliesManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  
  // Lead activo seleccionado en modo chat
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true); // Ficha del cliente derecha

  // Formulario creación lead
  const [createForm, setCreateForm] = useState({
    nombre: "",
    telefono: "",
    negocio: "",
    ciudad: "",
    empresa: "Transavic" as "Transavic" | "Avícola de Tony",
    estado: "Nuevo",
    vendedor_id: sessionUser.id,
    notas: "",
  });
  const [savingLead, setSavingLead] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Cargar datos principales
  const fetchLeadsAndAsesores = async () => {
    try {
      const [leadsRes, asesoresRes, settingsRes] = await Promise.all([
        fetch("/api/crm/leads"),
        fetch("/api/crm/asesores"),
        fetch("/api/settings"),
      ]);

      if (leadsRes.ok) {
        const data = await leadsRes.json();
        setLeads(data.leads || []);
      }
      if (asesoresRes.ok) {
        const data = await asesoresRes.json();
        setAsesores(data.asesores || []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setGlobalTags(data.crm_tags || []);
      }
    } catch (e) {
      console.error("Error al cargar datos del CRM:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenOrderModalForLead = (lead: Lead) => {
    const prefillData = {
      cliente: lead.nombre,
      whatsapp: lead.telefono,
      empresa: lead.empresa || "Transavic",
      notas: lead.notas || "",
    };
    sessionStorage.setItem("transavic.duplicar", JSON.stringify(prefillData));
    setShowOrderModal(true);
  };

  // Carga inicial SIEMPRE, aunque la pestaña arranque en segundo plano (si no, al
  // abrir el CRM en otra pestaña la bandeja se vería vacía hasta enfocarla).
  useEffect(() => {
    fetchLeadsAndAsesores();
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El REFRESCO periódico sí se pausa con la pestaña oculta: una pestaña de CRM
  // olvidada en segundo plano mantenía despierto el cómputo de Neon (ver el helper).
  usePollingVisible(fetchLeadsAndAsesores, 15000, { immediate: false });

  // Filtrar leads
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      // Filtro de pestaña de chat
      if (activeChatTab === "mios" && l.vendedor_id !== sessionUser.id) return false;
      if (activeChatTab === "pendientes" && l.vendedor_id) return false;
      if (activeChatTab === "no_leidos" && !l.unread_count) return false;
      if (activeChatTab === "ia" && !l.chatbot_activo) return false;

      // Búsqueda por texto
      const matchesSearch =
        l.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.telefono.includes(searchQuery) ||
        (l.negocio && l.negocio.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (l.ciudad && l.ciudad.toLowerCase().includes(searchQuery.toLowerCase()));

      // Filtro de asesor
      const matchesAsesor =
        selectedAsesor === "todos" ||
        (selectedAsesor === "sin_asignar" && !l.vendedor_id) ||
        l.vendedor_id === selectedAsesor;

      // Filtro de empresa
      const matchesEmpresa = selectedEmpresa === "todas" || l.empresa === selectedEmpresa;

      // Filtro de chatbot
      const matchesChatbot =
        selectedChatbot === "todos" ||
        (selectedChatbot === "activo" && l.chatbot_activo) ||
        (selectedChatbot === "inactivo" && !l.chatbot_activo);

      // Filtro de estado
      const matchesEstado = selectedEstadoFilter === "todos" || l.estado === selectedEstadoFilter;

      return matchesSearch && matchesAsesor && matchesEmpresa && matchesChatbot && matchesEstado;
    });
  }, [leads, searchQuery, selectedAsesor, selectedEmpresa, selectedChatbot, selectedEstadoFilter, activeChatTab, sessionUser.id]);

  // Mapa de etiquetas globales para uso rápido
  const tagsMap = useMemo(() => {
    const map: Record<string, { id: string; name: string; color: string }> = {};
    globalTags.forEach((t) => {
      map[t.id] = t;
      map[t.name.toLowerCase()] = t;
    });
    return map;
  }, [globalTags]);

  // Agrupar leads por columna para el Kanban

  // Manejar Drag & Drop Kanban

  // Crear Lead
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLead(true);
    setErrorMsg("");

    try {
      const response = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Error al registrar prospecto");
      }

      setShowCreateModal(false);
      setCreateForm({
        nombre: "",
        telefono: "",
        negocio: "",
        ciudad: "",
        empresa: "Transavic",
        estado: "Nuevo",
        vendedor_id: sessionUser.id,
        notas: "",
      });
      fetchLeadsAndAsesores();
    } catch (err) {
      setErrorMsg(err instanceof Error && err.message ? err.message : "Error desconocido");
    } finally {
      setSavingLead(false);
    }
  };

  // Métricas

  if (!mounted) return null;

  return (
    <div className={`flex flex-col w-full overflow-hidden transition-all duration-300 ${
      viewMode === "chat" ? "h-screen bg-slate-50" : "h-[calc(100vh-64px)] lg:h-[calc(100vh-16px)] bg-gray-50/30"
    }`}>
      {/* RENDER VISTA ROTACIÓN / CHAT INTERACTIVA */}
      {viewMode === "rotacion" ? (
        <RotationConfig onClose={() => setViewMode("chat")} />
      ) : (
        <div className="flex-1 flex overflow-hidden bg-slate-100">
          {/* Columna Izquierda: Listado de Chats */}
          <div
            className={`w-full md:w-[350px] bg-white border-r border-gray-100 flex flex-col shrink-0 overflow-hidden ${
              activeLeadId ? "hidden md:flex" : "flex"
            }`}
          >
            {/* Cabecera estilo WhatsApp */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-700 cursor-pointer p-1 rounded-lg hover:bg-gray-200/50"
                  onClick={() => window.dispatchEvent(new CustomEvent("toggle-mobile-sidebar"))}
                >
                  <FiMenu size={20} />
                </button>
                <h2 className="text-lg font-black text-gray-800">
                  Chats
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                {sessionUser.role === "admin" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setViewMode("rotacion")}
                      title="Configurar Reparto de Leads"
                      className="p-1 rounded-lg hover:bg-gray-200 text-pink-600 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FiRefreshCw size={14} className={(viewMode as string) === "rotacion" ? "animate-spin" : ""} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBotConfig(true)}
                      title="Configurar Bot de Bienvenida"
                      className="p-1 rounded-lg hover:bg-gray-200 text-purple-600 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <span className="text-sm">🤖</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRepliesManager(true)}
                      title="Gestionar Respuestas Rápidas"
                      className="p-1 rounded-lg hover:bg-gray-200 text-blue-600 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FiZap size={14} className="fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTagManager(true)}
                      title="Gestionar Etiquetas"
                      className="p-1 rounded-lg hover:bg-gray-200 text-amber-600 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FiTag size={14} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  title="Nuevo Prospecto"
                  className="p-1 rounded-lg hover:bg-gray-200 text-indigo-600 transition-colors flex items-center justify-center cursor-pointer"
                >
                  <FiPlus size={16} />
                </button>
              </div>
            </div>

            {/* Selector de Empresa/Marca (Dos CRMs independientes en uno) */}
            <div className="flex border-b border-gray-150 p-2 bg-slate-50/50 gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedEmpresa("Transavic")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-xl transition-all border cursor-pointer active:scale-98 ${
                  selectedEmpresa === "Transavic"
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-white text-gray-650 border-gray-200 hover:bg-gray-50"
                }`}
              >
                🐔 Transavic
              </button>
              <button
                type="button"
                onClick={() => setSelectedEmpresa("Avícola de Tony")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-xl transition-all border cursor-pointer active:scale-98 ${
                  selectedEmpresa === "Avícola de Tony"
                    ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                    : "bg-white text-gray-650 border-gray-200 hover:bg-gray-50"
                }`}
              >
                🥩 Avícola de Tony
              </button>
            </div>

            {/* Buscador y Filtros */}
            <div className="p-3 border-b border-gray-100 space-y-2 shrink-0 bg-gray-50/20">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar nombre o celular..."
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-150/60 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:bg-white text-gray-900 rounded-xl text-xs outline-none transition-all placeholder-gray-400"
                  />
                  <FiSearch className="absolute left-2.5 top-2.5 text-gray-400" size={13} />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      <FiX size={13} />
                    </button>
                  )}
                </div>

                <div className="relative overflow-visible shrink-0">
                  <button
                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer border ${
                      selectedAsesor !== "todos" ||
                      selectedEmpresa !== "todas" ||
                      selectedChatbot !== "todos" ||
                      selectedEstadoFilter !== "todos"
                        ? "bg-indigo-50 border-indigo-200 text-indigo-600"
                        : "bg-white hover:bg-gray-150 border-gray-200 text-gray-500"
                    }`}
                    title="Filtrar chats"
                  >
                    <FiFilter size={14} />
                  </button>

                  {showFilterMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40 bg-transparent"
                        onClick={() => setShowFilterMenu(false)}
                      ></div>
                      <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-2xl shadow-xl border border-gray-200 z-50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150 text-xs text-gray-700">
                        <div className="flex justify-between items-center pb-2 border-b border-gray-150">
                          <span className="font-bold text-gray-800">Filtros de Chat</span>
                          <button
                            onClick={() => {
                              setSelectedAsesor("todos");
                              setSelectedEmpresa("todas");
                              setSelectedChatbot("todos");
                              setSelectedEstadoFilter("todos");
                              setShowFilterMenu(false);
                            }}
                            className="text-[10px] text-indigo-600 hover:underline font-bold"
                          >
                            Limpiar
                          </button>
                        </div>

                        {/* Asesor */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Asesor</label>
                          <select
                            value={selectedAsesor}
                            onChange={(e) => setSelectedAsesor(e.target.value)}
                            className="w-full border border-gray-200 bg-white text-gray-800 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="todos">Todos</option>
                            <option value="sin_asignar">Sin Asignar</option>
                            {asesores.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Empresa/Marca */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Marca</label>
                          <select
                            value={selectedEmpresa}
                            onChange={(e) => setSelectedEmpresa(e.target.value)}
                            className="w-full border border-gray-200 bg-white text-gray-800 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="todas">Todas</option>
                            <option value="Transavic">Transavic</option>
                            <option value="Avícola de Tony">Avícola de Tony</option>
                          </select>
                        </div>

                        {/* Chatbot */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Chatbot IA</label>
                          <select
                            value={selectedChatbot}
                            onChange={(e) => setSelectedChatbot(e.target.value)}
                            className="w-full border border-gray-200 bg-white text-gray-800 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="todos">Todos</option>
                            <option value="activo">IA Activa</option>
                            <option value="inactivo">Humano</option>
                          </select>
                        </div>

                        {/* Estado Kanban */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Estado Comercial</label>
                          <select
                            value={selectedEstadoFilter}
                            onChange={(e) => setSelectedEstadoFilter(e.target.value)}
                            className="w-full border border-gray-200 bg-white text-gray-800 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="todos">Todos</option>
                            {ESTADOS_KANBAN.map((est) => (
                              <option key={est} value={est}>
                                {est}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Pestañas Rápidas */}
              <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none shrink-0">
                {[
                  { id: "todos", label: "Todos" },
                  { id: "mios", label: "Mis Leads" },
                  { id: "pendientes", label: "Pendientes" },
                  { id: "no_leidos", label: "No Leídos" },
                  { id: "ia", label: "Bot IA" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveChatTab(tab.id as typeof activeChatTab)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider shrink-0 transition-colors border cursor-pointer ${
                      activeChatTab === tab.id
                        ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                        : "bg-white border-gray-100 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Listado de Chats */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {filteredLeads.length === 0 ? (
                <div className="text-center py-20 px-4 text-xs text-gray-400">
                  <p className="italic">No se encontraron prospectos.</p>
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <FiPlus size={12} /> Nuevo Prospecto
                    </button>
                    {(searchQuery ||
                      activeChatTab !== "todos" ||
                      selectedAsesor !== "todos" ||
                      selectedEmpresa !== "todas" ||
                      selectedChatbot !== "todos" ||
                      selectedEstadoFilter !== "todos") && (
                      <button
                        onClick={() => {
                          setSearchQuery("");
                          setActiveChatTab("todos");
                          setSelectedAsesor("todos");
                          setSelectedEmpresa("todas");
                          setSelectedChatbot("todos");
                          setSelectedEstadoFilter("todos");
                        }}
                        className="text-[10px] text-indigo-600 hover:underline font-bold cursor-pointer"
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredLeads.map((lead) => {
                  const isActive = activeLeadId === lead.id;
                  return (
                    <div
                      key={lead.id}
                      onClick={() => {
                        setActiveLeadId(lead.id);
                        // Marcar como leído al hacer clic
                        if (lead.unread_count) {
                          fetch(`/api/crm/leads/${lead.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ unread_count: 0 }),
                          }).then(() => fetchLeadsAndAsesores());
                        }
                      }}
                      className={`p-3.5 flex gap-3 cursor-pointer hover:bg-slate-50 transition-colors relative group border-b border-gray-50 ${
                        isActive ? "bg-indigo-50/50 border-l-4 border-indigo-600" : ""
                      }`}
                    >
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 text-sm shrink-0">
                        {lead.nombre ? lead.nombre.substring(0, 2).toUpperCase() : "?"}
                      </div>

                      {/* Info de Fila */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-xs text-gray-800 truncate">{lead.nombre}</span>
                            {/* Mini tags de colores */}
                            {lead.tags && lead.tags.length > 0 && (
                              <div className="flex items-center -space-x-1 shrink-0">
                                {lead.tags.slice(0, 3).map((tId) => {
                                  const t = tagsMap[tId] || tagsMap[tId.toLowerCase()];
                                  if (!t) return null;
                                  return (
                                    <span
                                      key={tId}
                                      title={t.name}
                                      className="flex items-center justify-center relative"
                                    >
                                      <div
                                        className="w-3.5 h-2.5"
                                        style={{
                                          backgroundColor: t.color,
                                          clipPath: "polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%)",
                                        }}
                                      />
                                      <div className="absolute left-0.5 w-0.5 h-0.5 bg-white rounded-full opacity-80" />
                                    </span>
                                  );
                                })}
                                {lead.tags.length > 3 && (
                                  <div className="w-3 h-3 rounded-full bg-gray-150 flex items-center justify-center border border-gray-200/50 ml-1">
                                    <span className="text-[7px] text-gray-500 font-bold">+</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <span className="text-[9px] text-gray-400 shrink-0">
                            {new Date(lead.updated_at).toLocaleTimeString("es-PE", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-[10px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`text-[8px] font-black uppercase px-1.5 py-0.2 rounded-md shrink-0 ${
                                lead.empresa === "Transavic" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {lead.empresa}
                            </span>
                            {esBotEscribiendo(lead.bot_pensando_desde) ? (
                              <span className="text-[8px] font-black text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200 shrink-0 flex items-center gap-1">
                                <span className="flex gap-0.5" aria-hidden="true">
                                  <span className="h-1 w-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
                                  <span className="h-1 w-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
                                  <span className="h-1 w-1 rounded-full bg-indigo-500 animate-bounce" />
                                </span>
                                escribiendo
                              </span>
                            ) : lead.chatbot_activo ? (
                              <span className="text-[8px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-100 shrink-0">
                                🤖 IA
                              </span>
                            ) : (
                              <span className="text-[8px] font-black text-slate-500 bg-slate-50 px-1.5 py-0.2 rounded border border-slate-100 shrink-0">
                                👤 Humano
                              </span>
                            )}
                          </div>
                          {(lead.unread_count ?? 0) > 0 && (
                            <span className="bg-red-500 text-white font-black text-[9px] rounded-full px-1.5 py-0.5 shrink-0">
                              {lead.unread_count}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Hover Action Dropdown */}
                      <div className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveChatDropdown(activeChatDropdown === lead.id ? null : lead.id);
                          }}
                          className="p-1 rounded-full bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-700 shadow-sm border border-gray-200 cursor-pointer"
                        >
                          <FiChevronDown size={12} />
                        </button>
                        {activeChatDropdown === lead.id && (
                          <>
                            <div className="fixed inset-0 z-10 bg-transparent" onClick={(e) => { e.stopPropagation(); setActiveChatDropdown(null); }} />
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-150 z-20 py-1 font-semibold text-xs text-gray-700 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveChatDropdown(null);
                                  setActiveLeadId(lead.id);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                              >
                                <FiMessageSquare size={12} /> Abrir Chat
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveChatDropdown(null);
                                  // toggle unread count
                                  const newUnread = (lead.unread_count ?? 0) > 0 ? 0 : 1;
                                  fetch(`/api/crm/leads/${lead.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ unread_count: newUnread }),
                                  }).then(() => fetchLeadsAndAsesores());
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                              >
                                <FiCheck size={12} /> No Leído / Leído
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Columna Central: Conversación Activa */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
            {activeLeadId ? (
              <ChatPane
                leadId={activeLeadId}
                asesores={asesores}
                sessionUser={sessionUser}
                showRightPanel={showRightPanel}
                toggleRightPanel={() => setShowRightPanel(!showRightPanel)}
                onCloseChat={() => setActiveLeadId(null)}
                onRefreshLeads={fetchLeadsAndAsesores}
                onCreateOrder={handleOpenOrderModalForLead}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
                <FiMessageSquare size={52} className="mb-3 opacity-20" />
                <h3 className="font-bold text-slate-700 text-sm">Bandeja de Entrada</h3>
                <p className="text-xs text-center max-w-xs mt-1">
                  Selecciona una conversación del listado de la izquierda para comenzar a responder o gestionar.
                </p>
                <div className="w-full max-w-lg mt-6">
                  <GuiaModulo modulo="crm-leads" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Crear Lead */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
              <h3 className="font-bold text-gray-900 flex items-center gap-1.5">
                <FiUser className="text-indigo-600" /> Registrar Nuevo Prospecto
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <FiX size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="p-5 space-y-3.5 text-xs">
              {errorMsg && (
                <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700 font-medium">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Nombre</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={createForm.nombre}
                    onChange={(e) => setCreateForm({ ...createForm, nombre: e.target.value })}
                    placeholder="ej. Juan Restobar"
                    className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">WhatsApp</label>
                  <input
                    type="text"
                    required
                    value={createForm.telefono}
                    onChange={(e) => setCreateForm({ ...createForm, telefono: e.target.value })}
                    placeholder="ej. 987654321"
                    className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Negocio</label>
                  <input
                    type="text"
                    value={createForm.negocio}
                    onChange={(e) => setCreateForm({ ...createForm, negocio: e.target.value })}
                    placeholder="ej. Pollería"
                    className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Ciudad/Distrito</label>
                  <input
                    type="text"
                    value={createForm.ciudad}
                    onChange={(e) => setCreateForm({ ...createForm, ciudad: e.target.value })}
                    placeholder="ej. Miraflores"
                    className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Empresa/Marca</label>
                  <select
                    value={createForm.empresa}
                    onChange={(e) => setCreateForm({ ...createForm, empresa: e.target.value as "Transavic" | "Avícola de Tony" })}
                    className="w-full border border-gray-200 bg-white rounded-xl px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Transavic">Transavic</option>
                    <option value="Avícola de Tony">Avícola de Tony</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Asignar Asesora</label>
                  <select
                    value={createForm.vendedor_id || ""}
                    onChange={(e) => setCreateForm({ ...createForm, vendedor_id: e.target.value || "" })}
                    className="w-full border border-gray-200 bg-white rounded-xl px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">Sin Asignar</option>
                    {asesores.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase block">Notas Iniciales</label>
                <textarea
                  value={createForm.notas}
                  onChange={(e) => setCreateForm({ ...createForm, notas: e.target.value })}
                  placeholder="Detalles sobre el contacto, requerimientos o rubro..."
                  rows={2.5}
                  className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2.5 border-t border-gray-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingLead}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingLead ? "Registrando..." : "Registrar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Config Modales del CRM */}
      {showBotConfig && <WelcomeBotConfig onClose={() => setShowBotConfig(false)} />}
      {showRepliesManager && <QuickRepliesManager isOpen={showRepliesManager} onClose={() => setShowRepliesManager(false)} />}
      {showTagManager && <TagManager isOpen={showTagManager} onClose={() => setShowTagManager(false)} />}

      {/* Modal Registrar Pedido desde CRM */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center p-4 backdrop-blur-xs animate-in fade-in duration-250">
          <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[92vh] overflow-y-auto relative p-6 border border-gray-150 shadow-2xl flex flex-col animate-in scale-in duration-250">
            {/* Cabecera del Modal */}
            <div className="flex justify-between items-center pb-4 border-b border-gray-150 shrink-0">
              <div>
                <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                  <span>🛒</span> Registrar Pedido desde CRM
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Los datos del cliente se han prellenado automáticamente desde la conversación activa.
                </p>
              </div>
              <button
                onClick={() => setShowOrderModal(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors p-1.5 hover:bg-gray-100 rounded-xl cursor-pointer"
                aria-label="Cerrar"
              >
                <FiX size={20} />
              </button>
            </div>

            {/* Formulario */}
            <div className="flex-1 overflow-y-auto mt-4 pr-1">
              <PedidoForm
                asesores={asesores.map(a => ({ ...a, role: 'asesor' }))}
                currentUser={{
                  id: sessionUser.id,
                  name: sessionUser.name,
                  role: sessionUser.role,
                }}
              />
            </div>

            {/* Pie del modal: salida visible (además de la X del header) */}
            <div className="flex justify-end pt-4 mt-4 border-t border-gray-150 shrink-0">
              <button
                type="button"
                onClick={() => setShowOrderModal(false)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cerrar y volver al chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: ChatPane (Espacio Principal de Conversación e Historial)
// ─────────────────────────────────────────────────────────────────────────────
interface ChatPaneProps {
  leadId: string;
  asesores: { id: string; name: string }[];
  sessionUser: { id: string; name: string; role: string };
  showRightPanel: boolean;
  toggleRightPanel: () => void;
  onCloseChat: () => void;
  onRefreshLeads: () => void;
  onCreateOrder: (lead: Lead) => void;
}

function ChatPane({
  leadId,
  asesores,
  sessionUser,
  showRightPanel,
  toggleRightPanel,
  onCloseChat,
  onRefreshLeads,
  onCreateOrder,
}: ChatPaneProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [mensajes, setMensajes] = useState<LeadMensaje[]>([]);

  const botEscribiendo = useMemo(
    () => esBotEscribiendo(lead?.bot_pensando_desde),
    [lead?.bot_pensando_desde]
  );
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Modales
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showRecording, setShowRecording] = useState(false);

  // Selector respuestas rápidas flotante
  const [quickReplies, setQuickReplies] = useState<RespuestaRapida[]>([]);
  const [filteredReplies, setFilteredReplies] = useState<RespuestaRapida[]>([]);
  const [quickReplySelectedIndex, setQuickReplySelectedIndex] = useState(0);

  // Ficha derecha states
  const [editingNotes, setEditingNotes] = useState(false);
  const [guardandoFicha, setGuardandoFicha] = useState(false);
  const [togglingChatbot, setTogglingChatbot] = useState(false);
  const { mostrarToast, toasts } = useToast();
  const [notesTemp, setNotesTemp] = useState("");
  const [negocioTemp, setNegocioTemp] = useState("");
  const [ciudadTemp, setCiudadTemp] = useState("");
  const [globalTags, setGlobalTags] = useState<EtiquetaCrm[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Cargar detalles de lead y mensajes
  const loadLeadDetails = async () => {
    try {
      const [leadRes, msgRes, settingsRes] = await Promise.all([
        fetch(`/api/crm/leads/${leadId}`),
        fetch(`/api/crm/leads/${leadId}/mensajes`),
        fetch("/api/settings"),
      ]);

      if (leadRes.ok) {
        const leadData = await leadRes.json();
        setLead(leadData.lead);
        setNotesTemp(leadData.lead?.notas || "");
        setNegocioTemp(leadData.lead?.negocio || "");
        setCiudadTemp(leadData.lead?.ciudad || "");
      }
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setMensajes(msgData.mensajes || []);
      }
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setQuickReplies(settingsData.crm_quick_replies || []);
        setGlobalTags(settingsData.crm_tags || []);
      }
    } catch (e) {
      console.error("Error al cargar detalles del chat:", e);
    } finally {
      setLoading(false);
    }
  };

  // Carga INMEDIATA al abrir o cambiar de conversación: `usePollingVisible` solo
  // re-arranca su efecto si cambia `enabled`, no si cambia `leadId`, así que sin
  // esto el chat recién elegido se quedaría en blanco hasta el siguiente tick.
  useEffect(() => {
    if (leadId) loadLeadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Refresco del chat abierto cada 4 s, SOLO con la pestaña visible.
  usePollingVisible(loadLeadDetails, 4000, { enabled: !!leadId });

  // Scroll al final del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // Manejar cambios en el input de texto para respuestas rápidas
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewMessage(val);

    const match = val.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      const filterText = match[1].toLowerCase();
      const matched = quickReplies.filter((r) => r.shortcut.startsWith(filterText));
      setFilteredReplies(matched);
      setQuickReplySelectedIndex(0);
    } else {
      setFilteredReplies([]);
    }
  };

  // Manejar keydown para seleccionar respuestas rápidas con flechas
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (filteredReplies.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setQuickReplySelectedIndex((prev) => (prev + 1) % filteredReplies.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setQuickReplySelectedIndex((prev) => (prev - 1 + filteredReplies.length) % filteredReplies.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleSelectQuickReply(filteredReplies[quickReplySelectedIndex]);
      } else if (e.key === "Escape") {
        setFilteredReplies([]);
      }
    }
  };

  const handleSelectQuickReply = (reply: RespuestaRapida) => {
    // Reemplazar variables básicas
    const text = reply.text
      .replace(/{{nombre}}/g, lead?.nombre.split(" ")[0] || "cliente")
      .replace(/{{asesor}}/g, sessionUser.name.split(" ")[0] || "asesora");

    // Limpiar input y reemplazar el disparador "/"
    const lastSlashIndex = newMessage.lastIndexOf("/");
    let finalMsg = text;
    if (lastSlashIndex !== -1) {
      finalMsg = newMessage.substring(0, lastSlashIndex) + text;
    }

    setNewMessage(finalMsg);
    setFilteredReplies([]);
    inputRef.current?.focus();
  };

  // Enviar mensaje común
  const handleSendMessage = async (
    e?: React.FormEvent,
    customBody?: string,
    customType = "text",
    extra?: Record<string, unknown>
  ) => {
    if (e) e.preventDefault();
    const bodyToSend = customBody || newMessage;
    if (!bodyToSend.trim() || sending) return;

    setSending(true);
    if (!customBody) setNewMessage("");

    // Optimistic Update
    const tempMsg: LeadMensaje = {
      id: Date.now().toString(),
      lead_id: leadId,
      sender: sessionUser.name || "asesora",
      body: bodyToSend,
      type: customType,
      created_at: new Date(),
    };
    setMensajes((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch(`/api/crm/leads/${leadId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: bodyToSend, type: customType, ...(extra || {}) }),
      });

      const dataResp = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Mostrar el motivo real (ej. ventana de 24h cerrada) en vez de un genérico.
        throw new Error(dataResp?.error || "Error al enviar el mensaje.");
      }
      loadLeadDetails();
      onRefreshLeads();
    } catch (err) {
      console.error(err);
      mostrarToast(err instanceof Error ? err.message : "Error al enviar el mensaje.", "error");
      loadLeadDetails();
    } finally {
      setSending(false);
    }
  };

  // Enviar archivo adjunto (convertido a Base64)
  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let processedFile = file;
    // Comprimir si es imagen
    if (file.type.startsWith("image/")) {
      try {
        processedFile = await imageCompression(file, {
          maxSizeMB: 0.3,
          maxWidthOrHeight: 1200,
          useWebWorker: true,
        });
      } catch (err) {
        console.warn("Fallo compresión:", err);
      }
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      handleSendMessage(undefined, base64, file.type.startsWith("image/") ? "image" : "document");
    };
    reader.readAsDataURL(processedFile);
  };

  // Enviar nota de voz grabada
  const handleSendAudio = async (audioBlob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      handleSendMessage(undefined, base64, "audio");
    };
    reader.readAsDataURL(audioBlob);
    setShowRecording(false);
  };

  // Enviar plantilla oficial. El backend necesita el NOMBRE de la plantilla + idioma +
  // variables para mandar el template real a Meta; el previewText solo se guarda/renderiza.
  const handleSendTemplate = async (templateName: string, lang?: string, vars?: string[], file?: File, mediaType?: string, previewText?: string) => {
    if (previewText) {
      await handleSendMessage(undefined, previewText, "template", {
        templateName,
        language: lang || "es",
        variables: vars || [],
      });
    }
    setShowTemplateModal(false);
  };

  // Cambiar chatbot activo
  const handleToggleChatbot = async (active: boolean) => {
    if (!lead || togglingChatbot) return;
    setTogglingChatbot(true);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbot_activo: active }),
      });

      if (res.ok) {
        setLead({ ...lead, chatbot_activo: active });
        onRefreshLeads();
      } else {
        mostrarToast(`No se pudo cambiar a modo ${active ? "IA" : "Humano"}. Intenta de nuevo.`, "error");
      }
    } catch (e) {
      console.error(e);
      mostrarToast(`Sin conexión: no se pudo cambiar a modo ${active ? "IA" : "Humano"}.`, "error");
    } finally {
      setTogglingChatbot(false);
    }
  };

  // Cambiar vendedora asignada
  const handleChangeAsesor = async (asesorId: string) => {
    if (!lead) return;
    const newAsesorName = asesores.find((a) => a.id === asesorId)?.name || "Sin Asignar";
    if (!confirm(`¿Transferir este chat a ${newAsesorName}?`)) {
      const selectEl = document.getElementById("select-vendedor") as HTMLSelectElement | null;
      if (selectEl) selectEl.value = lead.vendedor_id || "";
      return;
    }
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedor_id: asesorId || null }),
      });

      if (res.ok) {
        setLead({ ...lead, vendedor_id: asesorId || null });
        onRefreshLeads();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Guardar ficha derecha (Notas, Negocio, Ciudad)
  const handleSaveDetails = async () => {
    if (!lead || guardandoFicha) return;
    setGuardandoFicha(true);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notas: notesTemp,
          negocio: negocioTemp,
          ciudad: ciudadTemp,
        }),
      });

      if (res.ok) {
        setLead({ ...lead, notas: notesTemp, negocio: negocioTemp, ciudad: ciudadTemp });
        setEditingNotes(false);
        onRefreshLeads();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGuardandoFicha(false);
    }
  };

  // Descartar cambios de la ficha y salir del modo edición
  const handleCancelDetails = () => {
    setNotesTemp(lead?.notas || "");
    setNegocioTemp(lead?.negocio || "");
    setCiudadTemp(lead?.ciudad || "");
    setEditingNotes(false);
  };

  // Guardar etiquetas asociadas al lead
  const handleSaveLeadTags = async (newTags: string[]) => {
    if (!lead) return;
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: newTags }),
      });

      if (res.ok) {
        setLead({ ...lead, tags: newTags });
        onRefreshLeads();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden h-full relative">
      {/* Workspace de Chat */}
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        {/* Chat Header */}
        <div className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-4 shrink-0 shadow-2xs z-10">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onCloseChat} className="md:hidden text-gray-500 mr-1 p-1 rounded-full hover:bg-gray-100">
              <FiChevronLeft size={20} />
            </button>
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-xs text-slate-700 shrink-0">
              {lead?.nombre ? lead.nombre.substring(0, 2).toUpperCase() : "?"}
            </div>
            <div className="min-w-0 group">
              <h4 className="font-bold text-xs text-gray-800 flex items-center gap-1.5 truncate">
                {lead?.nombre}
                <span
                  className={`text-[8px] font-black uppercase px-1.5 py-0.2 rounded-md ${
                    lead?.empresa === "Transavic" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {lead?.empresa}
                </span>
              </h4>
              <p
                onClick={() => {
                  if (lead?.telefono) {
                    navigator.clipboard.writeText(lead.telefono);
                    setCopiedPhone(true);
                    setTimeout(() => setCopiedPhone(false), 1500);
                  }
                }}
                className="text-[10px] text-gray-400 mt-0.5 truncate cursor-pointer hover:text-indigo-600 flex items-center gap-1 transition-colors select-all"
                title="Clic para copiar número"
              >
                {copiedPhone ? (
                  <span className="text-green-600 font-bold flex items-center gap-0.5 select-none">
                    <FiCheck size={10} className="shrink-0" /> ¡Copiado!
                  </span>
                ) : (
                  <>
                    <span>{lead?.telefono}</span>
                    <FiCopy size={9} className="opacity-40 group-hover:opacity-100 shrink-0 transition-opacity" />
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Direct Calls */}
            <a
              href={`tel:${lead?.telefono}`}
              className="p-2 bg-indigo-50 border border-indigo-100/50 hover:bg-indigo-100/50 rounded-xl text-indigo-600 transition-colors cursor-pointer hidden sm:block"
              title="Llamar por teléfono"
            >
              <FiPhone size={14} />
            </a>
 
            {/* Chatbot Active Switch */}
            <div className="flex bg-gray-150/65 p-0.5 rounded-lg border border-gray-200/50 text-[10px]">
              <button
                type="button"
                onClick={() => handleToggleChatbot(true)}
                disabled={togglingChatbot}
                className={`px-2 py-1 font-black rounded flex items-center gap-0.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
                  lead?.chatbot_activo ? "bg-purple-600 text-white shadow-2xs" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                🤖 IA
              </button>
              <button
                type="button"
                onClick={() => handleToggleChatbot(false)}
                disabled={togglingChatbot}
                className={`px-2 py-1 font-black rounded flex items-center gap-0.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
                  !lead?.chatbot_activo ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                👤 Humano
              </button>
            </div>
 
            <button
              onClick={toggleRightPanel}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                showRightPanel
                  ? "bg-indigo-50 border-indigo-100 text-indigo-600"
                  : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
              }`}
              title="Ficha del Cliente"
            >
              <FiInfo size={14} />
            </button>
          </div>
        </div>

        {/* Message Feed Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#efeae2] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] select-none">
          {mensajes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs py-20 bg-white/70 backdrop-blur-2xs rounded-3xl p-6 border border-gray-150/40">
              <FiMessageSquare size={36} className="mb-2 opacity-30" />
              <p>No hay mensajes. Saluda al cliente o dispara una plantilla.</p>
              <button
                type="button"
                onClick={() => setShowTemplateModal(true)}
                className="mt-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
              >
                <FiBookOpen size={12} /> Enviar Plantilla
              </button>
            </div>
          ) : (
            mensajes.map((m, idx, arr) => {
              const prevMsg = arr[idx - 1];
              const showDateSeparator =
                idx === 0 ||
                isDifferentDay(
                  prevMsg?.created_at,
                  m.created_at
                );

              const isMe = m.sender !== "cliente" && m.sender !== "bot";
              const isBot = m.sender === "bot";
              const timeStr = new Date(m.created_at).toLocaleTimeString("es-PE", {
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div key={m.id || idx} className="flex flex-col w-full">
                  {showDateSeparator && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white/95 backdrop-blur-xs text-gray-500 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-2xs border border-gray-150">
                        {formatDateSeparator(m.created_at)}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col ${isMe || isBot ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5 text-[9px] font-bold text-gray-400">
                      <span className="capitalize">{m.sender === "bot" ? "Bot IA" : m.sender}</span>
                      <span>•</span>
                      <span>{timeStr}</span>
                      {(isMe || isBot) && m.estado && (
                        <span
                          className={
                            m.estado === "leido"
                              ? "text-sky-500"
                              : m.estado === "fallido"
                              ? "text-red-500"
                              : "text-gray-400"
                          }
                          title={
                            m.estado === "fallido"
                              ? m.error_msg || "No se pudo entregar"
                              : m.estado === "leido"
                              ? "Leído"
                              : m.estado === "entregado"
                              ? "Entregado"
                              : "Enviado"
                          }
                        >
                          {m.estado === "fallido" ? "⚠" : m.estado === "enviado" ? "✓" : "✓✓"}
                        </span>
                      )}
                    </div>

                    <div
                      className={`max-w-[80%] rounded-2xl p-3 text-xs leading-relaxed ${
                        isMe
                          ? "bg-[#d9fdd3] text-gray-800 border border-[#c4eabf]/60 rounded-tr-none shadow-2xs"
                          : isBot
                          ? "bg-[#e0f0ff] text-indigo-950 border border-indigo-200 rounded-tr-none shadow-2xs"
                          : "bg-white text-gray-800 border border-gray-150 rounded-tl-none shadow-2xs"
                      }`}
                    >
                      {isBot && (
                        <div className="flex items-center gap-1 mb-1 text-[9px] font-extrabold uppercase tracking-wide text-indigo-600">
                          <FiActivity size={10} className="shrink-0 animate-pulse" />
                          <span>Asistente IA</span>
                        </div>
                      )}

                      {/* Rendering attachments */}
                      {m.type === "image" && m.body.startsWith("data:image/") ? (
                        <div className="space-y-1.5">
                          <img src={m.body} alt="Imagen adjunta" className="rounded-lg max-w-full max-h-60 object-cover shadow-2xs border border-gray-100" />
                        </div>
                      ) : m.type === "audio" && m.body.startsWith("data:audio/") ? (
                        <audio src={m.body} controls className="h-9 w-52 rounded-md focus:outline-none" />
                      ) : (
                        <span className="whitespace-pre-wrap">{m.body}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* El bot está generando la respuesta. Evita que la asesora conteste
              encima del bot y le duplique mensajes al cliente. */}
          {botEscribiendo && (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1.5 mb-0.5 text-[9px] font-bold text-indigo-400">
                <span>Bot IA</span>
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-tr-none border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" />
                  </span>
                  <span className="text-[11px] font-semibold text-indigo-700">
                    El bot está escribiendo…
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-white border-t border-gray-100 shrink-0 relative flex flex-col gap-2">
          {/* Quick Replies Autocomplete Selector */}
          {filteredReplies.length > 0 && (
            <QuickReplySelector
              replies={filteredReplies}
              filterText={newMessage}
              onSelect={handleSelectQuickReply}
              onClose={() => setFilteredReplies([])}
              selectedIndex={quickReplySelectedIndex}
            />
          )}
 
          {/* Grabadóra de Voz */}
          {showRecording ? (
            <div className="bg-gray-100/80 px-4 py-2 flex items-center w-full border border-gray-200 rounded-xl">
              <AudioRecorder onSend={handleSendAudio} onCancel={() => setShowRecording(false)} />
            </div>
          ) : (
            <form onSubmit={(e) => handleSendMessage(e)} className="flex items-end gap-2 w-full pt-1 px-1 pb-1">
              {/* Main WhatsApp input pill wrapper */}
              <div className="flex-1 flex items-center gap-1.5 bg-white rounded-2xl border border-gray-250/60 shadow-xs px-3 py-1.5 relative transition-all duration-200 focus-within:border-indigo-400">
                {/* Zap button */}
                <button
                  type="button"
                  onClick={() => {
                    const match = newMessage.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
                    if (match) {
                      setFilteredReplies([]);
                    } else {
                      const newVal = newMessage.endsWith(" ") || newMessage === "" ? newMessage + "/" : newMessage + " /";
                      setNewMessage(newVal);
                      setFilteredReplies(quickReplies);
                      setQuickReplySelectedIndex(0);
                    }
                  }}
                  className="p-1.5 text-gray-400 hover:text-blue-500 rounded-full hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
                  title="Respuestas Rápidas (/)"
                >
                  <FiZap size={15} />
                </button>
 
                {/* Textarea for auto-resize */}
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={newMessage}
                  onChange={(e) => {
                    handleInputChange(e);
                    // auto-resize height dynamically
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    } else {
                      handleKeyDown(e);
                    }
                  }}
                  placeholder={
                    lead?.chatbot_activo
                      ? "Chatbot activo. Escribe para pausarlo y responder..."
                      : "Escribe un mensaje... (escribe / para ver atajos)"
                  }
                  className="flex-1 min-w-0 bg-transparent border-none py-1 px-1 text-xs text-gray-800 placeholder-gray-400 focus:outline-none resize-none leading-relaxed"
                  style={{ maxHeight: "120px", overflowY: "auto" }}
                />
 
                {/* File Attachment Input & Clip Icon */}
                <label className="p-1.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors cursor-pointer flex items-center justify-center shrink-0">
                  <FiPaperclip size={15} className="rotate-45" />
                  <input type="file" onChange={handleFileAttach} className="hidden" accept="image/*,application/pdf" />
                </label>
 
                {/* Template Button */}
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="p-1.5 text-gray-400 hover:text-green-600 rounded-full hover:bg-gray-100 transition-colors shrink-0 cursor-pointer"
                  title="Enviar Plantilla"
                >
                  <FiBookOpen size={15} />
                </button>
              </div>

              {/* Action Button (Mic or Send) */}
              <div className="flex items-end justify-center shrink-0">
                {newMessage.trim() ? (
                  <button
                    type="submit"
                    disabled={sending}
                    className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-600 text-white shadow-md flex items-center justify-center transition-all active:scale-95 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <FiSend size={15} className="ml-0.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowRecording(true)}
                    className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-600 text-white shadow-md flex items-center justify-center transition-all active:scale-95 shrink-0 cursor-pointer"
                    title="Grabar nota de voz"
                  >
                    <FiMic size={15} />
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Ficha Lateral Derecha: Detalles del Cliente */}
      {showRightPanel && (
        <div className="w-72 bg-white border-l border-gray-100 flex flex-col overflow-y-auto p-4 space-y-4 shrink-0 h-full shadow-lg z-20 select-none">
          <div className="flex justify-between items-center pb-2 border-b border-gray-100">
            <span className="font-extrabold text-xs text-gray-700 uppercase tracking-wider flex items-center gap-1">
              <FiBookOpen size={13} /> Detalle de Contacto
            </span>
            <button
              onClick={toggleRightPanel}
              className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-150"
            >
              <FiX size={16} />
            </button>
          </div>

          {/* Formulario / Info */}
          <div className="space-y-4 text-xs">
            {/* Nombre y Negocio */}
            <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100/50 space-y-2.5">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Nombre</span>
                <span className="font-bold text-gray-800 text-xs block">{lead?.nombre}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Teléfono / WhatsApp</span>
                <span className="font-bold text-gray-700 text-xs block">{lead?.telefono}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Empresa</span>
                <span className="font-black text-gray-700 text-[10px] uppercase block">{lead?.empresa}</span>
              </div>
            </div>

            {/* Ficha de Contacto Header */}
            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Ficha de Contacto</span>
              {editingNotes ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelDetails}
                    disabled={guardandoFicha}
                    className="text-[9px] text-gray-400 font-bold hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveDetails}
                    disabled={guardandoFicha}
                    className="text-[9px] text-emerald-600 font-bold hover:underline cursor-pointer flex items-center gap-0.5 disabled:opacity-50"
                  >
                    {guardandoFicha ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingNotes(true)}
                  className="text-[9px] text-indigo-600 font-bold hover:underline cursor-pointer flex items-center gap-1"
                >
                  <FiEdit size={9} /> Editar Ficha
                </button>
              )}
            </div>

            {/* Asignación de Vendedora (Reasignar Chat) */}
            <div className="space-y-1 bg-amber-50/50 p-2.5 rounded-xl border border-amber-100/50">
              <label className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                Reasignar Chat
              </label>
              <p className="text-[9px] text-gray-400 leading-normal mb-1">
                Transfiere este chat a otra asesora. Desaparecerá de tu lista.
              </p>
              <select
                id="select-vendedor"
                value={lead?.vendedor_id || ""}
                onChange={(e) => handleChangeAsesor(e.target.value)}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                <option value="">Sin Asignar</option>
                {asesores.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Negocio y Distrito Editables */}
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Negocio / Rubro</label>
                <div 
                  onClick={() => { if (!editingNotes) setEditingNotes(true); }}
                  className="relative group cursor-pointer"
                >
                  <select
                    value={negocioTemp || ""}
                    disabled={!editingNotes}
                    onChange={(e) => setNegocioTemp(e.target.value)}
                    className={`w-full border rounded-lg px-2.5 py-1 text-[10px] outline-none transition-all appearance-none cursor-pointer ${
                      editingNotes
                        ? "border-indigo-500 bg-white text-gray-800 focus:ring-1 focus:ring-indigo-500"
                        : "border-gray-200 bg-gray-50 text-gray-500 pointer-events-none"
                    }`}
                  >
                    <option value="">Sin Clasificar</option>
                    {RUBROS_CRM.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <FiChevronDown size={10} />
                  </div>
                  {!editingNotes && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-indigo-500 font-bold flex items-center gap-0.5 pointer-events-none bg-gray-50 px-1">
                      <FiEdit size={8} /> Click para editar
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Ciudad / Distrito</label>
                <div 
                  onClick={() => { if (!editingNotes) setEditingNotes(true); }}
                  className="relative group cursor-pointer"
                >
                  <select
                    value={ciudadTemp || ""}
                    disabled={!editingNotes}
                    onChange={(e) => setCiudadTemp(e.target.value)}
                    className={`w-full border rounded-lg px-2.5 py-1 text-[10px] outline-none transition-all appearance-none cursor-pointer ${
                      editingNotes
                        ? "border-indigo-500 bg-white text-gray-800 focus:ring-1 focus:ring-indigo-500"
                        : "border-gray-200 bg-gray-50 text-gray-500 pointer-events-none"
                    }`}
                  >
                    <option value="">Sin Clasificar</option>
                    {DISTRITOS_CRM.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <FiChevronDown size={10} />
                  </div>
                  {!editingNotes && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-indigo-500 font-bold flex items-center gap-0.5 pointer-events-none bg-gray-50 px-1">
                      <FiEdit size={8} /> Click para editar
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tag Selector */}
            {lead && (
              <TagSelector
                leadId={leadId}
                assignedTags={lead.tags || []}
                globalTags={globalTags}
                onSaveTags={handleSaveLeadTags}
              />
            )}

            {/* Notas Internas */}
            <div className="bg-white border border-gray-150 rounded-2xl p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  Notas Internas:
                </span>
                {editingNotes ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelDetails}
                      disabled={guardandoFicha}
                      className="text-[9px] text-gray-400 font-bold hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveDetails}
                      disabled={guardandoFicha}
                      className="text-[9px] text-emerald-600 font-bold hover:underline cursor-pointer flex items-center gap-0.5 disabled:opacity-50"
                    >
                      {guardandoFicha ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingNotes(true)}
                    className="text-[9px] text-indigo-600 font-bold hover:underline cursor-pointer"
                  >
                    Editar Ficha
                  </button>
                )}
              </div>
              {editingNotes ? (
                <textarea
                  value={notesTemp}
                  onChange={(e) => setNotesTemp(e.target.value)}
                  className="w-full border border-gray-200 bg-white rounded-lg p-2 text-[10px] outline-none resize-none"
                  rows={3}
                />
              ) : (
                <p className="text-[10px] text-gray-600 italic leading-relaxed whitespace-pre-wrap">
                  {lead?.notas || "Sin anotaciones internas sobre este cliente."}
                </p>
              )}
            </div>

            {/* Botón de Venta Directa a Pedido */}
            {lead && (
              <div className="pt-2 border-t border-gray-100">
                <a
                  href={`/dashboard/nuevo-pedido?nombre=${encodeURIComponent(lead.nombre)}&whatsapp=${encodeURIComponent(
                    lead.telefono
                  )}&empresa=${encodeURIComponent(lead.empresa)}&distrito=${encodeURIComponent(
                    lead.ciudad || ""
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2 font-bold text-xs cursor-pointer shadow-xs transition-all active:scale-95"
                >
                  <FiExternalLink size={12} /> Registrar Pedido Venta
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Envío de Plantillas */}
      {showTemplateModal && (
        <TemplateModal
          isOpen={showTemplateModal}
          onClose={() => setShowTemplateModal(false)}
          onSend={handleSendTemplate}
          leadName={lead?.nombre || ""}
          userName={sessionUser.name || ""}
        />
      )}

      {/* Toasts de feedback (fixed → print:hidden ya incluido en el componente) */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

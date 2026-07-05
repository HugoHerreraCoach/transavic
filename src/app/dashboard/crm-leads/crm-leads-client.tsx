// src/app/dashboard/crm-leads/crm-leads-client.tsx
"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import {
  FiTarget,
  FiUser,
  FiMessageSquare,
  FiCheck,
  FiPlus,
  FiTrash2,
  FiSend,
  FiActivity,
  FiX,
  FiPhone,
  FiMapPin,
  FiBriefcase,
  FiInfo,
  FiSave,
  FiBookOpen,
  FiChevronLeft,
  FiChevronRight,
  FiSearch,
  FiFilter,
  FiBell,
  FiTag,
  FiPaperclip,
  FiMic,
  FiSmile,
  FiZap,
  FiExternalLink,
  FiCheckSquare,
  FiMenu,
  FiChevronDown,
  FiMoreVertical,
  FiClock,
  FiUserPlus,
  FiCopy,
  FiRefreshCw,
} from "react-icons/fi";
import { Lead, LeadEstado, LeadMensaje, User } from "@/lib/types";

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
import imageCompression from "browser-image-compression";

// Columnas fijas del Kanban
const ESTADOS_KANBAN: LeadEstado[] = ["Nuevo", "Contactado", "Calificado", "Propuesta", "Cerrado", "Perdido"];

const COLORES_ESTADO: Record<LeadEstado, { bg: string; border: string; text: string; headerBg: string }> = {
  Nuevo: { bg: "bg-slate-50/70", border: "border-slate-200", text: "text-slate-700", headerBg: "bg-slate-200/80" },
  Contactado: { bg: "bg-sky-50/70", border: "border-sky-200", text: "text-sky-700", headerBg: "bg-sky-200/80" },
  Calificado: { bg: "bg-amber-50/70", border: "border-amber-200", text: "text-amber-700", headerBg: "bg-amber-200/80" },
  Propuesta: { bg: "bg-indigo-50/70", border: "border-indigo-200", text: "text-indigo-700", headerBg: "bg-indigo-200/80" },
  Cerrado: { bg: "bg-emerald-50/70", border: "border-emerald-200", text: "text-emerald-700", headerBg: "bg-emerald-200/80" },
  Perdido: { bg: "bg-rose-50/70", border: "border-rose-200", text: "text-rose-700", headerBg: "bg-rose-200/80" },
};

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

export default function CrmLeadsClient({ sessionUser }: CrmLeadsClientProps) {
  // Configuración de vista
  const [viewMode, setViewMode] = useState<"chat" | "kanban" | "rotacion">("chat");

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

  useEffect(() => {
    fetchLeadsAndAsesores();
    setMounted(true);

    // Polling general de la lista cada 15 segundos para mantener notificaciones y snippets al día
    const interval = setInterval(fetchLeadsAndAsesores, 15000);
    return () => clearInterval(interval);
  }, []);

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
  const boardData = useMemo(() => {
    const columns: Record<LeadEstado, Lead[]> = {
      Nuevo: [],
      Contactado: [],
      Calificado: [],
      Propuesta: [],
      Cerrado: [],
      Perdido: [],
    };
    filteredLeads.forEach((l) => {
      if (columns[l.estado]) {
        columns[l.estado].push(l);
      }
    });
    return columns;
  }, [filteredLeads]);

  // Manejar Drag & Drop Kanban
  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newEstado = destination.droppableId as LeadEstado;
    const targetLeadId = draggableId;

    // Optimistic Update
    const updatedLeads = leads.map((l) =>
      l.id === targetLeadId ? { ...l, estado: newEstado, updated_at: new Date() } : l
    );
    setLeads(updatedLeads);

    try {
      const response = await fetch(`/api/crm/leads/${targetLeadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: newEstado }),
      });

      if (!response.ok) throw new Error("Transition save failed");
    } catch (e) {
      console.error(e);
      fetchLeadsAndAsesores();
    }
  };

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
  const stats = useMemo(() => {
    return {
      total: leads.length,
      nuevos: leads.filter((l) => l.estado === "Nuevo").length,
      contactados: leads.filter((l) => l.estado === "Contactado").length,
      chatbotActivos: leads.filter((l) => l.chatbot_activo).length,
      cerrados: leads.filter((l) => l.estado === "Cerrado").length,
    };
  }, [leads]);

  if (!mounted) return null;

  return (
    <div className={`flex flex-col w-full overflow-hidden transition-all duration-300 ${
      viewMode === "chat" ? "h-screen bg-slate-50 dark:bg-slate-950" : "h-[calc(100vh-64px)] lg:h-[calc(100vh-16px)] bg-gray-50/30 dark:bg-slate-900/10"
    }`}>
      {/* Header General del CRM - Solo visible en Kanban */}
      {viewMode === "kanban" && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-800 p-4 border-b border-gray-100 dark:border-slate-700 shrink-0 gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <FiTarget className="text-indigo-600 dark:text-indigo-400" /> Centro de Clientes y CRM
            </h1>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
              Conversa con tus prospectos, asigna vendedoras y monitorea el Chatbot de Inteligencia Artificial.
            </p>
          </div>

          {/* Controles de vista y acciones */}
          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            {/* Selector de Empresa/Marca */}
            <div className="flex bg-gray-150/65 dark:bg-slate-700/55 p-0.5 rounded-xl border border-gray-200/50 dark:border-slate-600/50">
              <button
                onClick={() => setSelectedEmpresa("Transavic")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                  selectedEmpresa === "Transavic"
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                }`}
              >
                🐔 Transavic
              </button>
              <button
                onClick={() => setSelectedEmpresa("Avícola de Tony")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                  selectedEmpresa === "Avícola de Tony"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                }`}
              >
                🥩 Avícola de Tony
              </button>
            </div>

            {/* Selector de Vista (Chat vs Kanban) */}
            <div className="flex bg-gray-150/65 dark:bg-slate-700/55 p-0.5 rounded-xl border border-gray-200/50 dark:border-slate-600/50">
              <button
                onClick={() => setViewMode("chat")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                  (viewMode as string) === "chat" ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-sm" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <FiMessageSquare size={13} /> Chat Inbox
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                  (viewMode as string) === "kanban" ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-sm" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <FiCheckSquare size={13} /> Kanban
              </button>
            </div>

            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-3 py-1.5 font-bold text-xs cursor-pointer shadow-md transition-all active:scale-95"
            >
              <FiPlus size={13} /> Nuevo Prospecto
            </button>
          </div>
        </div>
      )}

      {/* RENDER VISTA ROTACIÓN / CHAT INTERACTIVA */}
      {viewMode === "rotacion" ? (
        <RotationConfig onClose={() => setViewMode("chat")} />
      ) : viewMode === "chat" ? (
        <div className="flex-1 flex overflow-hidden bg-slate-100 dark:bg-slate-950">
          {/* Columna Izquierda: Listado de Chats */}
          <div
            className={`w-full md:w-[350px] bg-white dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800 flex flex-col shrink-0 overflow-hidden ${
              activeLeadId ? "hidden md:flex" : "flex"
            }`}
          >
            {/* Cabecera estilo WhatsApp */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer p-1 rounded-lg hover:bg-gray-200/50 dark:hover:bg-slate-700/50"
                  onClick={() => window.dispatchEvent(new CustomEvent("toggle-mobile-sidebar"))}
                >
                  <FiMenu size={20} />
                </button>
                <h2 className="text-lg font-black text-gray-800 dark:text-gray-100">
                  Chats
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Botón para alternar a vista Kanban */}
                <button
                  type="button"
                  onClick={() => setViewMode("kanban")}
                  title="Ver Tablero Kanban"
                  className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 transition-colors flex items-center justify-center cursor-pointer"
                >
                  <FiCheckSquare size={16} />
                </button>

                {sessionUser.role === "admin" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setViewMode("rotacion")}
                      title="Configurar Rotación de Leads"
                      className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-pink-600 dark:text-pink-400 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FiRefreshCw size={14} className={(viewMode as string) === "rotacion" ? "animate-spin" : ""} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBotConfig(true)}
                      title="Configurar Bot de Bienvenida"
                      className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-purple-600 dark:text-purple-400 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <span className="text-sm">🤖</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRepliesManager(true)}
                      title="Gestionar Respuestas Rápidas"
                      className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FiZap size={14} className="fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTagManager(true)}
                      title="Gestionar Etiquetas"
                      className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FiTag size={14} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  title="Nuevo Prospecto"
                  className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 transition-colors flex items-center justify-center cursor-pointer"
                >
                  <FiPlus size={16} />
                </button>
              </div>
            </div>

            {/* Selector de Empresa/Marca (Dos CRMs independientes en uno) */}
            <div className="flex border-b border-gray-150 dark:border-slate-800 p-2 bg-slate-50/50 dark:bg-slate-800/10 gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedEmpresa("Transavic")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-xl transition-all border cursor-pointer active:scale-98 ${
                  selectedEmpresa === "Transavic"
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-white dark:bg-slate-900 text-gray-650 dark:text-gray-400 border-gray-200 dark:border-slate-800 hover:bg-gray-50"
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
                    : "bg-white dark:bg-slate-900 text-gray-650 dark:text-gray-400 border-gray-200 dark:border-slate-800 hover:bg-gray-50"
                }`}
              >
                🥩 Avícola de Tony
              </button>
            </div>

            {/* Buscador y Filtros */}
            <div className="p-3 border-b border-gray-100 dark:border-slate-800 space-y-2 shrink-0 bg-gray-50/20 dark:bg-slate-800/10">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar nombre o celular..."
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-150/60 dark:bg-slate-800 border border-transparent hover:border-gray-200 dark:hover:border-slate-700 focus:border-indigo-500 dark:focus:border-indigo-400 focus:bg-white dark:focus:bg-slate-750 text-gray-900 dark:text-gray-100 rounded-xl text-xs outline-none transition-all placeholder-gray-400 dark:placeholder-gray-500"
                  />
                  <FiSearch className="absolute left-2.5 top-2.5 text-gray-400 dark:text-gray-500" size={13} />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
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
                        ? "bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400"
                        : "bg-white dark:bg-slate-800 hover:bg-gray-150 dark:hover:bg-slate-700 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400"
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
                      <div className="absolute right-0 mt-1.5 w-64 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-200 dark:border-slate-700 z-50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150 text-xs text-gray-700 dark:text-gray-300">
                        <div className="flex justify-between items-center pb-2 border-b border-gray-150 dark:border-slate-700">
                          <span className="font-bold text-gray-800 dark:text-gray-100">Filtros de Chat</span>
                          <button
                            onClick={() => {
                              setSelectedAsesor("todos");
                              setSelectedEmpresa("todas");
                              setSelectedChatbot("todos");
                              setSelectedEstadoFilter("todos");
                              setShowFilterMenu(false);
                            }}
                            className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-bold"
                          >
                            Limpiar
                          </button>
                        </div>

                        {/* Asesor */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Asesor</label>
                          <select
                            value={selectedAsesor}
                            onChange={(e) => setSelectedAsesor(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-indigo-400"
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
                          <label className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Marca</label>
                          <select
                            value={selectedEmpresa}
                            onChange={(e) => setSelectedEmpresa(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                          >
                            <option value="todas">Todas</option>
                            <option value="Transavic">Transavic</option>
                            <option value="Avícola de Tony">Avícola de Tony</option>
                          </select>
                        </div>

                        {/* Chatbot */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Chatbot IA</label>
                          <select
                            value={selectedChatbot}
                            onChange={(e) => setSelectedChatbot(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                          >
                            <option value="todos">Todos</option>
                            <option value="activo">IA Activa</option>
                            <option value="inactivo">Humano</option>
                          </select>
                        </div>

                        {/* Estado Kanban */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Estado Comercial</label>
                          <select
                            value={selectedEstadoFilter}
                            onChange={(e) => setSelectedEstadoFilter(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-indigo-400"
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
                        : "bg-white dark:bg-slate-850 border-gray-100 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-750 hover:text-gray-700 dark:hover:text-gray-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Listado de Chats */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50 dark:divide-slate-800/40">
              {filteredLeads.length === 0 ? (
                <div className="text-center py-20 text-xs text-gray-400 dark:text-gray-500 italic">No se encontraron prospectos.</div>
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
                      className={`p-3.5 flex gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative group border-b border-gray-50 dark:border-slate-800/40 ${
                        isActive ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-l-4 border-indigo-600" : ""
                      }`}
                    >
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-sm shrink-0">
                        {lead.nombre ? lead.nombre.substring(0, 2).toUpperCase() : "?"}
                      </div>

                      {/* Info de Fila */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-xs text-gray-800 dark:text-gray-100 truncate">{lead.nombre}</span>
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
                                  <div className="w-3 h-3 rounded-full bg-gray-150 dark:bg-slate-800 flex items-center justify-center border border-gray-200/50 dark:border-slate-700 ml-1">
                                    <span className="text-[7px] text-gray-500 dark:text-gray-400 font-bold">+</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <span className="text-[9px] text-gray-400 dark:text-gray-500 shrink-0">
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
                                lead.empresa === "Transavic" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                              }`}
                            >
                              {lead.empresa}
                            </span>
                            {lead.chatbot_activo ? (
                              <span className="text-[8px] font-black text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 px-1.5 py-0.2 rounded border border-purple-100 dark:border-purple-900/40 shrink-0">
                                🤖 IA
                              </span>
                            ) : (
                              <span className="text-[8px] font-black text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.2 rounded border border-slate-100 dark:border-slate-700 shrink-0">
                                👤 Humano
                              </span>
                            )}
                          </div>
                          {(lead.unread_count ?? 0) > 0 && (
                            <span className="bg-red-500 dark:bg-red-600 text-white font-black text-[9px] rounded-full px-1.5 py-0.5 shrink-0">
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
                          className="p-1 rounded-full bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shadow-sm border border-gray-200 dark:border-slate-700 cursor-pointer"
                        >
                          <FiChevronDown size={12} />
                        </button>
                        {activeChatDropdown === lead.id && (
                          <>
                            <div className="fixed inset-0 z-10 bg-transparent" onClick={(e) => { e.stopPropagation(); setActiveChatDropdown(null); }} />
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-150 dark:border-slate-700 z-20 py-1 font-semibold text-xs text-gray-700 dark:text-gray-300 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveChatDropdown(null);
                                  setActiveLeadId(lead.id);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
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
                                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
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
                <h3 className="font-bold text-gray-700 text-sm">Bandeja de Entrada</h3>
                <p className="text-xs text-center max-w-xs mt-1">
                  Selecciona una conversación del listado de la izquierda para comenzar a responder o gestionar.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* RENDER VISTA KANBAN (BOARD CON DRAG AND DROP) */
        <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-4 bg-gray-50/30">
          <div className="shrink-0">
            <GuiaModulo modulo="crm-leads" />
          </div>

          {/* Tarjetas de Métricas Rápidas */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 shrink-0">
            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Total Leads</span>
              <span className="text-xl font-black text-gray-900 block mt-0.5">{stats.total}</span>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Nuevos</span>
              <span className="text-xl font-black text-slate-600 block mt-0.5">{stats.nuevos}</span>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Contactados</span>
              <span className="text-xl font-black text-sky-600 block mt-0.5">{stats.contactados}</span>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">IA Activa</span>
              <span className="text-xl font-black text-purple-600 block mt-0.5">{stats.chatbotActivos}</span>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs col-span-2 lg:col-span-1">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Cerrados</span>
              <span className="text-xl font-black text-emerald-600 block mt-0.5">{stats.cerrados}</span>
            </div>
          </div>

          {/* Filtros Kanban */}
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
            {/* Buscador */}
            <div className="space-y-1">
              <label className="text-[9px] font-bold text-gray-400 uppercase block">Buscar</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nombre, celular..."
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500 bg-gray-50/50"
              />
            </div>

            {/* Asesor */}
            <div className="space-y-1">
              <label className="text-[9px] font-bold text-gray-400 uppercase block">Asesor</label>
              <select
                value={selectedAsesor}
                onChange={(e) => setSelectedAsesor(e.target.value)}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="todos">Todos los asesores</option>
                <option value="sin_asignar">Sin Asignar</option>
                {asesores.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Empresa */}
            <div className="space-y-1">
              <label className="text-[9px] font-bold text-gray-400 uppercase block">Marca</label>
              <select
                value={selectedEmpresa}
                onChange={(e) => setSelectedEmpresa(e.target.value)}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="todas">Todas</option>
                <option value="Transavic">Transavic</option>
                <option value="Avícola de Tony">Avícola de Tony</option>
              </select>
            </div>

            {/* Chatbot */}
            <div className="space-y-1">
              <label className="text-[9px] font-bold text-gray-400 uppercase block">Chatbot</label>
              <select
                value={selectedChatbot}
                onChange={(e) => setSelectedChatbot(e.target.value)}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="todos">Todos</option>
                <option value="activo">IA Activo</option>
                <option value="inactivo">IA Desactivado</option>
              </select>
            </div>
          </div>

          {/* Kanban Board Container */}
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            </div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex-1 flex gap-3 overflow-x-auto pb-4 items-start select-none">
                {ESTADOS_KANBAN.map((estado) => {
                  const columnLeads = boardData[estado] || [];
                  const colorInfo = COLORES_ESTADO[estado];
                  return (
                    <div
                      key={estado}
                      className={`flex flex-col rounded-2xl border ${colorInfo.border} w-[260px] max-h-full bg-slate-50/45 shadow-xs flex-shrink-0`}
                    >
                      {/* Header Columna */}
                      <div
                        className={`p-3 rounded-t-2xl flex justify-between items-center ${colorInfo.headerBg} border-b ${colorInfo.border}`}
                      >
                        <span className={`text-[10px] font-black uppercase tracking-wider ${colorInfo.text}`}>
                          {estado}
                        </span>
                        <span
                          className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${colorInfo.bg} ${colorInfo.text} border ${colorInfo.border}`}
                        >
                          {columnLeads.length}
                        </span>
                      </div>

                      {/* Droppable Body */}
                      <Droppable droppableId={estado}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-[300px] transition-colors duration-150 ${
                              snapshot.isDraggingOver ? "bg-indigo-50/15" : "bg-transparent"
                            }`}
                          >
                            {columnLeads.map((lead, index) => (
                              <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                {(providedDrag, snapshotDrag) => (
                                  <div
                                    ref={providedDrag.innerRef}
                                    {...providedDrag.draggableProps}
                                    {...providedDrag.dragHandleProps}
                                    onClick={() => {
                                      setActiveLeadId(lead.id);
                                      setViewMode("chat");
                                    }}
                                    className={`p-3 bg-white border border-gray-150 rounded-xl shadow-2xs hover:shadow-xs hover:border-indigo-200 transition-all cursor-pointer space-y-2 ${
                                      snapshotDrag.isDragging
                                        ? "shadow-lg border-indigo-300 scale-[1.02]"
                                        : "hover:-translate-y-0.5"
                                    }`}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span
                                        className={`text-[8px] font-black uppercase px-1.5 py-0.2 rounded-md ${
                                          lead.empresa === "Transavic"
                                            ? "bg-amber-100 text-amber-800"
                                            : "bg-red-100 text-red-800"
                                        }`}
                                      >
                                        {lead.empresa}
                                      </span>
                                      {lead.chatbot_activo ? (
                                        <span className="text-[8px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded-md animate-pulse">
                                          🤖 IA
                                        </span>
                                      ) : (
                                        <span className="text-[8px] font-black text-slate-500 bg-slate-50 px-1.5 py-0.2 rounded-md">
                                          👤 Asesora
                                        </span>
                                      )}
                                    </div>

                                    <div className="space-y-0.5">
                                      <h4 className="text-[11px] font-bold text-gray-800 leading-snug">
                                        {lead.nombre}
                                      </h4>
                                      {lead.negocio && (
                                        <p className="text-[9px] text-gray-400 font-medium flex items-center gap-0.5 truncate">
                                          <FiBriefcase size={9} /> {lead.negocio}
                                        </p>
                                      )}
                                    </div>

                                    <div className="flex justify-between items-center text-[9px] text-gray-400 pt-1.5 border-t border-gray-100">
                                      <span className="font-bold text-gray-500 flex items-center gap-0.5">
                                        <FiPhone size={9} /> {lead.telefono}
                                      </span>
                                      <span className="font-semibold text-gray-400 truncate max-w-[75px]">
                                        {lead.vendedor_name ? lead.vendedor_name.split(" ")[0] : "Libre"}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          )}
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
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-5xl max-h-[92vh] overflow-y-auto relative p-6 border border-gray-150 dark:border-slate-800 shadow-2xl flex flex-col animate-in scale-in duration-250">
            {/* Cabecera del Modal */}
            <div className="flex justify-between items-center pb-4 border-b border-gray-150 dark:border-slate-800 shrink-0">
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span>🛒</span> Registrar Pedido desde CRM
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Los datos del cliente se han prellenado automáticamente desde la conversación activa.
                </p>
              </div>
              <button
                onClick={() => setShowOrderModal(false)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
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

  useEffect(() => {
    loadLeadDetails();
    // Polling del chat activo cada 4 segundos
    const interval = setInterval(loadLeadDetails, 4000);
    return () => clearInterval(interval);
  }, [leadId]);

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
  const handleSendMessage = async (e?: React.FormEvent, customBody?: string, customType = "text") => {
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
        body: JSON.stringify({ body: bodyToSend, type: customType }),
      });

      if (!res.ok) throw new Error("Error en envío");
      loadLeadDetails();
      onRefreshLeads();
    } catch (err) {
      console.error(err);
      alert("Error al enviar el mensaje.");
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

  // Enviar plantilla oficial
  const handleSendTemplate = async (templateName: string, lang?: string, vars?: string[], file?: File, mediaType?: string, previewText?: string) => {
    if (previewText) {
      await handleSendMessage(undefined, previewText, "template");
    }
    setShowTemplateModal(false);
  };

  // Cambiar chatbot activo
  const handleToggleChatbot = async (active: boolean) => {
    if (!lead) return;
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbot_activo: active }),
      });

      if (res.ok) {
        setLead({ ...lead, chatbot_activo: active });
        onRefreshLeads();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Cambiar vendedora asignada
  const handleChangeAsesor = async (asesorId: string) => {
    if (!lead) return;
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
    if (!lead) return;
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
    }
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
        <div className="h-14 bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between px-4 shrink-0 shadow-2xs z-10">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onCloseChat} className="md:hidden text-gray-500 mr-1 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700">
              <FiChevronLeft size={20} />
            </button>
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-200 shrink-0">
              {lead?.nombre ? lead.nombre.substring(0, 2).toUpperCase() : "?"}
            </div>
            <div className="min-w-0 group">
              <h4 className="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-1.5 truncate">
                {lead?.nombre}
                <span
                  className={`text-[8px] font-black uppercase px-1.5 py-0.2 rounded-md ${
                    lead?.empresa === "Transavic" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
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
                className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 transition-colors select-all"
                title="Clic para copiar número"
              >
                {copiedPhone ? (
                  <span className="text-green-600 dark:text-green-400 font-bold flex items-center gap-0.5 select-none">
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
            {/* Registrar Pedido */}
            {lead && (
              <button
                onClick={() => onCreateOrder(lead)}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center gap-1 transition-all active:scale-95 shadow-sm cursor-pointer"
                title="Registrar Pedido del Cliente"
              >
                <FiPlus size={14} /> <span>Crear Pedido</span>
              </button>
            )}

            {/* Direct Calls */}
            <a
              href={`tel:${lead?.telefono}`}
              className="p-2 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100/50 dark:border-indigo-900/40 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/60 rounded-xl text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer hidden sm:block"
              title="Llamar por teléfono"
            >
              <FiPhone size={14} />
            </a>
 
            {/* Chatbot Active Switch */}
            <div className="flex bg-gray-150/65 dark:bg-slate-700/60 p-0.5 rounded-lg border border-gray-200/50 dark:border-slate-600/50 text-[10px]">
              <button
                type="button"
                onClick={() => handleToggleChatbot(true)}
                className={`px-2 py-1 font-black rounded flex items-center gap-0.5 transition-all cursor-pointer ${
                  lead?.chatbot_activo ? "bg-purple-600 text-white shadow-2xs" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-250"
                }`}
              >
                🤖 IA
              </button>
              <button
                type="button"
                onClick={() => handleToggleChatbot(false)}
                className={`px-2 py-1 font-black rounded flex items-center gap-0.5 transition-all cursor-pointer ${
                  !lead?.chatbot_activo ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-2xs" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-250"
                }`}
              >
                👤 Humano
              </button>
            </div>
 
            <button
              onClick={toggleRightPanel}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                showRightPanel
                  ? "bg-indigo-50 dark:bg-indigo-950 border-indigo-100 dark:border-indigo-900 text-indigo-600 dark:text-indigo-400"
                  : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
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
                      <span className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xs text-gray-500 dark:text-gray-400 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-2xs border border-gray-150 dark:border-slate-700">
                        {formatDateSeparator(m.created_at)}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col ${isMe || isBot ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5 text-[9px] font-bold text-gray-400 dark:text-gray-500">
                      <span className="capitalize">{m.sender === "bot" ? "Bot IA" : m.sender}</span>
                      <span>•</span>
                      <span>{timeStr}</span>
                    </div>

                    <div
                      className={`max-w-[80%] rounded-2xl p-3 text-xs leading-relaxed ${
                        isMe
                          ? "bg-[#d9fdd3] dark:bg-green-900/40 text-gray-800 dark:text-green-50 border border-[#c4eabf]/60 dark:border-green-800/20 rounded-tr-none shadow-2xs"
                          : isBot
                          ? "bg-[#e0f0ff] dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800/30 rounded-tr-none shadow-2xs"
                          : "bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 border border-gray-150 dark:border-slate-700/60 rounded-tl-none shadow-2xs"
                      }`}
                    >
                      {isBot && (
                        <div className="flex items-center gap-1 mb-1 text-[9px] font-extrabold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                          <FiActivity size={10} className="shrink-0 animate-pulse" />
                          <span>Asistente IA</span>
                        </div>
                      )}

                      {/* Rendering attachments */}
                      {m.type === "image" && m.body.startsWith("data:image/") ? (
                        <div className="space-y-1.5">
                          <img src={m.body} alt="Imagen adjunta" className="rounded-lg max-w-full max-h-60 object-cover shadow-2xs border border-gray-100 dark:border-slate-800" />
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
          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-white dark:bg-slate-800 border-t border-gray-100 dark:border-slate-800 shrink-0 relative flex flex-col gap-2">
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
            <div className="bg-gray-100/80 dark:bg-slate-900/80 px-4 py-2 flex items-center w-full border border-gray-200 dark:border-slate-700 rounded-xl">
              <AudioRecorder onSend={handleSendAudio} onCancel={() => setShowRecording(false)} />
            </div>
          ) : (
            <form onSubmit={(e) => handleSendMessage(e)} className="flex items-end gap-2 w-full pt-1 px-1 pb-1">
              {/* Main WhatsApp input pill wrapper */}
              <div className="flex-1 flex items-center gap-1.5 bg-white dark:bg-slate-900 rounded-2xl border border-gray-250/60 dark:border-slate-750/70 shadow-xs px-3 py-1.5 relative transition-all duration-200 focus-within:border-indigo-400 dark:focus-within:border-indigo-500">
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
                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
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
                  className="flex-1 min-w-0 bg-transparent border-none py-1 px-1 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none resize-none leading-relaxed"
                  style={{ maxHeight: "120px", overflowY: "auto" }}
                />
 
                {/* File Attachment Input & Clip Icon */}
                <label className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-center shrink-0">
                  <FiPaperclip size={15} className="rotate-45" />
                  <input type="file" onChange={handleFileAttach} className="hidden" accept="image/*,application/pdf" />
                </label>
 
                {/* Template Button */}
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
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

            {/* Asignación de Vendedora */}
            <div className="space-y-1">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Vendedor Asignado</label>
              <select
                value={lead?.vendedor_id || ""}
                onChange={(e) => handleChangeAsesor(e.target.value)}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
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
                <input
                  type="text"
                  value={negocioTemp}
                  disabled={!editingNotes}
                  onChange={(e) => setNegocioTemp(e.target.value)}
                  placeholder="ej. Pollería"
                  className="w-full border border-gray-200 bg-white disabled:bg-gray-50 rounded-lg px-2.5 py-1 text-[10px] outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Ciudad / Distrito</label>
                <input
                  type="text"
                  value={ciudadTemp}
                  disabled={!editingNotes}
                  onChange={(e) => setCiudadTemp(e.target.value)}
                  placeholder="ej. Miraflores"
                  className="w-full border border-gray-200 bg-white disabled:bg-gray-50 rounded-lg px-2.5 py-1 text-[10px] outline-none"
                />
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
                  <button
                    onClick={handleSaveDetails}
                    className="text-[9px] text-emerald-600 font-bold hover:underline cursor-pointer flex items-center gap-0.5"
                  >
                    Guardar
                  </button>
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
    </div>
  );
}

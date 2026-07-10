// src/components/DashboardLayout.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Session } from "next-auth";
import { useState, useCallback, useEffect } from "react";
import { usePollingVisible } from "@/lib/use-polling-visible";
import dynamic from "next/dynamic";
import {
  FiPlus,
  FiList,
  FiUsers,
  FiLogOut,
  FiMenu,
  FiX,
  FiBarChart2,
  FiClipboard,
  FiNavigation,
  FiTruck,
  FiTarget,
  FiFileText,
  FiCreditCard,
  FiBox,
  FiAward,
  FiSun,
  FiCheckSquare,
  FiMessageSquare,
  FiInbox,
  FiChevronDown,
  FiChevronRight,
  FiChevronLeft,
  FiShoppingBag,
  FiSettings,
  FiDollarSign,
} from "react-icons/fi";
import { doLogout } from "@/lib/actions";
import NotificationBell from "./NotificationBell";
import FloatingAssistant from "./FloatingAssistant";
import CmdKModal from "./CmdKModal";

const ComunicadoPopup = dynamic(() => import("./ComunicadoPopup"), { ssr: false });
const ArriboPopup = dynamic(() => import("./ArriboPopup"), { ssr: false });

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  repartidorOnly?: boolean;
  roles?: string[]; // si se define, solo se muestra a estos roles
  isPrimary?: boolean; // Highlight UX para botones vitales (Ej: POS de Planta)
  isBeta?: boolean; // módulo de la expansión ERP en fase de prueba → chip índigo "Beta"
}

// Chip índigo "Beta": marcador visual deliberado de los módulos en prueba
// (el índigo es el color de la fase beta; el rojo es la marca del core).
const ChipBeta = () => (
  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full align-middle">
    Beta
  </span>
);

// Orden = por OPERACIÓN de venta. Cada bloque EMPIEZA con su acción de vender
// (isPrimary = botón rojo, la "lead" del bloque) y sigue con sus vistas de apoyo.
// Así los 3 sistemas quedan auto-contenidos y simétricos. Filtrado por rol.
const navItems: NavItem[] = [
  // Repartidor: su única vista (suelta, sin grupo).
  { href: "/dashboard/mi-ruta", label: "Mi Ruta", icon: <FiNavigation className="h-5 w-5 flex-shrink-0" />, roles: ["repartidor"] },

  // ── 🛵 VENTAS EJECUTIVAS (el sistema original) ──
  { href: "/dashboard/nuevo-pedido", label: "Nuevo Pedido", icon: <FiPlus className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"], isPrimary: true },
  { href: "/dashboard", label: "Lista de Pedidos", icon: <FiList className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },
  { href: "/dashboard/mi-dia", label: "Mi Día", icon: <FiSun className="h-5 w-5 flex-shrink-0" />, roles: ["asesor", "admin"] },
  { href: "/dashboard/clientes", label: "Clientes", icon: <FiUsers className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor", "produccion"] },
  { href: "/dashboard/crm-leads", label: "CRM Leads", icon: <FiTarget className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"], isBeta: true },
  { href: "/dashboard/despacho", label: "Despacho", icon: <FiTruck className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },
  { href: "/dashboard/cobranzas", label: "Cobranzas", icon: <FiCreditCard className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },

  // ── 🏪 VENTA EN CAMPO (Avícola de Tony) ──
  // La lead: se entra aquí, se elige el cliente y se toca "Vender" (venta + cobranza + guía en una página).
  { href: "/dashboard/clientes-avicola", label: "Vender en Campo", icon: <FiShoppingBag className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isPrimary: true, isBeta: true },
  { href: "/dashboard/clientes-avicola/liquidacion", label: "Liquidación del día", icon: <FiClipboard className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },
  { href: "/dashboard/clientes-avicola/panel", label: "Panel Campo", icon: <FiBarChart2 className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },

  // ── 🏭 VENTA EN PLANTA (POS) ──
  { href: "/dashboard/pos-planta", label: "Venta Rápida", icon: <FiCheckSquare className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isPrimary: true, isBeta: true },
  { href: "/dashboard/clientes-planta", label: "Clientes Planta", icon: <FiUsers className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },
  { href: "/dashboard/cobranzas-planta", label: "Cobranzas Planta", icon: <FiCreditCard className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },

  // ── PRODUCCIÓN & COMPRAS ──
  { href: "/dashboard/resumen", label: "Resumen a Preparar", icon: <FiBox className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"] },
  { href: "/dashboard/produccion", label: "Producción", icon: <FiClipboard className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"] },
  { href: "/dashboard/produccion/mermas", label: "Calculadora Mermas", icon: <FiCheckSquare className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },
  { href: "/dashboard/inventario", label: "Inventario Flex", icon: <FiBox className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },
  { href: "/dashboard/compras", label: "Compras", icon: <FiInbox className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },
  { href: "/dashboard/proveedores", label: "Proveedores", icon: <FiUsers className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },
  { href: "/dashboard/prestamos", label: "Préstamos", icon: <FiTarget className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },

  // ── FINANZAS ── (Cobranzas de ejecutivas vive en su bloque 🛵)
  { href: "/dashboard/caja-diaria", label: "Caja Diaria", icon: <FiCreditCard className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },
  { href: "/dashboard/gastos", label: "Gastos", icon: <FiDollarSign className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "produccion"], isBeta: true },
  { href: "/dashboard/comprobantes", label: "Comprobantes", icon: <FiFileText className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },
  { href: "/dashboard/cuentas-por-pagar", label: "Cuentas por Pagar", icon: <FiList className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },
  { href: "/dashboard/cuentas", label: "Cuentas Bancarias", icon: <FiCreditCard className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },

  // ── REPORTES & ANALYTICS ──
  { href: "/dashboard/mis-metas", label: "Mis Metas", icon: <FiAward className="h-5 w-5 flex-shrink-0" />, roles: ["asesor", "admin"] },
  { href: "/dashboard/reportes", label: "Reportes", icon: <FiBarChart2 className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },
  { href: "/dashboard/rentabilidad", label: "Rentabilidad Real", icon: <FiBarChart2 className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },
  { href: "/dashboard/consolidado", label: "Consolidado", icon: <FiBarChart2 className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },

  // ── CONFIGURACIÓN ──
  { href: "/dashboard/catalogo", label: "Catálogo", icon: <FiBox className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },
  { href: "/dashboard/autorizaciones", label: "Autorizaciones", icon: <FiCheckSquare className="h-5 w-5 flex-shrink-0" />, roles: ["admin", "asesor"] },
  { href: "/dashboard/comunicados", label: "Comunicados", icon: <FiMessageSquare className="h-5 w-5 flex-shrink-0" />, adminOnly: true },
  { href: "/dashboard/incentivos", label: "Incentivos", icon: <FiAward className="h-5 w-5 flex-shrink-0" />, adminOnly: true },
  { href: "/dashboard/users", label: "Usuarios", icon: <FiUsers className="h-5 w-5 flex-shrink-0" />, adminOnly: true },
  { href: "/dashboard/configuracion", label: "Configuración", icon: <FiSettings className="h-5 w-5 flex-shrink-0" />, adminOnly: true, isBeta: true },
];

// Grupos por OPERACIÓN de venta (decisión de Antonio, jul 2026: 3 sistemas separados).
const GROUP_ORDER = [
  "🛵 Ventas Ejecutivas",
  "🏪 Venta en Campo",
  "🏭 Venta en Planta",
  "Producción & Compras",
  "Finanzas",
  "Reportes & Análisis",
  "Configuración",
];

const GROUP_BY_HREF: Record<string, string> = {
  // 🛵 Ventas Ejecutivas (el sistema original: pedidos, CRM, despacho, cobranzas de ejecutivas)
  "/dashboard/nuevo-pedido": "🛵 Ventas Ejecutivas",
  "/dashboard": "🛵 Ventas Ejecutivas",
  "/dashboard/mi-dia": "🛵 Ventas Ejecutivas",
  "/dashboard/clientes": "🛵 Ventas Ejecutivas",
  "/dashboard/crm-leads": "🛵 Ventas Ejecutivas",
  "/dashboard/despacho": "🛵 Ventas Ejecutivas",
  "/dashboard/cobranzas": "🛵 Ventas Ejecutivas",

  // 🏪 Venta en Campo (Avícola de Tony): vender + liquidación + panel
  "/dashboard/clientes-avicola": "🏪 Venta en Campo",
  "/dashboard/clientes-avicola/liquidacion": "🏪 Venta en Campo",
  "/dashboard/clientes-avicola/panel": "🏪 Venta en Campo",

  // 🏭 Venta en Planta (POS: vender + clientes y cobranzas propios)
  "/dashboard/pos-planta": "🏭 Venta en Planta",
  "/dashboard/clientes-planta": "🏭 Venta en Planta",
  "/dashboard/cobranzas-planta": "🏭 Venta en Planta",

  "/dashboard/resumen": "Producción & Compras",
  "/dashboard/produccion": "Producción & Compras",
  "/dashboard/produccion/mermas": "Producción & Compras",
  "/dashboard/inventario": "Producción & Compras",
  "/dashboard/compras": "Producción & Compras",
  "/dashboard/proveedores": "Producción & Compras",
  "/dashboard/prestamos": "Producción & Compras",

  // Finanzas transversales (caja con selector Planta/Campo, facturación electrónica compartida)
  "/dashboard/caja-diaria": "Finanzas",
  "/dashboard/gastos": "Finanzas",
  "/dashboard/comprobantes": "Finanzas",
  "/dashboard/cuentas-por-pagar": "Finanzas",
  "/dashboard/cuentas": "Finanzas",

  "/dashboard/mis-metas": "Reportes & Análisis",
  "/dashboard/reportes": "Reportes & Análisis",
  "/dashboard/rentabilidad": "Reportes & Análisis",
  "/dashboard/consolidado": "Reportes & Análisis",

  "/dashboard/catalogo": "Configuración",
  "/dashboard/autorizaciones": "Configuración",
  "/dashboard/comunicados": "Configuración",
  "/dashboard/incentivos": "Configuración",
  "/dashboard/users": "Configuración",
  "/dashboard/configuracion": "Configuración",
};

interface DashboardLayoutProps {
  children: React.ReactNode;
  session: Session;
}

export default function DashboardLayout({
  children,
  session,
}: DashboardLayoutProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const isCrm = pathname === "/dashboard/crm-leads";

  // El botón flotante del Asistente IA solo aparece en vistas de ANÁLISIS
  // (donde sus insights aportan algo), no en pantallas operativas como el POS,
  // caja o formularios — pedido de Hugo (5 jul 2026).
  const RUTAS_CON_ASISTENTE = [
    "/dashboard/mi-dia",
    "/dashboard/reportes",
    "/dashboard/mis-metas",
    "/dashboard/analytics",
    "/dashboard/panel-gerencial",
    "/dashboard/rentabilidad",
    "/dashboard/consolidado",
  ];
  const mostrarAsistente =
    pathname === "/dashboard" ||
    RUTAS_CON_ASISTENTE.some((r) => pathname.startsWith(r));

  useEffect(() => {
    const handleToggleMobile = () => setMobileOpen(true);
    window.addEventListener("toggle-mobile-sidebar", handleToggleMobile);
    return () => window.removeEventListener("toggle-mobile-sidebar", handleToggleMobile);
  }, []);
  
  // Estado para acordeones. Todos abiertos por defecto.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initialState: Record<string, boolean> = {};
    GROUP_ORDER.forEach(g => { initialState[g] = true; });
    return initialState;
  });

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const userRole = session.user.role;

  const [aprobadasSinUsar, setAprobadasSinUsar] = useState(0);
  const cargarAutorizaciones = useCallback(() => {
    fetch("/api/autorizaciones-precio?estado=aprobada")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Array<{ usada_at: string | null; resuelta_at: string | null; created_at: string }>) => {
        if (!Array.isArray(d)) return;
        const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
        setAprobadasSinUsar(
          d.filter(
            (a) =>
              !a.usada_at &&
              new Date(a.resuelta_at ?? a.created_at).getTime() > corte
          ).length
        );
      })
      .catch(() => {});
  }, []);
  usePollingVisible(cargarAutorizaciones, 60_000, { enabled: userRole === "asesor" });
  
  const badgePara = (href: string) =>
    href === "/dashboard/autorizaciones" && aprobadasSinUsar > 0 ? aprobadasSinUsar : 0;

  const filteredNavItems = navItems.filter((item) => {
    if (item.roles) return item.roles.includes(userRole);
    if (item.adminOnly) return userRole === "admin";
    if (item.repartidorOnly) return userRole === "repartidor";
    return true;
  });

  // Las acciones de vender (isPrimary) YA NO van sueltas arriba: van como PRIMER
  // ítem de su bloque de operación (el orden de navItems las pone primeras). Solo
  // quedan "sueltos" los ítems sin grupo (ej. Mi Ruta del repartidor).
  const sinGrupo = filteredNavItems.filter((i) => !GROUP_BY_HREF[i.href]);
  const grupos = GROUP_ORDER.map((nombre) => ({
    nombre,
    items: filteredNavItems.filter((i) => GROUP_BY_HREF[i.href] === nombre),
  })).filter((g) => g.items.length > 0);

  const isItemActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    if (!pathname.startsWith(href)) {
      return false;
    }
    // Evitar doble selección: si otro item de navegación también coincide y su href es más largo (más específico), desactivar este.
    const hasMoreSpecificMatch = filteredNavItems.some(
      (item) =>
        item.href !== href &&
        item.href !== "/dashboard" &&
        pathname.startsWith(item.href) &&
        item.href.length > href.length
    );
    return !hasMoreSpecificMatch;
  };

  // Link para móviles
  const mobileLink = (item: NavItem) => {
    const active = isItemActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all duration-200 cursor-pointer ${
          active && item.isPrimary
            ? "bg-red-600 text-white shadow-md scale-[1.02]"
            : active
            ? "bg-gradient-to-r from-red-50 to-red-100/30 text-red-700 shadow-sm border-l-4 border-red-600"
            : item.isPrimary
            ? "bg-red-600 text-white shadow-sm mt-2 mb-2"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`}
      >
        <span className={`transition-transform duration-200 ${item.isPrimary ? "text-white" : active ? "scale-110 text-red-600" : ""}`}>{item.icon}</span>
        <span>
          {item.label}
          {item.isBeta && <ChipBeta />}
        </span>
        {badgePara(item.href) > 0 && (
          <span className="ml-auto min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
            {badgePara(item.href)}
          </span>
        )}
      </Link>
    );
  };

  // Link Desktop. Aplica Soft UI Evolution.
  const desktopLink = (item: NavItem) => {
    const active = isItemActive(item.href);
    const isPrimary = item.isPrimary;
    
    return (
      <Link
        key={item.href}
        href={item.href}
        title={isSidebarCollapsed ? item.label : undefined}
        className={`
          flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200 cursor-pointer overflow-hidden
          ${isPrimary ? 'mb-1 font-semibold' : ''}
          ${
            active && isPrimary
              ? "bg-red-700 text-white shadow-sm"
              : active
              ? "bg-gradient-to-r from-red-50 to-red-100/30 text-red-700 shadow-sm border-l-4 border-red-600 font-semibold"
              : isPrimary
              ? "bg-red-600 text-white hover:bg-red-700 shadow-sm"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          }
          ${isSidebarCollapsed && isPrimary ? "w-10 h-10 p-0 mx-auto justify-center" : ""}
        `}
      >
        <span className={`relative flex-shrink-0 transition-transform duration-200 ${
          isPrimary ? "text-white" : active ? "text-red-600 scale-110" : "text-gray-500"
        }`}>
          {item.icon}
          {badgePara(item.href) > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center z-10">
              {badgePara(item.href)}
            </span>
          )}
        </span>
        <span className={`whitespace-nowrap transition-all duration-300 ${isSidebarCollapsed ? "opacity-0 w-0 hidden" : "opacity-100"}`}>
          {item.label}
          {item.isBeta && <ChipBeta />}
        </span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-gray-55">
      {/* Mobile header */}
      {!isCrm && (
        <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              aria-label="Abrir menú"
            >
              <FiMenu className="h-6 w-6" />
            </button>
            <span className="font-bold text-gray-800">🐔 Transavic</span>
            <NotificationBell variant="mobile" />
          </div>
        </header>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity ${isCrm ? "" : "lg:hidden"}`}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-72 bg-white border-r border-gray-200 
          transform transition-transform duration-300 ease-in-out shadow-2xl
          ${isCrm ? "" : "lg:hidden"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🐔</span>
              <span className="font-bold text-xl text-gray-800">Transavic</span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <FiX className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            {sinGrupo.map(mobileLink)}
            {grupos.map((g) => (
              <div key={g.nombre} className="pt-2">
                <p className="px-4 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">{g.nombre}</p>
                {g.items.map(mobileLink)}
              </div>
            ))}
          </nav>

          <div className="border-t border-gray-100 p-4 bg-gray-50">
            <div className="mb-4 px-4">
              <p className="text-xs text-gray-500 font-medium">Sesión iniciada como</p>
              <p className="font-bold text-gray-800 truncate">
                {session.user.name}
              </p>
              <p className="text-xs text-gray-500 capitalize">{userRole}</p>
            </div>
            <form action={doLogout}>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-red-600 bg-white hover:bg-red-50 border border-red-100 font-semibold transition-colors cursor-pointer shadow-sm"
              >
                <FiLogOut className="h-5 w-5" />
                <span>Cerrar Sesión</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Desktop Sidebar - UI UX Pro Max */}
      {!isCrm && (
        <aside
          className={`
            hidden lg:flex fixed top-0 left-0 z-40 h-full 
            bg-white border-r border-gray-200
            transition-all duration-300 ease-in-out
            flex-col shadow-[2px_0_8px_rgba(0,0,0,0.02)]
            ${isSidebarCollapsed ? "w-16" : "w-64"}
          `}
        >
          <div className="flex flex-col h-full w-full">
            {/* Logo */}
            <div className={`flex items-center py-5 border-b border-gray-100 h-16 ${isSidebarCollapsed ? "px-0 justify-center" : "px-6"}`}>
              <span className="text-2xl flex-shrink-0">🐔</span>
              {!isSidebarCollapsed && (
                <span className="font-extrabold text-xl text-gray-800 ml-3 whitespace-nowrap">
                  Transavic
                </span>
              )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 min-h-0 px-3 py-6 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
              {/* Sueltos (sin grupo: p. ej. Mi Ruta del repartidor) */}
              {sinGrupo.length > 0 && (
                <div className="space-y-1 mb-4">
                  {sinGrupo.map(desktopLink)}
                </div>
              )}

              {/* Grupos por operación: cada uno abre con su acción de vender (lead) */}
              <div className="space-y-1">
                {grupos.map((g) => {
                  const isExpanded = expandedGroups[g.nombre];
                  return (
                    <div key={g.nombre} className="mb-2">
                      {/* Header del grupo (Acordeón) */}
                      <button 
                        onClick={() => toggleGroup(g.nombre)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left rounded-lg hover:bg-gray-50 transition-colors group ${isSidebarCollapsed ? "justify-center" : ""}`}
                        title={isSidebarCollapsed ? g.nombre : undefined}
                      >
                        {!isSidebarCollapsed && (
                          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 group-hover:text-gray-600 transition-colors">
                            {g.nombre}
                          </span>
                        )}
                        {!isSidebarCollapsed ? (
                          isExpanded ? <FiChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <FiChevronRight className="h-3.5 w-3.5 text-gray-400" />
                        ) : (
                          <div className="w-4 h-[2px] bg-gray-300 rounded-full" />
                        )}
                      </button>
                      
                      {/* Items del grupo */}
                      <div className={`space-y-1 overflow-hidden transition-all duration-300 ease-in-out ${isExpanded || isSidebarCollapsed ? 'max-h-[1000px] opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                        {g.items.map(desktopLink)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </nav>

            {/* User section & Toggle Sidebar */}
            <div className="border-t border-gray-100 p-3 bg-gray-50/50">
              {/* Toggle pin/unpin */}
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="w-full flex items-center justify-center py-2 mb-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                title={isSidebarCollapsed ? "Expandir menú" : "Colapsar menú"}
              >
                {isSidebarCollapsed ? <FiChevronRight className="h-5 w-5" /> : <FiChevronLeft className="h-5 w-5" />}
              </button>

              {!isSidebarCollapsed && (
                <div className="mb-3 px-3">
                  <p className="text-[11px] text-gray-500 font-medium">Sesión:</p>
                  <p className="font-bold text-gray-800 truncate">{session.user.name}</p>
                </div>
              )}

              <form action={doLogout}>
                <button
                  type="submit"
                  title="Cerrar Sesión"
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-600 bg-white border border-red-50 hover:bg-red-50 font-medium transition-colors cursor-pointer shadow-sm ${isSidebarCollapsed ? "justify-center px-0" : ""}`}
                >
                  <FiLogOut className="h-5 w-5 flex-shrink-0" />
                  {!isSidebarCollapsed && <span className="whitespace-nowrap">Cerrar Sesión</span>}
                </button>
              </form>
            </div>
          </div>
        </aside>
      )}

      {/* Floating NotificationBell — desktop only */}
      {!isCrm && (
        <div className="hidden lg:block fixed top-3 right-4 z-30">
          <NotificationBell variant="desktop" />
        </div>
      )}

      {/* Main content - transition smooth para el width del sidebar */}
      {/* El pb-24 solo hace falta como espacio para el botón flotante del Asistente IA;
          en vistas operativas (POS, caja…) ese aire abajo era espacio muerto. */}
      <main className={`transition-all duration-300 ease-in-out ${isCrm ? "lg:pl-0 pt-0 pb-0 h-screen overflow-hidden" : `${isSidebarCollapsed ? "lg:pl-16" : "lg:pl-64"} pt-16 lg:pt-0 min-h-screen ${mostrarAsistente ? "pb-24" : "pb-6"}`}`}>
        {children}
      </main>

      {/* Botón flotante de IA */}
      {mostrarAsistente && <FloatingAssistant role={userRole} />}

      {/* Búsqueda global Cmd+K */}
      {!isCrm && (userRole === "admin" || userRole === "asesor") && <CmdKModal />}

      {/* Popups */}
      <ComunicadoPopup />
      {(userRole === "admin" || userRole === "asesor") && <ArriboPopup />}
    </div>
  );
}

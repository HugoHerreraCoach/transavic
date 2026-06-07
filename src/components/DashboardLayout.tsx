// src/components/DashboardLayout.tsx

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Session } from "next-auth";
import { useState } from "react";
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
} from "react-icons/fi";
import { doLogout } from "@/lib/actions";
import NotificationBell from "./NotificationBell";
import FloatingAssistant from "./FloatingAssistant";
import CmdKModal from "./CmdKModal";

const ComunicadoPopup = dynamic(() => import("./ComunicadoPopup"), { ssr: false });

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  repartidorOnly?: boolean;
  roles?: string[]; // si se define, solo se muestra a estos roles
}

// Orden = flujo del negocio. Cada ítem se muestra solo a los roles indicados.
// El orden DENTRO de cada grupo lo da este array; los grupos se ordenan con GROUP_ORDER.
const navItems: NavItem[] = [
  // Mi Ruta: única vista del repartidor (suelta, sin encabezado de grupo).
  {
    href: "/dashboard/mi-ruta",
    label: "Mi Ruta",
    icon: <FiNavigation className="h-5 w-5 flex-shrink-0" />,
    roles: ["repartidor"],
  },

  // P3.12 — "Mi Día" para asesoras: arrancar la jornada con todo en una pantalla
  // (pedidos de hoy + cobranzas que tocan + clientes a recontactar + métricas).
  // Admin lo ve como vista previa.
  {
    href: "/dashboard/mi-dia",
    label: "Mi Día",
    icon: <FiSun className="h-5 w-5 flex-shrink-0" />,
    roles: ["asesor", "admin"],
  },

  // ── OPERACIÓN (flujo del pedido) ──
  {
    href: "/dashboard/nuevo-pedido",
    label: "Nuevo Pedido",
    icon: <FiPlus className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "asesor"],
  },
  {
    href: "/dashboard",
    label: "Lista de Pedidos",
    icon: <FiList className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "asesor"],
  },
  // Resumen del día: totales por producto para preparar (uso de producción +
  // admin). Va antes de Producción porque responde "¿qué preparo?" en el flujo.
  {
    href: "/dashboard/resumen",
    label: "Resumen del día",
    icon: <FiBox className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "produccion"],
  },
  {
    href: "/dashboard/produccion",
    label: "Producción",
    icon: <FiClipboard className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "produccion"],
  },
  {
    href: "/dashboard/despacho",
    label: "Despacho",
    icon: <FiTruck className="h-5 w-5 flex-shrink-0" />,
    // Admin gestiona el despacho (asignar/optimizar). La asesora entra en SOLO
    // LECTURA: ve todos los motorizados y entregas en vivo (mapa + lista) para
    // poder avisarle a su cliente, sin tocar la operación.
    roles: ["admin", "asesor"],
  },

  // ── COMERCIAL ──
  {
    href: "/dashboard/clientes",
    label: "Clientes",
    icon: <FiUsers className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "asesor"],
  },
  {
    href: "/dashboard/comprobantes",
    label: "Comprobantes",
    icon: <FiFileText className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "asesor"],
  },
  {
    href: "/dashboard/cobranzas",
    label: "Cobranzas",
    icon: <FiCreditCard className="h-5 w-5 flex-shrink-0" />,
    roles: ["admin", "asesor"],
  },
  {
    href: "/dashboard/mis-metas",
    label: "Mis Metas",
    icon: <FiTarget className="h-5 w-5 flex-shrink-0" />,
    // Asesoras lo usan a diario; el admin entra como VISTA PREVIA (no compite, sus
    // tarjetas personales salen en S/0, pero ve el ranking y la meta de equipo reales).
    roles: ["asesor", "admin"],
  },

  // ── REPORTES ──
  {
    href: "/dashboard/reportes",
    label: "Reportes",
    icon: <FiBarChart2 className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },

  // ── CONFIGURACIÓN ──
  {
    href: "/dashboard/catalogo",
    label: "Catálogo",
    icon: <FiBox className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
  {
    href: "/dashboard/incentivos",
    label: "Incentivos",
    icon: <FiAward className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
  {
    href: "/dashboard/users",
    label: "Usuarios",
    icon: <FiUsers className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
  {
    href: "/dashboard/autorizaciones",
    label: "Autorizaciones",
    icon: <FiCheckSquare className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
  {
    href: "/dashboard/comunicados",
    label: "Comunicados",
    icon: <FiMessageSquare className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
];

const GROUP_ORDER = ["Operación", "Comercial", "Reportes", "Configuración"];
// Mapea cada ruta a su grupo del sidebar. Rutas sin entrada (ej. Mi Ruta del
// repartidor) se muestran sueltas, sin encabezado de grupo.
const GROUP_BY_HREF: Record<string, string> = {
  "/dashboard/produccion": "Operación",
  "/dashboard/despacho": "Operación",
  "/dashboard/nuevo-pedido": "Operación",
  "/dashboard": "Operación",
  "/dashboard/resumen": "Operación",
  "/dashboard/mi-dia": "Operación",
  "/dashboard/clientes": "Comercial",
  "/dashboard/cobranzas": "Comercial",
  "/dashboard/comprobantes": "Comercial",
  "/dashboard/mis-metas": "Comercial",
  "/dashboard/reportes": "Reportes",
  "/dashboard/catalogo": "Configuración",
  "/dashboard/incentivos": "Configuración",
  "/dashboard/users": "Configuración",
  "/dashboard/autorizaciones": "Configuración",
  "/dashboard/comunicados": "Configuración",
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
  const userRole = session.user.role;

  const filteredNavItems = navItems.filter((item) => {
    // Si tiene roles definidos, solo mostrar a esos roles
    if (item.roles) return item.roles.includes(userRole);
    // Si es adminOnly, solo admins
    if (item.adminOnly) return userRole === "admin";
    // Si es repartidorOnly, solo repartidores
    if (item.repartidorOnly) return userRole === "repartidor";
    return true;
  });

  // Agrupación del sidebar: ítems sin grupo (ej. Mi Ruta) van sueltos arriba;
  // el resto se agrupa con encabezados según GROUP_BY_HREF.
  const sinGrupo = filteredNavItems.filter((i) => !GROUP_BY_HREF[i.href]);
  const grupos = GROUP_ORDER.map((nombre) => ({
    nombre,
    items: filteredNavItems.filter((i) => GROUP_BY_HREF[i.href] === nombre),
  })).filter((g) => g.items.length > 0);

  const isItemActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  // Link del sidebar móvil (label siempre visible)
  const mobileLink = (item: NavItem) => {
    const active = isItemActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all duration-200 cursor-pointer ${
          active
            ? "bg-gradient-to-r from-red-50 to-red-100/30 text-red-700 shadow-sm border-l-4 border-red-600 scale-[1.02]"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
      >
        <span className={`transition-transform duration-200 ${active ? "scale-110" : ""}`}>{item.icon}</span>
        <span>{item.label}</span>
      </Link>
    );
  };

  // Link del sidebar desktop (colapsado; label e ícono activo aparecen on hover)
  const desktopLink = (item: NavItem) => {
    const active = isItemActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-all duration-200 cursor-pointer ${
          active ? "bg-gradient-to-r from-red-50 to-red-100/30 text-red-700 shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
      >
        <span className={`flex-shrink-0 transition-all duration-200 ${active ? "text-red-600 scale-110" : "text-gray-400"}`}>{item.icon}</span>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
          {item.label}
        </span>
      </Link>
    );
  };

  // Render agrupado reutilizable. headerClass controla la visibilidad del título
  // (en desktop colapsado el título solo aparece on hover).
  const renderGrouped = (
    renderLink: (item: NavItem) => React.ReactNode,
    headerClass: string
  ) => (
    <>
      {sinGrupo.map(renderLink)}
      {grupos.map((g) => (
        <div key={g.nombre} className="pt-2">
          <p className={headerClass}>{g.nombre}</p>
          {g.items.map(renderLink)}
        </div>
      ))}
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            aria-label="Abrir menú"
          >
            <FiMenu className="h-6 w-6" />
          </button>
          <span className="font-bold text-gray-800">🐔 Transavic</span>
          <NotificationBell />
        </div>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar (full width) */}
      <aside
        className={`
          lg:hidden fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 
          transform transition-transform duration-300 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🐔</span>
              <span className="font-bold text-xl text-gray-800">Transavic</span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              aria-label="Cerrar menú"
            >
              <FiX className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            {renderGrouped(
              mobileLink,
              "px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400"
            )}
          </nav>

          <div className="border-t border-gray-200 p-4">
            <div className="mb-4 px-4">
              <p className="text-sm text-gray-500">Sesión iniciada como</p>
              <p className="font-semibold text-gray-800 truncate">
                {session.user.name}
              </p>
              <p className="text-xs text-gray-400 capitalize">{userRole}</p>
            </div>
            <form action={doLogout}>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-red-600 hover:bg-red-50 font-medium transition-colors cursor-pointer"
              >
                <FiLogOut className="h-5 w-5" />
                <span>Cerrar Sesión</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Desktop Sidebar - Colapsado con expansión on hover */}
      <aside
        className="
          hidden lg:flex fixed top-0 left-0 z-40 h-full 
          w-16 hover:w-64 
          bg-white border-r border-gray-200
          transition-all duration-300 ease-in-out
          group overflow-hidden
        "
      >
        <div className="flex flex-col h-full w-64">
          {/* Logo */}
          <div className="flex items-center px-4 py-5 border-b border-gray-200 h-16">
            <span className="text-2xl flex-shrink-0">🐔</span>
            <span className="font-bold text-xl text-gray-800 ml-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
              Transavic
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 min-h-0 px-2 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
            {renderGrouped(
              desktopLink,
              "px-3 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap"
            )}
          </nav>

          {/* User section (compacta para no robar alto al menú) */}
          <div className="border-t border-gray-200 p-2">
            {/* User info - visible on hover */}
            <div className="mb-1 px-3 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <p className="text-[11px] text-gray-500 leading-tight truncate">
                Sesión:{" "}
                <span className="font-semibold text-gray-800">{session.user.name}</span>
              </p>
            </div>
            <form action={doLogout}>
              <button
                type="submit"
                title="Cerrar Sesión"
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 font-medium transition-colors cursor-pointer"
              >
                <FiLogOut className="h-5 w-5 flex-shrink-0" />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                  Cerrar Sesión
                </span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Floating NotificationBell — desktop only (en mobile ya está en el header) */}
      <div className="hidden lg:block fixed top-3 right-4 z-30">
        <NotificationBell />
      </div>

      {/* Main content - ajustado para sidebar colapsado.
          pb-24 deja aire abajo para que el botón flotante de IA no tape acciones. */}
      <main className="lg:pl-16 pt-16 lg:pt-0 min-h-screen pb-24">{children}</main>

      {/* Botón flotante de IA (reemplaza el ítem del menú) */}
      <FloatingAssistant role={userRole} />

      {/* P2.9 — Búsqueda global Cmd+K. Disponible solo para admin/asesor
          (el repartidor opera con /mi-ruta, no necesita búsqueda transversal). */}
      {(userRole === "admin" || userRole === "asesor") && <CmdKModal />}

      {/* Popup de comunicados pendientes para los destinatarios */}
      <ComunicadoPopup />
    </div>
  );
}

// src/components/DashboardLayout.tsx

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Session } from "next-auth";
import { useState } from "react";
import {
  FiPlus,
  FiList,
  FiUsers,
  FiLogOut,
  FiMenu,
  FiX,
  FiPackage,
  FiBarChart2,
  FiClipboard,
} from "react-icons/fi";
import { doLogout } from "@/lib/actions";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  {
    href: "/dashboard/nuevo-pedido",
    label: "Nuevo Pedido",
    icon: <FiPlus className="h-5 w-5 flex-shrink-0" />,
  },
  {
    href: "/dashboard",
    label: "Lista de Pedidos",
    icon: <FiList className="h-5 w-5 flex-shrink-0" />,
  },
  {
    href: "/dashboard/productos",
    label: "Productos",
    icon: <FiPackage className="h-5 w-5 flex-shrink-0" />,
  },
  {
    href: "/dashboard/analytics",
    label: "Analítica",
    icon: <FiBarChart2 className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
  {
    href: "/dashboard/resumen",
    label: "Resumen Diario",
    icon: <FiClipboard className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
  {
    href: "/dashboard/users",
    label: "Usuarios",
    icon: <FiUsers className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
  },
];

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

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || userRole === "admin",
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
          <div className="w-10" />
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
            {filteredNavItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200
                    ${
                      isActive
                        ? "bg-red-50 text-red-700 border-l-4 border-red-600"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }
                  `}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              );
            })}
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
          <nav className="flex-1 px-2 py-6 space-y-2 overflow-y-auto overflow-x-hidden">
            {filteredNavItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={`
                    flex items-center gap-3 px-3 py-3 rounded-lg font-medium transition-all duration-200
                    ${
                      isActive
                        ? "bg-red-50 text-red-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }
                  `}
                >
                  <span
                    className={`flex-shrink-0 ${isActive ? "text-red-600" : ""}`}
                  >
                    {item.icon}
                  </span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="border-t border-gray-200 p-2">
            {/* User info - visible on hover */}
            <div className="mb-2 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <p className="text-xs text-gray-500">Sesión iniciada como</p>
              <p className="font-semibold text-gray-800 truncate text-sm">
                {session.user.name}
              </p>
            </div>
            <form action={doLogout}>
              <button
                type="submit"
                title="Cerrar Sesión"
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-red-600 hover:bg-red-50 font-medium transition-colors cursor-pointer"
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

      {/* Main content - ajustado para sidebar colapsado */}
      <main className="lg:pl-16 pt-16 lg:pt-0 min-h-screen">{children}</main>
    </div>
  );
}

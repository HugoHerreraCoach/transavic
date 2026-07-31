// src/app/dashboard/reportes/reportes-client.tsx
// Hub de Reportes con 5 vistas de propósito claro:
//   • Ventas          — reporte de análisis por período (dinero, ranking, productos).
//   • Día a día       — resumen operativo de un día puntual (pedidos + totales).
//   • Salida de Carnes — consolidado diario de kg de carnes despachados por canal.
//   • Cartera Asesoras — control financiero diario y de saldos por ejecutiva.
//   • Cuadre de Mermas — conciliación física diaria de ingresos vs salidas por producto.
"use client";

import { useState } from "react";
import { FiTrendingUp, FiClipboard, FiBox, FiUsers, FiActivity } from "react-icons/fi";
import VentasTab from "./ventas-tab";
import DiaTab from "./dia-tab";
import SalidaCarnesTab from "./salida-carnes-tab";
import CarteraAsesorasTab from "./cartera-asesoras-tab";
import CuadreMermasTab from "./cuadre-mermas-tab";
import CuadreConsolidadoTab from "./cuadre-consolidado-tab";
import InsightCard from "@/components/InsightCard";

type Tab = "ventas" | "dia" | "salida_carnes" | "cartera_asesoras" | "cuadre_mermas" | "cuadre_consolidado";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "ventas", label: "Ventas", icon: <FiTrendingUp /> },
  { id: "dia", label: "Día a día", icon: <FiClipboard /> },
  { id: "salida_carnes", label: "Salida de Productos", icon: <FiBox /> },
  { id: "cartera_asesoras", label: "Cartera Asesoras", icon: <FiUsers /> },
  { id: "cuadre_mermas", label: "Cuadre por Producto", icon: <FiClipboard /> },
  { id: "cuadre_consolidado", label: "Cuadre General", icon: <FiActivity /> },
];

interface UserProp {
  id: string;
  role: string;
  name?: string | null;
}

export default function ReportesClient({ user }: { user?: UserProp }) {
  const isProduccion = user?.role === "produccion";
  
  // El rol 'produccion' solo puede ver 'salida_carnes' y 'cuadre_mermas'
  const visibleTabs = TABS.filter((t) => {
    if (isProduccion) {
      return t.id === "salida_carnes" || t.id === "cuadre_mermas";
    }
    return true;
  });

  const [tab, setTab] = useState<Tab>(isProduccion ? "salida_carnes" : "ventas");

  return (
    <div className="bg-gray-50 min-h-screen pt-6">
      <div className="px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-gray-800">Reportes</h1>
        <div className="mt-3">
          <InsightCard tipo="dia" />
        </div>
        <div className="flex gap-1 border-b border-gray-200">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-semibold flex items-center gap-2 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === t.id
                  ? "border-red-600 text-red-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-6">
        {tab === "ventas" && <VentasTab />}
        {tab === "dia" && <DiaTab />}
        {tab === "salida_carnes" && <SalidaCarnesTab />}
        {tab === "cartera_asesoras" && <CarteraAsesorasTab user={user} />}
        {tab === "cuadre_mermas" && <CuadreMermasTab />}
        {tab === "cuadre_consolidado" && <CuadreConsolidadoTab />}
      </div>
    </div>
  );
}

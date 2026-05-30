// src/app/dashboard/reportes/reportes-client.tsx
// Hub de Reportes con 2 vistas de propósito claro:
//   • Ventas    — reporte de análisis por período (dinero, ranking, productos).
//   • Día a día — resumen operativo de un día puntual (pedidos + totales).
// Antes eran 3 vistas (Panel Gerencial + Analítica + Resumen) que se pisaban;
// se fusionaron las dos analíticas en "Ventas".
"use client";

import { useState } from "react";
import { FiTrendingUp, FiClipboard } from "react-icons/fi";
import VentasTab from "./ventas-tab";
import DiaTab from "./dia-tab";
import InsightCard from "@/components/InsightCard";

type Tab = "ventas" | "dia";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "ventas", label: "Ventas", icon: <FiTrendingUp /> },
  { id: "dia", label: "Día a día", icon: <FiClipboard /> },
];

export default function ReportesClient() {
  const [tab, setTab] = useState<Tab>("ventas");

  return (
    <div className="bg-gray-50 min-h-screen pt-6">
      <div className="px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-gray-800">Reportes</h1>
        <div className="mt-3">
          <InsightCard tipo="dia" />
        </div>
        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map((t) => (
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
      </div>
    </div>
  );
}

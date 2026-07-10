// src/app/dashboard/gastos/page.tsx
// Listado de gastos del negocio (los gastos se REGISTRAN desde Caja Diaria;
// aquí solo se consultan). Acceso: mismo alcance que Caja Diaria — admin +
// produccion (quien gestiona la caja). Asesoras/repartidores se redirigen.
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { FiTrendingDown } from "react-icons/fi";
import GastosClient from "./gastos-client";

export const metadata = {
  title: "Gastos | Transavic",
};

export default async function GastosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // Blocklist normalizado (mismo criterio que /dashboard/resumen): bloqueamos
  // SOLO a asesoras y repartidores; admin y producción siempre pasan, aunque
  // el role venga con bordes (espacio/mayúscula) de una sesión vieja.
  const rol = (session.user.role ?? "").trim().toLowerCase();
  if (rol === "asesor" || rol === "repartidor") {
    redirect("/dashboard");
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FiTrendingDown className="text-red-500" /> Gastos
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Historial de gastos del negocio. Los gastos se registran desde Caja Diaria.
        </p>
      </div>
      <GastosClient />
    </div>
  );
}

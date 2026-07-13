// src/app/dashboard/pos-planta/ventas/page.tsx
// "Ventas de Planta": lista de ventas del POS por fecha (Hoy/Ayer/Semana), con acción
// de ANULAR (reversa dinero + stock). admin + produccion. Pedido de Ariana (13 jul 2026).
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import VentasPlantaClient from "./ventas-planta-client";

export const metadata = {
  title: "Ventas de Planta | Transavic",
};

export default async function VentasPlantaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }
  return <VentasPlantaClient />;
}

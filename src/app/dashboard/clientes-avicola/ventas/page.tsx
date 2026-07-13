// src/app/dashboard/clientes-avicola/ventas/page.tsx
// "Ventas en Campo": lista de ventas del módulo Clientes Avícola por fecha (tipo Lista
// de Pedidos), con acción FACTURAR por venta. SOLO admin (Antonio hace la venta en campo).
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import VentasCampoClient from "./ventas-campo-client";

export const metadata = {
  title: "Ventas en Campo | Transavic",
};

export default async function VentasCampoPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <VentasCampoClient />;
}

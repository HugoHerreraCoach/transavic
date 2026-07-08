// src/app/dashboard/clientes-avicola/liquidacion/page.tsx
// Liquidación del día del módulo "Clientes Avícola" (req. §11) — SOLO admin.
// Server component: guard de rol y render del client (patrón pos-planta/page.tsx).
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LiquidacionClient from "./liquidacion-client";

export const metadata = {
  title: "Liquidación del día | Transavic",
};

export default async function LiquidacionAvicolaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <LiquidacionClient />;
}

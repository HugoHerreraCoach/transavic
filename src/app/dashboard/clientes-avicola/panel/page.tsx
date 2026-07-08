// src/app/dashboard/clientes-avicola/panel/page.tsx
// Panel gerencial del módulo "Clientes Avícola" (req. §14) — SOLO admin.
// Server component: guard de rol y render del client (patrón pos-planta/page.tsx).
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PanelClient from "./panel-client";

export const metadata = {
  title: "Panel avícola | Transavic",
};

export default async function PanelAvicolaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <PanelClient />;
}

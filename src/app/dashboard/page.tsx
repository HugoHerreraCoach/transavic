// src/app/dashboard/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/roles";
import DashboardContent from "./dashboard-content";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // La Lista de Pedidos es para admin y asesoras. Producción y repartidor
  // tienen su propia pantalla (homeForRole evita el loop de redirección).
  if (!["admin", "asesor"].includes(session.user.role)) {
    redirect(homeForRole(session.user.role));
  }

  return <DashboardContent session={session} />;
}
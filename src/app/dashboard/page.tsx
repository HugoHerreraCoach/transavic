// src/app/dashboard/page.tsx

import { auth } from "@/auth";
import DashboardContent from "./dashboard-content";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();

  // El layout ya maneja la autenticación, pero necesitamos la sesión para el contenido
  if (!session?.user) {
    return null;
  }

  if (session.user.role === "repartidor") {
    redirect("/dashboard/mi-ruta");
  }

  return <DashboardContent session={session} />;
}
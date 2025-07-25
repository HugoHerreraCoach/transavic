// src/app/dashboard/page.tsx

import { auth } from "@/auth"; // 👈 Importa 'auth'
import DashboardContent from "./dashboard-content";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  // Obtenemos la sesión del usuario en el servidor
  const session = await auth();

  // Si por alguna razón no hay sesión, redirigimos al login
  if (!session?.user) {
    redirect("/login");
  }

  // Pasamos la sesión completa al componente cliente
  return <DashboardContent session={session} />;
}
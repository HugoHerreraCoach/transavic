// src/app/dashboard/clientes/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/roles";
import ClientesClient from "./clientes-client";

export default async function ClientesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }
  // Clientes es de admin y asesoras (no de producción/repartidor).
  if (!["admin", "asesor"].includes(session.user.role)) {
    redirect(homeForRole(session.user.role));
  }

  return (
    <ClientesClient
      userId={session.user.id}
      userName={session.user.name}
      userRole={session.user.role}
    />
  );
}

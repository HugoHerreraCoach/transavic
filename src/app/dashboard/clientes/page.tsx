// src/app/dashboard/clientes/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ClientesClient from "./clientes-client";

export default async function ClientesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <ClientesClient
      userId={session.user.id}
      userName={session.user.name}
      userRole={session.user.role}
    />
  );
}

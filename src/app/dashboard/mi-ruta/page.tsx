// src/app/dashboard/mi-ruta/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import MiRutaContent from "./mi-ruta-content";

export default async function MiRutaPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Tanto repartidores como admins pueden ver esta página
  // (admin puede usarla para testing/demo)
  return <MiRutaContent session={session} />;
}

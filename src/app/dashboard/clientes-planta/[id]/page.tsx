// src/app/dashboard/clientes-planta/[id]/page.tsx
// Ficha de UN cliente de planta (admin + produccion). Server component thin:
// guard de rol + render del client component, que hace el fetch de la ficha para
// poder refrescarla tras cada acción (edición) sin recargar la página.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import FichaPlantaClient from "./ficha-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ficha del cliente de planta | Transavic",
};

export default async function FichaClientePlantaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }

  const { id } = await params;
  return <FichaPlantaClient clienteId={id} />;
}

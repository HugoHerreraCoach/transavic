// src/app/dashboard/clientes-avicola/[id]/page.tsx
// Ficha 360 de UN cliente del módulo "Clientes Avícola" (ADMIN-only).
// Server component thin: guard de rol + render del client component, que hace
// el fetch de la ficha para poder refrescarla tras cada acción (venta, abono,
// anulación, edición) sin recargar la página.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import FichaAvicolaClient from "./ficha-client";

export const metadata = {
  title: "Ficha del cliente avícola | Transavic",
};

export default async function FichaClienteAvicolaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  const { id } = await params;
  return <FichaAvicolaClient clienteId={id} />;
}

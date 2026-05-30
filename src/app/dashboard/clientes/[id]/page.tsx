// src/app/dashboard/clientes/[id]/page.tsx
// Perfil 360° del cliente (server component).
// El client component se encarga de fetchear /api/clientes/[id]/perfil y
// renderizar todo. Acá solo validamos sesión + pasamos el id.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PerfilClienteClient from "./perfil-client";

export const dynamic = "force-dynamic";

export default async function PerfilClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin" && session.user.role !== "asesor") {
    redirect("/dashboard");
  }
  const { id } = await params;
  return <PerfilClienteClient clienteId={id} userRole={session.user.role} />;
}

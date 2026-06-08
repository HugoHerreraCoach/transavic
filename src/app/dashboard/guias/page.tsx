// src/app/dashboard/guias/page.tsx
// Redirige a la vista unificada de documentos SUNAT con el filtro de guías activado.
// Los enlaces existentes que apunten a /dashboard/guias seguirán funcionando.
import { auth } from "@/auth";
import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ pedido_id?: string }>;
}

export default async function GuiasPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) redirect("/dashboard");

  const { pedido_id } = await searchParams;
  const destino = pedido_id
    ? `/dashboard/comprobantes?tipo=09&pedido_id=${pedido_id}`
    : "/dashboard/comprobantes?tipo=09";

  redirect(destino);
}

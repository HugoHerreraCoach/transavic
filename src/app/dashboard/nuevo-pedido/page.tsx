// src/app/dashboard/nuevo-pedido/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/roles";
import { fetchAsesores } from '@/lib/data';
import PedidoForm from '@/components/PedidoForm';

export default async function NuevoPedidoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Solo admin y asesoras crean pedidos. Producción/repartidor van a su pantalla.
  if (!["admin", "asesor"].includes(session.user.role)) {
    redirect(homeForRole(session.user.role));
  }

  const asesores = await fetchAsesores();

  return (
    <PedidoForm
      asesores={asesores}
      currentUser={{
        id: session.user.id,
        name: session.user.name ?? "",
        role: session.user.role,
      }}
    />
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission } from "@/lib/roles";
import ComprasClient from "./compras-client";

export const metadata = {
  title: "Módulo de Compras | Transavic",
};

export default async function ComprasPage() {
  const session = await auth();
  
  if (!session?.user) {
    redirect("/login");
  }

  // Verificar si tiene permiso para gestionar compras (admin y produccion)
  if (!hasPermission(session.user.role, "CAN_MANAGE_PURCHASES")) {
    // Si no tiene permisos, lo devolvemos a su pantalla principal
    redirect("/"); 
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-gray-900">
          Ingreso de Mercadería (Compras)
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Registra el pollo vivo o procesado que ingresa a planta y calcula las mermas automáticamente.
        </p>
      </div>

      <ComprasClient />
    </div>
  );
}

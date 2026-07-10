// src/app/dashboard/configuracion/page.tsx
// Parámetros del negocio editables por el ADMIN sin programador (flexibilización
// 10 jul 2026). Los valores viven en settings.parametros_negocio; si nunca se
// guardó nada, el sistema usa los defaults históricos (src/lib/parametros-negocio.ts).
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ConfiguracionClient from "./configuracion-client";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Configuración del negocio</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cambia estos parámetros sin tocar el código. Se aplican de inmediato en todo el sistema.
        </p>
      </header>
      <ConfiguracionClient />
    </div>
  );
}

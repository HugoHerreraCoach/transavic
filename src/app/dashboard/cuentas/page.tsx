import { redirect } from "next/navigation";
import { auth } from "@/auth";
import CuentasClient from "./cuentas-client";

export const metadata = {
  title: "Cuentas Bancarias | Transavic",
};

export default async function CuentasPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Solo admin puede gestionar cuentas
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <main className="p-4 md:p-8 max-w-5xl mx-auto w-full">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Cuentas Bancarias</h1>
          <p className="text-gray-500 mt-1 text-sm md:text-base">
            Gestiona las cuentas y cajas para registrar ingresos del POS y otras ventas.
          </p>
        </div>
      </div>
      <CuentasClient />
    </main>
  );
}

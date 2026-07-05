// src/app/dashboard/cuentas-por-pagar/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CuentasPorPagarClient from "./cuentas-por-pagar-client";

export const metadata = {
  title: "Cuentas por Pagar | Transavic",
};

export default async function CuentasPorPagarPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <CuentasPorPagarClient />
    </div>
  );
}

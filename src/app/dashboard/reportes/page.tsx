// src/app/dashboard/reportes/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ReportesClient from "./reportes-client";
import BetaPlaceholder from "@/components/BetaPlaceholder";

export default async function ReportesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin" && session.user.role !== "asesor") redirect("/dashboard");
  
  if (session.user.role === "asesor") {
    return (
      <BetaPlaceholder 
        title="Reportes de Ventas" 
        description="Estamos construyendo un panel exclusivo donde podrás visualizar tu progreso detallado, comisiones proyectadas y ranking. ¡Pronto estará disponible!"
      />
    );
  }

  return <ReportesClient />;
}

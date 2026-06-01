// src/app/dashboard/resumen/page.tsx
// "Resumen del día": totales por producto para preparar (uso de producción).
// Acceso: admin + produccion (quien prepara la mercadería). Asesoras/repartidores
// no entran (se les redirige). El reporte de análisis por rango sigue en /reportes.
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ResumenClient from "./resumen-client";

export default async function ResumenPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  return <ResumenClient />;
}

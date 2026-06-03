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
  // Bloqueamos SOLO a asesoras y repartidores (no es su herramienta). Admin y
  // producción SIEMPRE pasan. Antes era un allowlist estricto (`["admin","produccion"].includes`)
  // que rebotaba al admin a /dashboard si el role traía algún borde (espacio/mayúscula
  // o una sesión vieja sin normalizar). Con blocklist normalizado, el admin nunca se
  // queda fuera de su propia herramienta.
  const rol = (session.user.role ?? "").trim().toLowerCase();
  if (rol === "asesor" || rol === "repartidor") {
    redirect("/dashboard");
  }
  return <ResumenClient />;
}

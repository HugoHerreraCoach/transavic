// src/app/dashboard/analytics/page.tsx
// Ruta legacy: Analítica ahora vive dentro de /dashboard/reportes (pestaña).
import { redirect } from "next/navigation";

export default function AnalyticsRedirect() {
  redirect("/dashboard/reportes");
}

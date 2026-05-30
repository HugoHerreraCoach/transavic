// src/app/dashboard/resumen/page.tsx
// Ruta legacy: Resumen Diario ahora vive dentro de /dashboard/reportes (pestaña).
import { redirect } from "next/navigation";

export default function ResumenRedirect() {
  redirect("/dashboard/reportes");
}

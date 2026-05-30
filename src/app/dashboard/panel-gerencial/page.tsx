// src/app/dashboard/panel-gerencial/page.tsx
// Ruta legacy: Panel Gerencial ahora vive dentro de /dashboard/reportes (pestaña).
import { redirect } from "next/navigation";

export default function PanelGerencialRedirect() {
  redirect("/dashboard/reportes");
}

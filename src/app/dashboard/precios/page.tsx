// src/app/dashboard/precios/page.tsx
// Ruta legacy: Precios ahora vive dentro de /dashboard/catalogo (pestaña).
import { redirect } from "next/navigation";

export default function PreciosRedirect() {
  redirect("/dashboard/catalogo");
}

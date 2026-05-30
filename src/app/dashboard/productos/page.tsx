// src/app/dashboard/productos/page.tsx
// Ruta legacy: Productos ahora vive dentro de /dashboard/catalogo (pestaña).
import { redirect } from "next/navigation";

export default function ProductosRedirect() {
  redirect("/dashboard/catalogo");
}

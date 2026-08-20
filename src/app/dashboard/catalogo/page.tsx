// src/app/dashboard/catalogo/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CatalogoClient from "./catalogo-client";

export default async function CatalogoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Admin: gestión completa. Asesoras: SOLO LECTURA de la lista de precios
  // (sin precio de compra ni margen) — pedido de Antonio, 11 jun 2026.
  if (!["admin", "asesor"].includes(session.user.role)) redirect("/dashboard");
  const esAdmin = session.user.role === "admin";
  // El admin puede por su rol; una asesora, solo si Antonio le prendió el permiso
  // en el modal de usuarios (users.puede_editar_precio_venta, 20 ago 2026).
  const puedeEditarPrecioVenta =
    esAdmin ||
    (session.user.role === "asesor" && session.user.puede_editar_precio_venta === true);
  return <CatalogoClient isAdmin={esAdmin} puedeEditarPrecioVenta={puedeEditarPrecioVenta} />;
}

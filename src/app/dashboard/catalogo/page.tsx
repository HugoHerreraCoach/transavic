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
  return <CatalogoClient isAdmin={session.user.role === "admin"} />;
}

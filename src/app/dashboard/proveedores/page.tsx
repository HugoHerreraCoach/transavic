// src/app/dashboard/proveedores/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ProveedoresClient from "./proveedores-client";

export const metadata = {
  title: "Directorio de Proveedores | Transavic",
};

export default async function ProveedoresPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin" && session.user.role !== "produccion") redirect("/dashboard");
  
  return <ProveedoresClient userRole={session.user.role} />;
}

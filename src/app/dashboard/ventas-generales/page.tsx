// src/app/dashboard/ventas-generales/page.tsx
// "Ventas Generales": las 3 operaciones de venta (Ejecutivas / Campo / Planta) en UNA
// vista clara, por día / día anterior / fecha. SOLO admin. Responde a la confusión de
// Antonio ("¿dónde están las ventas generales?").
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import VentasGeneralesClient from "./ventas-generales-client";

export const metadata = {
  title: "Ventas Generales | Transavic",
};

export default async function VentasGeneralesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <VentasGeneralesClient />;
}

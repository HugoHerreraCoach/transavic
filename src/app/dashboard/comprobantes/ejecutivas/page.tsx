// src/app/dashboard/comprobantes/ejecutivas/page.tsx
// "Comprobantes — Ejecutivas": la MISMA lista, amarrada a la operación Ejecutivas
// (ventas normales de las asesoras). admin + asesor (el endpoint scopea por asesora).
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ComprobantesClient from "../comprobantes-client";

export const metadata = {
  title: "Comprobantes — Ejecutivas | Transavic",
};

export default async function ComprobantesEjecutivasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) redirect("/dashboard");
  return <ComprobantesClient userRole={session.user.role} operacionFija="ejecutivas" />;
}

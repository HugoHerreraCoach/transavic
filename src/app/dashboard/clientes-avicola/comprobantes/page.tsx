// src/app/dashboard/clientes-avicola/comprobantes/page.tsx
// "Comprobantes de Campo": la MISMA lista de comprobantes, amarrada a la operación
// Campo (venta en campo). SOLO admin. Reutiliza ComprobantesClient con operacionFija.
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ComprobantesClient from "../../comprobantes/comprobantes-client";

export const metadata = {
  title: "Comprobantes de Campo | Transavic",
};

export default async function ComprobantesCampoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");
  return <ComprobantesClient userRole={session.user.role} operacionFija="campo" />;
}

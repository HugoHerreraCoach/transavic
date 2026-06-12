// src/app/dashboard/autorizaciones/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AutorizacionesClient } from "./autorizaciones-client";

export const dynamic = "force-dynamic";

export default async function AutorizacionesPage() {
  const session = await auth();
  // Admin gestiona; la asesora ve LAS SUYAS en solo lectura (el GET ya scopea)
  // y puede usar una aprobada con "Emitir con esta autorización" — antes era
  // solo-admin y la asesora no tenía NINGUNA vía para retomar su aprobación.
  if (!session?.user || !["admin", "asesor"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  return <AutorizacionesClient esAdmin={session.user.role === "admin"} />;
}

// src/app/dashboard/comprobantes/nuevo/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getSunatConfig } from "@/lib/sunat/config-transavic";
import EmitirComprobanteClient from "./emitir-client";

export default async function NuevoComprobantePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) redirect("/dashboard");

  // Datos públicos del emisor (RUC + razón social) — para que el form muestre
  // claramente con qué empresa se emite. No expone secretos (cert/clave SOL).
  const tra = getSunatConfig("transavic");
  const avi = getSunatConfig("avicola");
  const empresas = {
    transavic: { ruc: tra.ruc, razonSocial: tra.razonSocial },
    avicola: { ruc: avi.ruc, razonSocial: avi.razonSocial },
  };

  return <EmitirComprobanteClient empresas={empresas} />;
}

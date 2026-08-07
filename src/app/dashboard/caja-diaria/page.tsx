// src/app/dashboard/caja-diaria/page.tsx
// Acceso: mismo alcance que Gastos — admin + produccion (quien gestiona la
// caja). Antes esta página no validaba NADA y cualquier usuario logueado la
// abría; las APIs sí protegían, así que no veía datos, pero llegaba a una
// pantalla que no le corresponde.
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CajaDiariaClient from "./caja-diaria-client";

export const metadata = {
  title: "Caja Diaria | Transavic",
};

export default async function CajaDiariaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // Blocklist normalizado (mismo criterio que /dashboard/gastos): se bloquea
  // SOLO a asesoras y repartidores; admin y producción siempre pasan, aunque el
  // role venga con bordes (espacio/mayúscula) de una sesión vieja.
  const rol = (session.user.role ?? "").trim().toLowerCase();
  if (rol === "asesor" || rol === "repartidor") {
    redirect("/dashboard");
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <CajaDiariaClient esAdmin={rol === "admin"} />
    </div>
  );
}

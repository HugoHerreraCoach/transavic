// src/app/dashboard/despacho/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/roles";
import DespachoContent from "./despacho-content";

export default async function DespachoPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Despacho lo ven el admin (gestión completa) y la asesora (SOLO LECTURA:
  // monitorea motorizados y entregas en vivo). Repartidor/producción tienen
  // su propia pantalla → se les manda a su home.
  const rol = session.user.role;
  if (rol !== "admin" && rol !== "asesor") {
    redirect(homeForRole(rol));
  }

  return <DespachoContent session={session} />;
}

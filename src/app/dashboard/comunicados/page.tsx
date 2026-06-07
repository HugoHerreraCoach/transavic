// src/app/dashboard/comunicados/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/roles";
import ComunicadosClient from "./comunicados-client";

export default async function ComunicadosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect(homeForRole(session.user.role));
  return <ComunicadosClient />;
}

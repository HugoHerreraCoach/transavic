// src/app/dashboard/asistente-ia/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AsistenteIAClient from "./asistente-ia-client";

export default async function AsistenteIAPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") redirect("/dashboard");
  return (
    <AsistenteIAClient
      role={role as "admin" | "asesor"}
      nombre={session.user.name}
    />
  );
}

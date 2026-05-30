// src/app/dashboard/cobranzas/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CobranzasClient from "./cobranzas-client";

export default async function CobranzasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) redirect("/dashboard");
  return <CobranzasClient userRole={session.user.role} />;
}

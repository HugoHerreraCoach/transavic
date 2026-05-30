// src/app/dashboard/comprobantes/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ComprobantesClient from "./comprobantes-client";

export default async function ComprobantesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) redirect("/dashboard");
  return <ComprobantesClient userRole={session.user.role} />;
}

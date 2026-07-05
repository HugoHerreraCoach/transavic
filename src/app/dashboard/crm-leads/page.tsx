// src/app/dashboard/crm-leads/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CrmLeadsClient from "./crm-leads-client";

export default async function CrmLeadsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin" && session.user.role !== "asesor") {
    redirect("/dashboard");
  }
  
  const mappedUser = {
    id: session.user.id || "",
    name: session.user.name || "",
    role: session.user.role || "",
  };

  return <CrmLeadsClient sessionUser={mappedUser} />;
}

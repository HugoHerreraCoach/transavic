// src/app/dashboard/mis-metas/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import MisMetasClient from "./mis-metas-client";

export default async function MisMetasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["asesor", "admin"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  return (
    <MisMetasClient
      nombre={session.user.name}
      esVistaPrevia={session.user.role === "admin"}
    />
  );
}

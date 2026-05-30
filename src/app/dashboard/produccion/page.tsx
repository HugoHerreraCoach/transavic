// src/app/dashboard/produccion/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ProduccionClient from "./produccion-client";

export default async function ProduccionPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  return <ProduccionClient />;
}

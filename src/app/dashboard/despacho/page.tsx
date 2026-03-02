// src/app/dashboard/despacho/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DespachoContent from "./despacho-content";

export default async function DespachoPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <DespachoContent session={session} />;
}

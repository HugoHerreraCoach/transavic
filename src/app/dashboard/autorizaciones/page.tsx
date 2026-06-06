// src/app/dashboard/autorizaciones/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AutorizacionesClient } from "./autorizaciones-client";

export const dynamic = "force-dynamic";

export default async function AutorizacionesPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/dashboard");
  }
  return <AutorizacionesClient />;
}

// src/app/dashboard/mi-dia/page.tsx
// Panel "Mi día" — server component, valida rol y pasa al client.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import MiDiaClient from "./mi-dia-client";

export const dynamic = "force-dynamic";

export default async function MiDiaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // El panel está pensado para asesoras; admin lo ve como vista previa.
  if (session.user.role !== "asesor" && session.user.role !== "admin") {
    redirect("/dashboard");
  }
  return <MiDiaClient nombre={session.user.name ?? "Asesor/a"} role={session.user.role} />;
}

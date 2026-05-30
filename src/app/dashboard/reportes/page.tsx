// src/app/dashboard/reportes/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ReportesClient from "./reportes-client";

export default async function ReportesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");
  return <ReportesClient />;
}

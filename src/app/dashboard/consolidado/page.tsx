// src/app/dashboard/consolidado/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ConsolidadoClient from "./consolidado-client";

export const metadata = {
  title: "Consolidado Antonio | Transavic",
};

export default async function ConsolidadoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <ConsolidadoClient />
    </div>
  );
}

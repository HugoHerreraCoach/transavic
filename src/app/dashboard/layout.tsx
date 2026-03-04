// src/app/dashboard/layout.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import VersionChecker from "@/components/VersionChecker";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardLayout session={session}>
      {children}
      <VersionChecker />
    </DashboardLayout>
  );
}

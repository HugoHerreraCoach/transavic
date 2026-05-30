// src/app/dashboard/incentivos/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/roles";
import IncentivosClient from "./incentivos-client";

export default async function IncentivosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect(homeForRole(session.user.role));
  return <IncentivosClient />;
}

// src/app/dashboard/catalogo/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CatalogoClient from "./catalogo-client";

export default async function CatalogoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");
  return <CatalogoClient />;
}

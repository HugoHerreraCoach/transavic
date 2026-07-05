// src/app/dashboard/prestamos/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import PrestamosClient from "./prestamos-client";

export default async function PrestamosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin" && session.user.role !== "produccion") redirect("/dashboard");
  
  return <PrestamosClient />;
}

// src/app/dashboard/productos/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ProductosClient from "./productos-client";

export default async function ProductosPage() {
  const session = await auth();

  if (session?.user?.role !== 'admin') {
    redirect('/dashboard');
  }

  return <ProductosClient />;
}

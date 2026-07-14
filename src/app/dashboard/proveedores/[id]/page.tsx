import { auth } from "@/auth";
import { redirect } from "next/navigation";
import FichaProveedorClient from "./ficha-proveedor-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ficha financiera del proveedor | Transavic",
};

export default async function FichaProveedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/proveedores");
  const { id } = await params;
  return <FichaProveedorClient proveedorId={id} />;
}


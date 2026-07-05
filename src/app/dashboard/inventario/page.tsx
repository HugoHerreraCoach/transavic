import { redirect } from "next/navigation";
import { auth } from "@/auth";
import InventarioClient from "./inventario-client";

export const metadata = {
  title: "Inventario de Lotes | Transavic",
};

export default async function InventarioPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Admin o produccion
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }

  return (
    <main className="p-4 md:p-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inventario de Mercadería</h1>
        <p className="text-gray-500 mt-1 text-sm md:text-base">
          Vista de saldos y stock por producto. Puede ser negativo (modelo flexible).
        </p>
      </div>
      <InventarioClient />
    </main>
  );
}

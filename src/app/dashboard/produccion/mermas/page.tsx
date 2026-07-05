import { redirect } from "next/navigation";
import { auth } from "@/auth";
import MermasClient from "./mermas-client";

export const metadata = {
  title: "Calculadora de Mermas | Producción",
};

export default async function MermasPage() {
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
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Calculadora de Mermas</h1>
        <p className="text-gray-500 mt-1 text-sm md:text-base">
          Registra el rendimiento diario del proceso de pollo beneficiado.
        </p>
      </div>
      <MermasClient />
    </main>
  );
}

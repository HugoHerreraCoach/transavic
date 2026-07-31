import { redirect } from "next/navigation";
import { auth } from "@/auth";
import CuadrePolloClient from "./cuadre-pollo-client";

export const metadata = {
  title: "Cuadre de Pollo | Producción",
};

export default async function CuadrePolloPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }

  return (
    <main className="p-4 md:p-8 max-w-5xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Cuadre de Pollo</h1>
        <p className="text-gray-500 mt-1 text-sm md:text-base">
          Compara los kilos de pollo vivo que entraron contra todo lo que salió, para saber si la
          merma del día fue normal.
        </p>
      </div>
      <CuadrePolloClient />
    </main>
  );
}

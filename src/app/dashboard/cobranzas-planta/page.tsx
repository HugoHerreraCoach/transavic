import { redirect } from "next/navigation";
import { auth } from "@/auth";
import CobranzasPlantaClient from "./cobranzas-planta-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cobranzas de Planta | Transavic",
};

export default async function CobranzasPlantaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // El POS/planta lo operan admin Y producción → ambos ven su cobranza.
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }

  return (
    <main className="p-4 md:p-6 w-full max-w-3xl mx-auto">
      <CobranzasPlantaClient />
    </main>
  );
}

// src/app/dashboard/clientes-planta/page.tsx
// HOME del módulo "Clientes de Planta" (directorio propio del POS / operación 3).
// Solo admin y produccion. Precarga la lista con saldos calculados (src/lib/planta/saldos.ts).
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { listaClientesPlantaConSaldo } from "@/lib/planta/saldos";
import ListaClientesPlanta from "./lista-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Clientes de Planta | Transavic",
};

export default async function ClientesPlantaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }

  const sql = neon(process.env.DATABASE_URL!);
  const clientes = await listaClientesPlantaConSaldo(sql);

  return (
    <main className="p-4 md:p-6 w-full max-w-3xl mx-auto">
      <ListaClientesPlanta clientesIniciales={clientes} />
    </main>
  );
}

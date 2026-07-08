// src/app/dashboard/clientes-avicola/page.tsx
// HOME del módulo Clientes Avícola (venta en campo del Gerente General).
// Solo admin. Precarga la lista con saldos calculados (src/lib/avicola/saldos.ts).
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { listaClientesConSaldo } from "@/lib/avicola/saldos";
import ListaClientesAvicola from "./lista-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Clientes Avícola | Transavic",
};

export default async function ClientesAvicolaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  const sql = neon(process.env.DATABASE_URL!);
  const clientes = await listaClientesConSaldo(sql);

  // Mercados únicos para los chips de filtro y el datalist del form
  const mercados = Array.from(new Set(clientes.map((c) => c.mercado))).sort(
    (a, b) => a.localeCompare(b, "es")
  );

  return (
    <main className="p-4 md:p-6 w-full max-w-3xl mx-auto">
      <ListaClientesAvicola clientesIniciales={clientes} mercados={mercados} />
    </main>
  );
}

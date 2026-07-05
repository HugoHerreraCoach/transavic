import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PosClient from "./pos-client";
import { neon } from "@neondatabase/serverless";

export const metadata = {
  title: "Venta Rápida (POS) | Transavic",
};

export default async function PosPlantaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    redirect("/dashboard");
  }

  // Pre-cargar productos activos
  const sql = neon(process.env.DATABASE_URL!);
  const productosRaw = await sql`
    SELECT id, nombre, categoria, precio_venta, unidad 
    FROM productos 
    WHERE activo = TRUE 
    ORDER BY categoria, nombre ASC
  `;
  const productos = productosRaw.map(p => ({
    id: p.id as string,
    nombre: p.nombre as string,
    categoria: p.categoria as string,
    precio_venta: Number(p.precio_venta),
    unidades: p.unidad as string
  }));

  return (
    <main className="p-4 md:p-6 w-full max-w-7xl mx-auto flex flex-col h-[calc(100vh-80px)] overflow-hidden">
      <div className="flex-shrink-0 mb-4">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Punto de Venta - Producción</h1>
      </div>
      <PosClient productosInit={productos} />
    </main>
  );
}

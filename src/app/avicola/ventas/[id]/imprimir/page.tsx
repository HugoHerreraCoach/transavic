// src/app/avicola/ventas/[id]/imprimir/page.tsx
// Página HTML pública para la impresión de la "Guía de Venta" de campo de Avícola de Tony
// (Documento interno informal que se imprime en tiqueteras de 80mm o en hojas A4, sin usar librerías PDF).
import { neon } from "@neondatabase/serverless";
import { guiaDeVenta } from "@/lib/avicola/guia";
import { notFound } from "next/navigation";
import VentaImprimibleClient from "./imprimir-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VentaImprimirPage({ params }: PageProps) {
  const { id } = await params;
  const sql = neon(process.env.DATABASE_URL!);

  // Cargar datos completos de la venta y estado de cuenta
  const data = await guiaDeVenta(sql, id);
  if (!data) return notFound();

  return <VentaImprimibleClient data={data} />;
}

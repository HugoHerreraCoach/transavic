// src/app/dashboard/clientes-avicola/[id]/venta/page.tsx
// Pantalla de VENTA RÁPIDA del módulo Clientes Avícola (server component).
// La usa el Gerente General EN CAMPO: debe cargarse con todo listo para que la
// venta tome menos de un minuto. Precarga: estado de cuenta del cliente,
// catálogo activo y el ÚLTIMO precio pactado con ESTE cliente por producto.
import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { estadoCuentaCliente } from "@/lib/avicola/saldos";
import VentaAvicolaClient, { type ProductoVentaAvicola } from "./venta-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Venta en campo | Transavic",
};

/** Un id que no es UUID nunca va a existir — 404 antes de tocar la DB. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VentaAvicolaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const sql = neon(process.env.DATABASE_URL!);

  const [cliente, productosRaw, preciosRaw] = await Promise.all([
    // (a) Estado de cuenta del cliente (saldo actual para el header y el footer).
    estadoCuentaCliente(sql, id),
    // (b) Catálogo activo (mismo orden que el POS: categoría, nombre).
    sql`
      SELECT id, nombre, categoria, COALESCE(precio_venta, 0)::float8 AS precio_venta
      FROM productos
      WHERE activo = TRUE
      ORDER BY categoria, nombre
    `,
    // (c) Último precio pactado con ESTE cliente por producto (ventas no anuladas).
    sql`
      SELECT DISTINCT ON (vi.producto_id)
        vi.producto_id,
        vi.precio_kg::float8 AS precio_kg
      FROM venta_avicola_items vi
      JOIN ventas_avicola v ON v.id = vi.venta_id
      WHERE v.cliente_id = ${id}
        AND NOT v.anulada
        AND vi.producto_id IS NOT NULL
      ORDER BY vi.producto_id, v.created_at DESC
    `,
  ]);

  if (!cliente) notFound();

  const productos: ProductoVentaAvicola[] = (
    productosRaw as Array<{
      id: string;
      nombre: string;
      categoria: string;
      precio_venta: number;
    }>
  ).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    precio_venta: p.precio_venta,
  }));

  const ultimosPrecios: Record<string, number> = {};
  for (const fila of preciosRaw as Array<{
    producto_id: string;
    precio_kg: number;
  }>) {
    ultimosPrecios[fila.producto_id] = fila.precio_kg;
  }

  return (
    <VentaAvicolaClient
      cliente={cliente}
      productos={productos}
      ultimosPrecios={ultimosPrecios}
    />
  );
}

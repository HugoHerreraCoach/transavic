// src/app/dashboard/clientes-avicola/[id]/venta/page.tsx
// Pantalla de VENTA RÁPIDA del módulo Clientes Avícola (server component).
// La usa el Gerente General EN CAMPO: debe cargarse con todo listo para que la
// venta tome menos de un minuto. Precarga: estado de cuenta del cliente,
// catálogo activo y el ÚLTIMO precio pactado con ESTE cliente por producto.
// También soporta edición de venta mediante el query param ?edit=ventaId.
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const sp = await searchParams;
  const edit = sp.edit;
  const editId = typeof edit === "string" && UUID_REGEX.test(edit) ? edit : null;

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

  // Cargar venta existente si estamos en modo edición
  let ventaExistente = null;
  if (editId) {
    const ventaRow = await sql`
      SELECT id, numero_guia, fecha::text as fecha, observaciones
      FROM ventas_avicola
      WHERE id = ${editId} AND NOT anulada AND cliente_id = ${id}
    `;
    if (ventaRow.length > 0) {
      const itemsRows = await sql`
        SELECT 
          producto_id,
          producto_nombre,
          peso_kg::float8 AS peso,
          precio_kg::float8 AS precio
        FROM venta_avicola_items
        WHERE venta_id = ${editId}
        ORDER BY created_at ASC
      `;
      ventaExistente = {
        id: ventaRow[0].id,
        numero_guia: ventaRow[0].numero_guia,
        fecha: ventaRow[0].fecha,
        observaciones: ventaRow[0].observaciones,
        items: (itemsRows as Array<{
          producto_id: string | null;
          producto_nombre: string;
          peso: number;
          precio: number;
        }>).map((it) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre,
          peso: String(it.peso),
          precio: String(it.precio),
        })),
      };
    }
  }

  return (
    <VentaAvicolaClient
      cliente={cliente}
      productos={productos}
      ultimosPrecios={ultimosPrecios}
      ventaExistente={ventaExistente}
    />
  );
}

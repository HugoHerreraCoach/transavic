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

  const [cliente, productosRaw, historialRaw, masVendidosRaw, ultimaVentaRaw, ventaHoyRaw] =
    await Promise.all([
      // (a) Estado de cuenta del cliente (saldo actual para el header y el footer).
      estadoCuentaCliente(sql, id),
      // (b) Catálogo activo (mismo orden que el POS: categoría, nombre).
      sql`
        SELECT id, nombre, categoria, COALESCE(precio_venta, 0)::float8 AS precio_venta
        FROM productos
        WHERE activo = TRUE
        ORDER BY categoria, nombre
      `,
      // (c) "Lo de siempre" de ESTE cliente: cuántas VECES le compró cada producto
      //     y a qué precio la última vez. Ordenado por frecuencia (desempate: lo más
      //     reciente). Alimenta el orden de la sección + los precios precargados.
      sql`
        SELECT
          vi.producto_id,
          COUNT(DISTINCT v.id)::int AS veces,
          (ARRAY_AGG(vi.precio_kg ORDER BY v.created_at DESC))[1]::float8 AS ultimo_precio
        FROM venta_avicola_items vi
        JOIN ventas_avicola v ON v.id = vi.venta_id
        WHERE v.cliente_id = ${id}
          AND NOT v.anulada
          AND vi.producto_id IS NOT NULL
        GROUP BY vi.producto_id
        ORDER BY veces DESC, MAX(v.created_at) DESC
      `,
      // (d) Top del módulo (todas las ventas de campo): se usa SOLO cuando el cliente
      //     es nuevo y no tiene historial propio, para que igual arranque con algo útil.
      sql`
        SELECT vi.producto_id, COUNT(DISTINCT v.id)::int AS veces
        FROM venta_avicola_items vi
        JOIN ventas_avicola v ON v.id = vi.venta_id
        WHERE NOT v.anulada AND vi.producto_id IS NOT NULL
        GROUP BY vi.producto_id
        ORDER BY veces DESC
        LIMIT 8
      `,
      // (e) Ítems de la ÚLTIMA venta del cliente → botón "Repetir última venta".
      sql`
        SELECT vi.producto_id, vi.producto_nombre, vi.precio_kg::float8 AS precio_kg
        FROM venta_avicola_items vi
        WHERE vi.venta_id = (
          SELECT id FROM ventas_avicola
          WHERE cliente_id = ${id} AND NOT anulada
          ORDER BY created_at DESC
          LIMIT 1
        )
          AND vi.producto_id IS NOT NULL
        ORDER BY vi.created_at ASC
      `,
      // (f) UNA GUÍA POR DÍA (pedido del equipo, 11 jul 2026): si el cliente ya tiene
      //     una venta de HOY no anulada, "Vender" continúa ESA guía (no crea otra).
      //     El ruteo va en el server para cubrir TODAS las entradas (ficha, lista…).
      sql`
        SELECT id FROM ventas_avicola
        WHERE cliente_id = ${id}
          AND fecha = (NOW() AT TIME ZONE 'America/Lima')::date
          AND NOT anulada
        ORDER BY created_at DESC
        LIMIT 1
      `,
    ]);

  if (!cliente) notFound();

  // En modo crear (sin ?edit), si ya hay guía del día, editarla (una por día).
  const ventaHoyId = (ventaHoyRaw as Array<{ id: string }>)[0]?.id ?? null;
  const effectiveEditId = editId ?? ventaHoyId;

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

  // "Lo de siempre": ids ordenados por frecuencia; y de paso el precio precargado.
  const ultimosPrecios: Record<string, number> = {};
  const historialIds: string[] = [];
  for (const fila of historialRaw as Array<{
    producto_id: string;
    veces: number;
    ultimo_precio: number;
  }>) {
    ultimosPrecios[fila.producto_id] = fila.ultimo_precio;
    historialIds.push(fila.producto_id);
  }

  const masVendidosIds = (
    masVendidosRaw as Array<{ producto_id: string }>
  ).map((f) => f.producto_id);

  const ultimaVentaItems = (
    ultimaVentaRaw as Array<{
      producto_id: string;
      producto_nombre: string;
      precio_kg: number;
    }>
  ).map((f) => ({
    producto_id: f.producto_id,
    producto_nombre: f.producto_nombre,
    precio: f.precio_kg,
  }));

  // Cargar venta existente si estamos en modo edición (o si hay guía del día).
  let ventaExistente = null;
  if (effectiveEditId) {
    const ventaRow = await sql`
      SELECT v.id, v.numero_guia, v.fecha::text as fecha, v.observaciones,
             v.created_at::text AS created_at, u.name AS creado_por_nombre
      FROM ventas_avicola v
      LEFT JOIN users u ON u.id = v.creado_por
      WHERE v.id = ${effectiveEditId} AND NOT v.anulada AND v.cliente_id = ${id}
    `;
    if (ventaRow.length > 0) {
      const itemsRows = await sql`
        SELECT
          producto_id,
          producto_nombre,
          peso_kg::float8 AS peso,
          precio_kg::float8 AS precio
        FROM venta_avicola_items
        WHERE venta_id = ${effectiveEditId}
        ORDER BY created_at ASC
      `;
      ventaExistente = {
        id: ventaRow[0].id,
        numero_guia: ventaRow[0].numero_guia,
        fecha: ventaRow[0].fecha,
        observaciones: ventaRow[0].observaciones,
        created_at: ventaRow[0].created_at,
        creado_por_nombre: ventaRow[0].creado_por_nombre ?? null,
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
      historialIds={historialIds}
      masVendidosIds={masVendidosIds}
      ultimaVentaItems={ultimaVentaItems}
      ventaExistente={ventaExistente}
    />
  );
}

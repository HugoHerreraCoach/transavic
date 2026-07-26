// src/app/api/reportes/cuadre-fisico/detalle/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const ParamsSchema = z.object({
  desde: z.string().regex(FECHA_REGEX),
  hasta: z.string().regex(FECHA_REGEX),
  producto_id: z.string().uuid(),
  canal: z.enum(["compras", "campo", "ejecutivas", "planta", "ajuste"]),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const queryParams = {
    desde: searchParams.get("desde") || searchParams.get("fecha"),
    hasta: searchParams.get("hasta") || searchParams.get("desde") || searchParams.get("fecha"),
    producto_id: searchParams.get("producto_id"),
    canal: searchParams.get("canal"),
  };

  const validation = ParamsSchema.safeParse(queryParams);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Parámetros de consulta inválidos", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { desde, hasta, producto_id, canal } = validation.data;

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Obtener información básica del producto
    const prodRow = await sql`
      SELECT nombre, categoria, unidad FROM productos WHERE id = ${producto_id}
    `;
    if (prodRow.length === 0) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    const producto = prodRow[0];

    let items: Array<Record<string, unknown>> = [];

    if (canal === "compras") {
      items = await sql`
        SELECT 
          c.id AS compra_id,
          c.fecha::text AS fecha,
          p.razon_social AS proveedor_nombre,
          c.nro_doc,
          ci.id AS item_id,
          ci.jabas::int AS jabas,
          ci.peso_bruto::float8 AS peso_bruto,
          ci.peso_tara::float8 AS peso_tara,
          ci.peso_neto::float8 AS kilos,
          ci.costo_unitario::float8 AS costo_unitario,
          ci.jabas_macho::int AS jabas_macho,
          ci.jabas_hembra::int AS jabas_hembra,
          ci.sueltos_macho::int AS sueltos_macho,
          ci.sueltos_hembra::int AS sueltos_hembra,
          ci.total_pollos::int AS total_pollos
        FROM compra_items ci
        JOIN compras c ON c.id = ci.compra_id
        JOIN proveedores p ON p.id = c.proveedor_id
        WHERE c.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND ci.producto_id = ${producto_id}
          AND c.estado <> 'Anulado'
          AND COALESCE(ci.tipo, 'ingreso') = 'ingreso'
        ORDER BY c.fecha DESC, c.created_at DESC
      `;
    } else if (canal === "campo") {
      items = await sql`
        SELECT 
          v.id AS venta_id,
          v.fecha::text AS fecha,
          COALESCE(c.nombre, 'Cliente Campo') AS cliente_nombre,
          v.numero_guia AS nro_guia,
          vi.id AS item_id,
          0::int AS jabas,
          vi.peso_kg::float8 AS kilos,
          vi.precio_kg::float8 AS precio_unitario
        FROM venta_avicola_items vi
        JOIN ventas_avicola v ON v.id = vi.venta_id
        LEFT JOIN clientes_avicola c ON c.id = v.cliente_id
        WHERE v.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND vi.producto_id = ${producto_id}
          AND NOT v.anulada
        ORDER BY v.fecha DESC, v.created_at DESC
      `;
    } else if (canal === "ejecutivas") {
      items = await sql`
        SELECT 
          p.id AS pedido_id,
          (p.created_at AT TIME ZONE 'America/Lima')::date::text AS fecha,
          COALESCE(c.nombre, p.cliente, 'Cliente General') AS cliente_nombre,
          p.nro_pedido,
          pi.id AS item_id,
          COALESCE(pi.cantidad_real, pi.cantidad, 0)::float8 AS kilos,
          pi.precio_unitario::float8 AS precio_unitario
        FROM pedido_items pi
        JOIN pedidos p ON p.id = pi.pedido_id
        LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desde}::date AND ${hasta}::date
          AND pi.producto_id = ${producto_id}
          AND COALESCE(p.origen, 'asesor') = 'asesor'
          AND p.estado <> 'Fallido'
          AND NOT COALESCE(p.anulada, FALSE)
        ORDER BY p.created_at DESC
      `;
    } else if (canal === "planta") {
      items = await sql`
        SELECT 
          p.id AS pedido_id,
          (p.created_at AT TIME ZONE 'America/Lima')::date::text AS fecha,
          COALESCE(c.nombre, p.cliente, 'Venta en Planta') AS cliente_nombre,
          p.nro_pedido,
          pi.id AS item_id,
          pi.cantidad::float8 AS kilos,
          pi.precio_unitario::float8 AS precio_unitario
        FROM pedido_items pi
        JOIN pedidos p ON p.id = pi.pedido_id
        LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desde}::date AND ${hasta}::date
          AND pi.producto_id = ${producto_id}
          AND p.origen = 'pos_planta'
          AND p.estado <> 'Fallido'
          AND NOT COALESCE(p.anulada, FALSE)
        ORDER BY p.created_at DESC
      `;
    } else if (canal === "ajuste") {
      items = await sql`
        SELECT 
          a.id AS ajuste_id,
          a.fecha::text AS fecha,
          a.kilos_ajuste::float8 AS kilos,
          a.motivo,
          u.name AS usuario_nombre,
          a.created_at::text AS created_at
        FROM public.ajustes_cuadre_fisico a
        JOIN public.users u ON u.id = a.usuario_id
        WHERE a.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND a.producto_id = ${producto_id}
        ORDER BY a.created_at DESC
      `;
    }

    return NextResponse.json({
      producto,
      canal,
      items,
    });
  } catch (error) {
    console.error("Error al obtener detalle transaccional:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

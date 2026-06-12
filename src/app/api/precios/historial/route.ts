// src/app/api/precios/historial/route.ts
// GET — historial de auditoría de precios, SOLO ADMIN. Une dos fuentes que ya
// existen (sin tabla nueva):
//   (a) `precios_productos`: cada cambio de precio del CATÁLOGO (quién lo hizo
//       — siempre un admin, los endpoints de productos son admin-only — cuándo,
//       precio anterior vía LAG y precio nuevo).
//   (b) `autorizaciones_precio` aprobadas: ventas BAJO catálogo que un admin
//       autorizó (asesora, precio catálogo → precio autorizado, admin que aprobó).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const productoId = searchParams.get("producto_id");
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 300);

    const sql = neon(process.env.DATABASE_URL!);
    const filtraProducto = productoId && /^[0-9a-f-]{36}$/i.test(productoId);

    const rows = await sql.query(
      `
      SELECT * FROM (
        SELECT 'catalogo' AS tipo,
               pp.created_at AS fecha,
               pp.producto_id,
               p.nombre AS producto,
               COALESCE(u.name, 'Sistema') AS usuario,
               LAG(pp.precio_venta) OVER (PARTITION BY pp.producto_id ORDER BY pp.created_at) AS precio_anterior,
               pp.precio_venta AS precio_nuevo,
               NULL::text AS autorizado_por
        FROM precios_productos pp
        JOIN productos p ON p.id = pp.producto_id
        LEFT JOIN users u ON u.id = pp.created_by
      ) cat
      ${filtraProducto ? "WHERE cat.producto_id = $2::uuid" : ""}

      UNION ALL

      SELECT 'venta_bajo_catalogo' AS tipo,
             COALESCE(ap.resuelta_at, ap.created_at) AS fecha,
             NULL::uuid AS producto_id,
             item->>'nombre' AS producto,
             ap.asesora_nombre AS usuario,
             NULLIF(item->>'precio_minimo', '')::numeric AS precio_anterior,
             NULLIF(item->>'precio_solicitado', '')::numeric AS precio_nuevo,
             ap.aprobada_por AS autorizado_por
      FROM autorizaciones_precio ap,
           jsonb_array_elements(ap.items_json) AS item
      WHERE ap.estado = 'aprobada'
        ${filtraProducto ? "AND FALSE" : ""}

      ORDER BY fecha DESC
      LIMIT $1
      `,
      filtraProducto ? [limit, productoId] : [limit]
    );

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("Error en GET /api/precios/historial:", error);
    return NextResponse.json(
      { error: "Error al cargar el historial de precios" },
      { status: 500 }
    );
  }
}

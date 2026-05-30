// src/app/api/precios/route.ts
// GET /api/precios — listar productos con su precio vigente (admin only)
//
// ⚠️ @deprecated (mayo 2026)
// La vista del catálogo unificado usa /api/productos (que ahora devuelve
// precio_venta + precio_compra). Este endpoint se mantiene para no romper
// integraciones externas o scripts ad-hoc; se puede borrar cuando se confirme
// que ya no se usa.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el administrador puede ver y modificar precios" },
        { status: 403 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);
    const productos = await sql`
      SELECT id, nombre, categoria, unidad, precio_compra, precio_venta, activo
      FROM productos
      WHERE activo = TRUE
      ORDER BY
        CASE categoria
          WHEN 'Pollo' THEN 1
          WHEN 'Carnes' THEN 2
          WHEN 'Huevos' THEN 3
        END,
        nombre ASC
    `;

    return NextResponse.json({ data: productos });
  } catch (error) {
    console.error("Error en GET /api/precios:", error);
    return NextResponse.json(
      { error: "Error al obtener precios" },
      { status: 500 }
    );
  }
}

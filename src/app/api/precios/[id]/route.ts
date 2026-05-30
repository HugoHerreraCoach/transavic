// src/app/api/precios/[id]/route.ts
// PATCH /api/precios/[id] — actualizar precio de un producto (admin only)
// Crea histórico automáticamente: cierra el anterior y abre uno nuevo.
//
// ⚠️ @deprecated (mayo 2026)
// La vista del catálogo unificado usa PATCH /api/productos/[id] (que ahora
// acepta precio_venta + precio_compra + codigo). Este endpoint se mantiene
// para no romper integraciones externas; se puede borrar cuando se confirme
// que nada lo llama.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateSchema = z
  .object({
    precio_compra: z.number().nonnegative().nullable().optional(),
    precio_venta: z.number().positive("El precio de venta debe ser mayor a cero"),
  })
  .refine(
    (data) =>
      data.precio_compra == null || data.precio_compra <= data.precio_venta,
    {
      message: "El precio de compra no puede ser mayor al de venta",
      path: ["precio_compra"],
    }
  );

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el administrador puede modificar precios" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    if (!id) {
      return NextResponse.json(
        { error: "ID del producto requerido" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { precio_compra, precio_venta } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Verificar que el producto existe
    const productoExiste = await sql`
      SELECT id FROM productos WHERE id = ${id} AND activo = TRUE
    `;
    if (productoExiste.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    // 1. Cerrar el histórico vigente (si existía)
    await sql`
      UPDATE precios_productos
      SET vigente_hasta = (NOW() AT TIME ZONE 'America/Lima')::date
      WHERE producto_id = ${id} AND vigente_hasta IS NULL
    `;

    // 2. Insertar nuevo registro vigente
    await sql`
      INSERT INTO precios_productos (producto_id, precio_compra, precio_venta, created_by)
      VALUES (${id}, ${precio_compra ?? null}, ${precio_venta}, ${session.user.id})
    `;

    // 3. Actualizar snapshot en productos
    await sql`
      UPDATE productos
      SET precio_compra = ${precio_compra ?? null}, precio_venta = ${precio_venta}
      WHERE id = ${id}
    `;

    return NextResponse.json({
      message: "Precio actualizado",
      precio_compra: precio_compra ?? null,
      precio_venta,
    });
  } catch (error) {
    console.error("Error en PATCH /api/precios/[id]:", error);
    return NextResponse.json(
      { error: "Error al actualizar precio" },
      { status: 500 }
    );
  }
}

// src/app/api/productos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

// Vista unificada del catálogo (mayo 2026): un producto entra al sistema con
// nombre + categoría + unidad obligatorios, y opcionalmente puede nacer con
// precio_venta y precio_compra. Si no traen precios, quedan "sin precio" y
// el banner del catálogo lo destaca (no suman a ventas/metas hasta tenerlos).
const ProductoSchema = z.object({
  nombre: z.string().min(1, { message: "El nombre es requerido." }),
  categoria: z.string().min(1, { message: "La categoría es requerida." }),
  unidad: z.string().min(1, { message: "La unidad es requerida." }),
  precio_venta: z.number().positive().optional().nullable(),
  precio_compra: z.number().nonnegative().optional().nullable(),
});

export async function GET() {
  try {
    // El catálogo ahora lo ven también las asesoras (11 jun 2026), pero el
    // PRECIO DE COMPRA (margen del negocio) es SOLO de admin — y el control
    // real va aquí, no en la UI (antes este GET ni siquiera pedía sesión).
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const esAdmin = session.user.role === "admin";

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }

    const sql = neon(connectionString);
    const productos = await sql`
      SELECT id, nombre, categoria, unidad, activo,
        precio_venta, precio_compra, codigo
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

    // Mantener la key `precio_compra` (los tipos del cliente la esperan) pero
    // en null para roles no-admin.
    const data = esAdmin
      ? productos
      : productos.map((p) => ({ ...p, precio_compra: null }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Error al obtener productos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }

    const body = await request.json();
    const parsedData = ProductoSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { error: parsedData.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { nombre, categoria, unidad, precio_venta, precio_compra } = parsedData.data;
    const sql = neon(connectionString);

    // Código interno estable: prefijo por categoría + siguiente correlativo.
    const prefijo =
      categoria === "Pollo"
        ? "POL"
        : categoria === "Carnes"
          ? "CAR"
          : categoria === "Huevos"
            ? "HUE"
            : "PRD";
    const maxRow = (await sql`
      SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '[^0-9]', '', 'g'), '')::int), 0) AS n
      FROM productos WHERE codigo LIKE ${prefijo + "%"}
    `) as Array<{ n: number }>;
    const codigo = `${prefijo}${String(Number(maxRow[0]?.n ?? 0) + 1).padStart(3, "0")}`;

    const result = await sql`
      INSERT INTO productos (nombre, categoria, unidad, codigo, precio_venta, precio_compra)
      VALUES (${nombre}, ${categoria}, ${unidad}, ${codigo},
              ${precio_venta ?? null}, ${precio_compra ?? null})
      RETURNING id, nombre, categoria, unidad, activo, codigo, precio_venta, precio_compra
    `;

    // Si el producto nace con precio_venta, abrimos también el primer registro
    // en el histórico (mismo patrón que /api/precios/[id] PATCH para mantener
    // la auditoría consistente). No-crítico: si falla, el producto ya quedó OK.
    if (precio_venta !== undefined && precio_venta !== null && precio_venta > 0) {
      try {
        await sql`
          INSERT INTO precios_productos (producto_id, precio_compra, precio_venta, created_by)
          VALUES (${result[0].id}, ${precio_compra ?? null}, ${precio_venta}, ${session.user.id})
        `;
      } catch (histErr) {
        console.error(
          "POST /api/productos: no se pudo registrar histórico de precios (no crítico):",
          histErr
        );
      }
    }

    return NextResponse.json(
      { data: result[0], message: "Producto creado exitosamente" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error al crear producto:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}

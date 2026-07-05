import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  try {
    // ?movimientos=<producto_id> → mini-kardex del producto (últimos 20 movimientos)
    const productoMovs = req.nextUrl.searchParams.get("movimientos");
    if (productoMovs) {
      const movimientos = await sql`
        SELECT m.id, m.cantidad_cambio, m.tipo, m.motivo, m.created_at,
               u.name AS usuario_nombre
        FROM inventario_movimientos m
        LEFT JOIN users u ON u.id = m.usuario_id
        WHERE m.producto_id = ${productoMovs}
        ORDER BY m.created_at DESC
        LIMIT 20
      `;
      return NextResponse.json(movimientos.map((m) => ({
        ...m,
        cantidad_cambio: Number(m.cantidad_cambio),
      })));
    }

    const inventario = await sql`
      SELECT
        i.id, i.producto_id, p.nombre as producto_nombre, p.categoria, i.cantidad, i.updated_at
      FROM inventario_lotes i
      JOIN productos p ON p.id = i.producto_id
      ORDER BY p.categoria, p.nombre ASC
    `;
    return NextResponse.json(inventario);
  } catch (error) {
    console.error("Error al obtener inventario:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

// Motivos válidos para un ajuste manual (trazabilidad: nunca ± stock sin explicación)
const MOTIVOS_AJUSTE = [
  "Merma no registrada",
  "Error de conteo",
  "Robo / faltante",
  "Ajuste por cierre",
  "Otro",
] as const;

const AjusteSchema = z.object({
  producto_id: z.string().uuid(),
  cantidad_cambio: z.number().refine((n) => n !== 0, "El cambio no puede ser 0"),
  motivo: z.enum(MOTIVOS_AJUSTE),
  detalle: z.string().trim().optional().nullable(),
}).refine(
  (d) => d.motivo !== "Otro" || (d.detalle && d.detalle.length >= 3),
  { message: "Si el motivo es 'Otro', describe el detalle.", path: ["detalle"] }
);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "Solo admin o producción pueden ajustar inventario" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = AjusteSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { producto_id, cantidad_cambio, motivo, detalle } = result.data;
    const motivoCompleto = detalle ? `${motivo}: ${detalle}` : motivo;

    const sql = neon(process.env.DATABASE_URL!);
    // Upsert del saldo + movimiento de kardex, atómico.
    const [updated] = await sql.transaction([
      sql`
        INSERT INTO inventario_lotes (producto_id, cantidad)
        VALUES (${producto_id}, ${cantidad_cambio})
        ON CONFLICT (producto_id) DO UPDATE SET
          cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
        RETURNING *
      `,
      sql`
        INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, motivo, usuario_id)
        VALUES (${producto_id}, ${cantidad_cambio}, 'ajuste', ${motivoCompleto}, ${session.user.id})
      `,
    ]);

    return NextResponse.json(updated[0], { status: 200 });
  } catch (error) {
    console.error("Error al ajustar inventario:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

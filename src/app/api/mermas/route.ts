import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  try {
    const mermas = await sql`
      SELECT 
        m.id, m.fecha, m.peso_bruto, m.peso_limpio, m.peso_menudencia, 
        m.merma, m.porcentaje_merma, m.created_at, u.name as registrado_por
      FROM mermas_diarias m
      JOIN users u ON u.id = m.usuario_id
      ORDER BY m.created_at DESC
      LIMIT 50
    `;
    return NextResponse.json(mermas);
  } catch (error) {
    console.error("Error al obtener mermas:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

const MermaSchema = z.object({
  fecha: z.string().optional(), // 'YYYY-MM-DD' o usa la de hoy
  peso_bruto: z.number().positive(),
  peso_limpio: z.number().nonnegative(),
  peso_menudencia: z.number().nonnegative(),
  compra_id: z.string().uuid().optional().nullable(), // lote/carga del día al que corresponde
}).refine(
  (d) => d.peso_limpio + d.peso_menudencia <= d.peso_bruto,
  { message: "Limpio + menudencia no puede superar el peso bruto.", path: ["peso_limpio"] }
);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "Solo admin o producción pueden registrar mermas" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = MermaSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { fecha, peso_bruto, peso_limpio, peso_menudencia, compra_id } = result.data;

    // Cálculos de merma
    // Merma = Peso Bruto - (Peso Limpio + Peso Menudencia)
    const merma_kg = peso_bruto - (peso_limpio + peso_menudencia);
    const porcentaje = (merma_kg / peso_bruto) * 100;

    const sql = neon(process.env.DATABASE_URL!);

    const insertResult = await sql`
      INSERT INTO mermas_diarias (
        fecha, peso_bruto, peso_limpio, peso_menudencia,
        merma, porcentaje_merma, usuario_id, compra_id
      )
      VALUES (
        COALESCE(${fecha || null}::date, (NOW() AT TIME ZONE 'America/Lima')::date),
        ${peso_bruto}, ${peso_limpio}, ${peso_menudencia},
        ${merma_kg}, ${porcentaje}, ${session.user.id}, ${compra_id || null}
      )
      RETURNING *
    `;

    return NextResponse.json(insertResult[0], { status: 201 });
  } catch (error) {
    console.error("Error al registrar merma:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

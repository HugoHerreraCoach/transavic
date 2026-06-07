// GET  — admin: lista todos los comunicados con conteo de lecturas.
// POST — admin: crea un comunicado nuevo (con imágenes opcionales).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ImagenSchema = z.object({
  base64: z.string().max(400_000),
  mime: z.string().max(50),
});

const CreateSchema = z.object({
  titulo: z.string().min(1).max(200).trim(),
  cuerpo: z.string().max(5000).trim().default(""),
  destinatarios: z.array(z.string().uuid()).min(1),
  imagenes: z.array(ImagenSchema).max(10).optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT
        c.id,
        c.titulo,
        c.cuerpo,
        c.creado_por,
        c.destinatarios,
        c.created_at,
        COUNT(cl.id)::int AS lecturas_count
      FROM comunicados c
      LEFT JOIN comunicado_lecturas cl ON cl.comunicado_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `;
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error GET /api/comunicados:", error);
    return NextResponse.json({ error: "Error al obtener comunicados" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const { titulo, cuerpo, destinatarios, imagenes } = parsed.data;

    const result = (await sql`
      INSERT INTO comunicados (titulo, cuerpo, creado_por, destinatarios)
      VALUES (
        ${titulo},
        ${cuerpo},
        ${session.user.name?.trim() ?? "Admin"},
        ${JSON.stringify(destinatarios)}
      )
      RETURNING id
    `) as Array<{ id: string }>;

    const comunicadoId = result[0].id;

    if (imagenes && imagenes.length > 0) {
      for (let i = 0; i < imagenes.length; i++) {
        await sql`
          INSERT INTO comunicado_imagenes (comunicado_id, imagen_base64, imagen_mime, orden)
          VALUES (${comunicadoId}, ${imagenes[i].base64}, ${imagenes[i].mime}, ${i + 1})
        `;
      }
    }

    return NextResponse.json({ id: comunicadoId }, { status: 201 });
  } catch (error) {
    console.error("Error POST /api/comunicados:", error);
    return NextResponse.json({ error: "Error al crear comunicado" }, { status: 500 });
  }
}

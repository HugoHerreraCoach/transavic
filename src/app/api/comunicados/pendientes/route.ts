// GET — devuelve los comunicados destinados al usuario actual que aún no leyó.
// Ordenados del más antiguo al más reciente (se muestran en ese orden en el popup).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const sql = neon(process.env.DATABASE_URL!);
    const userId = session.user.id;

    const rows = await sql`
      SELECT 
        c.id, c.titulo, c.cuerpo, c.creado_por, c.created_at,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('id', ci.id) ORDER BY ci.orden ASC)
           FROM comunicado_imagenes ci
           WHERE ci.comunicado_id = c.id),
          '[]'::jsonb
        ) as imagenes
      FROM comunicados c
      WHERE c.destinatarios @> jsonb_build_array(${userId}::text)
        AND NOT EXISTS (
          SELECT 1 FROM comunicado_lecturas cl
          WHERE cl.comunicado_id = c.id
            AND cl.user_id = ${userId}::uuid
        )
      ORDER BY c.created_at ASC
    `;
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error GET /api/comunicados/pendientes:", error);
    return NextResponse.json({ error: "Error al obtener comunicados pendientes" }, { status: 500 });
  }
}

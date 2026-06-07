// src/app/api/comunicados/[id]/leer/route.ts
// POST — marca un comunicado como leído por el usuario actual (idempotente)
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID de comunicado inválido" }, { status: 400 });
    }

    const userId = session.user.id;
    const sql = neon(process.env.DATABASE_URL!);

    // Insertar la lectura de manera idempotente
    await sql`
      INSERT INTO comunicado_lecturas (comunicado_id, user_id, leido_at)
      VALUES (${id}::uuid, ${userId}::uuid, NOW())
      ON CONFLICT (comunicado_id, user_id) DO NOTHING
    `;

    return NextResponse.json({ success: true, message: "Comunicado marcado como leído" });
  } catch (error) {
    console.error("Error en POST /api/comunicados/[id]/leer:", error);
    return NextResponse.json({ error: "Error al registrar la lectura" }, { status: 500 });
  }
}

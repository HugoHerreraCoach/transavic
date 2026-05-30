// src/app/api/metas/override/route.ts
// POST — admin setea manualmente la meta mensual de una asesora (override).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  asesor_id: z.string().uuid(),
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Formato esperado: YYYY-MM"),
  monto_meta: z.number().positive(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo admin" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { asesor_id, mes, monto_meta } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    const mesIso = `${mes}-01`;
    await sql`
      INSERT INTO metas_asesoras (asesor_id, mes, monto_meta)
      VALUES (${asesor_id}, ${mesIso}::date, ${monto_meta})
      ON CONFLICT (asesor_id, mes) DO UPDATE SET monto_meta = ${monto_meta}
    `;
    return NextResponse.json({ message: "Meta actualizada" });
  } catch (error) {
    console.error("Error en POST /api/metas/override:", error);
    return NextResponse.json({ error: "Error al guardar meta" }, { status: 500 });
  }
}

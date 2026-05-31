// src/app/api/metas/override/route.ts
// POST — admin setea manualmente la meta mensual de una asesora (override).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

// `monto_meta` opcional/nullable: null = meta automática (sin override).
// `bono` opcional: premio en texto libre al cumplir la meta del mes; "" / null = sin bono.
const Schema = z.object({
  asesor_id: z.string().uuid(),
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Formato esperado: YYYY-MM"),
  monto_meta: z.number().positive().nullable().optional(),
  bono: z.string().max(200).nullable().optional(),
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
    const { asesor_id, mes } = parsed.data;
    const montoMeta = parsed.data.monto_meta ?? null;
    const bono = (parsed.data.bono ?? "").trim() || null;

    const sql = neon(process.env.DATABASE_URL!);
    const mesIso = `${mes}-01`;

    // Sin meta fija NI bono → borrar la fila: la asesora vuelve a meta automática
    // (ventas del mes anterior × % configurable) y sin bono.
    if (montoMeta === null && bono === null) {
      await sql`
        DELETE FROM metas_asesoras
        WHERE asesor_id = ${asesor_id} AND mes = ${mesIso}::date
      `;
      return NextResponse.json({
        message: "Meta y bono restablecidos a automático",
      });
    }

    await sql`
      INSERT INTO metas_asesoras (asesor_id, mes, monto_meta, bono)
      VALUES (${asesor_id}, ${mesIso}::date, ${montoMeta}, ${bono})
      ON CONFLICT (asesor_id, mes)
      DO UPDATE SET monto_meta = ${montoMeta}, bono = ${bono}
    `;
    return NextResponse.json({ message: "Meta actualizada" });
  } catch (error) {
    console.error("Error en POST /api/metas/override:", error);
    return NextResponse.json({ error: "Error al guardar meta" }, { status: 500 });
  }
}

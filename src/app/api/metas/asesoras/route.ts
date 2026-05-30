// src/app/api/metas/asesoras/route.ts
// GET — lista de asesoras con su meta mensual efectiva + ventas del mes (para que
// el admin vea y edite las metas individuales). Solo admin.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { calcularMetaDiaria, ventasMesActual } from "@/lib/metas";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const sql = neon(process.env.DATABASE_URL!);
  const asesores = (await sql`
    SELECT id, name FROM users WHERE role = 'asesor' ORDER BY name
  `) as Array<{ id: string; name: string }>;

  const out = [];
  for (const a of asesores) {
    const meta = await calcularMetaDiaria(a.id);
    const vendido = await ventasMesActual(a.id);
    out.push({
      id: a.id,
      nombre: (a.name || "").trim(),
      metaMensual: meta.metaMensual,
      metaDiaria: meta.metaDiaria,
      ventasMesActual: vendido,
    });
  }

  return NextResponse.json({ asesoras: out });
}

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

  // Mes actual (primer día) para leer el override/bono que el admin haya fijado.
  const hoy = new Date();
  const mesIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;

  const out = [];
  for (const a of asesores) {
    const meta = await calcularMetaDiaria(a.id);
    const vendido = await ventasMesActual(a.id);
    const ov = (await sql`
      SELECT monto_meta, bono FROM metas_asesoras
      WHERE asesor_id = ${a.id} AND mes = ${mesIso}::date
    `) as Array<{ monto_meta: string | number | null; bono: string | null }>;
    const metaOverride =
      ov.length > 0 && ov[0].monto_meta != null ? Number(ov[0].monto_meta) : null;
    const bono = (ov[0]?.bono ?? "").trim();
    out.push({
      id: a.id,
      nombre: (a.name || "").trim(),
      metaMensual: meta.metaMensual, // meta efectiva (override o automática)
      metaDiaria: meta.metaDiaria,
      ventasMesActual: vendido,
      metaOverride, // null = meta automática; número = meta fija puesta por el admin
      bono, // "" = sin bono
    });
  }

  return NextResponse.json({ asesoras: out });
}

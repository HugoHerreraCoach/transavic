// src/app/api/comprobantes/resumenes/route.ts
// GET — lista los últimos Resúmenes Diarios (RC-) enviados, para poder consultar
// el ticket de los que envió el cron (o manualmente) días atrás.
// Solo admin.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const empresa = req.nextUrl.searchParams.get("empresa");
  const sql = neon(process.env.DATABASE_URL!);

  const rows = empresa
    ? await sql`
        SELECT id, empresa, fecha_referencia, correlativo, ticket, estado,
               boletas_incluidas, created_at
        FROM resumenes_diarios
        WHERE empresa = ${empresa}
        ORDER BY created_at DESC
        LIMIT 20`
    : await sql`
        SELECT id, empresa, fecha_referencia, correlativo, ticket, estado,
               boletas_incluidas, created_at
        FROM resumenes_diarios
        ORDER BY created_at DESC
        LIMIT 20`;

  return NextResponse.json({ resumenes: rows });
}

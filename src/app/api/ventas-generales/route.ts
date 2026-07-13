// src/app/api/ventas-generales/route.ts
// Ventas GENERALES del día (o fecha elegida) de las 3 operaciones de venta de Antonio:
//   🛵 Ejecutivas (pedidos de asesoras) · 🏭 Planta (POS) · 🏪 Campo (Clientes Avícola).
// Vista unificada y clara — hoy el Consolidado NO incluía Campo. SOLO admin, lectura.
//
// Criterio de "venta del día" = venta REGISTRADA ese día (zona Lima), consistente para
// las 3 operaciones (campo/planta son del mismo día; ejecutivas suele entregarse después,
// pero la VENTA es cuando se registró — gotcha #8). Se excluyen los pedidos 'Fallido'
// (entrega fallida, no es venta cerrada) y las ventas de campo anuladas.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { resumenVentasGeneralesPorFecha } from "@/lib/ventas-generales";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fechaRaw = searchParams.get("fecha") ?? undefined;
  if (fechaRaw && (!FECHA_REGEX.test(fechaRaw) || Number.isNaN(Date.parse(fechaRaw)))) {
    return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Fecha objetivo: la enviada o hoy en Lima (por SQL, nunca toISOString).
    const hoyRows = (await sql`
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
    `) as Array<{ hoy: string }>;
    const fecha = fechaRaw ?? hoyRows[0].hoy;

    return NextResponse.json(await resumenVentasGeneralesPorFecha(sql, fecha));
  } catch (error) {
    console.error("Error en GET /api/ventas-generales:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

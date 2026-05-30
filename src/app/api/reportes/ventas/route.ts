// src/app/api/reportes/ventas/route.ts
// GET — Reporte de ventas (facturación entregada) por rango de fechas.
// Admin-only: expone ventas globales + ranking entre asesoras.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { obtenerReporteVentas } from "@/lib/reportes/datos-ventas";

export const dynamic = "force-dynamic";

const esFecha = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Fecha local (zona del servidor) en YYYY-MM-DD, sin caer en UTC. */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const desdeRaw = sp.get("desde");
    const hastaRaw = sp.get("hasta");

    const hoy = hoyLocal();
    // Default: este mes (día 1 → hoy).
    const desde = esFecha(desdeRaw) ? desdeRaw : hoy.slice(0, 8) + "01";
    const hasta = esFecha(hastaRaw) ? hastaRaw : hoy;

    const reporte = await obtenerReporteVentas(desde, hasta);
    return NextResponse.json(reporte);
  } catch (error) {
    console.error("Error en GET /api/reportes/ventas:", error);
    return NextResponse.json({ error: "Error al cargar el reporte de ventas" }, { status: 500 });
  }
}

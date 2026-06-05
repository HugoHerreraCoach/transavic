// src/app/api/asistente-ia/route.ts
// Endpoint que devuelve los 4 insights del Asistente IA.
// Admin y asesor permitidos — cada rol ve insights distintos (scoping por SQL).
// Cache 1h por insight (forzable con ?refresh=1).

import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  cached,
  clearInsightsCacheFor,
  // Admin
  insightProductosEnAlza,
  insightClientesEnRiesgo,
  insightAsesoraTop,
  insightRecomendacionDia,
  // Asesora
  insightMiPerformance,
  insightMisClientesEnRiesgo,
  insightMiCartera,
  insightSugerenciaDia,
} from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") {
    return NextResponse.json({ error: "Solo admin o asesor" }, { status: 403 });
  }

  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  // Cache scope: el admin tiene un namespace global, cada asesora el suyo.
  const cacheScope = role === "admin" ? "admin" : `asesor-${session.user.id}`;
  if (refresh) await clearInsightsCacheFor(cacheScope);

  try {
    if (role === "admin") {
      const [productos, clientes, asesoras, dia] = await Promise.all([
        cached(`${cacheScope}-productos`, insightProductosEnAlza, refresh),
        cached(`${cacheScope}-clientes`, insightClientesEnRiesgo, refresh),
        cached(`${cacheScope}-asesoras`, insightAsesoraTop, refresh),
        cached(`${cacheScope}-dia`, insightRecomendacionDia, refresh),
      ]);
      return NextResponse.json({
        role: "admin",
        generatedAt: new Date().toISOString(),
        cached: !refresh,
        productos,
        clientes,
        asesoras,
        dia,
      });
    }

    // ── Asesora ──
    const asesorId = session.user.id;
    const asesoraNombre = session.user.name ?? "asesora";
    const [performance, clientes, cartera, sugerencia] = await Promise.all([
      cached(`${cacheScope}-performance`, () => insightMiPerformance(asesorId, asesoraNombre), refresh),
      cached(`${cacheScope}-clientes`, () => insightMisClientesEnRiesgo(asesorId, asesoraNombre), refresh),
      cached(`${cacheScope}-cartera`, () => insightMiCartera(asesorId, asesoraNombre), refresh),
      cached(`${cacheScope}-sugerencia`, () => insightSugerenciaDia(asesorId, asesoraNombre), refresh),
    ]);
    return NextResponse.json({
      role: "asesor",
      generatedAt: new Date().toISOString(),
      cached: !refresh,
      performance,
      clientes,
      cartera,
      sugerencia,
    });
  } catch (err) {
    console.error("Error generando insights:", err);
    return NextResponse.json(
      { error: "Error generando insights", detail: (err as Error).message },
      { status: 500 }
    );
  }
}

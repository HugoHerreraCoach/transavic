// src/app/api/repartidor/mi-ruta/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchMiRuta } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const pedidos = await fetchMiRuta(session.user.id);

    // Calcular estadísticas
    const total = pedidos.length;
    const entregados = pedidos.filter((p) => p.estado === "Entregado").length;
    const fallidos = pedidos.filter((p) => p.estado === "Fallido").length;
    const enCamino = pedidos.find((p) => p.estado === "En_Camino") ?? null;

    return NextResponse.json({
      pedidos,
      stats: {
        total,
        entregados,
        fallidos,
        completados: entregados + fallidos,
        pendientes: total - entregados - fallidos,
      },
      pedidoActivo: enCamino,
    });
  } catch (error) {
    console.error("Error en mi-ruta:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

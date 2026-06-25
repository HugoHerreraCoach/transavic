// src/app/api/repartidor/mi-ruta/route.ts
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Fetch pedidos with new fields
    const pedidos = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas,
        p.distancia_km, p.duracion_estimada_min,
        p.guia_firmada_at,
        u.name AS asesor_name
      FROM pedidos p
      LEFT JOIN users u ON p.asesor_id = u.id
      WHERE p.repartidor_id = ${session.user.id}
        AND p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      ORDER BY
        CASE 
          WHEN p.estado IN ('Entregado', 'Fallido') THEN 1 
          ELSE 0 
        END,
        p.orden_ruta ASC NULLS LAST,
        p.created_at ASC
    `;

    const parsedPedidos = pedidos.map((p) => ({
      ...p,
      latitude: p.latitude ? parseFloat(p.latitude as string) : null,
      longitude: p.longitude ? parseFloat(p.longitude as string) : null,
      distancia_km: p.distancia_km ? parseFloat(p.distancia_km as string) : null,
      duracion_estimada_min: p.duracion_estimada_min ? parseInt(p.duracion_estimada_min as string) : null,
    }));

    // Calcular estadísticas (usar pedidos raw para acceso a campo estado)
    const total = pedidos.length;
    const entregados = pedidos.filter((p) => p.estado === "Entregado").length;
    const fallidos = pedidos.filter((p) => p.estado === "Fallido").length;
    const enCaminoIdx = pedidos.findIndex((p) => p.estado === "En_Camino");
    const enCamino = enCaminoIdx >= 0 ? parsedPedidos[enCaminoIdx] : null;

    // Calcular resumen de ruta (solo pedidos activos)
    const activosIndices = pedidos
      .map((p, i) => (p.estado !== "Entregado" && p.estado !== "Fallido") ? i : -1)
      .filter((i) => i >= 0);
    const distanciaTotalKm = activosIndices.reduce(
      (sum, i) => sum + (parsedPedidos[i].distancia_km || 0), 0
    );
    const duracionTotalMin = activosIndices.reduce(
      (sum, i) => sum + (parsedPedidos[i].duracion_estimada_min || 0), 0
    );

    // Obtener base location
    const baseResult = await sql`SELECT value FROM settings WHERE key = 'base_location'`;
    const baseLocation = baseResult.length > 0
      ? baseResult[0].value
      : { lat: -12.0464, lng: -77.0428, address: "Centro de Lima", name: "Local Principal" };

    return NextResponse.json({
      pedidos: parsedPedidos,
      stats: {
        total,
        entregados,
        fallidos,
        completados: entregados + fallidos,
        pendientes: total - entregados - fallidos,
      },
      rutaResumen: {
        paradasRestantes: activosIndices.length,
        distanciaTotalKm: Math.round(distanciaTotalKm * 100) / 100,
        duracionTotalMin: duracionTotalMin,
      },
      pedidoActivo: enCamino,
      baseLocation,
    });
  } catch (error) {
    console.error("Error en mi-ruta:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}


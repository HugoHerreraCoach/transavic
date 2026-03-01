// src/app/api/analytics/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no está definida");

    const sql = neon(connectionString);
    const searchParams = request.nextUrl.searchParams;
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");

    // Default: last 30 days
    const defaultDesde = new Date();
    defaultDesde.setDate(defaultDesde.getDate() - 30);
    const fechaDesde = desde || defaultDesde.toISOString().split("T")[0];
    const fechaHasta = hasta || new Date().toISOString().split("T")[0];

    // ── KPIs ──
    const kpis = await sql`
      SELECT 
        COUNT(*) as total_pedidos,
        COUNT(*) FILTER (WHERE entregado = TRUE) as entregados,
        COUNT(*) FILTER (WHERE entregado = FALSE) as pendientes
      FROM pedidos
      WHERE fecha_pedido >= ${fechaDesde}::date AND fecha_pedido <= ${fechaHasta}::date
    `;

    // ── Top Productos ──
    const topProductos = await sql`
      SELECT 
        pi.producto_nombre as nombre,
        pi.unidad,
        SUM(pi.cantidad) as total_cantidad,
        COUNT(DISTINCT pi.pedido_id) as total_pedidos
      FROM pedido_items pi
      JOIN pedidos p ON pi.pedido_id = p.id
      WHERE p.fecha_pedido >= ${fechaDesde}::date AND p.fecha_pedido <= ${fechaHasta}::date
      GROUP BY pi.producto_nombre, pi.unidad
      ORDER BY total_cantidad DESC
      LIMIT 15
    `;

    // ── Ventas por día ──
    const ventasPorDia = await sql`
      SELECT 
        TO_CHAR(fecha_pedido, 'YYYY-MM-DD') as fecha,
        TO_CHAR(fecha_pedido, 'DD/MM') as fecha_corta,
        COUNT(*) as total
      FROM pedidos
      WHERE fecha_pedido >= ${fechaDesde}::date AND fecha_pedido <= ${fechaHasta}::date
      GROUP BY fecha_pedido
      ORDER BY fecha_pedido ASC
    `;

    // ── Por empresa ──
    const porEmpresa = await sql`
      SELECT 
        empresa,
        COUNT(*) as total
      FROM pedidos
      WHERE fecha_pedido >= ${fechaDesde}::date AND fecha_pedido <= ${fechaHasta}::date
      GROUP BY empresa
      ORDER BY total DESC
    `;

    // ── Por distrito ──
    const porDistrito = await sql`
      SELECT 
        COALESCE(distrito, 'Sin distrito') as distrito,
        COUNT(*) as total
      FROM pedidos
      WHERE fecha_pedido >= ${fechaDesde}::date AND fecha_pedido <= ${fechaHasta}::date
      GROUP BY distrito
      ORDER BY total DESC
      LIMIT 10
    `;

    // ── Entregas por persona: Hoy, Esta Semana, Este Mes ──
    const entregasHoy = await sql`
      SELECT entregado_por as persona, COUNT(*) as total
      FROM pedidos
      WHERE entregado = TRUE AND entregado_por IS NOT NULL
        AND entregado_at::date = CURRENT_DATE
      GROUP BY entregado_por ORDER BY total DESC
    `;

    const entregasSemana = await sql`
      SELECT entregado_por as persona, COUNT(*) as total
      FROM pedidos
      WHERE entregado = TRUE AND entregado_por IS NOT NULL
        AND entregado_at >= date_trunc('week', CURRENT_DATE)
      GROUP BY entregado_por ORDER BY total DESC
    `;

    const entregasMes = await sql`
      SELECT entregado_por as persona, COUNT(*) as total
      FROM pedidos
      WHERE entregado = TRUE AND entregado_por IS NOT NULL
        AND entregado_at >= date_trunc('month', CURRENT_DATE)
      GROUP BY entregado_por ORDER BY total DESC
    `;

    return NextResponse.json({
      kpis: kpis[0],
      topProductos,
      ventasPorDia,
      porEmpresa,
      porDistrito,
      entregasPorPersona: { hoy: entregasHoy, semana: entregasSemana, mes: entregasMes },
      rango: { desde: fechaDesde, hasta: fechaHasta },
    });
  } catch (error) {
    console.error("Error en analytics:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

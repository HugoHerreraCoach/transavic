// src/app/api/reportes/cuadre-fisico/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Reporte consolidado de inventario, exclusivo para admin y produccion
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const desdeParam = searchParams.get("desde") || searchParams.get("fecha");
  const hastaParam = searchParams.get("hasta") || desdeParam;

  if ((desdeParam && !FECHA_REGEX.test(desdeParam)) || (hastaParam && !FECHA_REGEX.test(hastaParam))) {
    return NextResponse.json(
      { error: "Formato de fecha inválido. Usar YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Obtener fecha por defecto (hoy en Lima)
    let desde = desdeParam;
    let hasta = hastaParam;
    if (!desde || !hasta) {
      const hoyRows = (await sql`
        SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
      `) as Array<{ hoy: string }>;
      const hoy = hoyRows[0]?.hoy || new Date().toISOString().split("T")[0];
      desde = desde || hoy;
      hasta = hasta || hoy;
    }

    const rows = await sql`
      WITH productos_carnicos AS (
        -- Seleccionar productos de categorías de carne (Pollo, Carnes)
        SELECT id, nombre, categoria, unidad
        FROM productos
        WHERE categoria IN ('Pollo', 'Carnes') AND activo IS NOT FALSE
      ),
      compras_dia AS (
        -- Sumatoria de kilos e ingresados por compras completadas en el rango de fechas
        SELECT 
          ci.producto_id,
          COALESCE(SUM(ci.peso_neto), 0)::numeric(14, 2) AS kg_comprados,
          COALESCE(SUM(ci.jabas), 0)::int AS jabas_compradas,
          COALESCE(SUM(ci.jabas_macho), 0)::int AS jabas_macho,
          COALESCE(SUM(ci.jabas_hembra), 0)::int AS jabas_hembra,
          COALESCE(SUM(ci.sueltos_macho), 0)::int AS sueltos_macho,
          COALESCE(SUM(ci.sueltos_hembra), 0)::int AS sueltos_hembra,
          COALESCE(SUM(ci.total_pollos), 0)::int AS total_pollos
        FROM compra_items ci
        JOIN compras c ON c.id = ci.compra_id
        WHERE c.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND c.estado <> 'Anulado'
          AND COALESCE(ci.tipo, 'ingreso') = 'ingreso'
        GROUP BY ci.producto_id
      ),
      ventas_ejecutivas AS (
        -- Sumatoria de kilos reales pesados para ejecutivas/delivery en el rango de fechas
        SELECT 
          pi.producto_id,
          COALESCE(SUM(COALESCE(pi.cantidad_real, pi.cantidad, 0)), 0)::numeric(14, 2) AS kg_ejecutivas
        FROM pedido_items pi
        JOIN pedidos p ON p.id = pi.pedido_id
        WHERE (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desde}::date AND ${hasta}::date
          AND COALESCE(p.origen, 'asesor') = 'asesor'
          AND p.estado <> 'Fallido'
          AND NOT COALESCE(p.anulada, FALSE)
        GROUP BY pi.producto_id
      ),
      ventas_planta AS (
        -- Sumatoria de kilos del POS de planta en el rango de fechas
        SELECT 
          pi.producto_id,
          COALESCE(SUM(pi.cantidad), 0)::numeric(14, 2) AS kg_planta
        FROM pedido_items pi
        JOIN pedidos p ON p.id = pi.pedido_id
        WHERE (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desde}::date AND ${hasta}::date
          AND p.origen = 'pos_planta'
          AND p.estado <> 'Fallido'
          AND NOT COALESCE(p.anulada, FALSE)
        GROUP BY pi.producto_id
      ),
      ventas_campo AS (
        -- Sumatoria de kilos en las ventas de campo en el rango de fechas
        SELECT 
          vi.producto_id,
          COALESCE(SUM(vi.peso_kg), 0)::numeric(14, 2) AS kg_campo
        FROM venta_avicola_items vi
        JOIN ventas_avicola v ON v.id = vi.venta_id
        WHERE v.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND NOT v.anulada
        GROUP BY vi.producto_id
      ),
      ajustes_periodo AS (
        -- Sumatoria de ajustes manuales registrados en el rango de fechas
        SELECT 
          producto_id,
          COALESCE(SUM(kilos_ajuste), 0)::numeric(14, 2) AS kg_ajuste
        FROM public.ajustes_cuadre_fisico
        WHERE fecha BETWEEN ${desde}::date AND ${hasta}::date
        GROUP BY producto_id
      )
      SELECT 
        pr.id AS producto_id,
        pr.nombre AS producto_nombre,
        pr.categoria AS producto_categoria,
        COALESCE(c.jabas_compradas, 0)::int AS jabas_compradas,
        COALESCE(c.kg_comprados, 0)::float8 AS kg_comprados,
        COALESCE(c.jabas_macho, 0)::int AS jabas_macho,
        COALESCE(c.jabas_hembra, 0)::int AS jabas_hembra,
        COALESCE(c.sueltos_macho, 0)::int AS sueltos_macho,
        COALESCE(c.sueltos_hembra, 0)::int AS sueltos_hembra,
        COALESCE(c.total_pollos, 0)::int AS total_pollos,
        -- Merma de beneficio estimada: Macho 0.35kg, Hembra 0.30kg por pollo
        ((COALESCE(c.jabas_macho, 0) * 7 + COALESCE(c.sueltos_macho, 0)) * 0.35 +
         (COALESCE(c.jabas_hembra, 0) * 9 + COALESCE(c.sueltos_hembra, 0)) * 0.30)::float8 AS kg_merma_estimada,
        COALESCE(ve.kg_ejecutivas, 0)::float8 AS kg_ejecutivas,
        COALESCE(vp.kg_planta, 0)::float8 AS kg_planta,
        COALESCE(vc.kg_campo, 0)::float8 AS kg_campo,
        COALESCE(aj.kg_ajuste, 0)::float8 AS kg_ajuste,
        (COALESCE(ve.kg_ejecutivas, 0) + COALESCE(vp.kg_planta, 0) + COALESCE(vc.kg_campo, 0))::float8 AS kg_vendidos,
        (COALESCE(c.kg_comprados, 0) - (COALESCE(ve.kg_ejecutivas, 0) + COALESCE(vp.kg_planta, 0) + COALESCE(vc.kg_campo, 0)) + COALESCE(aj.kg_ajuste, 0))::float8 AS diferencia
      FROM productos_carnicos pr
      LEFT JOIN compras_dia c ON c.producto_id = pr.id
      LEFT JOIN ventas_ejecutivas ve ON ve.producto_id = pr.id
      LEFT JOIN ventas_planta vp ON vp.producto_id = pr.id
      LEFT JOIN ventas_campo vc ON vc.producto_id = pr.id
      LEFT JOIN ajustes_periodo aj ON aj.producto_id = pr.id
      WHERE COALESCE(c.kg_comprados, 0) > 0 
         OR COALESCE(ve.kg_ejecutivas, 0) > 0 
         OR COALESCE(vp.kg_planta, 0) > 0 
         OR COALESCE(vc.kg_campo, 0) > 0
         OR COALESCE(aj.kg_ajuste, 0) <> 0
      ORDER BY pr.nombre ASC
    `;

    return NextResponse.json({
      desde,
      hasta,
      productos: rows,
    });
  } catch (error) {
    console.error("Error al calcular cuadre físico de mermas:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

// src/app/api/reportes/salida-carnes/route.ts
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

  // Solo admin y produccion tienen acceso a este reporte consolidado
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fechaParam = searchParams.get("fecha");
  const fechaInicioParam = searchParams.get("fecha_inicio");
  const fechaFinParam = searchParams.get("fecha_fin");

  if (fechaParam && !FECHA_REGEX.test(fechaParam)) {
    return NextResponse.json(
      { error: "Formato de fecha inválido. Usar YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (fechaInicioParam && !FECHA_REGEX.test(fechaInicioParam)) {
    return NextResponse.json(
      { error: "Formato de fecha_inicio inválido. Usar YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (fechaFinParam && !FECHA_REGEX.test(fechaFinParam)) {
    return NextResponse.json(
      { error: "Formato de fecha_fin inválido. Usar YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    let fechaInicio = fechaInicioParam;
    let fechaFin = fechaFinParam;

    if (!fechaInicio || !fechaFin) {
      if (fechaParam) {
        fechaInicio = fechaParam;
        fechaFin = fechaParam;
      } else {
        const hoyRows = (await sql`
          SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
        `) as Array<{ hoy: string }>;
        const hoy = hoyRows[0]?.hoy || new Date().toISOString().split("T")[0];
        fechaInicio = hoy;
        fechaFin = hoy;
      }
    }

    // 1. Ventas Ejecutivas (Asesoras)
    const ejecutivasResult = await sql`
      SELECT 
        COALESCE(SUM(COALESCE(pi.cantidad_real, pi.cantidad, 0)), 0)::numeric(14, 2) AS total_kg
      FROM pedidos p
      JOIN pedido_items pi ON pi.pedido_id = p.id
      JOIN productos pr ON pr.id = pi.producto_id
      -- fecha_pedido = fecha de ENTREGA (gotcha #8). Este reporte mide SALIDA física
      -- de mercadería, así que se ancla al día en que sale, no al día de la venta.
      -- Debe coincidir con /api/reportes/cuadre-fisico o los dos reportes se contradicen.
      WHERE p.fecha_pedido BETWEEN ${fechaInicio}::date AND ${fechaFin}::date
        AND COALESCE(p.origen, 'asesor') = 'asesor'
        AND p.estado <> 'Fallido'
        AND NOT COALESCE(p.anulada, FALSE)
        AND pi.unidad IN ('kg', 'KGM')
        AND pr.categoria IN ('Pollo', 'Carnes')
    ` as Array<{ total_kg: string | number }>;

    // 2. Ventas de Planta (POS Planta)
    const plantaResult = await sql`
      SELECT 
        COALESCE(SUM(COALESCE(pi.cantidad, 0)), 0)::numeric(14, 2) AS total_kg
      FROM pedidos p
      JOIN pedido_items pi ON pi.pedido_id = p.id
      JOIN productos pr ON pr.id = pi.producto_id
      WHERE p.fecha_pedido BETWEEN ${fechaInicio}::date AND ${fechaFin}::date
        AND p.origen = 'pos_planta'
        AND p.estado <> 'Fallido'
        AND NOT COALESCE(p.anulada, FALSE)
        AND pi.unidad IN ('kg', 'KGM')
        AND pr.categoria IN ('Pollo', 'Carnes')
    ` as Array<{ total_kg: string | number }>;

    // 3. Ventas en Campo
    const campoResult = await sql`
      SELECT 
        COALESCE(SUM(COALESCE(vi.peso_kg, 0)), 0)::numeric(14, 2) AS total_kg
      FROM ventas_avicola v
      JOIN venta_avicola_items vi ON vi.venta_id = v.id
      JOIN productos pr ON pr.id = vi.producto_id
      WHERE v.fecha BETWEEN ${fechaInicio}::date AND ${fechaFin}::date
        AND NOT v.anulada
        AND pr.categoria IN ('Pollo', 'Carnes')
    ` as Array<{ total_kg: string | number }>;

    const kgEjecutivas = Number(ejecutivasResult[0]?.total_kg || 0);
    const kgPlanta = Number(plantaResult[0]?.total_kg || 0);
    const kgCampo = Number(campoResult[0]?.total_kg || 0);
    const granTotal = kgEjecutivas + kgPlanta + kgCampo;

    return NextResponse.json({
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      ejecutivas: kgEjecutivas,
      planta: kgPlanta,
      campo: kgCampo,
      total: granTotal,
    });
  } catch (error) {
    console.error("Error al calcular salida de carnes:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

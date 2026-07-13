// src/app/api/rentabilidad/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { leerParametrosNegocio } from "@/lib/parametros-negocio";
import { fechaHoyLima } from "@/lib/sunat/fechas";
import { resumenVentasGeneralesPorFecha } from "@/lib/ventas-generales";

export const dynamic = "force-dynamic";

function sumarDiasIso(fecha: string, delta: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const valor = new Date(Date.UTC(y, m - 1, d + delta));
  return valor.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fechaInicio = searchParams.get("fechaInicio") || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const fechaFin = searchParams.get("fechaFin") || new Date().toISOString().split("T")[0];

  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }
    const sql = neon(connectionString);

    // 1. Obtener compras de pollo en el período
    const comprasRows = await sql`
      SELECT 
        COALESCE(SUM(ci.subtotal), 0) AS total_monto,
        COALESCE(SUM(ci.peso_neto), 0) AS total_peso
      FROM compras c
      JOIN compra_items ci ON c.id = ci.compra_id
      JOIN productos p ON ci.producto_id = p.id
      WHERE c.fecha >= ${fechaInicio} AND c.fecha <= ${fechaFin}
        AND c.estado <> 'Anulado'
        AND p.categoria = 'Pollo'
    `;
    const polloComprasMonto = Number(comprasRows[0].total_monto);
    const polloComprasPeso = Number(comprasRows[0].total_peso);

    // Fallback: precio de compra promedio del catálogo si no hay compras
    const fallbackRows = await sql`
      SELECT COALESCE(AVG(precio_compra), 0) AS precio_promedio
      FROM productos
      WHERE categoria = 'Pollo' AND activo = TRUE AND precio_compra > 0
    `;
    const precioCompraFallback = Number(fallbackRows[0].precio_promedio) || 7.50; // default a 7.50 si todo falla

    // 2. Obtener mermas y rendimientos en el período
    const mermasRows = await sql`
      SELECT
        COALESCE(SUM(peso_bruto), 0) AS bruto,
        COALESCE(SUM(peso_limpio), 0) AS limpio,
        COALESCE(SUM(peso_menudencia), 0) AS menudencia,
        COALESCE(SUM(merma), 0) AS merma
      FROM mermas_diarias
      WHERE fecha >= ${fechaInicio} AND fecha <= ${fechaFin}
    `;
    const totalBruto = Number(mermasRows[0].bruto);
    const totalLimpio = Number(mermasRows[0].limpio);
    const totalMenudencia = Number(mermasRows[0].menudencia);
    const totalMerma = Number(mermasRows[0].merma);

    // 3. Obtener ventas de pollo en el período
    const ventasRows = await sql`
      SELECT 
        COALESCE(SUM(pi.subtotal), 0) AS total_monto,
        COALESCE(SUM(pi.cantidad), 0) AS total_peso
      FROM pedidos p
      JOIN pedido_items pi ON p.id = pi.pedido_id
      JOIN productos prod ON pi.producto_id = prod.id
      WHERE p.fecha_pedido >= ${fechaInicio} AND p.fecha_pedido <= ${fechaFin}
        AND p.estado = 'Entregado'
        AND NOT COALESCE(p.anulada, FALSE)
        AND prod.categoria = 'Pollo'
    `;
    const polloVentasMonto = Number(ventasRows[0].total_monto);
    const polloVentasPeso = Number(ventasRows[0].total_peso);

    // Cálculos de Costeo Real
    const costoCompraPorKg = polloComprasPeso > 0 ? (polloComprasMonto / polloComprasPeso) : precioCompraFallback;
    
    // Si hay mermas, calculamos el yield del periodo. Si no, usamos el rendimiento
    // estándar configurable (/dashboard/configuracion; default histórico 80% = 20% merma).
    const parametros = await leerParametrosNegocio(sql);
    const mermaFallback = 100 - parametros.rendimiento_fallback_pct;
    const mermaPorcentaje = totalBruto > 0 ? (totalMerma / totalBruto) * 100 : mermaFallback;
    const rendimientoPorcentaje = 100 - mermaPorcentaje;

    const costoRealPorKg = costoCompraPorKg / (rendimientoPorcentaje / 100);

    const precioVentaPromedio = polloVentasPeso > 0 ? (polloVentasMonto / polloVentasPeso) : 0;
    const margenUtilidadPorKg = precioVentaPromedio > 0 ? (precioVentaPromedio - costoRealPorKg) : 0;
    const utilidadProyectada = polloVentasPeso * margenUtilidadPorKg;

    // Obtener los datos día a día para un gráfico de tendencia
    const comprasDiarias = await sql`
      SELECT 
        c.fecha,
        COALESCE(SUM(ci.subtotal), 0) AS monto,
        COALESCE(SUM(ci.peso_neto), 0) AS peso
      FROM compras c
      JOIN compra_items ci ON c.id = ci.compra_id
      JOIN productos p ON ci.producto_id = p.id
      WHERE c.fecha >= ${fechaInicio} AND c.fecha <= ${fechaFin}
        AND c.estado <> 'Anulado'
        AND p.categoria = 'Pollo'
      GROUP BY c.fecha
      ORDER BY c.fecha ASC
    `;

    const mermasDiarias = await sql`
      SELECT
        fecha,
        COALESCE(SUM(peso_bruto), 0) AS bruto,
        COALESCE(SUM(peso_limpio), 0) AS limpio,
        COALESCE(SUM(peso_menudencia), 0) AS menudencia,
        COALESCE(SUM(merma), 0) AS merma
      FROM mermas_diarias
      WHERE fecha >= ${fechaInicio} AND fecha <= ${fechaFin}
      GROUP BY fecha
      ORDER BY fecha ASC
    `;

    // Comparativo "Hoy vs Ayer": exactamente la misma definición de las tres
    // operaciones usada por Ventas Generales y Consolidado.
    const hoyIso = fechaHoyLima();
    const ayerIso = sumarDiasIso(hoyIso, -1);
    const [ventasHoy, ventasAyer] = await Promise.all([
      resumenVentasGeneralesPorFecha(sql, hoyIso),
      resumenVentasGeneralesPorFecha(sql, ayerIso),
    ]);
    const comparativo = {
      hoy: { monto: ventasHoy.total, pedidos: ventasHoy.totalVentas },
      ayer: { monto: ventasAyer.total, pedidos: ventasAyer.totalVentas },
    };

    return NextResponse.json({
      comparativo,
      resumen: {
        polloComprasMonto,
        polloComprasPeso,
        costoCompraPorKg,
        totalBruto,
        totalLimpio,
        totalMenudencia,
        totalMerma,
        mermaPorcentaje,
        rendimientoPorcentaje,
        costoRealPorKg,
        polloVentasMonto,
        polloVentasPeso,
        precioVentaPromedio,
        margenUtilidadPorKg,
        utilidadProyectada,
      },
      comprasDiarias,
      mermasDiarias
    });
  } catch (error) {
    console.error("Error en API de Rentabilidad:", error);
    return NextResponse.json({ error: "Error al calcular rentabilidad" }, { status: 500 });
  }
}

// src/app/api/consolidado/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import {
  listaClientesPlantaConSaldo,
  UMBRAL_DEUDA_PLANTA,
} from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // 1. Cuentas Bancarias y Saldos
    const cuentas = await sql`
      SELECT id, nombre, tipo, saldo::float8 AS saldo, activa
      FROM cuentas_bancarias
      WHERE activa = true
      ORDER BY tipo ASC, nombre ASC
    `;

    // 2. Cuentas por Cobrar (Facturas pendientes/vencidas)
    const cobrarRows = await sql`
      SELECT COALESCE(SUM(monto), 0)::float8 AS total_cobrar
      FROM facturas
      WHERE estado IN ('Pendiente', 'Vencida')
    `;
    const totalCobrar = cobrarRows[0]?.total_cobrar || 0;

    // 2b. Cartera por Cobrar de PLANTA (POS) — aislada de `facturas`.
    //     Desde que el POS dejó de escribir en `facturas`, su deuda no aparecía
    //     en la cartera de ejecutivas. La recuperamos por separado reutilizando
    //     la aritmética central de saldos (NO duplicar): saldo = monto − Σ abonos
    //     de cobranzas no anuladas; solo cuenta el saldo positivo (> umbral).
    const clientesPlanta = await listaClientesPlantaConSaldo(sql);
    const carteraPlanta = clientesPlanta.reduce(
      (acc, c) => acc + (c.saldo_actual > UMBRAL_DEUDA_PLANTA ? c.saldo_actual : 0),
      0
    );

    // 3. Cuentas por Pagar (Pasivos a proveedores)
    const pagarRows = await sql`
      SELECT COALESCE(SUM(monto_deuda - monto_pagado), 0)::float8 AS total_pagar
      FROM cuentas_por_pagar
      WHERE estado IN ('Pendiente', 'Parcial')
    `;
    const totalPagar = pagarRows[0]?.total_pagar || 0;

    // 4. Últimas transacciones registradas en cuentas
    const transacciones = await sql`
      SELECT 
        t.id,
        t.cuenta_id,
        c.nombre AS cuenta_nombre,
        t.tipo,
        t.monto::float8 AS monto,
        t.concepto,
        TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
        u.name AS usuario_name
      FROM transacciones t
      JOIN cuentas_bancarias c ON t.cuenta_id = c.id
      JOIN users u ON t.usuario_id = u.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `;

    // 5. Ventas de Hoy (Planta y Asesoras)
    const ventasHoyRows = await sql`
      SELECT 
        COALESCE(SUM(im.monto), 0)::float8 AS total_ventas,
        COALESCE(SUM(im.monto) FILTER (WHERE p.origen = 'pos_planta'), 0)::float8 AS ventas_pos,
        COALESCE(SUM(im.monto) FILTER (WHERE p.origen IS NULL OR p.origen != 'pos_planta'), 0)::float8 AS ventas_asesor
      FROM pedidos p
      LEFT JOIN (
        SELECT pedido_id, SUM(COALESCE(subtotal_real, subtotal, 0)) AS monto
        FROM pedido_items
        GROUP BY pedido_id
      ) im ON im.pedido_id = p.id
      WHERE p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
        AND p.estado = 'Entregado'
    `;
    const ventasHoy = ventasHoyRows[0] || { total_ventas: 0, ventas_pos: 0, ventas_asesor: 0 };

    return NextResponse.json({
      cuentas,
      totalCobrar, // cartera de ejecutivas (facturas Pendiente/Vencida)
      carteraPlanta, // cartera de planta (POS): saldos de cobranzas_planta
      totalPagar,
      transacciones,
      ventasHoy
    });
  } catch (error: unknown) {
    console.error("Error en GET /api/consolidado:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

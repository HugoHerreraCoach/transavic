// src/app/api/consolidado/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import {
  listaClientesPlantaConSaldo,
  UMBRAL_DEUDA_PLANTA,
} from "@/lib/planta/saldos";
import { listaClientesConSaldo, UMBRAL_DEUDA } from "@/lib/avicola/saldos";
import { resumenVentasGeneralesPorFecha } from "@/lib/ventas-generales";

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

    // 5. Ventas registradas HOY de las tres operaciones. Misma fuente y criterio
    // que /api/ventas-generales: nunca mezclar fecha de entrega con fecha de venta.
    const hoyRows = (await sql`
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
    `) as Array<{ hoy: string }>;
    const resumenVentas = await resumenVentasGeneralesPorFecha(sql, hoyRows[0].hoy);

    // 5c. Cartera por Cobrar de CAMPO (saldos avícola positivos) — reutiliza la
    //     aritmética central de saldos (no duplicar). Un saldo a favor no netea deuda ajena.
    const clientesCampo = await listaClientesConSaldo(sql);
    const carteraCampo = clientesCampo.reduce(
      (acc, c) => acc + (c.saldo_actual > UMBRAL_DEUDA ? c.saldo_actual : 0),
      0
    );

    const ventasHoy = {
      total_ventas: resumenVentas.total,
      ventas_pos: resumenVentas.operaciones.planta.total,
      ventas_asesor: resumenVentas.operaciones.ejecutivas.total,
      ventas_campo: resumenVentas.operaciones.campo.total,
      total_todas: resumenVentas.total,
    };

    return NextResponse.json({
      cuentas,
      totalCobrar, // cartera de ejecutivas (facturas Pendiente/Vencida)
      carteraPlanta, // cartera de planta (POS): saldos de cobranzas_planta
      carteraCampo, // cartera de campo (Clientes Avícola): saldos avícola positivos
      totalPagar,
      transacciones,
      ventasHoy,
    });
  } catch (error: unknown) {
    console.error("Error en GET /api/consolidado:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

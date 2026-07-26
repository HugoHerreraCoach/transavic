// src/app/api/reportes/balance-asesoras/cliente/route.ts
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

  const { searchParams } = new URL(req.url);
  const clienteId = searchParams.get("cliente_id");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  if (!clienteId) {
    return NextResponse.json({ error: "ID de cliente requerido" }, { status: 400 });
  }

  if (!desde || !hasta || !FECHA_REGEX.test(desde) || !FECHA_REGEX.test(hasta)) {
    return NextResponse.json(
      { error: "Rango de fechas requerido y válido (desde/hasta en formato YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Verificar que el cliente existe y que si el rol es asesor, el cliente le pertenece
    const clienteRows = await sql`
      SELECT id, nombre, razon_social, ruc_dni, asesor_id
      FROM clientes
      WHERE id = ${clienteId}::uuid
    `;

    if (clienteRows.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const cliente = clienteRows[0];

    if (session.user.role === "asesor" && cliente.asesor_id !== session.user.id) {
      return NextResponse.json({ error: "Sin permisos para consultar este cliente" }, { status: 403 });
    }

    // 1. Saldo Anterior
    const saldoAntRows = await sql`
      SELECT 
        COALESCE(SUM(f.monto), 0)::numeric(14, 2) AS saldo_ant
      FROM facturas f
      WHERE f.cliente_id = ${clienteId}::uuid
        AND f.fecha_emision < ${desde}::date
        AND f.estado <> 'Anulada'
        AND (f.fecha_pago IS NULL OR f.fecha_pago >= ${desde}::date)
    `;
    const saldoAnterior = Number(saldoAntRows[0]?.saldo_ant || 0);

    interface DbRow {
      id: string;
      tipo: string;
      fecha: string;
      referencia: string;
      monto: number;
      kilos: number;
    }

    // 2. Transacciones del Periodo
    // Ventas
    const ventas = (await sql`
      SELECT 
        f.id,
        'VENTA' AS tipo,
        f.fecha_emision::text AS fecha,
        f.serie_numero AS referencia,
        f.monto::float8 AS monto,
        COALESCE((
          SELECT SUM(COALESCE(pi.cantidad_real, pi.cantidad, 0)) 
          FROM pedido_items pi 
          WHERE pi.pedido_id = f.pedido_id 
            AND pi.unidad IN ('kg', 'KGM')
        ), 0)::float8 AS kilos
      FROM facturas f
      WHERE f.cliente_id = ${clienteId}::uuid
        AND f.fecha_emision BETWEEN ${desde}::date AND ${hasta}::date
        AND f.estado <> 'Anulada'
    `) as unknown as DbRow[];

    // Cobros
    const cobros = (await sql`
      SELECT 
        f.id,
        'COBRO' AS tipo,
        f.fecha_pago::text AS fecha,
        f.serie_numero AS referencia,
        f.monto::float8 AS monto,
        0.0::float8 AS kilos
      FROM facturas f
      WHERE f.cliente_id = ${clienteId}::uuid
        AND f.fecha_pago BETWEEN ${desde}::date AND ${hasta}::date
        AND f.estado = 'Pagada'
    `) as unknown as DbRow[];

    // Descuentos (Notas de Crédito)
    const descuentos = (await sql`
      SELECT 
        c.id,
        'NC_DESCUENTO' AS tipo,
        c.fecha_emision::text AS fecha,
        c.serie_numero AS referencia,
        c.monto_total::float8 AS monto,
        0.0::float8 AS kilos
      FROM comprobantes c
      JOIN pedidos p ON p.id = c.pedido_id
      WHERE p.cliente_id = ${clienteId}::uuid
        AND c.tipo = '07'
        AND c.estado IN ('aceptado', 'observado', 'pendiente')
        AND c.fecha_emision BETWEEN ${desde}::date AND ${hasta}::date
    `) as unknown as DbRow[];

    interface TmpTx {
      id: string;
      tipo: "VENTA" | "COBRO" | "NC_DESCUENTO";
      fecha: string;
      referencia: string;
      monto: number;
      kilos: number;
    }

    // Unificar y ordenar cronológicamente
    const transacciones: TmpTx[] = [
      ...ventas.map((v) => ({
        id: v.id,
        tipo: "VENTA" as const,
        fecha: v.fecha,
        referencia: v.referencia,
        monto: Number(v.monto),
        kilos: Number(v.kilos),
      })),
      ...cobros.map((c) => ({
        id: c.id,
        tipo: "COBRO" as const,
        fecha: c.fecha,
        referencia: c.referencia,
        monto: Number(c.monto),
        kilos: Number(c.kilos),
      })),
      ...descuentos.map((d) => ({
        id: d.id,
        tipo: "NC_DESCUENTO" as const,
        fecha: d.fecha,
        referencia: d.referencia,
        monto: Number(d.monto),
        kilos: Number(d.kilos),
      })),
    ].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    return NextResponse.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        razon_social: cliente.razon_social,
        ruc_dni: cliente.ruc_dni,
      },
      saldo_anterior: saldoAnterior,
      transacciones,
    });
  } catch (error) {
    console.error("Error al obtener detalle financiero de cliente:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

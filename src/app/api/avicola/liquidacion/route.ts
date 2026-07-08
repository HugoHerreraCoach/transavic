// src/app/api/avicola/liquidacion/route.ts
// Liquidación del día del módulo "Clientes Avícola" (req. §11) — admin-only, solo lectura.
// Filtros: fecha (default hoy Lima), mercado, cliente_id, medio_pago (SOLO afecta cobranza).
// Toda agregación filtra NOT anulada / NOT anulado (disciplina gotcha #24).
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MEDIOS_PAGO_AVICOLA,
  type LiquidacionAvicola,
  type MedioPagoAvicola,
} from "@/lib/avicola/types";
import { listaClientesConSaldo, UMBRAL_DEUDA } from "@/lib/avicola/saldos";
import { fechaHoyLima } from "@/lib/sunat/fechas";

export const dynamic = "force-dynamic";

/** Redondeo a 2 decimales para limpiar ruido de float en sumas TS. */
const r2 = (n: number) => Math.round(n * 100) / 100;

const FiltrosSchema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD")
    .refine((f) => {
      // Fecha calendario real (rechaza 2026-02-31) para no reventar el cast en SQL.
      const [y, m, d] = f.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    }, "La fecha indicada no existe en el calendario")
    .optional(),
  mercado: z.string().min(1).optional(),
  cliente_id: z.string().uuid().optional(),
  medio_pago: z.enum(MEDIOS_PAGO_AVICOLA).optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = FiltrosSchema.safeParse({
    fecha: searchParams.get("fecha") ?? undefined,
    mercado: searchParams.get("mercado") ?? undefined,
    cliente_id: searchParams.get("cliente_id") ?? undefined,
    medio_pago: searchParams.get("medio_pago") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const fecha = parsed.data.fecha ?? fechaHoyLima();
  const mercado = parsed.data.mercado ?? null;
  const clienteId = parsed.data.cliente_id ?? null;
  const medioPago = parsed.data.medio_pago ?? null;

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const [ventasPorCliente, porProducto, abonosPorMedio, abonosPorCliente, lista] =
      await Promise.all([
        // Ventas del día agrupadas por cliente (filtros mercado/cliente).
        sql`
          SELECT v.cliente_id, SUM(v.total)::float8 AS vendido
          FROM ventas_avicola v
          JOIN clientes_avicola c ON c.id = v.cliente_id
          WHERE NOT v.anulada
            AND v.fecha = ${fecha}::date
            AND (${mercado}::text IS NULL OR c.mercado = ${mercado}::text)
            AND (${clienteId}::uuid IS NULL OR v.cliente_id = ${clienteId}::uuid)
          GROUP BY v.cliente_id
        ` as unknown as Promise<Array<{ cliente_id: string; vendido: number }>>,

        // Kilos y monto por producto de las ventas del día (mismos filtros).
        sql`
          SELECT
            vi.producto_nombre,
            SUM(vi.peso_kg)::float8 AS total_kg,
            SUM(vi.subtotal)::float8 AS total_monto
          FROM venta_avicola_items vi
          JOIN ventas_avicola v ON v.id = vi.venta_id
          JOIN clientes_avicola c ON c.id = v.cliente_id
          WHERE NOT v.anulada
            AND v.fecha = ${fecha}::date
            AND (${mercado}::text IS NULL OR c.mercado = ${mercado}::text)
            AND (${clienteId}::uuid IS NULL OR v.cliente_id = ${clienteId}::uuid)
          GROUP BY vi.producto_nombre
          ORDER BY SUM(vi.peso_kg) DESC
        ` as unknown as Promise<
          Array<{ producto_nombre: string; total_kg: number; total_monto: number }>
        >,

        // Cobranza del día por medio de pago — ÚNICO bloque donde aplica medio_pago.
        sql`
          SELECT a.medio_pago, SUM(a.monto)::float8 AS total
          FROM abonos_avicola a
          JOIN clientes_avicola c ON c.id = a.cliente_id
          WHERE NOT a.anulado
            AND a.fecha = ${fecha}::date
            AND (${mercado}::text IS NULL OR c.mercado = ${mercado}::text)
            AND (${clienteId}::uuid IS NULL OR a.cliente_id = ${clienteId}::uuid)
            AND (${medioPago}::text IS NULL OR a.medio_pago = ${medioPago}::text)
          GROUP BY a.medio_pago
        ` as unknown as Promise<Array<{ medio_pago: MedioPagoAvicola; total: number }>>,

        // Abonos del día por cliente (SIN filtro de medio — vista de clientes).
        sql`
          SELECT
            a.cliente_id,
            SUM(a.monto)::float8 AS abonado,
            ARRAY_AGG(DISTINCT a.medio_pago ORDER BY a.medio_pago) AS medios
          FROM abonos_avicola a
          JOIN clientes_avicola c ON c.id = a.cliente_id
          WHERE NOT a.anulado
            AND a.fecha = ${fecha}::date
            AND (${mercado}::text IS NULL OR c.mercado = ${mercado}::text)
            AND (${clienteId}::uuid IS NULL OR a.cliente_id = ${clienteId}::uuid)
          GROUP BY a.cliente_id
        ` as unknown as Promise<
          Array<{ cliente_id: string; abonado: number; medios: MedioPagoAvicola[] }>
        >,

        // Estado de cuenta de TODOS los clientes (cartera global + saldo por cliente).
        listaClientesConSaldo(sql),
      ]);

    // ── Ventas ──────────────────────────────────────────────────────────────
    const total_vendido = r2(ventasPorCliente.reduce((s, v) => s + v.vendido, 0));
    const clientes_atendidos = ventasPorCliente.length;
    const total_kg = r2(porProducto.reduce((s, p) => s + p.total_kg, 0));
    const por_producto = porProducto.map((p) => ({
      producto_nombre: p.producto_nombre,
      total_kg: r2(p.total_kg),
      total_monto: r2(p.total_monto),
    }));

    // ── Cobranza ────────────────────────────────────────────────────────────
    const cobradoPorMedio = new Map(abonosPorMedio.map((a) => [a.medio_pago, a.total]));
    const por_medio = MEDIOS_PAGO_AVICOLA.map((mp) => ({
      medio_pago: mp,
      total: r2(cobradoPorMedio.get(mp) ?? 0),
    }));
    const total_cobrado = r2(abonosPorMedio.reduce((s, a) => s + a.total, 0));
    // Cartera global: solo deudas positivas — un saldo a favor NO netea deuda ajena.
    const cartera_total = r2(
      lista.reduce((s, c) => s + Math.max(c.saldo_actual, 0), 0)
    );

    // ── Por cliente (venta O abono ese día) ─────────────────────────────────
    const infoCliente = new Map(lista.map((c) => [c.id, c]));
    const abonadoPorCliente = new Map(abonosPorCliente.map((a) => [a.cliente_id, a]));
    const idsDelDia = new Set<string>([
      ...ventasPorCliente.map((v) => v.cliente_id),
      ...abonosPorCliente.map((a) => a.cliente_id),
    ]);
    const vendidoPorCliente = new Map(
      ventasPorCliente.map((v) => [v.cliente_id, v.vendido])
    );
    const por_cliente = [...idsDelDia]
      .map((id) => {
        const cliente = infoCliente.get(id);
        const abono = abonadoPorCliente.get(id);
        return {
          cliente_id: id,
          nombre: cliente?.nombre ?? "(cliente no encontrado)",
          mercado: cliente?.mercado ?? "",
          vendido: r2(vendidoPorCliente.get(id) ?? 0),
          abonado: r2(abono?.abonado ?? 0),
          saldo_actual: r2(cliente?.saldo_actual ?? 0),
          medios: abono?.medios ?? [],
        };
      })
      .sort(
        (a, b) =>
          b.vendido - a.vendido ||
          b.abonado - a.abonado ||
          a.nombre.localeCompare(b.nombre, "es")
      );

    // ── Clientes ────────────────────────────────────────────────────────────
    const visitados = clientes_atendidos;
    const con_pago = abonosPorCliente.length;
    const sin_pago = ventasPorCliente.filter(
      (v) => !abonadoPorCliente.has(v.cliente_id)
    ).length;
    const con_deuda = lista.filter((c) => c.saldo_actual > UMBRAL_DEUDA).length;

    const respuesta: LiquidacionAvicola = {
      fecha,
      ventas: {
        total_vendido,
        total_kg,
        clientes_atendidos,
        por_cliente,
        por_producto,
      },
      cobranza: {
        total_cobrado,
        // Puede ser negativo si ese día se cobró más de lo que se vendió — se devuelve tal cual.
        pendiente_del_dia: r2(total_vendido - total_cobrado),
        cartera_total,
        por_medio,
      },
      clientes: { visitados, con_pago, sin_pago, con_deuda },
    };

    return NextResponse.json(respuesta);
  } catch (error) {
    console.error("Error en GET /api/avicola/liquidacion:", error);
    return NextResponse.json(
      { error: "Error al generar la liquidación del día" },
      { status: 500 }
    );
  }
}

// src/app/api/cuentas-por-pagar/deuda/route.ts
// POST: crea una deuda MANUAL a un proveedor (sin compra vinculada) — el caso típico
// es el "saldo anterior": lo que ya se le debía antes de usar el sistema (pedido de
// Nelita, 9 jul 2026). Se paga con el flujo normal de Cuentas por Pagar.
// Admin-only, igual que los pagos (es un movimiento financiero).
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DeudaManualSchema = z.object({
  proveedor_id: z.string().uuid(),
  monto: z.number().positive("El monto debe ser mayor a 0."),
  fecha_vencimiento: z
    .string()
    .regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD).")
    .optional()
    .nullable(),
  concepto: z.string().trim().max(200).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = DeudaManualSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { proveedor_id, monto, fecha_vencimiento, concepto } = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    const proveedorRows = await sql`
      SELECT razon_social FROM proveedores WHERE id = ${proveedor_id}
    `;
    if (proveedorRows.length === 0) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }

    const filas = await sql`
      INSERT INTO cuentas_por_pagar (
        proveedor_id, compra_id, monto_deuda, monto_pagado, estado,
        fecha_vencimiento, concepto
      )
      VALUES (
        ${proveedor_id}, NULL, ${monto}, 0, 'Pendiente',
        ${fecha_vencimiento ?? null}::date, ${concepto?.trim() || "Saldo anterior"}
      )
      RETURNING id
    `;

    return NextResponse.json({ success: true, id: filas[0].id }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error al registrar deuda manual a proveedor:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

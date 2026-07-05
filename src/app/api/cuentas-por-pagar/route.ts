// src/app/api/cuentas-por-pagar/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PagoSchema = z.object({
  cuentaPagarId: z.string().uuid(),
  cuentaBancariaId: z.string().uuid(),
  montoPago: z.number().positive(),
  fechaPago: z.string(),
  notas: z.string().optional().nullable(),
});

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
    const deudas = await sql`
      SELECT 
        cpp.id,
        cpp.proveedor_id,
        prov.razon_social AS proveedor_nombre,
        prov.ruc AS proveedor_ruc,
        cpp.compra_id,
        comp.nro_doc AS compra_nro_doc,
        comp.tipo_doc AS compra_tipo_doc,
        cpp.monto_deuda::float8 AS monto_deuda,
        cpp.monto_pagado::float8 AS monto_pagado,
        cpp.estado,
        TO_CHAR(cpp.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
        cpp.created_at
      FROM cuentas_por_pagar cpp
      JOIN proveedores prov ON cpp.proveedor_id = prov.id
      LEFT JOIN compras comp ON cpp.compra_id = comp.id
      ORDER BY cpp.estado DESC, cpp.fecha_vencimiento ASC, cpp.created_at DESC
    `;
    return NextResponse.json({ deudas });
  } catch (error: unknown) {
    console.error("Error al obtener cuentas por pagar:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

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
    const result = PagoSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { cuentaPagarId, cuentaBancariaId, montoPago, fechaPago, notas } = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // 1. Obtener la cuenta por pagar
    const deudaRows = await sql`
      SELECT cpp.*, prov.razon_social AS proveedor_nombre, comp.nro_doc AS compra_nro_doc
      FROM cuentas_por_pagar cpp
      JOIN proveedores prov ON cpp.proveedor_id = prov.id
      LEFT JOIN compras comp ON cpp.compra_id = comp.id
      WHERE cpp.id = ${cuentaPagarId}
    `;

    if (deudaRows.length === 0) {
      return NextResponse.json({ error: "Cuenta por pagar no encontrada" }, { status: 404 });
    }

    const deuda = deudaRows[0];
    const montoDeuda = Number(deuda.monto_deuda);
    const montoPagadoActual = Number(deuda.monto_pagado);
    const restante = montoDeuda - montoPagadoActual;

    if (restante <= 0) {
      return NextResponse.json({ error: "Esta deuda ya se encuentra totalmente pagada" }, { status: 400 });
    }

    if (montoPago > restante + 0.01) { // Tolerancia para flotantes
      return NextResponse.json({ error: `El monto a pagar (S/ ${montoPago.toFixed(2)}) supera el saldo restante de la deuda (S/ ${restante.toFixed(2)})` }, { status: 400 });
    }

    // 2. Obtener la cuenta bancaria de origen
    const cuentaRows = await sql`
      SELECT id, nombre, saldo::float8 AS saldo
      FROM cuentas_bancarias
      WHERE id = ${cuentaBancariaId} AND activa = true
    `;

    if (cuentaRows.length === 0) {
      return NextResponse.json({ error: "Cuenta bancaria de origen no encontrada o inactiva" }, { status: 404 });
    }

    const cuenta = cuentaRows[0];
    const saldoActual = Number(cuenta.saldo);

    if (saldoActual < montoPago) {
      return NextResponse.json({ error: `Fondos insuficientes en la cuenta "${cuenta.nombre}" (Saldo actual: S/ ${saldoActual.toFixed(2)})` }, { status: 400 });
    }

    // 3. Ejecutar la actualización atómica con el CTE encadenado
    const docLabel = deuda.compra_nro_doc ? `Doc: ${deuda.compra_nro_doc}` : "Sin Doc";
    const concepto = `Pago a Proveedor: ${deuda.proveedor_nombre} (${docLabel})${notas ? ` - ${notas}` : ""}`;

    const res = await sql`
      WITH update_pagar AS (
        UPDATE cuentas_por_pagar
        SET monto_pagado = monto_pagado + ${montoPago},
            estado = CASE WHEN (monto_pagado + ${montoPago}) >= monto_deuda - 0.01 THEN 'Pagado' ELSE 'Parcial' END,
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuentaPagarId}
        RETURNING id
      ),
      update_cuenta AS (
        UPDATE cuentas_bancarias
        SET saldo = saldo - ${montoPago},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuentaBancariaId}
        RETURNING id
      )
      INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
      SELECT uc.id, ${session.user.id}, 'egreso', ${montoPago}, ${concepto}, up.id
      FROM update_cuenta uc, update_pagar up
      RETURNING id;
    `;

    if (res.length === 0) {
      throw new Error("La transacción atómica de pago falló.");
    }

    return NextResponse.json({ success: true, message: "Pago registrado exitosamente" });
  } catch (error: unknown) {
    console.error("Error al registrar pago a proveedor:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

// src/app/api/cuentas-por-pagar/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PagoProveedorError,
  registrarPagoProveedor,
} from "@/lib/proveedores/pagos";

export const dynamic = "force-dynamic";

const PagoSchema = z.object({
  id: z.string().uuid().optional(),
  cuentaPagarId: z.string().uuid(),
  cuentaBancariaId: z.string().uuid(),
  montoPago: z
    .number()
    .positive()
    .max(99_999_999.99)
    .refine((monto) => Math.abs(monto * 100 - Math.round(monto * 100)) < 1e-7, {
      message: "El monto admite como máximo dos decimales",
    }),
  // Fecha REAL del pago (puede ser retroactiva): se persiste en transacciones.fecha.
  fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  notas: z.string().optional().nullable(),
  confirmarAnticipo: z.boolean().default(false),
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
        cpp.concepto,
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

    const {
      cuentaPagarId,
      cuentaBancariaId,
      montoPago,
      fechaPago,
      notas,
      confirmarAnticipo,
    } = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    const deudaRows = await sql`
      SELECT cpp.proveedor_id
      FROM cuentas_por_pagar cpp
      WHERE cpp.id = ${cuentaPagarId}
    `;

    if (deudaRows.length === 0) {
      return NextResponse.json({ error: "Cuenta por pagar no encontrada" }, { status: 404 });
    }

    const respuesta = await registrarPagoProveedor(sql, session.user.id, {
      id: result.data.id ?? crypto.randomUUID(),
      proveedor_id: String(deudaRows[0].proveedor_id),
      cuenta_bancaria_id: cuentaBancariaId,
      monto: montoPago,
      fecha: fechaPago,
      notas: notas ?? null,
      deuda_prioritaria_id: cuentaPagarId,
      confirmar_anticipo: confirmarAnticipo,
    });

    return NextResponse.json({
      success: true,
      repetido: respuesta.repetido,
      message: respuesta.repetido
        ? "El pago ya estaba registrado."
        : "Pago registrado exitosamente",
    });
  } catch (error: unknown) {
    if (error instanceof PagoProveedorError) {
      return NextResponse.json(
        { error: error.message, codigo: error.codigo, ...error.datos },
        { status: error.status }
      );
    }
    console.error("Error al registrar pago a proveedor:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

import { auth } from "@/auth";
import {
  construirEstadoCuentaProveedor,
  construirMovimientosProveedor,
} from "@/lib/proveedores/estado-cuenta";
import type {
  AplicacionPagoProveedor,
  DeudaProveedorFicha,
  FichaProveedorResponse,
  ItemCompraProveedor,
  PagoProveedorFicha,
} from "@/lib/proveedores/types";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((fecha) => {
    const valor = new Date(`${fecha}T00:00:00.000Z`);
    return !Number.isNaN(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
  });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Solo administradores pueden consultar saldos de proveedores" },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }
  const desdeParam = req.nextUrl.searchParams.get("desde");
  const hastaParam = req.nextUrl.searchParams.get("hasta");
  if (
    (desdeParam && !FechaSchema.safeParse(desdeParam).success) ||
    (hastaParam && !FechaSchema.safeParse(hastaParam).success) ||
    (desdeParam && hastaParam && desdeParam > hastaParam)
  ) {
    return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const proveedorRows = await sql`
      SELECT id, razon_social, ruc, telefono, direccion,
             COALESCE(activo, TRUE) AS activo,
             COALESCE(plazo_pago_dias, 30)::int AS plazo_pago_dias
      FROM proveedores
      WHERE id = ${id}
    `;
    if (proveedorRows.length === 0) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }

    const [deudaRows, itemRows, aplicacionRows, pagoRows] = await Promise.all([
      sql`
        SELECT
          cpp.id, cpp.compra_id,
          COALESCE(c.fecha, (cpp.created_at AT TIME ZONE 'America/Lima')::date)::text AS fecha,
          cpp.fecha_vencimiento::text,
          c.tipo_doc, c.nro_doc, cpp.concepto,
          cpp.monto_deuda::float8 AS monto_deuda,
          cpp.monto_pagado::float8 AS monto_pagado,
          (cpp.monto_deuda - cpp.monto_pagado)::float8 AS saldo_restante,
          cpp.estado, cpp.created_at::text
        FROM cuentas_por_pagar cpp
        LEFT JOIN compras c ON c.id = cpp.compra_id
        WHERE cpp.proveedor_id = ${id}
        ORDER BY fecha DESC, cpp.created_at DESC
      `,
      sql`
        SELECT
          ci.id, ci.compra_id, p.nombre AS producto_nombre,
          ci.peso_neto::float8 AS peso_neto, ci.jabas::int,
          ci.costo_unitario::float8 AS costo_unitario,
          ci.subtotal::float8 AS subtotal,
          COALESCE(ci.tipo, 'ingreso') AS tipo
        FROM compra_items ci
        JOIN compras c ON c.id = ci.compra_id
        JOIN productos p ON p.id = ci.producto_id
        WHERE c.proveedor_id = ${id}
        ORDER BY ci.id
      `,
      sql`
        SELECT
          a.id, a.pago_id, a.deuda_id, a.monto::float8 AS monto,
          a.origen, a.fecha_aplicacion::text,
          p.estado AS pago_estado,
          COALESCE(c.tipo_doc || ' ' || c.nro_doc, cpp.concepto, 'Deuda manual') AS documento
        FROM pagos_proveedores_aplicaciones a
        JOIN pagos_proveedores p ON p.id = a.pago_id
        JOIN cuentas_por_pagar cpp ON cpp.id = a.deuda_id
        LEFT JOIN compras c ON c.id = cpp.compra_id
        WHERE a.proveedor_id = ${id}
        ORDER BY a.fecha_aplicacion, a.created_at, a.id
      `,
      sql`
        SELECT
          p.id, p.fecha::text, p.monto::float8 AS monto, p.notas, p.estado,
          cb.nombre AS cuenta_nombre, COALESCE(u.name, 'Usuario') AS registrado_por,
          p.created_at::text, p.motivo_anulacion, p.anulado_at::text
        FROM pagos_proveedores p
        JOIN cuentas_bancarias cb ON cb.id = p.cuenta_bancaria_id
        LEFT JOIN users u ON u.id = p.registrado_por
        WHERE p.proveedor_id = ${id}
        ORDER BY p.fecha DESC, p.created_at DESC, p.id DESC
      `,
    ]);

    type AplicacionRow = AplicacionPagoProveedor & { pago_estado: string };
    const aplicaciones = aplicacionRows as unknown as AplicacionRow[];
    const items = itemRows as unknown as Array<ItemCompraProveedor & { compra_id: string }>;
    const aplicacionPublica = (a: AplicacionRow): AplicacionPagoProveedor => ({
      id: a.id,
      pago_id: a.pago_id,
      deuda_id: a.deuda_id,
      monto: Number(a.monto),
      origen: a.origen,
      fecha_aplicacion: a.fecha_aplicacion,
      documento: a.documento,
    });

    const deudas: DeudaProveedorFicha[] = deudaRows.map((row) => ({
      id: String(row.id),
      compra_id: row.compra_id ? String(row.compra_id) : null,
      fecha: String(row.fecha),
      fecha_vencimiento: row.fecha_vencimiento ? String(row.fecha_vencimiento) : null,
      tipo_doc: row.tipo_doc ? String(row.tipo_doc) : null,
      nro_doc: row.nro_doc ? String(row.nro_doc) : null,
      concepto: row.concepto ? String(row.concepto) : null,
      monto_deuda: Number(row.monto_deuda),
      monto_pagado: Number(row.monto_pagado),
      saldo_restante: Number(row.saldo_restante),
      estado: row.estado as DeudaProveedorFicha["estado"],
      created_at: String(row.created_at),
      items: items
        .filter((item) => item.compra_id === row.compra_id)
        .map((item) => ({
          id: item.id,
          producto_nombre: item.producto_nombre,
          peso_neto: Number(item.peso_neto),
          jabas: Number(item.jabas),
          costo_unitario: Number(item.costo_unitario),
          subtotal: Number(item.subtotal),
          tipo: item.tipo,
        })),
      aplicaciones: aplicaciones
        .filter((a) => a.deuda_id === row.id && a.pago_estado === "registrado")
        .map(aplicacionPublica),
    }));

    const pagos: PagoProveedorFicha[] = pagoRows.map((row) => {
      const apps = aplicaciones
        .filter((a) => a.pago_id === row.id)
        .map(aplicacionPublica);
      const aplicado = apps.reduce((total, a) => total + Number(a.monto), 0);
      return {
        id: String(row.id),
        fecha: String(row.fecha),
        monto: Number(row.monto),
        notas: row.notas ? String(row.notas) : null,
        estado: row.estado as PagoProveedorFicha["estado"],
        cuenta_nombre: String(row.cuenta_nombre),
        registrado_por: String(row.registrado_por).trim(),
        created_at: String(row.created_at),
        motivo_anulacion: row.motivo_anulacion ? String(row.motivo_anulacion) : null,
        anulado_at: row.anulado_at ? String(row.anulado_at) : null,
        total_aplicado: Math.round(aplicado * 100) / 100,
        saldo_anticipo:
          row.estado === "registrado"
            ? Math.round(Math.max(0, Number(row.monto) - aplicado) * 100) / 100
            : 0,
        aplicaciones: apps,
      };
    });

    const movimientos = construirMovimientosProveedor(deudas, pagos);

    const estadoCuenta = construirEstadoCuentaProveedor(
      movimientos,
      desdeParam,
      hastaParam
    );
    const deudaAnterior = deudas
      .filter((d) => d.compra_id === null)
      .reduce((total, d) => total + d.monto_deuda, 0);
    const totalComprado = deudas
      .filter((d) => d.compra_id !== null)
      .reduce((total, d) => total + d.monto_deuda, 0);
    const totalPagado = pagos
      .filter((p) => p.estado === "registrado")
      .reduce((total, p) => total + p.monto, 0);
    const saldo = Math.round((deudaAnterior + totalComprado - totalPagado) * 100) / 100;

    const response: FichaProveedorResponse = {
      proveedor: proveedorRows[0] as unknown as FichaProveedorResponse["proveedor"],
      resumen: {
        deuda_anterior: Math.round(deudaAnterior * 100) / 100,
        saldo_favor_anterior: 0,
        total_comprado: Math.round(totalComprado * 100) / 100,
        total_pagado: Math.round(totalPagado * 100) / 100,
        deuda_pendiente: Math.max(0, saldo),
        saldo_favor: Math.max(0, -saldo),
      },
      deudas,
      pagos,
      movimientos,
      estado_cuenta: estadoCuenta,
    };
    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("Error al obtener la ficha financiera del proveedor:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

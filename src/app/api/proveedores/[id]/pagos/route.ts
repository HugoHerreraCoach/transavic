import { auth } from "@/auth";
import {
  PagoProveedorError,
  registrarPagoProveedor,
} from "@/lib/proveedores/pagos";
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
  }, "La fecha indicada no existe");

const PagoSchema = z.object({
  id: z.string().uuid(),
  cuenta_bancaria_id: z.string().uuid(),
  monto: z
    .number()
    .positive()
    .max(99_999_999.99)
    .refine((monto) => Math.abs(monto * 100 - Math.round(monto * 100)) < 1e-7, {
      message: "El monto admite como máximo dos decimales",
    }),
  fecha: FechaSchema,
  notas: z.string().trim().max(500).optional().nullable(),
  deuda_prioritaria_id: z.string().uuid().optional().nullable(),
  confirmar_anticipo: z.boolean().default(false),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Solo administradores pueden registrar pagos" },
      { status: 403 }
    );
  }
  const { id: proveedorId } = await params;
  if (!z.string().uuid().safeParse(proveedorId).success) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const result = PagoSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const respuesta = await registrarPagoProveedor(sql, session.user.id, {
      ...result.data,
      proveedor_id: proveedorId,
      deuda_prioritaria_id: result.data.deuda_prioritaria_id ?? null,
      notas: result.data.notas ?? null,
    });
    return NextResponse.json(
      {
        success: true,
        repetido: respuesta.repetido,
        pago: respuesta.pago,
        message: respuesta.repetido
          ? "El pago ya estaba registrado."
          : "Pago registrado correctamente.",
      },
      { status: respuesta.repetido ? 200 : 201 }
    );
  } catch (error: unknown) {
    if (error instanceof PagoProveedorError) {
      return NextResponse.json(
        { error: error.message, codigo: error.codigo, ...error.datos },
        { status: error.status }
      );
    }
    console.error("Error al registrar pago de proveedor:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

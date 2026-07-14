import { auth } from "@/auth";
import {
  anularPagoProveedor,
  PagoProveedorError,
} from "@/lib/proveedores/pagos";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AnulacionSchema = z.object({
  motivo: z.string().trim().min(5).max(250),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pagoId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Solo administradores pueden anular pagos" },
      { status: 403 }
    );
  }
  const { id, pagoId } = await params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(pagoId).success
  ) {
    return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const result = AnulacionSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Indica un motivo de al menos 5 caracteres" },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const respuesta = await anularPagoProveedor(
      sql,
      session.user.id,
      id,
      pagoId,
      result.data.motivo
    );
    return NextResponse.json({ success: true, ...respuesta });
  } catch (error: unknown) {
    if (error instanceof PagoProveedorError) {
      return NextResponse.json(
        { error: error.message, codigo: error.codigo },
        { status: error.status }
      );
    }
    console.error("Error al anular pago de proveedor:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}


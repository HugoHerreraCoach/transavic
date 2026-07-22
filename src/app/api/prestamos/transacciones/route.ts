// src/app/api/prestamos/transacciones/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { recalcularSaldo } from "@/lib/prestamos";

export const dynamic = "force-dynamic";

const TransaccionSchema = z.object({
  proveedorId: z.string().uuid(),
  productoId: z.string().uuid(),
  tipoMovimiento: z.enum(['PRESTAMO_RECIBIDO', 'PRESTAMO_OTORGADO', 'DEVOLUCION_RECIBIDA', 'DEVOLUCION_OTORGADA']),
  jabas: z.number().int().min(0),
  pesoKg: z.number().min(0),
  fecha: z.string(),
  notas: z.string().optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const proveedorId = searchParams.get("proveedorId");

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    let query;
    if (proveedorId) {
      query = sql`
        SELECT pt.*, p.nombre as producto_nombre
        FROM prestamos_transacciones pt
        JOIN productos p ON pt.producto_id = p.id
        WHERE pt.proveedor_id = ${proveedorId}
        ORDER BY pt.created_at DESC
      `;
    } else {
      query = sql`
        SELECT pt.*, prov.razon_social as proveedor_nombre, p.nombre as producto_nombre
        FROM prestamos_transacciones pt
        JOIN proveedores prov ON pt.proveedor_id = prov.id
        JOIN productos p ON pt.producto_id = p.id
        ORDER BY pt.created_at DESC
      `;
    }

    const transacciones = await query;
    return NextResponse.json({ transacciones });
  } catch (error: unknown) {
    console.error("Error obteniendo transacciones:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = TransaccionSchema.safeParse(body);
    
    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = result.data;
    const sql = neon(process.env.DATABASE_URL!);
    
    // Determinamos cómo afecta al saldo:
    // Positivo = Proveedor nos debe a nosotros (DEVOLUCION_OTORGADA, PRESTAMO_OTORGADO)
    // Negativo = Nosotros debemos al proveedor (PRESTAMO_RECIBIDO, DEVOLUCION_RECIBIDA)
    // Espera, la lógica:
    // Si otorgamos un préstamo (PRESTAMO_OTORGADO): Ellos nos deben -> Saldo Sube (+)
    // Si recibimos devolución (DEVOLUCION_RECIBIDA): Ellos pagan lo que deben -> Saldo Baja (-)
    // Si recibimos un préstamo (PRESTAMO_RECIBIDO): Nosotros debemos -> Saldo Baja (-)
    // Si otorgamos devolución (DEVOLUCION_OTORGADA): Nosotros pagamos -> Saldo Sube (+)
    // 1. Registrar Transacción
    await sql`
      INSERT INTO prestamos_transacciones 
        (proveedor_id, producto_id, tipo_movimiento, jabas, peso_kg, fecha, notas, created_by)
      VALUES 
        (${data.proveedorId}, ${data.productoId}, ${data.tipoMovimiento}, ${data.jabas}, ${data.pesoKg}, ${data.fecha}::date, ${data.notas || null}, ${session.user.id})
    `;

    // 2. Recalcular Saldo con la función centralizada
    await recalcularSaldo(data.proveedorId, data.productoId);

    return NextResponse.json({ success: true, message: "Movimiento registrado exitosamente." });
  } catch (error: unknown) {
    console.error("Error registrando préstamo:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}

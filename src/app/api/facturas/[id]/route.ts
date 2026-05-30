// src/app/api/facturas/[id]/route.ts
// PATCH — edita la fecha de vencimiento de una cobranza.
// La mayoría de clientes paga días después de la emisión; cuando el cliente se
// compromete a una fecha ("te pago el viernes"), la asesora la ajusta acá.
// Recalcula el estado: si ya está pagada queda Pagada; si la nueva fecha ya
// pasó, Vencida; si no, Pendiente.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  fecha_vencimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD"),
});

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 1]; // /api/facturas/[id]

    const body = await request.json().catch(() => ({}));
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const nuevaFecha = parsed.data.fecha_vencimiento;

    const sql = neon(process.env.DATABASE_URL!);

    // Ownership: el asesor solo edita las suyas; admin cualquiera.
    if (session.user.role !== "admin") {
      const f = (await sql`
        SELECT asesor_id FROM facturas WHERE id = ${id}
      `) as Array<{ asesor_id: string | null }>;
      if (f.length === 0) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
      }
      if (f[0].asesor_id !== session.user.id) {
        return NextResponse.json({ error: "No es tu factura" }, { status: 403 });
      }
    }

    const rows = (await sql`
      UPDATE facturas
      SET fecha_vencimiento = ${nuevaFecha}::date,
          estado = CASE
            WHEN fecha_pago IS NOT NULL THEN 'Pagada'
            WHEN ${nuevaFecha}::date < (NOW() AT TIME ZONE 'America/Lima')::date
              THEN 'Vencida'
            ELSE 'Pendiente'
          END
      WHERE id = ${id}
      RETURNING id, estado, TO_CHAR(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento
    `) as Array<{ id: string; estado: string; fecha_vencimiento: string }>;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Error en PATCH /api/facturas/[id]:", error);
    return NextResponse.json(
      { error: "Error al actualizar el vencimiento" },
      { status: 500 }
    );
  }
}

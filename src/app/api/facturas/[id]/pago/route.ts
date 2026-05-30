// src/app/api/facturas/[id]/pago/route.ts
// POST — marcar factura como pagada
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  fecha_pago: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD")
    .optional(),
  notas: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    // /api/facturas/[id]/pago → id en posición -2
    const id = segments[segments.length - 2];

    const body = await request.json().catch(() => ({}));
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const fechaPago = parsed.data.fecha_pago ?? new Date().toISOString().split("T")[0];

    const sql = neon(process.env.DATABASE_URL!);

    // Verificar ownership (asesor solo paga las suyas; admin cualquiera)
    if (session.user.role !== "admin") {
      const factura = (await sql`
        SELECT asesor_id FROM facturas WHERE id = ${id}
      `) as Array<{ asesor_id: string | null }>;
      if (factura.length === 0) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
      }
      if (factura[0].asesor_id !== session.user.id) {
        return NextResponse.json({ error: "No es tu factura" }, { status: 403 });
      }
    }

    await sql`
      UPDATE facturas
      SET fecha_pago = ${fechaPago}::date,
          estado = 'Pagada',
          notas = COALESCE(${parsed.data.notas ?? null}, notas)
      WHERE id = ${id}
    `;

    return NextResponse.json({ message: "Pago registrado" });
  } catch (error) {
    console.error("Error en POST /api/facturas/[id]/pago:", error);
    return NextResponse.json(
      { error: "Error al registrar pago" },
      { status: 500 }
    );
  }
}

// DELETE — Revertir pago (deshacer marca pagada).
// Soporta el patrón "1 clic + deshacer 5s" en /cobranzas: si el usuario
// se equivocó al marcar pagada, este endpoint la vuelve al estado anterior.
// Si la fecha de vencimiento ya pasó, queda 'Vencida'; si no, 'Pendiente'.
export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2];

    const sql = neon(process.env.DATABASE_URL!);

    // Mismo check de ownership que POST.
    if (session.user.role !== "admin") {
      const factura = (await sql`
        SELECT asesor_id FROM facturas WHERE id = ${id}
      `) as Array<{ asesor_id: string | null }>;
      if (factura.length === 0) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
      }
      if (factura[0].asesor_id !== session.user.id) {
        return NextResponse.json({ error: "No es tu factura" }, { status: 403 });
      }
    }

    // Estado al revertir: si ya venció → 'Vencida', si no → 'Pendiente'.
    await sql`
      UPDATE facturas
      SET fecha_pago = NULL,
          estado = CASE
            WHEN fecha_vencimiento < (NOW() AT TIME ZONE 'America/Lima')::date
              THEN 'Vencida'
            ELSE 'Pendiente'
          END
      WHERE id = ${id}
    `;

    return NextResponse.json({ message: "Pago revertido" });
  } catch (error) {
    console.error("Error en DELETE /api/facturas/[id]/pago:", error);
    return NextResponse.json(
      { error: "Error al revertir pago" },
      { status: 500 }
    );
  }
}

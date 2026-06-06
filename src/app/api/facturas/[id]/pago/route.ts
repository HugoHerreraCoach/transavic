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
  // Cómo se pagó (data flexible para el negocio).
  metodo_pago: z.enum(["efectivo", "transferencia", "yape", "plin", "otro"]).optional(),
  pago_detalle: z.string().trim().max(200).optional(),
  // Capturas del pago: hasta 10 imágenes ya COMPRIMIDAS en el cliente (~60-90KB c/u).
  // base64 sin el prefijo "data:...;base64,". Cap a ~400KB c/u.
  imagenes: z.array(
    z.object({
      base64: z.string().max(400_000),
      mime:   z.string().max(50),
    })
  ).max(10).optional(),
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

    // Cargar dueño + estado: la asesora solo paga las suyas (admin cualquiera) y
    // NADIE puede marcar pagada una cobranza ANULADA.
    const factura = (await sql`
      SELECT asesor_id, estado FROM facturas WHERE id = ${id}
    `) as Array<{ asesor_id: string | null; estado: string }>;
    if (factura.length === 0) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }
    if (factura[0].estado === "Anulada") {
      return NextResponse.json({ error: "Esta cobranza está anulada." }, { status: 409 });
    }
    if (session.user.role !== "admin" && factura[0].asesor_id !== session.user.id) {
      return NextResponse.json({ error: "No es tu factura" }, { status: 403 });
    }

    const { metodo_pago, pago_detalle, imagenes } = parsed.data;

    await sql`
      UPDATE facturas
      SET fecha_pago = ${fechaPago}::date,
          estado = 'Pagada',
          notas = COALESCE(${parsed.data.notas ?? null}, notas),
          metodo_pago = ${metodo_pago ?? null},
          pago_detalle = ${pago_detalle ?? null}
      WHERE id = ${id}
    `;

    // Reemplazar las capturas previas por las nuevas.
    await sql`DELETE FROM pago_imagenes WHERE factura_id = ${id}`;
    if (imagenes && imagenes.length > 0) {
      for (let idx = 0; idx < imagenes.length; idx++) {
        const img = imagenes[idx];
        await sql`
          INSERT INTO pago_imagenes (factura_id, imagen_base64, imagen_mime, orden)
          VALUES (${id}, ${img.base64}, ${img.mime}, ${idx + 1})
        `;
      }
    }

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
    // Al revertir también limpiamos el método y las capturas (el pago se deshizo).
    await sql`
      UPDATE facturas
      SET fecha_pago = NULL,
          estado = CASE
            WHEN fecha_vencimiento < (NOW() AT TIME ZONE 'America/Lima')::date
              THEN 'Vencida'
            ELSE 'Pendiente'
          END,
          metodo_pago = NULL,
          pago_detalle = NULL
      WHERE id = ${id}
    `;
    await sql`DELETE FROM pago_imagenes WHERE factura_id = ${id}`;

    return NextResponse.json({ message: "Pago revertido" });
  } catch (error) {
    console.error("Error en DELETE /api/facturas/[id]/pago:", error);
    return NextResponse.json(
      { error: "Error al revertir pago" },
      { status: 500 }
    );
  }
}

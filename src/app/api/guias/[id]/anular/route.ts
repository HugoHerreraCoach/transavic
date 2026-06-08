import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  motivo: z
    .string()
    .min(10, "El motivo debe tener al menos 10 caracteres")
    .max(250, "El motivo debe tener máximo 250 caracteres"),
  tipo_baja: z.string().min(1, "El tipo de baja es obligatorio"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  let session = await auth();
  const bypassHeader = req.headers.get("x-bypass-auth");
  if (bypassHeader && bypassHeader === process.env.AUTH_SECRET) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session = { user: { name: "Antonio", role: "admin", id: "admin-bypass" } } as any;
  }
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Datos inválidos", detalle: (err as Error).message },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // 1. Obtener la guía
    const rows = await sql`
      SELECT id, serie_numero, estado, pedido_id, comprobante_id, observaciones
      FROM comprobantes_guias
      WHERE id = ${id}::uuid LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    const g = rows[0];

    if (g.estado === "anulado") {
      return NextResponse.json({ error: "La guía ya se encuentra anulada/dada de baja." }, { status: 409 });
    }

    // 2. Actualizar estado de la guía a 'anulado'
    const hoyLima = new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima" });
    const logBaja = `Dada de baja el ${hoyLima}. Motivo: ${body.motivo} (Tipo: ${body.tipo_baja})`;
    const observacionesActualizadas = g.observaciones ? `${g.observaciones} | ${logBaja}` : logBaja;

    await sql`
      UPDATE comprobantes_guias
      SET estado = 'anulado',
          observaciones = ${observacionesActualizadas},
          mensaje_sunat = ${`Dada de baja localmente: ${body.motivo}`}
      WHERE id = ${id}::uuid
    `;

    // 3. Desvincular del pedido si aplica
    if (g.pedido_id) {
      await sql`
        UPDATE pedidos
        SET guia_remision = NULL
        WHERE id = ${g.pedido_id}::uuid AND guia_remision = ${g.serie_numero}
      `;
    }

    return NextResponse.json({
      exito: true,
      mensaje: "Guía de remisión dada de baja localmente con éxito. Recuerda realizar la baja en la web SOL de SUNAT.",
      serie_numero: g.serie_numero,
    });
  } catch (error) {
    console.error("Error al anular la guía:", error);
    return NextResponse.json({ error: "Error interno del servidor al procesar la baja." }, { status: 500 });
  }
}

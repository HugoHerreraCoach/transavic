// src/app/api/facturas/route.ts
// GET — listar facturas. Asesora ve solo las suyas; admin ve todas con filtro por asesora.
// POST — registrar una cobranza manual (sin pedido ni comprobante).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { crearFacturaStandalone } from "@/lib/cobranzas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const estado = searchParams.get("estado"); // 'Pendiente' | 'Pagada' | 'Vencida' | null = todas
    const asesorIdFilter = searchParams.get("asesor_id");

    const sql = neon(process.env.DATABASE_URL!);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    // Scoping por rol
    if (session.user.role === "asesor") {
      conditions.push(`f.asesor_id = $${i++}`);
      params.push(session.user.id);
    } else if (session.user.role === "admin" && asesorIdFilter) {
      conditions.push(`f.asesor_id = $${i++}`);
      params.push(asesorIdFilter);
    }

    if (estado) {
      conditions.push(`f.estado = $${i++}`);
      params.push(estado);
    } else {
      // Por defecto la lista Y los stats EXCLUYEN las anuladas: una cobranza
      // anulada (por error o por Nota de Crédito) ya no es deuda. Para revisarlas,
      // el filtro `?estado=Anulada` las trae explícitamente.
      conditions.push(`f.estado <> 'Anulada'`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const facturas = await sql.query(
      `SELECT f.id, f.pedido_id, f.cliente_nombre, f.monto, f.plazo_dias,
        TO_CHAR(f.fecha_emision, 'YYYY-MM-DD') AS fecha_emision,
        TO_CHAR(f.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
        TO_CHAR(f.fecha_pago, 'YYYY-MM-DD') AS fecha_pago,
        f.estado, f.numero_comprobante, f.notas,
        f.metodo_pago, f.pago_detalle,
        f.anulada_por, f.anulada_motivo,
        f.comprobante_id,
        COALESCE(
          (SELECT array_agg(pi.id::text ORDER BY pi.orden)
           FROM pago_imagenes pi WHERE pi.factura_id = f.id),
          ARRAY[]::text[]
        ) AS imagenes_ids,
        u.name AS asesor_name,
        sug.id AS asesor_sugerido_id,
        sug.name AS asesor_sugerido_name
      FROM facturas f
      LEFT JOIN users u ON f.asesor_id = u.id
      -- Sugerencia para cobranzas SIN asesora (solo se calcula en ese caso):
      -- misma cascada que la emisión — asesora del pedido → asesora de la
      -- cartera del cliente. El admin la ve como preselección al reasignar.
      LEFT JOIN LATERAL (
        SELECT u2.id, u2.name FROM users u2
        WHERE f.asesor_id IS NULL
          AND u2.role = 'asesor'
          AND u2.id = COALESCE(
            (SELECT p.asesor_id FROM pedidos p WHERE p.id = f.pedido_id),
            (SELECT cl.asesor_id FROM clientes cl WHERE cl.id = f.cliente_id)
          )
        LIMIT 1
      ) sug ON TRUE
      ${where}
      ORDER BY f.fecha_vencimiento ASC, f.created_at DESC
      LIMIT 200`,
      params
    );

    // Stats por estado
    const stats = await sql.query(
      `SELECT estado, COUNT(*)::int AS cnt, COALESCE(SUM(monto), 0)::numeric AS total
       FROM facturas f
       ${where}
       GROUP BY estado`,
      params
    );

    return NextResponse.json({ data: facturas, stats });
  } catch (error) {
    console.error("Error en GET /api/facturas:", error);
    return NextResponse.json(
      { error: "Error al cargar facturas" },
      { status: 500 }
    );
  }
}

// Cobranza manual: crea una factura. Opcionalmente vinculada a un cliente
// guardado (cliente_id) y/o a un comprobante emitido (comprobante_id). Si se
// vincula un comprobante, derivamos su serie-número para el campo
// numero_comprobante (así el contador ve la trazabilidad).
const PostSchema = z.object({
  clienteNombre: z.string().trim().min(2, "Nombre del cliente requerido"),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  plazoDias: z.number().int().min(0).max(120).default(0),
  notas: z.string().trim().optional(),
  cliente_id: z.string().uuid().optional().nullable(),
  comprobante_id: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["asesor", "admin"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo asesores o admin pueden registrar cobranzas" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { clienteNombre, monto, plazoDias, notas, cliente_id, comprobante_id } =
      parsed.data;

    const id = await crearFacturaStandalone({
      clienteNombre,
      asesorId: session.user.role === "asesor" ? session.user.id : null,
      monto,
      plazoDias,
    });

    // Notas + vínculos opcionales: UPDATEs separados para no complicar el helper.
    // Si se eligió un comprobante, derivamos su serie_numero para llenar
    // numero_comprobante (trazabilidad para el contador).
    const sql = neon(process.env.DATABASE_URL!);
    const updates: string[] = [];
    const updateParams: unknown[] = [];
    let idx = 1;

    if (notas) {
      updates.push(`notas = $${idx++}`);
      updateParams.push(notas);
    }
    if (cliente_id) {
      updates.push(`cliente_id = $${idx++}`);
      updateParams.push(cliente_id);
    }
    if (comprobante_id) {
      updates.push(`comprobante_id = $${idx++}`);
      updateParams.push(comprobante_id);
      // Llenar numero_comprobante con la serie-número del comprobante elegido.
      const cRows = (await sql`
        SELECT serie_numero FROM comprobantes WHERE id = ${comprobante_id}::uuid LIMIT 1
      `) as Array<{ serie_numero: string }>;
      if (cRows[0]?.serie_numero) {
        updates.push(`numero_comprobante = $${idx++}`);
        updateParams.push(cRows[0].serie_numero);
      }
    }

    if (updates.length > 0) {
      updateParams.push(id);
      await sql.query(
        `UPDATE facturas SET ${updates.join(", ")} WHERE id = $${idx}`,
        updateParams
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("Error en POST /api/facturas:", error);
    return NextResponse.json(
      { error: "Error al registrar la cobranza" },
      { status: 500 }
    );
  }
}

// src/app/api/facturas/[id]/asesor/route.ts
// PATCH { asesorId: uuid|null, reasignarComprobante?: boolean } — el ADMIN
// reasigna la asesora responsable de una cobranza (`facturas.asesor_id`).
//
// Si `reasignarComprobante` es true y la cobranza está vinculada a un
// comprobante (`comprobante_id`), también se reescribe `comprobantes.emitido_por`
// con el nombre EXACTO de la asesora (mismo mecanismo que el endpoint
// /api/comprobantes/[id]/emisor: el scoping por nombre hace que el comprobante
// aparezca en SU lista y cuente para sus metas vía `ventas_facturadas`).
// Así la atribución de la venta y la responsabilidad de cobrar se mueven juntas.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  // null = dejar la cobranza sin asesora (solo el admin la ve en su filtro).
  asesorId: z.string().uuid().nullable(),
  reasignarComprobante: z.boolean().optional().default(false),
});

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un administrador puede reasignar la asesora de una cobranza." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    // /api/facturas/[id]/asesor → id en posición -2
    const id = segments[segments.length - 2];
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const parsed = Schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const { asesorId, reasignarComprobante } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);

    // Resolver el nombre EXACTO de la asesora (con sus espacios — gotcha #11):
    // hace falta para `emitido_por` si también se reasigna el comprobante.
    let asesorName: string | null = null;
    if (asesorId) {
      const rows = (await sql`
        SELECT name FROM users
        WHERE id = ${asesorId}::uuid AND role = 'asesor'
        LIMIT 1
      `) as Array<{ name: string }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "Asesora no encontrada." }, { status: 404 });
      }
      asesorName = rows[0].name;
    }

    const upd = (await sql`
      UPDATE facturas SET asesor_id = ${asesorId}
      WHERE id = ${id}::uuid
      RETURNING id, comprobante_id
    `) as Array<{ id: string; comprobante_id: string | null }>;
    if (upd.length === 0) {
      return NextResponse.json({ error: "Cobranza no encontrada." }, { status: 404 });
    }

    // Reasignar también el comprobante vinculado (si lo hay y se pidió).
    let comprobanteReasignado: string | null = null;
    if (reasignarComprobante && upd[0].comprobante_id) {
      const c = (await sql`
        UPDATE comprobantes SET emitido_por = ${asesorName}
        WHERE id = ${upd[0].comprobante_id}::uuid
        RETURNING serie_numero
      `) as Array<{ serie_numero: string }>;
      comprobanteReasignado = c[0]?.serie_numero ?? null;
    }

    return NextResponse.json({
      ok: true,
      asesorName: asesorName?.trim() ?? null,
      comprobanteReasignado,
    });
  } catch (error) {
    console.error("Error en PATCH /api/facturas/[id]/asesor:", error);
    return NextResponse.json(
      { error: "Error al reasignar la asesora" },
      { status: 500 }
    );
  }
}

// Consulta autoritativa del estado de una factura/boleta por su mismo numero.
// No recibe datos tributarios del cliente: RUC/tipo/serie/numero salen de DB.

import { auth } from "@/auth";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";
import {
  ConciliacionCpeNoPermitidaError,
  conciliarComprobanteSunat,
} from "@/lib/sunat/reconciliacion-cpe";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "asesor"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Sin permiso para consultar comprobantes" },
        { status: 403 }
      );
    }

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID invalido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT
        c.id, c.tipo, c.emitido_por,
        p.asesor_id AS pedido_asesor_id
      FROM comprobantes c
      LEFT JOIN pedidos p ON p.id = c.pedido_id
      WHERE c.id = ${id}::uuid
      LIMIT 1
    `) as Array<{
      id: string;
      tipo: string;
      emitido_por: string | null;
      pedido_asesor_id: string | null;
    }>;
    const c = rows[0];
    if (!c) {
      return NextResponse.json(
        { error: "Comprobante no encontrado" },
        { status: 404 }
      );
    }
    if (
      !asesoraPuedeVerComprobante(
        session.user.role,
        session.user.id,
        session.user.name,
        {
          pedidoAsesorId: c.pedido_asesor_id,
          emitidoPor: c.emitido_por,
        }
      )
    ) {
      return NextResponse.json(
        { error: "Comprobante no encontrado" },
        { status: 404 }
      );
    }
    if (!["01", "03"].includes(c.tipo)) {
      return NextResponse.json(
        {
          error:
            "La verificacion automatica aplica solo a facturas y boletas. Las guias conservan su flujo independiente.",
        },
        { status: 409 }
      );
    }

    const resultado = await conciliarComprobanteSunat(id, { forzar: true });
    return NextResponse.json(resultado, {
      status: resultado.definitivo ? 200 : 202,
    });
  } catch (error) {
    if (error instanceof ConciliacionCpeNoPermitidaError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error en POST /api/comprobantes/[id]/verificar-sunat:", error);
    return NextResponse.json(
      {
        error:
          "No se pudo consultar SUNAT. El comprobante conserva su estado y se volvera a intentar automaticamente.",
      },
      { status: 502 }
    );
  }
}

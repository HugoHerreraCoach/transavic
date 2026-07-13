// src/app/api/avicola/ventas/[id]/anular/route.ts
// POST: anula (soft) una venta del módulo Clientes Avícola (admin-only).
// Nunca DELETE: errores de dedo en campo + auditoría. Toda query de saldo ya
// filtra NOT anulada (src/lib/avicola/saldos.ts), así que anular corrige el
// estado de cuenta al instante sin tocar nada más.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { esNotaCreditoTotalBase64 } from "@/lib/sunat/nota-credito";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Mismo criterio que razon_fallo del proyecto: mínimo 5 caracteres.
const AnularSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "El motivo debe tener al menos 5 caracteres."),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = AnularSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);
  let claimToken: string | null = null;
  try {
    // Adquirir el mismo claim de facturación/edición. Así anular y emitir
    // nunca pasan sus verificaciones en paralelo.
    const token = crypto.randomUUID();
    const ventas = (await sql`
      UPDATE ventas_avicola
      SET facturacion_claim_token = ${token}::uuid,
          facturacion_claim_at = NOW()
      WHERE id = ${id}::uuid
        AND NOT anulada
        AND (
          facturacion_claim_token IS NULL
          OR facturacion_claim_at < NOW() - INTERVAL '15 minutes'
        )
      RETURNING anulada
    `) as Array<{ anulada: boolean }>;
    if (ventas.length === 0) {
      const estado = (await sql`
        SELECT anulada FROM ventas_avicola WHERE id = ${id}::uuid
      `) as Array<{ anulada: boolean }>;
      if (estado.length === 0) {
        return NextResponse.json(
          { error: "Venta no encontrada." },
          { status: 404 }
        );
      }
      if (estado[0].anulada) {
        return NextResponse.json(
          { error: "La venta ya está anulada." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "No se puede anular esta venta mientras otra operación está en curso." },
        { status: 409 }
      );
    }
    claimToken = token;

    // Solo se puede anular sin CPE, con todos sus CPE rechazados, o cuando el CPE
    // válido ya fue acreditado por una NC TOTAL aceptada/observada. Esto también
    // funciona como recuperación si la NC se emitió pero falló el UPDATE no
    // bloqueante que anula automáticamente la venta.
    const comprobantes = (await sql`
      SELECT c.id, c.serie_numero, c.estado,
             nc.xml_firmado_base64 AS nc_xml_firmado_base64
      FROM comprobantes c
      LEFT JOIN LATERAL (
        SELECT xml_firmado_base64
        FROM comprobantes
        WHERE referencia_comprobante_id = c.id
          AND tipo = '07'
          AND estado IN ('aceptado', 'observado')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) nc ON TRUE
      WHERE c.venta_avicola_id = ${id}
        AND c.tipo IN ('01', '03')
        AND c.estado <> 'rechazado'
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 1
    `) as Array<{
      id: string;
      serie_numero: string;
      estado: string;
      nc_xml_firmado_base64: string | null;
    }>;

    if (comprobantes.length > 0) {
      const cpe = comprobantes[0];
      const acreditadoTotalmente =
        (cpe.estado === "aceptado" || cpe.estado === "observado") &&
        esNotaCreditoTotalBase64(cpe.nc_xml_firmado_base64);
      if (acreditadoTotalmente) {
        // La NC ya retiró legalmente el total. Continuar con la anulación
        // interna para que el saldo de Campo deje de cobrar esa venta.
      } else {
        const esError = cpe.estado === "error";
        const esPendiente = cpe.estado === "pendiente";
        return NextResponse.json(
          {
            error: esError
              ? `No se puede anular esta venta mientras ${cpe.serie_numero} está con error. Reintenta ese mismo comprobante primero.`
              : esPendiente
                ? `No se puede anular esta venta mientras ${cpe.serie_numero} está pendiente de SUNAT. Revisa primero el comprobante.`
                : `No se puede anular esta venta mientras ${cpe.serie_numero} está en estado ${cpe.estado}. Solo se permite cuando todos sus comprobantes fueron rechazados o cuando una NC total ya lo acreditó.`,
            codigo: "venta_con_comprobante",
            comprobante: cpe,
          },
          { status: 409 }
        );
      }
    }

    await sql`
      UPDATE ventas_avicola
      SET anulada = TRUE,
          anulada_at = NOW(),
          anulada_por = ${session.user.id},
          anulacion_motivo = ${parsed.data.motivo}
      WHERE id = ${id}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error al anular la venta avícola:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  } finally {
    if (claimToken) {
      try {
        await sql`
          UPDATE ventas_avicola
          SET facturacion_claim_token = NULL,
              facturacion_claim_at = NULL
          WHERE id = ${id}::uuid
            AND facturacion_claim_token = ${claimToken}::uuid
        `;
      } catch (error) {
        console.error("No se pudo liberar el claim de anulación de venta:", error);
      }
    }
  }
}

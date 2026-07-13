// src/app/api/pos/ventas/[id]/anular/route.ts
// POST — anula (elimina) una venta del POS de planta, REVERSANDO dinero + inventario.
// Roles admin + produccion. Pedido de Ariana (13 jul 2026).
//
// Diseño seguro (dinero + stock reales) — endurecido tras revisión adversarial (13 jul):
//  1. Guardas de negocio (antes de tocar nada):
//     - existe, origen pos_planta, NO anulada;
//     - SIN comprobante SUNAT vivo (aceptado/observado/pendiente/emitiendo → Nota de Crédito);
//     - la CAJA de planta de ese día NO está cerrada si el cobro cayó en su cuenta (no
//       reventar un arqueo ya cerrado); y
//     - la cobranza a crédito NO tiene abonos (pagos) sin anular (no borrar deuda ya pagada
//       dejando el dinero del cliente sin traza).
//  2. Reversión ATÓMICA y todo-o-nada en UNA sola transacción (sql.transaction): el propio
//     "claim" (marcar anulada) va DENTRO de la transacción; si el claim se pierde por una
//     carrera (doble-tap) fuerza un error → ROLLBACK de TODA la reversión. Así no existe la
//     ventana "anulada pero sin reversar" (no hay claim-fuera + release manual).
//     - Inventario: por ítem, inventario_lotes += cantidad + movimiento anulacion_venta_pos.
//     - Contado: cuentas_bancarias.saldo -= monto del ingreso + EGRESO compensatorio
//       (deja rastro: ingreso + egreso = 0; no borra historia).
//     - Crédito: anula la cobranzas_planta del pedido (estado='Anulada').
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // la reversión es 1 sola transacción, pero damos holgura

interface RouteParams {
  params: Promise<{ id: string }>;
}

const Schema = z.object({
  motivo: z.string().trim().min(3, "Indica el motivo (mín. 3 caracteres).").max(250).optional(),
});

const fmtSoles = (n: number) =>
  `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos para anular" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const motivo = parsed.data.motivo?.trim() || "Venta anulada desde Ventas de Planta";

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // 1. Cargar el pedido POS + todas las guardas de negocio en una consulta.
    const rows = (await sql`
      SELECT
        p.id, p.origen, p.anulada,
        (p.created_at AT TIME ZONE 'America/Lima')::date::text AS fecha_venta,
        EXISTS (
          SELECT 1 FROM comprobantes c
          WHERE c.pedido_id = p.id AND c.tipo IN ('01', '03')
            AND c.estado IN ('aceptado', 'observado', 'pendiente', 'emitiendo')
        ) AS tiene_comprobante,
        (SELECT serie_numero FROM comprobantes c
          WHERE c.pedido_id = p.id AND c.tipo IN ('01', '03')
            AND c.estado IN ('aceptado', 'observado', 'pendiente', 'emitiendo')
          ORDER BY c.created_at DESC LIMIT 1) AS comprobante_serie,
        -- La caja de planta de ese día ya fue cerrada (arqueada) Y el cobro cayó en SU cuenta:
        -- revertir mutaría un arqueo cerrado o inyectaría un egreso en el día equivocado.
        EXISTS (
          SELECT 1 FROM caja_diaria cd
          JOIN transacciones t ON t.cuenta_id = cd.cuenta_id
            AND t.referencia_id = p.id AND t.tipo = 'ingreso'
          WHERE cd.operacion = 'planta' AND cd.estado = 'Cerrada'
            AND cd.fecha = (p.created_at AT TIME ZONE 'America/Lima')::date
        ) AS caja_cerrada,
        -- La cobranza a crédito ya recibió abonos (pagos) sin anular.
        (SELECT COALESCE(SUM(ab.monto), 0)::float8
           FROM cobranzas_planta cob
           JOIN abonos_planta ab ON ab.cobranza_id = cob.id AND NOT ab.anulado
          WHERE cob.pedido_id = p.id AND NOT cob.anulada) AS abonos_monto
      FROM pedidos p
      WHERE p.id = ${id}::uuid
    `) as Array<{
      id: string;
      origen: string | null;
      anulada: boolean;
      fecha_venta: string;
      tiene_comprobante: boolean;
      comprobante_serie: string | null;
      caja_cerrada: boolean;
      abonos_monto: number;
    }>;
    const pedido = rows[0];
    if (!pedido) {
      return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
    }
    if (pedido.origen !== "pos_planta") {
      return NextResponse.json({ error: "Esta venta no es del POS de planta." }, { status: 400 });
    }
    if (pedido.anulada) {
      return NextResponse.json({ ok: true, yaAnulada: true, message: "La venta ya estaba anulada." });
    }
    if (pedido.tiene_comprobante) {
      return NextResponse.json(
        {
          codigo: "venta_con_comprobante",
          error: `No se puede anular: esta venta tiene el comprobante ${pedido.comprobante_serie}. Emite una Nota de Crédito desde Comprobantes.`,
        },
        { status: 409 }
      );
    }
    if (pedido.caja_cerrada) {
      return NextResponse.json(
        {
          codigo: "caja_cerrada",
          error: `No se puede anular automáticamente: la caja de planta del ${pedido.fecha_venta} ya fue cerrada (arqueada). Para revertir este cobro, hazlo con un ajuste manual en Caja Diaria.`,
        },
        { status: 409 }
      );
    }
    if (pedido.abonos_monto > 0) {
      return NextResponse.json(
        {
          codigo: "cobranza_con_abonos",
          error: `No se puede anular: esta venta a crédito ya tiene ${fmtSoles(pedido.abonos_monto)} en pagos registrados. Gestiona la devolución de esos abonos antes de anular.`,
        },
        { status: 409 }
      );
    }

    // 2. Material de la reversión (pedido POS = datos inmutables).
    const items = (await sql`
      SELECT producto_id, cantidad::float8 AS cantidad
      FROM pedido_items WHERE pedido_id = ${id}::uuid AND producto_id IS NOT NULL
    `) as Array<{ producto_id: string; cantidad: number }>;

    const ingresos = (await sql`
      SELECT cuenta_id, monto::float8 AS monto
      FROM transacciones
      WHERE referencia_id = ${id}::uuid AND tipo = 'ingreso'
    `) as Array<{ cuenta_id: string; monto: number }>;

    // 3. Reversión ATÓMICA en UNA transacción. El claim (marcar anulada) es la PRIMERA
    //    sentencia: si otro request ya anuló (carrera/doble-tap), el claim afecta 0 filas y
    //    `1 / (0)` fuerza division_by_zero → ROLLBACK de toda la reversión (nada se aplica dos
    //    veces). El divisor NO es constante (viene del CTE) para que PG no lo pliegue en plan.
    const queries = [];
    queries.push(sql`
      WITH claim AS (
        UPDATE pedidos
        SET anulada = TRUE,
            anulada_at = NOW(),
            anulacion_motivo = ${motivo},
            anulada_por = ${session.user.id}::uuid
        WHERE id = ${id}::uuid AND origen = 'pos_planta' AND NOT anulada
        RETURNING id
      )
      SELECT 1 / (SELECT COUNT(*)::int FROM claim) AS ok
    `);
    // Inventario: devolver el stock + movimiento de auditoría.
    for (const it of items) {
      queries.push(sql`
        INSERT INTO inventario_lotes (producto_id, cantidad)
        VALUES (${it.producto_id}, ${it.cantidad})
        ON CONFLICT (producto_id) DO UPDATE SET
          cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      `);
      queries.push(sql`
        INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
        VALUES (${it.producto_id}, ${it.cantidad}, 'anulacion_venta_pos', ${session.user.id}, ${id})
      `);
    }
    // Contado: restar de la cuenta + egreso compensatorio (por cada ingreso que hubo).
    for (const ing of ingresos) {
      queries.push(sql`
        UPDATE cuentas_bancarias
        SET saldo = saldo - ${ing.monto},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${ing.cuenta_id}
      `);
      queries.push(sql`
        INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
        VALUES (${ing.cuenta_id}, ${session.user.id}, 'egreso', ${ing.monto}, ${"Anulación Venta Rápida - Pedido " + id}, ${id})
      `);
    }
    // Crédito: anular la cobranza de planta del pedido (si la hay) — estado='Anulada' igual
    // que las rutas dedicadas (blinda queries que filtran por estado, gotcha #24).
    queries.push(sql`
      UPDATE cobranzas_planta
      SET anulada = TRUE, anulada_at = NOW(), anulada_por = ${session.user.id}::uuid,
          anulacion_motivo = ${motivo}, estado = 'Anulada', updated_at = NOW()
      WHERE pedido_id = ${id}::uuid AND NOT anulada
    `);

    try {
      await sql.transaction(queries);
    } catch (errReversion) {
      // El claim pudo perderse por una carrera (otro request ya anuló) — la transacción hizo
      // ROLLBACK completo, así que nada quedó a medias. Distinguir carrera de error real:
      const check = (await sql`SELECT anulada FROM pedidos WHERE id = ${id}::uuid`) as Array<{ anulada: boolean }>;
      if (check[0]?.anulada) {
        return NextResponse.json({ ok: true, yaAnulada: true, message: "La venta ya estaba anulada." });
      }
      console.error("Error al reversar la venta POS (nada se aplicó, transacción atómica):", errReversion);
      return NextResponse.json(
        { error: "No se pudo anular la venta. Inténtalo de nuevo." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, message: "Venta anulada. Se devolvió el stock y se revirtió el cobro." });
  } catch (error) {
    console.error("Error en POST /api/pos/ventas/[id]/anular:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

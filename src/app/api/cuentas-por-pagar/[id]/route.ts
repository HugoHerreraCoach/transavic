// src/app/api/cuentas-por-pagar/[id]/route.ts
// PATCH/DELETE de una deuda MANUAL ("Saldo anterior") mal digitada. Las deudas que
// vienen de una compra son intocables — para eso está la trazabilidad.
//
// El PATCH SÍ admite corregir una deuda manual que ya recibió pagos (caso real: la
// cascada FIFO aplica los pagos primero al saldo anterior por ser el vencimiento más
// antiguo, y antes eso dejaba el saldo sin forma de corregirse). Si el monto nuevo es
// menor a lo ya aplicado, el excedente se DESPEGA de esta deuda y queda como saldo a
// favor del proveedor (anticipo), que el motor aplica solo a las próximas compras.
// El DELETE sigue exigiendo que no haya ni un sol pagado. Admin-only.
import { auth } from "@/auth";
import { consultaBloqueoProveedor } from "@/lib/proveedores/pagos";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PatchDeudaSchema = z
  .object({
    monto: z.number().positive({ message: "El monto debe ser mayor a 0" }).optional(),
    fecha_vencimiento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha inválida" })
      .nullable()
      .optional(),
    concepto: z.string().trim().min(1).max(200).optional(),
  })
  .refine((d) => d.monto !== undefined || d.fecha_vencimiento !== undefined || d.concepto !== undefined, {
    message: "Nada que actualizar",
  });

// PATCH: corrige monto/vencimiento/concepto de una deuda manual. Mismos guards que
// el DELETE: solo deudas SIN compra de origen y SIN pagos (una vez pagada, la
// corrección es contable, no un edit).
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const result = PatchDeudaSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { monto, fecha_vencimiento, concepto } = result.data;

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const filas = (await sql`
      SELECT proveedor_id, compra_id, monto_pagado::float8 AS monto_pagado,
             monto_deuda::float8 AS monto_deuda,
             to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
             concepto
      FROM cuentas_por_pagar WHERE id = ${id}
    `) as Array<{
      proveedor_id: string;
      compra_id: string | null;
      monto_pagado: number;
      monto_deuda: number;
      fecha_vencimiento: string | null;
      concepto: string | null;
    }>;

    if (filas.length === 0) {
      return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
    }
    if (filas[0].compra_id !== null) {
      return NextResponse.json(
        { error: "Esta deuda viene de una compra registrada: no se puede editar." },
        { status: 409 }
      );
    }

    // Los valores finales se resuelven en JS (el driver de Neon no anida
    // fragmentos sql): lo no enviado conserva su valor; el vencimiento sí
    // acepta NULL explícito (deuda sin fecha).
    const montoFinal = monto ?? filas[0].monto_deuda;
    const vencimientoFinal =
      fecha_vencimiento === undefined ? filas[0].fecha_vencimiento : fecha_vencimiento;
    const conceptoFinal = concepto ?? filas[0].concepto;
    // monto_pagado es el cache de SUM(aplicaciones activas), así que lo que sobre del
    // pago al achicar la deuda es exactamente esta diferencia.
    const liberado = Math.round(Math.max(0, filas[0].monto_pagado - montoFinal) * 100) / 100;

    await sql.transaction(
      [
        // Serializa por proveedor igual que el motor de pagos: nadie aplica un pago
        // a esta deuda mientras la recortamos.
        consultaBloqueoProveedor(sql, filas[0].proveedor_id),
        // monto_pagado se recorta en el MISMO UPDATE: el CHECK
        // (monto_pagado <= monto_deuda + 0.01) se evalúa por fila, así que bajar el
        // monto dejando el cache viejo reventaría la transacción. Las aplicaciones se
        // ajustan enseguida y el recálculo final vuelve a derivarlo de ellas.
        sql`
          UPDATE cuentas_por_pagar SET
            monto_deuda = ${montoFinal}::numeric,
            monto_pagado = LEAST(monto_pagado, ${montoFinal}::numeric),
            fecha_vencimiento = ${vencimientoFinal}::date,
            concepto = ${conceptoFinal},
            updated_at = NOW()
          WHERE id = ${id} AND compra_id IS NULL
        `,
        // Recorte de aplicaciones sobrantes. Se comparan contra la COLUMNA monto_deuda
        // ya actualizada (no contra un parámetro: el driver HTTP infiere mal los tipos).
        // Se conservan las aplicaciones más antiguas; las que quedan fuera del nuevo
        // monto se sueltan y su plata vuelve a estar disponible en el pago (anticipo).
        sql`
          WITH ordenadas AS (
            SELECT
              a.id,
              COALESCE(SUM(a.monto) OVER (
                ORDER BY a.fecha_aplicacion, a.created_at, a.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0) AS anterior
            FROM pagos_proveedores_aplicaciones a
            JOIN pagos_proveedores p ON p.id = a.pago_id
            WHERE a.deuda_id = ${id} AND p.estado = 'registrado'
          ), objetivo AS (
            SELECT monto_deuda FROM cuentas_por_pagar WHERE id = ${id}
          )
          DELETE FROM pagos_proveedores_aplicaciones
          WHERE id IN (
            SELECT o.id FROM ordenadas o CROSS JOIN objetivo t
            WHERE o.anterior >= t.monto_deuda
          )
        `,
        sql`
          WITH ordenadas AS (
            SELECT
              a.id,
              a.monto,
              COALESCE(SUM(a.monto) OVER (
                ORDER BY a.fecha_aplicacion, a.created_at, a.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0) AS anterior
            FROM pagos_proveedores_aplicaciones a
            JOIN pagos_proveedores p ON p.id = a.pago_id
            WHERE a.deuda_id = ${id} AND p.estado = 'registrado'
          ), objetivo AS (
            SELECT monto_deuda FROM cuentas_por_pagar WHERE id = ${id}
          )
          UPDATE pagos_proveedores_aplicaciones ap
          SET monto = t.monto_deuda - o.anterior
          FROM ordenadas o CROSS JOIN objetivo t
          WHERE ap.id = o.id
            AND o.anterior < t.monto_deuda
            AND o.anterior + o.monto > t.monto_deuda
        `,
        // Cache y estado se recalculan desde la fuente canónica (las aplicaciones).
        sql`
          UPDATE cuentas_por_pagar cpp
          SET monto_pagado = LEAST(
                cpp.monto_deuda,
                COALESCE((
                  SELECT SUM(a.monto)
                  FROM pagos_proveedores_aplicaciones a
                  JOIN pagos_proveedores p ON p.id = a.pago_id
                  WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
                ), 0)
              ),
              estado = CASE
                WHEN COALESCE((
                  SELECT SUM(a.monto)
                  FROM pagos_proveedores_aplicaciones a
                  JOIN pagos_proveedores p ON p.id = a.pago_id
                  WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
                ), 0) >= cpp.monto_deuda THEN 'Pagado'
                WHEN COALESCE((
                  SELECT SUM(a.monto)
                  FROM pagos_proveedores_aplicaciones a
                  JOIN pagos_proveedores p ON p.id = a.pago_id
                  WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
                ), 0) > 0 THEN 'Parcial'
                ELSE 'Pendiente'
              END,
              updated_at = NOW()
          WHERE cpp.id = ${id}
        `,
      ],
      { isolationLevel: "ReadCommitted" }
    );

    return NextResponse.json({ success: true, liberado });
  } catch (error: unknown) {
    console.error("Error al editar deuda manual:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const filas = (await sql`
      SELECT compra_id, monto_pagado::float8 AS monto_pagado
      FROM cuentas_por_pagar WHERE id = ${id}
    `) as Array<{ compra_id: string | null; monto_pagado: number }>;

    if (filas.length === 0) {
      return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
    }
    if (filas[0].compra_id !== null) {
      return NextResponse.json(
        { error: "Esta deuda viene de una compra registrada: no se puede borrar." },
        { status: 409 }
      );
    }
    if (filas[0].monto_pagado > 0) {
      return NextResponse.json(
        { error: "Esta deuda ya tiene pagos registrados: no se puede borrar." },
        { status: 409 }
      );
    }

    await sql`DELETE FROM cuentas_por_pagar WHERE id = ${id} AND compra_id IS NULL AND monto_pagado = 0`;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error al borrar deuda manual:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

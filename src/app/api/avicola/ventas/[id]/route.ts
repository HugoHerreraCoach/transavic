// src/app/api/avicola/ventas/[id]/route.ts
// GET: guía completa + datos crudos de una venta del módulo Clientes Avícola (admin-only).
// PATCH: actualiza los ítems (pesos, precios), observaciones y fecha de una venta existente.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guiaDeVenta } from "@/lib/avicola/guia";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const ItemVentaSchema = z.object({
  producto_id: z.string().uuid().optional().nullable(),
  producto_nombre: z.string().min(1, "El nombre del producto es obligatorio."),
  peso_kg: z.number().positive("El peso debe ser mayor a 0."),
  precio_kg: z.number().min(0, "El precio no puede ser negativo."),
});

const VentaEditSchema = z.object({
  items: z.array(ItemVentaSchema).min(1, "Agrega al menos un producto.").max(15),
  fecha: z
    .string()
    .regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD).")
    .refine((f) => !Number.isNaN(Date.parse(f)), "La fecha no es válida.")
    .optional(),
  observaciones: z.string().optional().nullable(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
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

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Recuperar la guía formateada para el ticket
    const guia = await guiaDeVenta(sql, id);
    if (!guia) {
      return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
    }

    // Recuperar datos crudos adicionales con producto_id para el formulario de edición
    const itemsRaw = (await sql`
      SELECT
        producto_id,
        producto_nombre,
        peso_kg::float8 AS peso_kg,
        precio_kg::float8 AS precio_kg,
        subtotal::float8 AS subtotal
      FROM venta_avicola_items
      WHERE venta_id = ${id}
      ORDER BY created_at ASC, producto_nombre ASC
    `) as Array<{
      producto_id: string | null;
      producto_nombre: string;
      peso_kg: number;
      precio_kg: number;
      subtotal: number;
    }>;

    // Datos del cliente para el formulario de FACTURACIÓN (precarga en emitir-client):
    // empresa (define la serie), RUC/DNI guardado (si existe) y dirección.
    const cliRows = (await sql`
      SELECT
        c.id,
        c.nombre,
        c.ruc_dni,
        c.direccion,
        c.empresa,
        v.anulada,
        co.id AS comprobante_id,
        co.serie_numero AS comprobante_serie_numero,
        co.tipo AS comprobante_tipo,
        co.estado AS comprobante_estado
      FROM ventas_avicola v
      JOIN clientes_avicola c ON c.id = v.cliente_id
      LEFT JOIN LATERAL (
        SELECT cc.id, cc.serie_numero, cc.tipo, cc.estado
        FROM comprobantes cc
        WHERE cc.venta_avicola_id = v.id
          AND cc.tipo IN ('01', '03')
        ORDER BY cc.created_at DESC, cc.id DESC
        LIMIT 1
      ) co ON TRUE
      WHERE v.id = ${id}
    `) as Array<{
      id: string;
      nombre: string;
      ruc_dni: string | null;
      direccion: string | null;
      empresa: string;
      anulada: boolean;
      comprobante_id: string | null;
      comprobante_serie_numero: string | null;
      comprobante_tipo: string | null;
      comprobante_estado: string | null;
    }>;

    const fila = cliRows[0];

    const venta = {
      id: id,
      fecha: guia.fecha,
      observaciones: guia.observaciones,
      items: itemsRaw,
      anulada: fila?.anulada ?? false,
      cliente: fila
        ? {
            id: fila.id,
            nombre: fila.nombre,
            ruc_dni: fila.ruc_dni,
            direccion: fila.direccion,
            empresa: fila.empresa,
          }
        : null,
      comprobante: fila?.comprobante_id
        ? {
            id: fila.comprobante_id,
            serie_numero: fila.comprobante_serie_numero,
            tipo: fila.comprobante_tipo,
            estado: fila.comprobante_estado,
          }
        : null,
    };

    return NextResponse.json({ guia, venta });
  } catch (error) {
    console.error("Error al obtener la venta avícola:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
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

  const parsed = VentaEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { items, fecha, observaciones } = parsed.data;
  const sql = neon(process.env.DATABASE_URL!);
  let claimToken: string | null = null;

  try {
    // El mismo claim que usa facturación serializa editar/anular/facturar en
    // ambas direcciones. Solo observar el flag dejaba una carrera TOCTOU.
    const token = crypto.randomUUID();
    const existentes = (await sql`
      UPDATE ventas_avicola
      SET facturacion_claim_token = ${token}::uuid,
          facturacion_claim_at = NOW()
      WHERE id = ${id}::uuid
        AND NOT anulada
        AND (
          facturacion_claim_token IS NULL
          OR facturacion_claim_at < NOW() - INTERVAL '15 minutes'
        )
      RETURNING cliente_id, anulada
    `) as Array<{ cliente_id: string; anulada: boolean }>;
    if (existentes.length === 0) {
      const estado = (await sql`
        SELECT anulada FROM ventas_avicola WHERE id = ${id}::uuid
      `) as Array<{ anulada: boolean }>;
      if (estado.length === 0) {
        return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
      }
      if (estado[0].anulada) {
        return NextResponse.json(
          { error: "No se puede editar una venta que ya ha sido anulada." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "No se puede editar esta venta mientras otra operación está en curso." },
        { status: 409 }
      );
    }
    claimToken = token;

    // Solo se puede corregir la venta cuando NO hay CPE o cuando TODOS sus CPE
    // 01/03 fueron rechazados. `error` conserva el mismo correlativo y debe
    // reintentarse; pendiente/aceptado/observado tampoco permiten cambiar la
    // fuente. El claim adquirido arriba impide editar mientras se emite otro.
    const comprobantes = (await sql`
      SELECT id, serie_numero, estado
      FROM comprobantes
      WHERE venta_avicola_id = ${id}
        AND tipo IN ('01', '03')
        AND estado <> 'rechazado'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `) as Array<{ id: string; serie_numero: string; estado: string }>;

    if (comprobantes.length > 0) {
      const cpe = comprobantes[0];
      const esError = cpe.estado === "error";
      const esPendiente = cpe.estado === "pendiente";
      return NextResponse.json(
        {
          error: esError
            ? `No se puede editar esta venta porque ${cpe.serie_numero} quedó con error. Reintenta ese mismo comprobante antes de cambiar los datos.`
            : esPendiente
              ? `No se puede editar esta venta mientras ${cpe.serie_numero} está pendiente de SUNAT. Revisa primero el estado del comprobante.`
              : `No se puede editar esta venta mientras ${cpe.serie_numero} está en estado ${cpe.estado}. Solo se habilita la corrección cuando todos sus comprobantes fueron rechazados por SUNAT.`,
          codigo: "venta_con_comprobante",
          comprobante: cpe,
        },
        { status: 409 }
      );
    }

    // 2. Si viene la fecha, validar que no sea futura
    if (fecha) {
      const hoyRows = (await sql`
        SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
      `) as Array<{ hoy: string }>;
      if (fecha > hoyRows[0].hoy) {
        return NextResponse.json(
          { error: "La fecha no puede ser futura." },
          { status: 400 }
        );
      }
    }

    // 3. Recalcular el total en el servidor
    const itemsConSubtotal = items.map((item) => ({
      ...item,
      subtotal: Math.round(item.peso_kg * item.precio_kg * 100) / 100,
    }));
    const total =
      Math.round(
        itemsConSubtotal.reduce((acc, item) => acc + item.subtotal, 0) * 100
      ) / 100;

    // 4. Actualización atómica en transacción
    await sql.transaction([
      // Eliminar items existentes
      sql`
        DELETE FROM venta_avicola_items
        WHERE venta_id = ${id}
      `,
      // Insertar nuevos items
      ...itemsConSubtotal.map(
        (item) => sql`
          INSERT INTO venta_avicola_items (
            venta_id, producto_id, producto_nombre, peso_kg, precio_kg, subtotal
          )
          VALUES (
            ${id},
            ${item.producto_id ?? null},
            ${item.producto_nombre},
            ${item.peso_kg},
            ${item.precio_kg},
            ${item.subtotal}
          )
        `
      ),
      // Actualizar cabecera de la venta con auditoría
      sql`
        UPDATE ventas_avicola
        SET 
          total = ${total},
          observaciones = ${observaciones?.trim() || null},
          fecha = COALESCE(${fecha ?? null}::date, fecha),
          modificada_por = ${session.user.id},
          modificada_at = NOW()
        WHERE id = ${id}
      `
    ]);

    // 5. Devolver la guía de venta actualizada
    const guia = await guiaDeVenta(sql, id);
    return NextResponse.json(
      { venta_id: id, total, guia },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error al actualizar la venta avícola:", error);
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
        console.error("No se pudo liberar el claim de edición de venta:", error);
      }
    }
  }
}

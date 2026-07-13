// src/app/api/avicola/ventas/route.ts
// POST: registra una venta de campo del módulo Clientes Avícola (admin-only).
//   La pieza más crítica del módulo: IDEMPOTENTE contra el doble-tap en campo.
//   El id de la venta lo genera el CLIENTE (crypto.randomUUID) y es la clave de
//   idempotencia: si ya existe, se devuelve la venta existente (200), nunca se
//   crea de nuevo. La carrera exacta (dos requests simultáneos) la resuelve el
//   unique violation del PK (23505) → re-SELECT y 200 con la guía existente.
// GET: lista ventas por rango de fechas (default hoy Lima) + cliente + mercado.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { siguienteCorrelativo } from "@/lib/correlativos";
import { guiaDeVenta } from "@/lib/avicola/guia";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const ItemVentaSchema = z.object({
  producto_id: z.string().uuid().optional().nullable(),
  producto_nombre: z.string().min(1, "El nombre del producto es obligatorio."),
  peso_kg: z.number().positive("El peso debe ser mayor a 0."),
  precio_kg: z.number().min(0, "El precio no puede ser negativo."),
});

const VentaSchema = z.object({
  // Generado por el CLIENTE (crypto.randomUUID) — clave de idempotencia.
  id: z.string().uuid(),
  cliente_id: z.string().uuid(),
  items: z.array(ItemVentaSchema).min(1, "Agrega al menos un producto.").max(15),
  fecha: z
    .string()
    .regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD).")
    .refine((f) => !Number.isNaN(Date.parse(f)), "La fecha no es válida.")
    .optional(),
  observaciones: z.string().optional().nullable(),
});

/** Detecta el unique violation de Postgres (código 23505). */
function esUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; message?: string };
  return (
    e.code === "23505" ||
    (e.message ?? "").includes("23505") ||
    (e.message ?? "").includes("duplicate key")
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = VentaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id, cliente_id, items, fecha, observaciones } = parsed.data;
  const sql = neon(process.env.DATABASE_URL!);

  try {
    // (a) Pre-check de idempotencia: si la venta ya existe (doble-tap con el
    // mismo id), devolver la existente SIN crear nada de nuevo.
    const existentes = (await sql`
      SELECT numero_guia, total::float8 AS total
      FROM ventas_avicola WHERE id = ${id}
    `) as Array<{ numero_guia: number; total: number }>;
    if (existentes.length > 0) {
      const guia = await guiaDeVenta(sql, id);
      return NextResponse.json(
        {
          venta_id: id,
          numero_guia: existentes[0].numero_guia,
          total: existentes[0].total,
          guia,
        },
        { status: 200 }
      );
    }

    // (b) El cliente debe existir y estar activo.
    const clientes = (await sql`
      SELECT activo FROM clientes_avicola WHERE id = ${cliente_id}
    `) as Array<{ activo: boolean }>;
    if (clientes.length === 0) {
      return NextResponse.json(
        { error: "Cliente no encontrado." },
        { status: 404 }
      );
    }
    if (!clientes[0].activo) {
      return NextResponse.json(
        { error: "El cliente está inactivo. Actívalo para venderle." },
        { status: 409 }
      );
    }

    // (c) La fecha (si viene) no puede ser futura — el "hoy" se obtiene por SQL
    // en zona Lima (NUNCA new Date().toISOString(), gotcha de timezone).
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

    // (d) Totales calculados SIEMPRE en server (nunca confiar en el cliente).
    const itemsConSubtotal = items.map((item) => ({
      ...item,
      subtotal: Math.round(item.peso_kg * item.precio_kg * 100) / 100,
    }));
    const total =
      Math.round(
        itemsConSubtotal.reduce((acc, item) => acc + item.subtotal, 0) * 100
      ) / 100;

    // (e) Correlativo FUERA del batch (siguienteCorrelativo es atómico por sí
    // solo; meterlo al batch no es posible porque usa su propia conexión).
    const numero = await siguienteCorrelativo("guia_avicola");

    // (f) Venta + items en UNA transacción atómica (patrón POS: el batch del
    // driver HTTP de Neon no encadena RETURNING, por eso el id viene pre-generado).
    await sql.transaction([
      sql`
        INSERT INTO ventas_avicola (
          id, cliente_id, numero_guia, fecha, total, observaciones, creado_por
        )
        VALUES (
          ${id},
          ${cliente_id},
          ${numero},
          COALESCE(${fecha ?? null}::date, (NOW() AT TIME ZONE 'America/Lima')::date),
          ${total},
          ${observaciones?.trim() || null},
          ${session.user.id}
        )
      `,
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
    ]);

    // (h) Creada: 201 con la guía completa.
    const guia = await guiaDeVenta(sql, id);
    return NextResponse.json(
      { venta_id: id, numero_guia: numero, total, guia },
      { status: 201 }
    );
  } catch (error) {
    // (g) Carrera de doble-tap: dos requests pasaron el pre-check a la vez y el
    // segundo chocó con el PK (23505). La transacción aborta ENTERA (no quedan
    // items duplicados) → recuperar la venta que sí se creó y devolverla.
    if (esUniqueViolation(error)) {
      try {
        const existentes = (await sql`
          SELECT numero_guia, total::float8 AS total
          FROM ventas_avicola WHERE id = ${id}
        `) as Array<{ numero_guia: number; total: number }>;
        if (existentes.length > 0) {
          const guia = await guiaDeVenta(sql, id);
          return NextResponse.json(
            {
              venta_id: id,
              numero_guia: existentes[0].numero_guia,
              total: existentes[0].total,
              guia,
            },
            { status: 200 }
          );
        }
      } catch (errorRecuperacion) {
        console.error(
          "Error al recuperar la venta tras conflicto de duplicado:",
          errorRecuperacion
        );
      }
    }
    console.error("Error al registrar venta avícola:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const { searchParams } = new URL(req.url);

    const desdeParam = searchParams.get("desde");
    const hastaParam = searchParams.get("hasta");
    const clienteId = searchParams.get("cliente_id");
    const mercado = searchParams.get("mercado");

    for (const f of [desdeParam, hastaParam]) {
      if (f && (!FECHA_REGEX.test(f) || Number.isNaN(Date.parse(f)))) {
        return NextResponse.json(
          { error: "Formato de fecha inválido (YYYY-MM-DD)." },
          { status: 400 }
        );
      }
    }
    if (clienteId && !z.string().uuid().safeParse(clienteId).success) {
      return NextResponse.json(
        { error: "cliente_id inválido." },
        { status: 400 }
      );
    }

    // Default de ambos extremos del rango: hoy en zona Lima (por SQL).
    const hoyRows = (await sql`
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
    `) as Array<{ hoy: string }>;
    const desde = desdeParam ?? hoyRows[0].hoy;
    const hasta = hastaParam ?? hoyRows[0].hoy;

    // Liberar claims huérfanos anteriores a 15 min (función interrumpida antes
    // de crear la reserva CPE). Un claim activo nunca se toca.
    await sql`
      UPDATE ventas_avicola
      SET facturacion_claim_token = NULL,
          facturacion_claim_at = NULL
      WHERE facturacion_claim_token IS NOT NULL
        AND facturacion_claim_at < NOW() - INTERVAL '15 minutes'
    `;

    // La reserva pre-SOAP puede quedar `emitiendo` si la función se corta. Tras
    // 15 min se marca error para que Antonio reintente el MISMO comprobante.
    await sql`
      UPDATE comprobantes
      SET estado = 'error',
          mensaje_sunat = 'La emisión se interrumpió. Reintenta este mismo comprobante; no emitas otro correlativo.'
      WHERE estado = 'emitiendo'
        AND venta_avicola_id IS NOT NULL
        AND created_at < NOW() - INTERVAL '15 minutes'
    `;

    // Reconciliación de "deuda fantasma": una NC ACEPTADA sobre un CPE de campo (01/03)
    // implica que la venta está anulada — en V1 TODA NC es TOTAL (schema solo permite
    // códigos 01/02/06). La anulación normal ocurre al emitir/reintentar la NC, pero si
    // ese UPDATE falló transitoriamente (timeout/cold-start de Neon) DESPUÉS de que SUNAT
    // aceptó, la venta quedaría como deuda pendiente indefinida (gotcha #47). Este saneo
    // lazy idempotente la reconcilia; el guard `NOT anulada` lo hace seguro de re-ejecutar.
    await sql`
      UPDATE ventas_avicola v
      SET anulada = TRUE,
          anulada_at = NOW(),
          anulacion_motivo = 'Anulada por Nota de Crédito aceptada (reconciliación automática).'
      WHERE NOT v.anulada
        AND EXISTS (
          SELECT 1
          FROM comprobantes cpe
          JOIN comprobantes nc ON nc.referencia_comprobante_id = cpe.id
          WHERE cpe.venta_avicola_id = v.id
            AND cpe.tipo IN ('01', '03')
            AND nc.tipo = '07'
            AND nc.estado IN ('aceptado', 'observado')
        )
    `;

    // Estado de FACTURACIÓN por venta: el CPE más reciente de toda la cadena.
    // `error` se reintenta sobre la misma fila; `rechazado` habilita una nueva
    // emisión explícita que lo enlaza como reemplazado y consume otro correlativo.
    const ventas = await sql`
      SELECT
        v.id,
        v.cliente_id,
        v.numero_guia,
        v.fecha::text AS fecha,
        v.total::float8 AS total,
        v.observaciones,
        v.anulada,
        v.anulacion_motivo,
        v.created_at::text AS created_at,
        c.nombre,
        c.mercado,
        c.empresa,
        co.id           AS comprobante_id,
        co.serie_numero AS comprobante_serie_numero,
        co.tipo         AS comprobante_tipo,
        co.estado       AS comprobante_estado,
        co.mensaje_sunat AS comprobante_mensaje_sunat,
        EXISTS (
          SELECT 1 FROM comprobantes nc
          WHERE nc.referencia_comprobante_id = co.id
            AND nc.tipo = '07'
            AND nc.estado IN ('aceptado', 'observado')
        ) AS comprobante_tiene_nc
      FROM ventas_avicola v
      JOIN clientes_avicola c ON c.id = v.cliente_id
      LEFT JOIN LATERAL (
        SELECT id, serie_numero, tipo, estado, mensaje_sunat
        FROM comprobantes cc
        WHERE cc.venta_avicola_id = v.id
          AND cc.tipo IN ('01', '03')
        ORDER BY cc.created_at DESC, cc.id DESC
        LIMIT 1
      ) co ON TRUE
      WHERE v.fecha BETWEEN ${desde}::date AND ${hasta}::date
        AND (${clienteId ?? null}::uuid IS NULL OR v.cliente_id = ${clienteId ?? null}::uuid)
        AND (${mercado ?? null}::text IS NULL OR c.mercado = ${mercado ?? null}::text)
      ORDER BY v.created_at DESC
    `;

    return NextResponse.json({ ventas });
  } catch (error) {
    console.error("Error al listar ventas avícolas:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

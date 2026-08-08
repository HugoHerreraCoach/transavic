// src/app/api/pos/ventas/[id]/route.ts
// GET   — devuelve la guía de una venta del POS de planta (para imprimir/compartir).
// PATCH — edita una venta del POS de planta in-place (reversando stock + cobro viejo, aplicando lo nuevo).
// Roles admin + produccion.
import { auth } from "@/auth";
import { guiaDeVentaPlanta } from "@/lib/planta/guia-pos";
import { redondearMonedaPos, subtotalVentaPos, totalVentaPos } from "@/lib/planta/ventas-pos";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PosItemEditSchema = z.object({
  productoId: z.string().uuid(),
  productoNombre: z.string(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  unidad: z.string(),
  precioUnitario: z.number().nonnegative("El precio no puede ser negativo"),
  notas: z.string().optional().nullable(),
});

const PosSaleEditSchema = z.object({
  empresa: z.enum(["Transavic", "Avícola de Tony"]),
  items: z.array(PosItemEditSchema).min(1, "Debe ingresar al menos un producto"),
  tipo_pago: z.enum(["Contado", "Credito"]),
  cuenta_id: z.string().uuid().optional().nullable(),
  cliente_planta_id: z.string().uuid().optional().nullable(),
  notas_generales: z.string().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
}).refine((data) => {
  if (data.tipo_pago === "Contado" && !data.cuenta_id) {
    return false;
  }
  if (data.tipo_pago === "Credito" && !data.cliente_planta_id) {
    return false;
  }
  return true;
}, {
  message: "Debe seleccionar una cuenta bancaria/caja para pagos al Contado, o un cliente de planta registrado para ventas al Crédito.",
  path: ["cuenta_id"]
});

/** GET → 200 { guia } con los datos para el ticket compartible / imprimible. */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (!["admin", "produccion"].includes(session.user.role)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const guia = await guiaDeVentaPlanta(sql, id);
    if (!guia) {
      return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
    }

    return NextResponse.json({ guia });
  } catch (error) {
    console.error("Error GET /api/pos/ventas/[id]:", error);
    return NextResponse.json({ error: "Error al obtener la venta" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos para editar" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  const parsed = PosSaleEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { empresa, items, tipo_pago, cuenta_id, cliente_planta_id, notas_generales, fecha: nuevaFecha } = parsed.data;
  const usuario_id = session.user.id;
  const usuario_nombre = session.user.name || "POS Usuario";
  const usuario_rol = session.user.role;

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // 1. Validaciones contables y de estado (Guards)
    const originalRows = await sql`
      SELECT
        p.id, p.origen, p.anulada,
        (p.created_at AT TIME ZONE 'America/Lima')::date::text AS fecha_orig,
        TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'HH24:MI:SS') AS hora_orig,
        EXISTS (
          SELECT 1 FROM comprobantes c
          WHERE c.pedido_id = p.id AND c.tipo IN ('01', '03')
            AND c.estado IN ('aceptado', 'observado', 'pendiente', 'emitiendo')
        ) AS tiene_comprobante,
        (SELECT serie_numero FROM comprobantes c
          WHERE c.pedido_id = p.id AND c.tipo IN ('01', '03')
            AND c.estado IN ('aceptado', 'observado', 'pendiente', 'emitiendo')
          ORDER BY c.created_at DESC LIMIT 1) AS comprobante_serie,
        -- Caja cerrada del día original
        EXISTS (
          SELECT 1 FROM caja_diaria cd
          JOIN transacciones t ON t.cuenta_id = cd.cuenta_id
            AND t.referencia_id = p.id AND t.tipo = 'ingreso'
          WHERE cd.operacion = 'planta' AND cd.estado = 'Cerrada'
            AND cd.fecha = (p.created_at AT TIME ZONE 'America/Lima')::date
        ) AS caja_original_cerrada,
        -- Caja cerrada del nuevo día destino (solo si es Contado)
        EXISTS (
          SELECT 1 FROM caja_diaria cd
          WHERE cd.operacion = 'planta' AND cd.estado = 'Cerrada'
            AND cd.fecha = ${nuevaFecha}::date
            AND cd.cuenta_id = ${cuenta_id}::uuid
        ) AS caja_destino_cerrada
      FROM pedidos p
      WHERE p.id = ${id}::uuid
    `;

    const pedido = originalRows[0];
    if (!pedido) {
      return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
    }
    if (pedido.origen !== "pos_planta") {
      return NextResponse.json({ error: "Esta venta no es del POS de planta." }, { status: 400 });
    }
    if (pedido.anulada) {
      return NextResponse.json({ error: "No se puede editar una venta anulada." }, { status: 400 });
    }
    if (pedido.tiene_comprobante) {
      return NextResponse.json(
        { error: `No se puede editar: esta venta tiene el comprobante ${pedido.comprobante_serie}. Emite una Nota de Crédito.` },
        { status: 409 }
      );
    }
    if (pedido.caja_original_cerrada) {
      return NextResponse.json(
        { error: "No se puede editar: la caja de la fecha original de la venta ya está cerrada (arqueada)." },
        { status: 409 }
      );
    }
    if (tipo_pago === "Contado" && pedido.caja_destino_cerrada) {
      return NextResponse.json(
        { error: `No se puede mover la venta al ${nuevaFecha}: la caja para ese día ya está cerrada.` },
        { status: 409 }
      );
    }

    // 2. Cargar datos antiguos para la reversión
    const oldItems = await sql`
      SELECT producto_id, cantidad::float8 AS cantidad
      FROM pedido_items WHERE pedido_id = ${id}::uuid AND producto_id IS NOT NULL
    ` as Array<{ producto_id: string; cantidad: number }>;

    const oldTransactions = await sql`
      SELECT cuenta_id, monto::float8 AS monto
      FROM transacciones
      WHERE referencia_id = ${id}::uuid AND tipo = 'ingreso'
    ` as Array<{ cuenta_id: string; monto: number }>;

    // 3. Preparar los datos nuevos
    let clienteNombre = "Venta Rápida (POS)";
    let razonSocial: string | null = null;
    let rucDni: string | null = null;
    let plazoPagoDias = 0;

    if (cliente_planta_id) {
      const clientRows = await sql`
        SELECT nombre, razon_social, ruc_dni, plazo_pago_dias
        FROM clientes_planta
        WHERE id = ${cliente_planta_id}::uuid AND activo
      `;
      if (clientRows.length === 0) {
        return NextResponse.json({ error: "Cliente de planta no encontrado o inactivo" }, { status: 404 });
      }
      clienteNombre = clientRows[0].nombre;
      razonSocial = clientRows[0].razon_social;
      rucDni = clientRows[0].ruc_dni;
      plazoPagoDias = Number(clientRows[0].plazo_pago_dias) || 0;
    }

    const itemsCanonicos = items.map((item) => ({
      ...item,
      cantidad: redondearMonedaPos(item.cantidad),
      precioUnitario: redondearMonedaPos(item.precioUnitario),
    }));

    const newTotal = totalVentaPos(itemsCanonicos);
    const detallesItems = itemsCanonicos.map(i => {
      return `${i.cantidad} ${i.unidad} ${i.productoNombre}` + (i.notas ? ` (${i.notas})` : '');
    });
    const detalleDerivado = detallesItems.join(", ") + (notas_generales ? ` | NOTAS: ${notas_generales}` : "");
    const nuevoCreatedAt = `${nuevaFecha} ${pedido.hora_orig}`;

    const queries = [];

    // --- REVERSIÓN ---
    // A. Reversar stock antiguo
    for (const it of oldItems) {
      queries.push(sql`
        INSERT INTO inventario_lotes (producto_id, cantidad)
        VALUES (${it.producto_id}, ${it.cantidad})
        ON CONFLICT (producto_id) DO UPDATE SET
          cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      `);
      queries.push(sql`
        INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
        VALUES (${it.producto_id}, ${it.cantidad}, 'anulacion_venta_pos', ${usuario_id}, ${id})
      `);
    }

    // B. Reversar dinero contado antiguo
    for (const tx of oldTransactions) {
      queries.push(sql`
        UPDATE cuentas_bancarias
        SET saldo = saldo - ${tx.monto},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${tx.cuenta_id}
      `);
    }
    // C. Eliminar transacciones antiguas y cobranzas antiguas
    queries.push(sql`DELETE FROM transacciones WHERE referencia_id = ${id}::uuid`);
    queries.push(sql`DELETE FROM cobranzas_planta WHERE pedido_id = ${id}::uuid`);

    // --- APLICAR NUEVA VENTA ---
    // D. Descontar stock nuevo
    for (const it of itemsCanonicos) {
      queries.push(sql`
        INSERT INTO inventario_lotes (producto_id, cantidad)
        VALUES (${it.productoId}, ${-it.cantidad})
        ON CONFLICT (producto_id) DO UPDATE SET
          cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      `);
      queries.push(sql`
        INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
        VALUES (${it.productoId}, ${-it.cantidad}, 'venta_pos', ${usuario_id}, ${id})
      `);
    }

    // E. Aplicar cobro Contado
    if (tipo_pago === "Contado") {
      queries.push(sql`
        UPDATE cuentas_bancarias
        SET saldo = saldo + ${newTotal},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuenta_id}::uuid
      `);
      queries.push(sql`
        INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id, fecha, created_at)
        VALUES (
          ${cuenta_id}::uuid, ${usuario_id}, 'ingreso', ${newTotal}, 'Venta Rápida (Editada) - Pedido ' || ${id}, ${id},
          ${nuevaFecha}::date, ${nuevoCreatedAt}::timestamp AT TIME ZONE 'America/Lima'
        )
      `);
    } else {
      // F. Aplicar cobro Crédito
      const cobranza_id = crypto.randomUUID();
      queries.push(sql`
        INSERT INTO cobranzas_planta (
          id, pedido_id, cliente_planta_id, cliente_nombre,
          monto, plazo_dias, fecha_emision, fecha_vencimiento,
          estado, empresa, notas, creado_por, created_at
        )
        VALUES (
          ${cobranza_id}, ${id}::uuid, ${cliente_planta_id}::uuid, ${clienteNombre},
          ${newTotal}, ${plazoPagoDias}, ${nuevaFecha}::date,
          ${nuevaFecha}::date + ${plazoPagoDias}::int,
          'Pendiente', ${empresa}, ${notas_generales || null}, ${usuario_id},
          ${nuevoCreatedAt}::timestamp AT TIME ZONE 'America/Lima'
        )
      `);
    }

    // G. Actualizar pedido en pedidos
    queries.push(sql`
      UPDATE pedidos
      SET cliente = ${clienteNombre},
          -- Va junto a razon_social/ruc_dni: si se actualizan esos y no el id, la
          -- venta seguiría colgando de la ficha del cliente ANTERIOR.
          cliente_planta_id = ${cliente_planta_id ?? null}::uuid,
          razon_social = ${razonSocial},
          ruc_dni = ${rucDni},
          fecha_pedido = ${nuevaFecha}::date,
          detalle = ${detalleDerivado},
          detalle_final = ${detalleDerivado},
          empresa = ${empresa},
          created_at = ${nuevoCreatedAt}::timestamp AT TIME ZONE 'America/Lima'
      WHERE id = ${id}::uuid
    `);

    // H. Reemplazar pedido_items
    queries.push(sql`DELETE FROM pedido_items WHERE pedido_id = ${id}::uuid`);
    for (const it of itemsCanonicos) {
      const subtotal = subtotalVentaPos(it.cantidad, it.precioUnitario);
      queries.push(sql`
        INSERT INTO pedido_items (
          pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido,
          precio_unitario, subtotal, subtotal_real, costo_unitario_snapshot, notas
        )
        VALUES (
          ${id}::uuid, ${it.productoId}::uuid, ${it.productoNombre}, ${it.cantidad}, ${it.unidad}, ${it.unidad},
          ${it.precioUnitario}, ${subtotal}, ${subtotal},
          (SELECT p.precio_compra FROM productos p WHERE p.id = ${it.productoId}::uuid),
          ${it.notas || null}
        )
      `);
    }

    // I. Auditoría de edición
    const cambios = [
      {
        campo: "edicion_venta",
        etiqueta: "Edición de Venta Rápida",
        antes: pedido.fecha_orig + " | Total: " + (oldTransactions[0]?.monto || "Deuda"),
        despues: nuevaFecha + " | Total: " + newTotal
      }
    ];

    queries.push(sql`
      INSERT INTO pedido_ediciones (pedido_id, usuario_id, usuario_nombre, usuario_rol, cambios)
      VALUES (
        ${id}::uuid,
        ${usuario_id}::uuid,
        ${usuario_nombre},
        ${usuario_rol},
        ${JSON.stringify(cambios)}::jsonb
      )
    `);

    await sql.transaction(queries);

    return NextResponse.json({ ok: true, message: "Venta editada correctamente." });
  } catch (error) {
    console.error("Error al editar venta POS:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

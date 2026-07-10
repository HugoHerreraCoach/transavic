// src/app/api/pos/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PosItemSchema = z.object({
  productoId: z.string().uuid(),
  nombre: z.string(),
  cantidad: z.number().positive(),
  unidad: z.string(),
  precioUnitario: z.number().nonnegative(),
  notas: z.string().optional().nullable(),
});

const PosSaleSchema = z.object({
  // id del pedido generado por el CLIENTE (idempotencia: el replay de la cola
  // offline reusa el mismo id y colisiona en PK en vez de duplicar la venta).
  id: z.string().uuid().optional(),
  empresa: z.enum(["Transavic", "Avícola de Tony"]),
  items: z.array(PosItemSchema).min(1),
  tipo_pago: z.enum(["Contado", "Credito"]),
  cuenta_id: z.string().uuid().optional().nullable(),
  // Cliente de PLANTA (tabla propia clientes_planta), NO el de ejecutivas.
  cliente_planta_id: z.string().uuid().optional().nullable(),
  notas_generales: z.string().optional().nullable(),
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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado para Venta Rápida" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = PosSaleSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { id: bodyId, empresa, items, tipo_pago, cuenta_id, cliente_planta_id, notas_generales } = result.data;
    const usuario_id = session.user.id;
    const usuario_nombre = session.user.name || "POS Usuario";

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }
    const sql = neon(connectionString);

    // Idempotencia: id del pedido generado por el cliente (o fallback server-side).
    const pedido_id = bodyId ?? crypto.randomUUID();
    const yaExiste = await sql`SELECT id FROM pedidos WHERE id = ${pedido_id}`;
    if (yaExiste.length > 0) {
      // Replay de la cola offline: la venta ya se registró, no duplicar.
      return NextResponse.json({ message: "Venta ya registrada", pedido_id }, { status: 200 });
    }

    // Cliente de PLANTA (opcional para contado; obligatorio para crédito).
    // Se denormalizan razon_social/ruc_dni al pedido para poder facturar a RUC
    // (el comprobante lee esos campos del pedido, no de clientes).
    let clienteNombre = "Venta Rápida (POS)";
    let razonSocial: string | null = null;
    let rucDni: string | null = null;
    let plazoPagoDias = 0;

    if (cliente_planta_id) {
      const clientRows = await sql`
        SELECT nombre, razon_social, ruc_dni, plazo_pago_dias
        FROM clientes_planta
        WHERE id = ${cliente_planta_id}
      `;
      if (clientRows.length === 0) {
        return NextResponse.json({ error: "Cliente de planta no encontrado" }, { status: 404 });
      }
      clienteNombre = clientRows[0].nombre;
      razonSocial = clientRows[0].razon_social;
      rucDni = clientRows[0].ruc_dni;
      plazoPagoDias = Number(clientRows[0].plazo_pago_dias) || 0;
    }

    // Calcular totales
    let total_venta = 0;
    const detallesItems = items.map(i => {
      const sub = i.cantidad * i.precioUnitario;
      total_venta += sub;
      return `${i.cantidad} ${i.unidad} ${i.nombre}` + (i.notas ? ` (${i.notas})` : '');
    });
    const detalleDerivado = detallesItems.join(", ") + (notas_generales ? ` | NOTAS: ${notas_generales}` : "");

    // Venta COMPLETA en una sola transacción: pedido + items + inventario + cobro/deuda.
    // Un fallo a mitad no puede dejar un pedido sin stock descontado ni una venta sin
    // cobro/cobranza. El pedido de planta va con cliente_id=NULL (la FK apunta a la
    // tabla `clientes` de ejecutivas; el cliente de planta vive en cobranzas_planta),
    // pero denormaliza razon_social/ruc_dni para el comprobante.
    const queries = [
      // 1. Crear el Pedido (origen = pos_planta, estado = Entregado)
      sql`
        INSERT INTO pedidos (
          id, cliente, cliente_id, razon_social, ruc_dni, fecha_pedido, detalle, detalle_final, estado,
          empresa, asesor_id, entregado_por, origen
        )
        VALUES (
          ${pedido_id},
          ${clienteNombre},
          NULL,
          ${razonSocial},
          ${rucDni},
          (NOW() AT TIME ZONE 'America/Lima')::date,
          ${detalleDerivado},
          ${detalleDerivado},
          'Entregado',
          ${empresa},
          ${usuario_id},
          ${usuario_nombre},
          'pos_planta'
        )
      `,
      // 2. Items e inventario (lote flexible, puede quedar negativo)
      ...items.flatMap((item) => {
        const subtotal = item.cantidad * item.precioUnitario;
        return [
          sql`
            INSERT INTO pedido_items (
              pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido,
              precio_unitario, subtotal, subtotal_real, notas
            )
            VALUES (
              ${pedido_id}, ${item.productoId}, ${item.nombre}, ${item.cantidad}, ${item.unidad}, ${item.unidad},
              ${item.precioUnitario}, ${subtotal}, ${subtotal}, ${item.notas || null}
            )
          `,
          // Upsert (no UPDATE a secas): si el producto nunca tuvo fila de lote, el
          // UPDATE viejo no hacía NADA y la venta no descontaba stock (bug cazado en
          // la auditoría del 10 jul). Con el upsert queda el negativo, coherente con
          // la política de inventario flexible (doc 09 §4).
          sql`
            INSERT INTO inventario_lotes (producto_id, cantidad)
            VALUES (${item.productoId}, ${-item.cantidad})
            ON CONFLICT (producto_id) DO UPDATE SET
              cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          `,
          sql`
            INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
            VALUES (${item.productoId}, ${-item.cantidad}, 'venta_pos', ${usuario_id}, ${pedido_id})
          `,
        ];
      }),
    ];

    // 3. Cobro (Contado) o deuda (Crédito)
    if (tipo_pago === "Contado") {
      queries.push(sql`
        WITH update_cuenta AS (
          UPDATE cuentas_bancarias
          SET saldo = saldo + ${total_venta},
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          WHERE id = ${cuenta_id}
          RETURNING id
        )
        INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
        SELECT id, ${usuario_id}, 'ingreso', ${total_venta}, 'Venta Rápida - Pedido ' || ${pedido_id}, ${pedido_id}
        FROM update_cuenta
      `);
    } else {
      // Crédito de planta → cobranza PROPIA (cobranzas_planta), aislada de `facturas`
      // de ejecutivas. La fecha de vencimiento se calcula en SQL (zona Lima, gotcha #30).
      const cobranza_id = crypto.randomUUID();
      queries.push(sql`
        INSERT INTO cobranzas_planta (
          id, pedido_id, cliente_planta_id, cliente_nombre,
          monto, plazo_dias, fecha_emision, fecha_vencimiento,
          estado, empresa, notas, creado_por
        )
        VALUES (
          ${cobranza_id}, ${pedido_id}, ${cliente_planta_id}, ${clienteNombre},
          ${total_venta}, ${plazoPagoDias}, (NOW() AT TIME ZONE 'America/Lima')::date,
          (NOW() AT TIME ZONE 'America/Lima')::date + ${plazoPagoDias}::int,
          'Pendiente', ${empresa}, ${notas_generales || null}, ${usuario_id}
        )
      `);
    }

    try {
      await sql.transaction(queries);
    } catch (error: unknown) {
      // Carrera de doble-tap / replay offline: el pedido ya existe (unique violation).
      const code = (error as { code?: string })?.code;
      if (code === "23505") {
        return NextResponse.json({ message: "Venta ya registrada", pedido_id }, { status: 200 });
      }
      throw error;
    }

    return NextResponse.json({ message: "Venta Rápida registrada", pedido_id }, { status: 201 });
  } catch (error) {
    console.error("Error al procesar Venta POS:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

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
  empresa: z.enum(["Transavic", "Avícola de Tony"]),
  items: z.array(PosItemSchema).min(1),
  tipo_pago: z.enum(["Contado", "Credito"]),
  cuenta_id: z.string().uuid().optional().nullable(),
  cliente_id: z.string().uuid().optional().nullable(),
  notas_generales: z.string().optional().nullable(),
}).refine((data) => {
  if (data.tipo_pago === "Contado" && !data.cuenta_id) {
    return false;
  }
  if (data.tipo_pago === "Credito" && !data.cliente_id) {
    return false;
  }
  return true;
}, {
  message: "Debe seleccionar una cuenta bancaria/caja para pagos al Contado, o un cliente registrado para ventas al Crédito.",
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

    const { empresa, items, tipo_pago, cuenta_id, cliente_id, notas_generales } = result.data;
    const usuario_id = session.user.id;
    const usuario_nombre = session.user.name || "POS Usuario";

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }
    const sql = neon(connectionString);

    // Obtener información del cliente si existe
    let clienteNombre = "Venta Rápida (POS)";
    let plazoPagoDias = 0;
    let clientAsesorId = usuario_id;

    if (cliente_id) {
      const clientRows = await sql`
        SELECT nombre, plazo_pago_dias, asesor_id
        FROM clientes
        WHERE id = ${cliente_id}
      `;
      if (clientRows.length > 0) {
        clienteNombre = clientRows[0].nombre;
        plazoPagoDias = Number(clientRows[0].plazo_pago_dias) || 0;
        clientAsesorId = clientRows[0].asesor_id || usuario_id;
      }
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
    // cobro/cobranza. El id del pedido se genera aquí porque la transacción batch del
    // driver HTTP de Neon no permite usar el RETURNING de una query en las siguientes.
    const pedido_id = crypto.randomUUID();

    const queries = [
      // 1. Crear el Pedido (origen = pos_planta, estado = Entregado)
      sql`
        INSERT INTO pedidos (
          id, cliente, cliente_id, fecha_pedido, detalle, detalle_final, estado,
          empresa, asesor_id, entregado_por, origen
        )
        VALUES (
          ${pedido_id},
          ${clienteNombre},
          ${cliente_id || null},
          (NOW() AT TIME ZONE 'America/Lima')::date,
          ${detalleDerivado},
          ${detalleDerivado},
          'Entregado',
          ${empresa},
          ${clientAsesorId},
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
          sql`
            UPDATE inventario_lotes
            SET cantidad = cantidad - ${item.cantidad},
                updated_at = (NOW() AT TIME ZONE 'America/Lima')
            WHERE producto_id = ${item.productoId}
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
      const fechaVence = new Date(Date.now() + plazoPagoDias * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      queries.push(sql`
        INSERT INTO facturas (
          pedido_id, cliente_id, cliente_nombre, asesor_id,
          monto, plazo_dias, fecha_emision, fecha_vencimiento,
          estado, numero_comprobante, notas
        )
        VALUES (
          ${pedido_id}, ${cliente_id}, ${clienteNombre}, ${clientAsesorId},
          ${total_venta}, ${plazoPagoDias}, (NOW() AT TIME ZONE 'America/Lima')::date,
          ${fechaVence}::date, 'Pendiente', 'POS-CREDITO', ${notas_generales || null}
        )
      `);
    }

    await sql.transaction(queries);

    return NextResponse.json({ message: "Venta Rápida registrada", pedido_id }, { status: 201 });
  } catch (error) {
    console.error("Error al procesar Venta POS:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

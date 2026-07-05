// src/lib/inventario.ts
// Política de inventario (decidida por Hugo, 5 jul 2026): el stock lo mueven
// compras (+), ventas POS (−), AJUSTES manuales (± con motivo) y los pedidos
// normales al pasar a ENTREGADO (− con cantidades reales pesadas; se repone al
// revertir la entrega). Cada movimiento queda en el kardex `inventario_movimientos`.
//
// Idempotencia: la offline-queue del repartidor puede repetir POST /entregar.
// El guard es `pedidos.inventario_descontado`: solo el llamado que gana el
// UPDATE condicional ejecuta el descuento; los repetidos no hacen nada.
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

interface ItemPedido {
  producto_id: string;
  cantidad: string | number;
}

async function itemsDelPedido(sql: Sql, pedidoId: string): Promise<ItemPedido[]> {
  const rows = (await sql`
    SELECT producto_id, COALESCE(cantidad_real, cantidad)::numeric AS cantidad
    FROM pedido_items
    WHERE pedido_id = ${pedidoId}
      AND producto_id IS NOT NULL
      AND COALESCE(cantidad_real, cantidad) > 0
  `) as ItemPedido[];
  return rows;
}

/**
 * Descuenta del inventario los ítems de un pedido ENTREGADO (una sola vez).
 * No lanza: si algo falla, revierte el guard y deja log — la entrega del
 * repartidor NUNCA debe fallar por el inventario.
 */
export async function descontarInventarioPedido(
  sql: Sql,
  pedidoId: string,
  usuarioId: string | null
): Promise<void> {
  try {
    const guard = await sql`
      UPDATE pedidos SET inventario_descontado = TRUE
      WHERE id = ${pedidoId} AND inventario_descontado = FALSE
      RETURNING id
    `;
    if (guard.length === 0) return; // ya descontado (reintento offline-queue)

    const items = await itemsDelPedido(sql, pedidoId);
    if (items.length === 0) return;

    try {
      await sql.transaction(
        items.flatMap((it) => [
          sql`
            INSERT INTO inventario_lotes (producto_id, cantidad)
            VALUES (${it.producto_id}, ${-Number(it.cantidad)})
            ON CONFLICT (producto_id) DO UPDATE SET
              cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          `,
          sql`
            INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
            VALUES (${it.producto_id}, ${-Number(it.cantidad)}, 'entrega', ${usuarioId}, ${pedidoId})
          `,
        ])
      );
    } catch (e) {
      // Falló el descuento: liberar el guard para que el próximo reintento lo haga.
      await sql`UPDATE pedidos SET inventario_descontado = FALSE WHERE id = ${pedidoId}`;
      throw e;
    }
  } catch (error) {
    console.error(`Inventario: no se pudo descontar el pedido ${pedidoId} (no bloqueante):`, error);
  }
}

/**
 * Repone el inventario al REVERTIR una entrega (una sola vez, mismo guard).
 * No lanza: la reversión de la entrega no debe fallar por el inventario.
 */
export async function reponerInventarioPedido(
  sql: Sql,
  pedidoId: string,
  usuarioId: string | null
): Promise<void> {
  try {
    const guard = await sql`
      UPDATE pedidos SET inventario_descontado = FALSE
      WHERE id = ${pedidoId} AND inventario_descontado = TRUE
      RETURNING id
    `;
    if (guard.length === 0) return; // nunca se descontó (o ya se repuso)

    const items = await itemsDelPedido(sql, pedidoId);
    if (items.length === 0) return;

    try {
      await sql.transaction(
        items.flatMap((it) => [
          sql`
            INSERT INTO inventario_lotes (producto_id, cantidad)
            VALUES (${it.producto_id}, ${Number(it.cantidad)})
            ON CONFLICT (producto_id) DO UPDATE SET
              cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          `,
          sql`
            INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
            VALUES (${it.producto_id}, ${Number(it.cantidad)}, 'reversion', ${usuarioId}, ${pedidoId})
          `,
        ])
      );
    } catch (e) {
      await sql`UPDATE pedidos SET inventario_descontado = TRUE WHERE id = ${pedidoId}`;
      throw e;
    }
  } catch (error) {
    console.error(`Inventario: no se pudo reponer el pedido ${pedidoId} (no bloqueante):`, error);
  }
}

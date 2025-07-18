// src/lib/data.ts
import { neon } from "@neondatabase/serverless";
import { Pedido } from "./types";

export async function fetchFilteredPedidos(
  query?: string,
  fecha?: string
): Promise<Pedido[]> {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }

    const sql = neon(connectionString);

    let baseQuery = `
      SELECT 
        id, cliente, whatsapp, direccion, distrito, tipo_cliente, 
        detalle, hora_entrega, notas, empresa, 
        TO_CHAR(fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        peso_exacto, created_at 
      FROM pedidos
    `;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query) {
      conditions.push(`cliente ILIKE $${params.length + 1}`);
      params.push(`%${query}%`);
    }

    if (fecha) {
      conditions.push(`fecha_pedido = $${params.length + 1}`);
      params.push(fecha);
    }

    if (conditions.length > 0) {
      baseQuery += " WHERE " + conditions.join(" AND ");
    }

    baseQuery += " ORDER BY created_at DESC";

    // ✅ CAMBIO FINAL: Volvemos a sql.query() que es más robusto para esto.
    const result = await sql.query(baseQuery, params);

    // Y retornamos el resultado directamente, que ya es el arreglo de filas.
    return result as Pedido[];
  } catch (error) {
    console.error("Error en la base de datos:", error);
    return [];
  }
}

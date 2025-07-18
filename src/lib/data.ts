// src/lib/data.ts
import { neon } from "@neondatabase/serverless";
import { Pedido } from "./types";

const ITEMS_PER_PAGE = 25;

export async function fetchFilteredPedidos(
  query: string,
  fecha: string,
  currentPage: number
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida");
  }
  const sql = neon(connectionString);
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query) {
      // ✅ CAMBIO: Se añade "OR whatsapp ILIKE ..." a la condición de búsqueda.
      whereClauses.push(`(cliente ILIKE $${paramIndex} OR detalle ILIKE $${paramIndex} OR whatsapp ILIKE $${paramIndex})`);
      params.push(`%${query}%`);
      paramIndex++;
    }

    if (fecha) {
      whereClauses.push(`fecha_pedido = $${paramIndex}`);
      params.push(fecha);
      paramIndex++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const pedidosQuery = `
      SELECT
        id, cliente, whatsapp, empresa,
        TO_CHAR(fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        detalle, peso_exacto
      FROM pedidos
      ${whereString}
      ORDER BY fecha_pedido DESC, id DESC
      LIMIT ${ITEMS_PER_PAGE}
      OFFSET ${offset}
    `;
    const pedidosPromise = sql.query(pedidosQuery, params);

    const countQuery = `SELECT COUNT(*) FROM pedidos ${whereString}`;
    const countPromise = sql.query(countQuery, params);

    const [data, countResult] = await Promise.all([pedidosPromise, countPromise]);

    const totalCount = Number(countResult[0].count);
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

    return {
      data: data as Pedido[],
      pagination: {
        totalRecords: totalCount,
        totalPages: totalPages,
        currentPage: currentPage,
      },
    };
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch pedidos.");
  }
}
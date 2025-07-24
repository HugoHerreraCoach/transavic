// src/lib/data.ts

import { neon } from "@neondatabase/serverless";
import { Pedido } from "./types";

const ITEMS_PER_PAGE = 25;

type PedidoFromDB = Omit<Pedido, 'peso_exacto' | 'created_at'> & {
  peso_exacto: string | null;
  created_at: string; // La base de datos devuelve las fechas como texto (ISO string)
};


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

    // ✅ CORRECCIÓN 1: Añadimos 'created_at' a la consulta SELECT.
    const pedidosQuery = `
      SELECT
        id, cliente, whatsapp, empresa, direccion, distrito, tipo_cliente, hora_entrega, notas,
        TO_CHAR(fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        detalle, peso_exacto, created_at, latitude, longitude
      FROM pedidos
      ${whereString}
      ORDER BY fecha_pedido DESC, id DESC
      LIMIT ${ITEMS_PER_PAGE}
      OFFSET ${offset}
    `;
    const dataPromise = sql.query(pedidosQuery, params);

    const countQuery = `SELECT COUNT(*) FROM pedidos ${whereString}`;
    const countPromise = sql.query(countQuery, params);

    const [data, countResult] = await Promise.all([dataPromise, countPromise]);

    const totalCount = Number((countResult[0] as { count: string }).count);
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    
    const rawPedidos = data as PedidoFromDB[];

    // ✅ CORRECCIÓN 2: Convertimos el 'created_at' de string a Date.
    const typedPedidos: Pedido[] = rawPedidos.map(pedido => ({
      ...pedido,
      peso_exacto: pedido.peso_exacto === null ? null : Number(pedido.peso_exacto),
      created_at: new Date(pedido.created_at)
    }));

    return {
      data: typedPedidos,
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
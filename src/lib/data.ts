// src/lib/data.ts

import { neon } from "@neondatabase/serverless";
import { Pedido } from "./types";
import { Session } from "next-auth";
import { User } from "./types";

const ITEMS_PER_PAGE = 25;

type PedidoFromDB = Omit<Pedido, 'created_at' | 'detalle_final'> & {
  detalle_final: string | null;
  created_at: string; 
};


export async function fetchFilteredPedidos(
  query: string,
  fecha: string,
  currentPage: number,
  session: Session
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida");
  }

  // ✅ Extraemos el rol y el ID del usuario de la sesión
  const userRole = session.user.role;
  const userId = session.user.id;

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

    // ✅ LÓGICA DE ROLES
    if (userRole === "asesor") {
      whereClauses.push(`asesor_id = $${paramIndex}`);
      params.push(userId);
      paramIndex++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const pedidosQuery = `
      SELECT
        p.id, p.cliente, p.whatsapp, p.empresa, p.direccion, p.distrito, p.tipo_cliente, p.hora_entrega, p.notas,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        p.detalle, p.detalle_final, p.created_at, p.latitude, p.longitude, p.asesor_id, p.entregado,
        u.name as asesor_name
      FROM pedidos AS p
      LEFT JOIN users AS u ON p.asesor_id = u.id
      ${whereString}
      ORDER BY p.created_at DESC -- Se especifica p.created_at
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
      detalle_final: pedido.detalle_final,
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


// ✅ Nueva función para obtener solo los asesores
export async function fetchAsesores() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL no está definida.");
    return []; // Devuelve un array vacío si no hay conexión
  }
  const sql = neon(connectionString);

  try {
    const asesores = await sql`
      SELECT id, name, role FROM users WHERE role = 'asesor' ORDER BY name ASC
    `;
    // Aseguramos que el tipo de dato sea el correcto
    return asesores as User[];
  } catch (error) {
    console.error("Error al obtener los asesores:", error);
    return []; // Devuelve un array vacío en caso de error
  }
}

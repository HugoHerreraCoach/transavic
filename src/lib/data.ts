// src/lib/data.ts

import { neon } from "@neondatabase/serverless";
import { Pedido, PedidoRuta } from "./types";
import { Session } from "next-auth";
import { User } from "./types";

const ITEMS_PER_PAGE = 25;

type PedidoFromDB = Omit<
  Pedido,
  "created_at" | "detalle_final" | "latitude" | "longitude"
> & {
  detalle_final: string | null;
  created_at: string;
  latitude: string | null;
  longitude: string | null;
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

  const userRole = session.user.role;
  const userId = session.user.id;

  const sql = neon(connectionString);
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query) {
      whereClauses.push(
        `(p.cliente ILIKE $${paramIndex} OR p.detalle ILIKE $${paramIndex} OR p.whatsapp ILIKE $${paramIndex})`
      );
      params.push(`%${query}%`);
      paramIndex++;
    }

    if (fecha) {
      whereClauses.push(`p.fecha_pedido = $${paramIndex}`);
      params.push(fecha);
      paramIndex++;
    }

    // LÓGICA DE ROLES
    if (userRole === "asesor") {
      whereClauses.push(`p.asesor_id = $${paramIndex}`);
      params.push(userId);
      paramIndex++;
    } else if (userRole === "repartidor") {
      whereClauses.push(`p.repartidor_id = $${paramIndex}`);
      params.push(userId);
      paramIndex++;
    }

    const whereString =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const pedidosQuery = `
      SELECT
        p.id, p.cliente, p.whatsapp, p.empresa, p.direccion, p.distrito, p.tipo_cliente, p.hora_entrega, p.razon_social, p.ruc_dni, p.notas,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        p.detalle, p.detalle_final, p.created_at, p.latitude, p.longitude, p.asesor_id, p.entregado,
        p.entregado_por, p.entregado_at,
        p.estado, p.repartidor_id, p.orden_ruta, p.hora_llegada_estimada, p.razon_fallo, p.inicio_viaje_at,
        u.name as asesor_name,
        r.name as repartidor_name
      FROM pedidos AS p
      LEFT JOIN users AS u ON p.asesor_id = u.id
      LEFT JOIN users AS r ON p.repartidor_id = r.id
      ${whereString}
      ORDER BY p.created_at DESC
      LIMIT ${ITEMS_PER_PAGE}
      OFFSET ${offset}
    `;
    const dataPromise = sql.query(pedidosQuery, params);

    const countQuery = `SELECT COUNT(*) FROM pedidos AS p ${whereString}`;
    const countPromise = sql.query(countQuery, params);

    const [data, countResult] = await Promise.all([dataPromise, countPromise]);

    const totalCount = Number((countResult[0] as { count: string }).count);
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

    const rawPedidos = data as PedidoFromDB[];

    const typedPedidos: Pedido[] = rawPedidos.map((pedido) => ({
      ...pedido,
      detalle_final: pedido.detalle_final,
      created_at: new Date(pedido.created_at),
      latitude: pedido.latitude ? parseFloat(pedido.latitude) : null,
      longitude: pedido.longitude ? parseFloat(pedido.longitude) : null,
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

// Obtener asesores
export async function fetchAsesores() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL no está definida.");
    return [];
  }
  const sql = neon(connectionString);

  try {
    const asesores = await sql`
      SELECT id, name, role FROM users WHERE role = 'asesor' ORDER BY name ASC
    `;
    return asesores as User[];
  } catch (error) {
    console.error("Error al obtener los asesores:", error);
    return [];
  }
}

// Obtener repartidores
export async function fetchRepartidores() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL no está definida.");
    return [];
  }
  const sql = neon(connectionString);

  try {
    const repartidores = await sql`
      SELECT id, name, role FROM users WHERE role = 'repartidor' ORDER BY name ASC
    `;
    return repartidores as User[];
  } catch (error) {
    console.error("Error al obtener los repartidores:", error);
    return [];
  }
}

// Obtener pedidos de la ruta de un repartidor para hoy
export async function fetchMiRuta(repartidorId: string): Promise<PedidoRuta[]> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida");
  }
  const sql = neon(connectionString);

  try {
    const pedidos = await sql`
      SELECT
        id, cliente, direccion, distrito, whatsapp,
        latitude, longitude, estado, orden_ruta,
        hora_entrega, hora_llegada_estimada, inicio_viaje_at,
        razon_fallo, detalle, notas
      FROM pedidos
      WHERE repartidor_id = ${repartidorId}
        AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      ORDER BY
        CASE estado
          WHEN 'En_Camino' THEN 0
          WHEN 'Asignado' THEN 1
          WHEN 'Pendiente' THEN 2
          WHEN 'Entregado' THEN 3
          WHEN 'Fallido' THEN 4
        END,
        orden_ruta ASC NULLS LAST,
        created_at ASC
    `;

    return pedidos.map((p) => ({
      ...p,
      latitude: p.latitude ? parseFloat(p.latitude as string) : null,
      longitude: p.longitude ? parseFloat(p.longitude as string) : null,
    })) as PedidoRuta[];
  } catch (error) {
    console.error("Error al obtener mi ruta:", error);
    throw new Error("Failed to fetch mi ruta.");
  }
}

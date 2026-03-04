// src/app/api/clientes/[id]/pedidos/route.ts

import { neon } from '@neondatabase/serverless';
import { NextResponse, NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "DATABASE_URL no definida" }, { status: 500 });
  }

  const { id } = await params;
  const sql = neon(connectionString);

  try {
    // First get the client's name for fallback matching
    const clienteResult = await sql`SELECT nombre FROM clientes WHERE id = ${id}`;
    if (clienteResult.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    const clienteNombre = clienteResult[0].nombre;

    // Get pedidos linked by cliente_id OR matching by name
    const pedidos = await sql`
      SELECT
        p.id, p.cliente, p.detalle, p.empresa, p.distrito,
        p.estado, p.hora_entrega, p.whatsapp,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
        p.detalle_final, p.notas, p.created_at
      FROM pedidos p
      WHERE p.cliente_id = ${id}
         OR (p.cliente_id IS NULL AND LOWER(p.cliente) = LOWER(${clienteNombre}))
      ORDER BY p.created_at DESC
      LIMIT 50
    `;

    return NextResponse.json(pedidos);
  } catch (error) {
    console.error('Error fetching pedidos for client:', error);
    return NextResponse.json({ error: "Error al obtener pedidos" }, { status: 500 });
  }
}

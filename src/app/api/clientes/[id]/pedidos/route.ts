// src/app/api/clientes/[id]/pedidos/route.ts
// Devuelve los pedidos de un cliente específico.
// Scoping: admin ve todo; asesor solo ve si el cliente es de SU cartera.

import { neon } from "@neondatabase/serverless";
import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const userId = session.user.id;

  try {
    // Asesor: validar que el cliente le pertenezca. Admin: pasa derecho.
    const clienteResult = (role === "admin"
      ? await sql`SELECT nombre FROM clientes WHERE id = ${id}::uuid`
      : await sql`SELECT nombre FROM clientes WHERE id = ${id}::uuid AND asesor_id = ${userId}::uuid`) as Array<{
      nombre: string;
    }>;
    if (clienteResult.length === 0) {
      // Mismo mensaje que "no encontrado" para no leak existence del cliente
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    const clienteNombre = clienteResult[0].nombre;

    // Pedidos del cliente + scoping por asesor si rol = asesor
    const pedidos =
      role === "admin"
        ? await sql`
            SELECT
              p.id, p.cliente, p.detalle, p.empresa, p.distrito,
              p.estado, p.hora_entrega, p.whatsapp,
              TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
              p.detalle_final, p.notas, p.created_at
            FROM pedidos p
            WHERE p.cliente_id = ${id}::uuid
               OR (p.cliente_id IS NULL AND LOWER(p.cliente) = LOWER(${clienteNombre}))
            ORDER BY p.created_at DESC
            LIMIT 50
          `
        : await sql`
            SELECT
              p.id, p.cliente, p.detalle, p.empresa, p.distrito,
              p.estado, p.hora_entrega, p.whatsapp,
              TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
              p.detalle_final, p.notas, p.created_at
            FROM pedidos p
            WHERE p.asesor_id = ${userId}::uuid
              AND (p.cliente_id = ${id}::uuid
                   OR (p.cliente_id IS NULL AND LOWER(p.cliente) = LOWER(${clienteNombre})))
            ORDER BY p.created_at DESC
            LIMIT 50
          `;

    return NextResponse.json(pedidos);
  } catch (error) {
    console.error("Error fetching pedidos for client:", error);
    return NextResponse.json(
      { error: "Error al obtener pedidos" },
      { status: 500 }
    );
  }
}

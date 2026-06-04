// src/app/api/clientes/[id]/perfil/route.ts
// Perfil 360° del cliente — agrega en una sola respuesta:
//   - Datos del cliente
//   - Stats: total facturado / cobrado / pendiente / # pedidos
//   - Comprobantes (facturas/boletas/NC) emitidos al cliente
//   - Cobranzas (facturas internas) — pendientes / pagadas / vencidas
//   - Top productos del cliente (más comprados)
//
// Diseño: un único endpoint que pega varias queries en paralelo y devuelve el
// perfil completo. Evita 5 round-trips desde la página y simplifica el cliente.
//
// Scoping: admin ve cualquier cliente; asesor solo los de su cartera.
import { neon } from "@neondatabase/serverless";
import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    // 1) Cliente — con scope. Si la asesora no es la dueña, devolvemos 404
    //    (no leakear existencia del cliente).
    const clienteRows = (role === "admin"
      ? await sql`
          SELECT c.*, u.name AS asesor_name
          FROM clientes c
          LEFT JOIN users u ON c.asesor_id = u.id
          WHERE c.id = ${id}::uuid
        `
      : await sql`
          SELECT c.*, u.name AS asesor_name
          FROM clientes c
          LEFT JOIN users u ON c.asesor_id = u.id
          WHERE c.id = ${id}::uuid AND c.asesor_id = ${userId}::uuid
        `) as Array<Record<string, unknown>>;

    if (clienteRows.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    const cliente = clienteRows[0];
    const nombre = String(cliente.nombre ?? "");
    const rucDni = cliente.ruc_dni ? String(cliente.ruc_dni) : null;

    // 2) Pedidos del cliente (top 50 más recientes) — para histórico y stats.
    const pedidos = (await sql`
      SELECT
        p.id, p.cliente, p.detalle, p.empresa, p.distrito, p.estado,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') AS fecha_pedido,
        p.fecha_pedido AS fecha_pedido_raw,
        p.created_at,
        COALESCE(SUM(pi.subtotal), 0) AS subtotal_pedido
      FROM pedidos p
      LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
      WHERE p.cliente_id = ${id}::uuid
         OR (p.cliente_id IS NULL AND LOWER(p.cliente) = LOWER(${nombre}))
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `) as Array<Record<string, unknown>>;

    // 3) Comprobantes emitidos al cliente — por ruc_dni si existe.
    const comprobantes = rucDni
      ? ((await sql`
          SELECT
            c.id, c.serie_numero, c.tipo, c.empresa, c.estado,
            c.monto_total, c.created_at,
            c.cliente_razon_social, c.mensaje_sunat
          FROM comprobantes c
          WHERE c.cliente_doc_num = ${rucDni}
          ORDER BY c.created_at DESC
          LIMIT 50
        `) as Array<Record<string, unknown>>)
      : [];

    // 4) Cobranzas (facturas internas) — por cliente_id o por nombre (fallback).
    const cobranzas = (await sql`
      SELECT
        f.id, f.cliente_nombre, f.monto, f.estado, f.numero_comprobante,
        TO_CHAR(f.fecha_emision, 'DD/MM/YYYY') AS fecha_emision,
        TO_CHAR(f.fecha_vencimiento, 'DD/MM/YYYY') AS fecha_vencimiento,
        TO_CHAR(f.fecha_pago, 'DD/MM/YYYY') AS fecha_pago,
        f.fecha_vencimiento AS fecha_vencimiento_raw
      FROM facturas f
      WHERE (f.cliente_id = ${id}::uuid
         OR (f.cliente_id IS NULL AND LOWER(f.cliente_nombre) = LOWER(${nombre})))
        AND f.estado <> 'Anulada'
      ORDER BY f.fecha_emision DESC
      LIMIT 50
    `) as Array<Record<string, unknown>>;

    // 5) Top productos comprados — agrega por producto, ordena por cantidad de
    //    pedidos del cliente. Útil para "qué pedirle al próximo contacto".
    const topProductos = (await sql`
      SELECT
        pr.nombre AS producto,
        pr.categoria,
        COUNT(DISTINCT pi.pedido_id) AS veces_pedido,
        SUM(pi.cantidad) AS cantidad_total,
        SUM(pi.subtotal) AS subtotal_total
      FROM pedido_items pi
      JOIN pedidos p ON p.id = pi.pedido_id
      JOIN productos pr ON pr.id = pi.producto_id
      WHERE p.cliente_id = ${id}::uuid
         OR (p.cliente_id IS NULL AND LOWER(p.cliente) = LOWER(${nombre}))
      GROUP BY pr.id, pr.nombre, pr.categoria
      ORDER BY veces_pedido DESC, subtotal_total DESC
      LIMIT 10
    `) as Array<Record<string, unknown>>;

    // 6) Cálculo de stats consolidadas.
    const totalFacturado = comprobantes
      .filter(
        (c) =>
          c.estado === "ACEPTADA" ||
          c.estado === "ACEPTADA_CON_OBSERVACIONES" ||
          c.estado === "PENDIENTE"
      )
      .reduce(
        (acc, c) =>
          acc + (c.tipo === "07" ? -Number(c.monto_total) : Number(c.monto_total)),
        0
      );

    const totalCobrado = cobranzas
      .filter((c) => c.estado === "Pagada")
      .reduce((acc, c) => acc + Number(c.monto), 0);

    const totalPendiente = cobranzas
      .filter((c) => c.estado === "Pendiente" || c.estado === "Vencida")
      .reduce((acc, c) => acc + Number(c.monto), 0);

    const totalVencido = cobranzas
      .filter((c) => c.estado === "Vencida")
      .reduce((acc, c) => acc + Number(c.monto), 0);

    const ultimoPedido = pedidos.length > 0 ? pedidos[0].created_at : null;
    const ticketPromedio = pedidos.length > 0
      ? pedidos.reduce((acc, p) => acc + Number(p.subtotal_pedido ?? 0), 0) / pedidos.length
      : 0;

    return NextResponse.json({
      cliente,
      stats: {
        totalFacturado,
        totalCobrado,
        totalPendiente,
        totalVencido,
        numPedidos: pedidos.length,
        ultimoPedido,
        ticketPromedio,
      },
      pedidos,
      comprobantes,
      cobranzas,
      topProductos,
    });
  } catch (error) {
    console.error("Error GET /api/clientes/[id]/perfil:", error);
    return NextResponse.json(
      { error: "Error al cargar perfil" },
      { status: 500 }
    );
  }
}

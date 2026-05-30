// src/app/api/mi-dia/route.ts
// P3.12 — Endpoint del panel "Mi día" para la asesora.
//
// Agrega en una sola respuesta todo lo que la asesora necesita ver al
// arrancar la jornada. Reduce a 1 fetch lo que hoy son 4-5 navegaciones:
//   - Pedidos para entrega HOY (que ella registró)
//   - Pedidos pendientes / sin entregar todavía
//   - Cobranzas vencidas + venciendo hoy (de sus clientes)
//   - Clientes "dormidos" (sin pedidos hace >20 días) — top 5
//   - Métricas rápidas: ventas hoy, racha actual de la semana
//
// Scope: ASESOR ve SOLO lo suyo. Si lo invoca un admin (caso uso "vista previa"
// del panel) se le devuelve scope agregado (todas las asesoras), pero por
// ahora dejamos solo asesor — el admin ya tiene daily-digest.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== "asesor" && role !== "admin") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    const userId = session.user.id;

    const sql = neon(process.env.DATABASE_URL!);

    // 1) Pedidos cuya FECHA DE ENTREGA es hoy (Lima).
    const pedidosHoy = (await sql`
      SELECT p.id, p.cliente, p.distrito, p.estado, p.empresa,
        p.detalle, p.hora_entrega,
        TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') AS fecha_pedido
      FROM pedidos p
      WHERE p.asesor_id = ${userId}::uuid
        AND p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      ORDER BY
        CASE p.estado
          WHEN 'Pendiente' THEN 0
          WHEN 'En_Produccion' THEN 1
          WHEN 'Listo_Para_Despacho' THEN 2
          WHEN 'Asignado' THEN 3
          WHEN 'En_Camino' THEN 4
          ELSE 5
        END,
        p.hora_entrega NULLS LAST,
        p.created_at DESC
      LIMIT 20
    `) as Array<Record<string, unknown>>;

    // 2) Cobranzas vencidas o venciendo hoy del asesor.
    const cobranzas = (await sql`
      SELECT f.id, f.cliente_nombre, f.monto, f.estado,
        TO_CHAR(f.fecha_vencimiento, 'DD/MM/YYYY') AS fecha_vencimiento,
        (NOW() AT TIME ZONE 'America/Lima')::date - f.fecha_vencimiento AS dias_vencido,
        f.numero_comprobante
      FROM facturas f
      WHERE f.asesor_id = ${userId}::uuid
        AND f.estado IN ('Pendiente', 'Vencida')
        AND f.fecha_vencimiento <= (NOW() AT TIME ZONE 'America/Lima')::date
      ORDER BY f.fecha_vencimiento ASC
      LIMIT 10
    `) as Array<Record<string, unknown>>;

    // 3) Clientes dormidos (sin pedidos hace 20+ días).
    //    Solo los que tienen al menos un pedido (no recién creados sin compras).
    const clientesDormidos = (await sql`
      SELECT c.id, c.nombre, c.ruc_dni, c.whatsapp,
        MAX(p.created_at) AS ultimo_pedido,
        (NOW() AT TIME ZONE 'America/Lima')::date - MAX(p.created_at)::date AS dias_sin_pedido
      FROM clientes c
      JOIN pedidos p ON (p.cliente_id = c.id OR (p.cliente_id IS NULL AND LOWER(p.cliente) = LOWER(c.nombre)))
      WHERE c.asesor_id = ${userId}::uuid
      GROUP BY c.id, c.nombre, c.ruc_dni, c.whatsapp
      HAVING (NOW() AT TIME ZONE 'America/Lima')::date - MAX(p.created_at)::date >= 20
      ORDER BY dias_sin_pedido DESC
      LIMIT 5
    `) as Array<Record<string, unknown>>;

    // 4) Métricas rápidas del día: # pedidos registrados HOY (créditos al asesor),
    //    monto vendido HOY (created_at — coherente con sistema de incentivos).
    const ventasHoy = (await sql`
      SELECT
        COUNT(DISTINCT p.id)::int AS pedidos_hoy,
        COALESCE(SUM(pi.subtotal), 0)::numeric AS monto_hoy
      FROM pedidos p
      LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
      WHERE p.asesor_id = ${userId}::uuid
        AND (p.created_at AT TIME ZONE 'America/Lima')::date = (NOW() AT TIME ZONE 'America/Lima')::date
    `) as Array<{ pedidos_hoy: number; monto_hoy: string | number }>;
    const ventas = ventasHoy[0] ?? { pedidos_hoy: 0, monto_hoy: 0 };

    return NextResponse.json({
      pedidosHoy,
      cobranzas,
      clientesDormidos,
      ventasHoy: {
        pedidos: ventas.pedidos_hoy,
        monto: Number(ventas.monto_hoy),
      },
    });
  } catch (error) {
    console.error("Error GET /api/mi-dia:", error);
    return NextResponse.json({ error: "Error al cargar Mi día" }, { status: 500 });
  }
}

// src/app/api/despacho/asignar-externo/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// POST: Asignar pedido a delivery externo
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const { pedido_id, nombre_delivery } = await req.json();

    if (!pedido_id) {
      return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    await sql`
      UPDATE pedidos
      SET es_delivery_externo = true,
          delivery_externo_nombre = ${nombre_delivery || 'Sin nombre'},
          estado = 'Asignado',
          repartidor_id = NULL
      WHERE id = ${pedido_id}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error asignar externo:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// PATCH: Actualizar estado de pedido externo (Entregado/Fallido)
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const { pedido_id, estado, razon_fallo } = await req.json();

    if (!pedido_id || !estado) {
      return NextResponse.json({ error: "pedido_id y estado requeridos" }, { status: 400 });
    }

    if (!["Entregado", "Fallido"].includes(estado)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    if (estado === "Entregado") {
      await sql`
        UPDATE pedidos
        SET estado = 'Entregado',
            entregado = true,
            entregado_at = NOW()
        WHERE id = ${pedido_id}
      `;
    } else {
      await sql`
        UPDATE pedidos
        SET estado = 'Fallido',
            razon_fallo = ${razon_fallo || 'Fallido (delivery externo)'}
        WHERE id = ${pedido_id}
      `;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error actualizar externo:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE: Desasignar de delivery externo (devolver a pendientes)
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const { pedido_id } = await req.json();

    if (!pedido_id) {
      return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    await sql`
      UPDATE pedidos
      SET es_delivery_externo = false,
          delivery_externo_nombre = NULL,
          estado = 'Pendiente',
          repartidor_id = NULL
      WHERE id = ${pedido_id}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error desasignar externo:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

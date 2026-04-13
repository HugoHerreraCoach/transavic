// src/app/api/pedidos/[id]/entregar/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const EntregarSchema = z.object({
  resultado: z.enum(["Entregado", "Fallido"]),
  razon_fallo: z.string().min(5, "La razón debe tener al menos 5 caracteres.").optional(),
}).refine(
  (data) => data.resultado !== "Fallido" || (data.razon_fallo && data.razon_fallo.length >= 5),
  { message: "Debes indicar la razón por la que no se entregó.", path: ["razon_fallo"] }
);

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2];

    if (!id) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = EntregarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { resultado, razon_fallo } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Verificar que el pedido existe
    const pedidoResult = await sql`
      SELECT id, estado, repartidor_id FROM pedidos WHERE id = ${id}
    `;

    if (pedidoResult.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const pedido = pedidoResult[0];

    // Verificar permisos: debe ser el repartidor asignado o un admin
    if (session.user.role !== "admin" && pedido.repartidor_id !== session.user.id) {
      return NextResponse.json({ error: "Este pedido no está asignado a ti." }, { status: 403 });
    }

    // Permitir entrega desde Asignado (entrega directa) o En_Camino (flujo normal)
    const estadosPermitidos = ["Asignado", "En_Camino", "Pendiente"];
    if (!estadosPermitidos.includes(pedido.estado as string)) {
      return NextResponse.json(
        { error: `No se puede entregar desde estado "${pedido.estado}".` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const entregadoPor = session.user.name || "Desconocido";

    if (resultado === "Entregado") {
      await sql`
        UPDATE pedidos
        SET estado = 'Entregado',
            entregado = TRUE,
            entregado_por = ${entregadoPor},
            entregado_at = ${now},
            razon_fallo = NULL
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE pedidos
        SET estado = 'Fallido',
            entregado = FALSE,
            razon_fallo = ${razon_fallo ?? null},
            entregado_por = ${entregadoPor},
            entregado_at = ${now}
        WHERE id = ${id}
      `;
    }

    return NextResponse.json({
      message: resultado === "Entregado" ? "Pedido entregado exitosamente" : "Pedido marcado como no entregado",
      estado: resultado,
    });
  } catch (error) {
    console.error("Error al entregar pedido:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PATCH: Revertir entrega (deshacer Entregado/Fallido → Asignado)
export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2];

    if (!id) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const pedidoResult = await sql`
      SELECT id, estado, repartidor_id FROM pedidos WHERE id = ${id}
    `;

    if (pedidoResult.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const pedido = pedidoResult[0];

    // Solo admin o el repartidor asignado
    if (session.user.role !== "admin" && pedido.repartidor_id !== session.user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    // Solo se puede revertir Entregado o Fallido
    if (pedido.estado !== "Entregado" && pedido.estado !== "Fallido") {
      return NextResponse.json(
        { error: `Solo se puede revertir desde "Entregado" o "Fallido". Estado actual: "${pedido.estado}"` },
        { status: 400 }
      );
    }

    await sql`
      UPDATE pedidos
      SET estado = 'Asignado',
          entregado = FALSE,
          entregado_por = NULL,
          entregado_at = NULL,
          razon_fallo = NULL,
          inicio_viaje_at = NULL,
          hora_llegada_estimada = NULL
      WHERE id = ${id}
    `;

    return NextResponse.json({
      message: "Entrega revertida. El pedido vuelve a Asignado.",
      estado: "Asignado",
    });
  } catch (error) {
    console.error("Error al revertir entrega:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}


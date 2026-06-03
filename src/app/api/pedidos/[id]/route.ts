// src/app/api/pedidos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { calcularCambios, tocaCamposAuditables } from "@/lib/pedido-historial";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  cliente: z.string().min(1).optional(),
  whatsapp: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  distrito: z.string().optional(),
  tipo_cliente: z.string().optional(),
  detalle: z.string().min(1).optional(),
  hora_entrega: z.string().optional().nullable(),
  razon_social: z.string().optional().nullable(),
  ruc_dni: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  detalle_final: z.string().optional().nullable(),
  empresa: z.string().optional(),
  fecha_pedido: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  // --- Campos de despacho ---
  estado: z.enum(["Pendiente", "En_Produccion", "Listo_Para_Despacho", "Asignado", "En_Camino", "Entregado", "Fallido"]).optional(),
  repartidor_id: z.string().uuid().nullable().optional(),
  orden_ruta: z.number().nullable().optional(),
  razon_fallo: z.string().nullable().optional(),
  // --- Campos legacy ---
  entregado: z.boolean().optional(),
  entregado_por: z.string().optional().nullable(),
  entregado_at: z.string().optional().nullable(),
  // Ítems estructurados (productos del catálogo). Si vienen, REEMPLAZAN los
  // pedido_items del pedido → editar cuenta en el "Resumen del día" y reportes.
  items: z
    .array(
      z.object({
        productoId: z.string().uuid(),
        nombre: z.string().min(1),
        cantidad: z.number().positive(),
        unidad: z.string().min(1),
      })
    )
    .optional(),
});

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Cargar pedido
    const pedidoRows = await sql`
      SELECT p.*, u.name AS asesor_name
      FROM pedidos p
      LEFT JOIN users u ON p.asesor_id = u.id
      WHERE p.id = ${id}
    `;

    if (pedidoRows.length === 0) {
      return NextResponse.json(
        { error: "Pedido no encontrado" },
        { status: 404 }
      );
    }
    const pedido = pedidoRows[0];

    // Verificar permisos: asesor solo puede ver los suyos, repartidor los suyos, admin todos
    if (
      session.user.role !== "admin" &&
      pedido.asesor_id !== session.user.id &&
      pedido.repartidor_id !== session.user.id
    ) {
      return NextResponse.json(
        { error: "No tienes permiso para ver este pedido." },
        { status: 403 }
      );
    }

    // Cargar items del pedido
    const items = await sql`
      SELECT pi.*, prod.codigo
      FROM pedido_items pi
      LEFT JOIN productos prod ON pi.producto_id = prod.id
      WHERE pi.pedido_id = ${id}
    `;

    return NextResponse.json({ pedido, items });
  } catch (error) {
    console.error("Error en API GET:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    // ── Auth: verificar que el usuario esté logueado ──
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // ── Ownership: verificar que el pedido pertenece al usuario (salvo admin) ──
    if (session.user.role !== "admin") {
      const pedidoCheck = await sql`
        SELECT asesor_id, repartidor_id FROM pedidos WHERE id = ${id}
      `;
      if (pedidoCheck.length === 0) {
        return NextResponse.json(
          { error: "Pedido no encontrado" },
          { status: 404 }
        );
      }
      const { asesor_id, repartidor_id } = pedidoCheck[0];
      if (asesor_id !== session.user.id && repartidor_id !== session.user.id) {
        return NextResponse.json(
          { error: "No tienes permiso para modificar este pedido." },
          { status: 403 }
        );
      }
    }

    const body = await request.json();
    const parsedData = UpdateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const dataToUpdate = parsedData.data;

    // `items` (productos del catálogo) NO es columna de `pedidos`: se sincroniza aparte
    // en `pedido_items`. Lo separamos del objeto que arma el UPDATE dinámico de pedidos.
    const itemsToSync = dataToUpdate.items;
    delete (dataToUpdate as { items?: unknown }).items;

    // Sincronizar estado ↔ entregado (backward compatibility)
    if (dataToUpdate.estado) {
      // Si se cambia el estado directamente, sincronizar el boolean
      dataToUpdate.entregado = dataToUpdate.estado === "Entregado";

      if (dataToUpdate.estado === "Entregado" || dataToUpdate.estado === "Fallido") {
        if (!dataToUpdate.entregado_por) {
          const session = await auth();
          dataToUpdate.entregado_por = session?.user?.name || "Desconocido";
        }
        dataToUpdate.entregado_at = new Date().toISOString();
      }

      if (dataToUpdate.estado === "Pendiente") {
        dataToUpdate.entregado_por = null;
        dataToUpdate.entregado_at = null;
        dataToUpdate.razon_fallo = null;
        dataToUpdate.repartidor_id = null;
        dataToUpdate.orden_ruta = null;
      }

      // Si es Fallido, razon_fallo es requerida
      if (dataToUpdate.estado === "Fallido" && !dataToUpdate.razon_fallo) {
        return NextResponse.json(
          { error: "Se requiere una razón para marcar como 'Fallido'." },
          { status: 400 }
        );
      }
    } else if (dataToUpdate.entregado !== undefined) {
      // Legacy: si se usa el boolean, sincronizar con estado
      if (dataToUpdate.entregado === true) {
        dataToUpdate.estado = "Entregado";
        if (!dataToUpdate.entregado_por) {
          const session = await auth();
          dataToUpdate.entregado_por = session?.user?.name || "Desconocido";
        }
        dataToUpdate.entregado_at = new Date().toISOString();
      } else if (dataToUpdate.entregado === false) {
        dataToUpdate.estado = "Pendiente";
        dataToUpdate.entregado_por = null;
        dataToUpdate.entregado_at = null;
        dataToUpdate.razon_fallo = null;
      }
    }

    const updateEntries = Object.entries(dataToUpdate).filter(
      (entry) => entry[1] !== undefined
    );

    if (updateEntries.length === 0 && itemsToSync === undefined) {
      return NextResponse.json(
        { error: "No se proporcionaron campos para actualizar." },
        { status: 400 }
      );
    }

    // ── Auditoría: si este PATCH corrige datos del pedido, leemos los valores
    //    ANTES de actualizar para poder guardar el diff (antes → después). ──
    let antesAuditable: Record<string, unknown> | null = null;
    if (tocaCamposAuditables(dataToUpdate as Record<string, unknown>)) {
      const antesRows = await sql`
        SELECT cliente, whatsapp, direccion, distrito, tipo_cliente, detalle,
               hora_entrega, razon_social, ruc_dni, notas, detalle_final, empresa,
               TO_CHAR(fecha_pedido, 'YYYY-MM-DD') AS fecha_pedido
        FROM pedidos WHERE id = ${id}
      `;
      antesAuditable = (antesRows[0] as Record<string, unknown>) ?? null;
    }

    // Construimos la consulta SET dinámicamente (solo si hay campos de `pedidos`).
    if (updateEntries.length > 0) {
      const setClauses = updateEntries
        .map(([key], index) => `${key} = $${index + 1}`)
        .join(", ");

      const params = updateEntries.map((entry) => entry[1]);
      const query = `UPDATE pedidos SET ${setClauses} WHERE id = $${params.length + 1}`;
      params.push(id);
      await sql.query(query, params);
    }

    // ── Auditoría: guardar el historial de la corrección (no bloqueante: si
    //    el INSERT falla, la edición igual quedó aplicada). ──
    if (antesAuditable) {
      try {
        const cambios = calcularCambios(
          antesAuditable,
          dataToUpdate as Record<string, unknown>
        );
        if (cambios.length > 0) {
          await sql`
            INSERT INTO pedido_ediciones
              (pedido_id, usuario_id, usuario_nombre, usuario_rol, cambios)
            VALUES (
              ${id},
              ${session.user.id ?? null},
              ${session.user.name || "Desconocido"},
              ${session.user.role ?? null},
              ${JSON.stringify(cambios)}::jsonb
            )
          `;
        }
      } catch (e) {
        console.error("No se pudo registrar el historial de edición:", e);
      }
    }

    // ── Sincronizar pedido_items (editor de pedido con selección de productos) ──
    // Si el payload trae `items`, reemplazamos los productos del pedido por los nuevos,
    // con snapshot del precio vigente (igual que al crear). Así editar SÍ cuenta en el
    // "Resumen del día" y los reportes (antes, editar solo el texto libre no se
    // contabilizaba porque no actualizaba pedido_items).
    if (itemsToSync !== undefined) {
      await sql`DELETE FROM pedido_items WHERE pedido_id = ${id}`;
      for (const item of itemsToSync) {
        const productoRow = await sql`
          SELECT precio_venta FROM productos WHERE id = ${item.productoId}
        `;
        const precioUnitario = productoRow[0]?.precio_venta
          ? Number(productoRow[0].precio_venta)
          : null;
        const subtotal =
          precioUnitario !== null
            ? Number((precioUnitario * item.cantidad).toFixed(2))
            : null;
        await sql`
          INSERT INTO pedido_items
            (pedido_id, producto_id, producto_nombre, cantidad, unidad, precio_unitario, subtotal)
          VALUES (${id}, ${item.productoId}, ${item.nombre}, ${item.cantidad}, ${item.unidad}, ${precioUnitario}, ${subtotal})
        `;
      }
    }

    return NextResponse.json(
      { message: "Pedido actualizado exitosamente" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error en API PATCH:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    // ── Auth: verificar que el usuario esté logueado ──
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    // ── Rol: SOLO el admin puede eliminar pedidos. Las asesoras corrigen con
    //    "Editar" (queda en el historial), pero no borran; el repartidor tampoco. ──
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un administrador puede eliminar pedidos." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    const result = await sql`
      DELETE FROM pedidos
      WHERE id = ${id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Pedido no encontrado para eliminar" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "Pedido eliminado exitosamente" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error en API DELETE:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

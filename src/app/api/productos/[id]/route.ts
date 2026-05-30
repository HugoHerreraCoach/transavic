// src/app/api/productos/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no está definida");

    const body = await request.json();
    const sql = neon(connectionString);

    // Catálogo unificado (mayo 2026): el PATCH ahora acepta también precio_venta,
    // precio_compra y codigo desde la misma vista, evitando hablar con /api/precios
    // por separado. Si cambian precios, también insertamos un registro en el
    // histórico `precios_productos` para mantener la auditoría que tenía
    // /api/precios/[id] (cuándo cambió, quién lo cambió, valor anterior).
    const cambioPrecio = body.precio_venta !== undefined || body.precio_compra !== undefined;

    // Snapshot del estado actual ANTES de actualizar — lo usamos para construir
    // el registro histórico con los valores resultantes (los que vienen + los
    // que no se tocan se preservan de la fila actual).
    let snapshotActual: { precio_venta: string | number | null; precio_compra: string | number | null } | null = null;
    if (cambioPrecio) {
      const rows = (await sql`
        SELECT precio_venta, precio_compra FROM productos WHERE id = ${id} AND activo = TRUE
      `) as Array<{ precio_venta: string | number | null; precio_compra: string | number | null }>;
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Producto no encontrado" },
          { status: 404 }
        );
      }
      snapshotActual = rows[0];
    }

    const updates: string[] = [];
    const values: (string | boolean | number | null)[] = [];
    let paramIdx = 1;

    if (body.nombre !== undefined) {
      updates.push(`nombre = $${paramIdx++}`);
      values.push(body.nombre);
    }
    if (body.categoria !== undefined) {
      updates.push(`categoria = $${paramIdx++}`);
      values.push(body.categoria);
    }
    if (body.unidad !== undefined) {
      updates.push(`unidad = $${paramIdx++}`);
      values.push(body.unidad);
    }
    if (body.activo !== undefined) {
      updates.push(`activo = $${paramIdx++}`);
      values.push(body.activo);
    }
    if (body.codigo !== undefined) {
      // codigo puede venir como string vacío (queremos NULL en ese caso).
      const codigoVal = typeof body.codigo === "string" && body.codigo.trim() === ""
        ? null
        : body.codigo;
      updates.push(`codigo = $${paramIdx++}`);
      values.push(codigoVal);
    }
    if (body.precio_venta !== undefined) {
      // null o número (positivo). Si viene 0 o "" lo guardamos como NULL.
      const v =
        body.precio_venta === null || body.precio_venta === "" || Number(body.precio_venta) === 0
          ? null
          : Number(body.precio_venta);
      if (v !== null && (Number.isNaN(v) || v < 0)) {
        return NextResponse.json(
          { error: "precio_venta inválido" },
          { status: 400 }
        );
      }
      updates.push(`precio_venta = $${paramIdx++}`);
      values.push(v);
    }
    if (body.precio_compra !== undefined) {
      const v =
        body.precio_compra === null || body.precio_compra === ""
          ? null
          : Number(body.precio_compra);
      if (v !== null && (Number.isNaN(v) || v < 0)) {
        return NextResponse.json(
          { error: "precio_compra inválido" },
          { status: 400 }
        );
      }
      updates.push(`precio_compra = $${paramIdx++}`);
      values.push(v);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    values.push(id);
    const query = `
      UPDATE productos SET ${updates.join(", ")}
      WHERE id = $${paramIdx}
      RETURNING id, nombre, categoria, unidad, activo, codigo, precio_venta, precio_compra
    `;

    const result = await sql.query(query, values);

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    // Histórico de precios (preserva auditoría que tenía /api/precios/[id]):
    // si cambió precio_venta o precio_compra, cerramos el registro vigente
    // anterior e insertamos uno nuevo en precios_productos. Si la operación
    // de histórico falla, NO falla el PATCH — el dato principal ya quedó OK.
    if (cambioPrecio && snapshotActual) {
      const nuevoVenta =
        body.precio_venta !== undefined
          ? body.precio_venta === null || body.precio_venta === "" || Number(body.precio_venta) === 0
            ? null
            : Number(body.precio_venta)
          : (typeof snapshotActual.precio_venta === "string"
              ? Number(snapshotActual.precio_venta)
              : snapshotActual.precio_venta);
      const nuevaCompra =
        body.precio_compra !== undefined
          ? body.precio_compra === null || body.precio_compra === ""
            ? null
            : Number(body.precio_compra)
          : (typeof snapshotActual.precio_compra === "string"
              ? Number(snapshotActual.precio_compra)
              : snapshotActual.precio_compra);

      try {
        await sql`
          UPDATE precios_productos
          SET vigente_hasta = (NOW() AT TIME ZONE 'America/Lima')::date
          WHERE producto_id = ${id} AND vigente_hasta IS NULL
        `;
        // precio_venta NULL en el histórico no tiene sentido (no se vende).
        // Si quedó NULL, simplemente no abrimos un nuevo registro vigente.
        if (nuevoVenta !== null && nuevoVenta > 0) {
          await sql`
            INSERT INTO precios_productos (producto_id, precio_compra, precio_venta, created_by)
            VALUES (${id}, ${nuevaCompra ?? null}, ${nuevoVenta}, ${session.user.id})
          `;
        }
      } catch (histErr) {
        console.error(
          "PATCH /api/productos/[id]: no se pudo registrar histórico de precios (no crítico):",
          histErr
        );
      }
    }

    return NextResponse.json({ data: result[0] });
  } catch (error) {
    console.error("Error al actualizar producto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no está definida");

    const sql = neon(connectionString);

    // Soft delete: mark as inactive
    const result = await sql`
      UPDATE productos SET activo = FALSE WHERE id = ${id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "Producto desactivado" });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}

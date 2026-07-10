// src/app/api/compras/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CompraItemSchema = z.object({
  producto_id: z.string().uuid(),
  jabas: z.number().int().nonnegative(),
  peso_bruto: z.number().positive(),
  peso_tara: z.number().nonnegative(),
  costo_unitario: z.number().nonnegative(),
  // 'devolucion' = mercadería que se le devuelve al proveedor en esta guía:
  // RESTA del total (deuda) y del inventario (decisión Hugo/Nelita, 9 jul 2026).
  tipo: z.enum(["ingreso", "devolucion"]).default("ingreso"),
});

// Un producto de categoría "servicio" (ej. "Pelada de pollo", "ENVIO") es un cargo
// del proveedor, no mercadería: suma a la deuda pero NUNCA toca inventario.
const esCategoriaServicio = (categoria: string | null | undefined) =>
  /servicio/i.test(categoria ?? "");

const CompraSchema = z.object({
  proveedor_id: z.string().uuid(),
  fecha: z.string(),
  tipo_doc: z.string(),
  nro_doc: z.string().min(1, { message: "El número de documento es requerido" }),
  items: z.array(CompraItemSchema).min(1, { message: "Debe ingresar al menos un producto" }),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // ?ultimos_costos=<proveedor_id> → último costo pagado por producto a ese
    // proveedor (para precargar el costo al registrar la carga de la madrugada).
    const proveedorCostos = req.nextUrl.searchParams.get("ultimos_costos");
    if (proveedorCostos) {
      const costos = await sql`
        SELECT DISTINCT ON (ci.producto_id)
               ci.producto_id, ci.costo_unitario
        FROM compra_items ci
        JOIN compras c ON ci.compra_id = c.id
        WHERE c.proveedor_id = ${proveedorCostos}
        ORDER BY ci.producto_id, c.fecha DESC, c.created_at DESC
      `;
      return NextResponse.json(
        costos.map((r) => ({ producto_id: r.producto_id, costo_unitario: Number(r.costo_unitario) }))
      );
    }

    // Obtener compras con información del proveedor
    const compras = await sql`
      SELECT 
        c.id, c.fecha, c.tipo_doc, c.nro_doc, c.estado, c.subtotal, c.igv, c.total, c.created_at,
        p.razon_social AS proveedor_nombre,
        p.ruc AS proveedor_ruc,
        u.name AS registrado_por
      FROM compras c
      JOIN proveedores p ON c.proveedor_id = p.id
      LEFT JOIN users u ON c.created_by = u.id
      ORDER BY c.fecha DESC, c.created_at DESC
      LIMIT 100
    `;

    // Obtener los items detallados de cada compra
    const items = await sql`
      SELECT
        ci.id, ci.compra_id, ci.producto_id, prod.nombre as producto_nombre,
        ci.jabas, ci.peso_bruto, ci.peso_tara, ci.peso_neto, ci.costo_unitario, ci.subtotal,
        ci.tipo
      FROM compra_items ci
      JOIN productos prod ON ci.producto_id = prod.id
    `;

    // Mapear items a sus respectivas compras
    const comprasConItems = compras.map(compra => ({
      ...compra,
      items: items.filter(item => item.compra_id === compra.id)
    }));

    return NextResponse.json(comprasConItems);
  } catch (error: unknown) {
    console.error("Error al obtener compras:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const result = CompraSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { proveedor_id, fecha, tipo_doc, nro_doc, items } = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // Categorías de los productos de la guía (server-side autoritativo): decide qué
    // filas son SERVICIO (no tocan inventario) sin confiar en lo que mande la UI.
    const idsProductos = [...new Set(items.map((i) => i.producto_id))];
    const categoriasRows = (await sql`
      SELECT id, categoria FROM productos WHERE id = ANY(${idsProductos}::uuid[])
    `) as Array<{ id: string; categoria: string | null }>;
    const categoriaPorProducto = new Map(
      categoriasRows.map((r) => [r.id, r.categoria])
    );
    if (categoriasRows.length !== idsProductos.length) {
      return NextResponse.json(
        { error: "Hay un producto que ya no existe en el catálogo. Recarga la página." },
        { status: 400 }
      );
    }

    // Calcular montos de cada item y sumas totales. El peso se guarda POSITIVO;
    // el signo vive en `tipo`: una devolución resta su subtotal del total de la guía.
    let totalAcumulado = 0;
    const itemsProcesados = items.map(item => {
      const servicio = esCategoriaServicio(categoriaPorProducto.get(item.producto_id));
      const peso_neto = Number((item.peso_bruto - item.peso_tara).toFixed(2));
      const signo = item.tipo === "devolucion" ? -1 : 1;
      const subtotalItem = Number((signo * peso_neto * item.costo_unitario).toFixed(2));
      totalAcumulado += subtotalItem;
      return {
        ...item,
        servicio,
        peso_neto,
        subtotalItem
      };
    });
    totalAcumulado = Number(totalAcumulado.toFixed(2));

    // La guía no puede quedar en negativo: la deuda al proveedor nunca es "a favor".
    // (Una devolución pura contra deuda vieja se registra junto con la próxima guía.)
    if (totalAcumulado < 0) {
      return NextResponse.json(
        { error: "Las devoluciones no pueden superar el ingreso de la guía. Regístralas junto con una guía de ingreso mayor." },
        { status: 400 }
      );
    }

    const igvTotal = Number((totalAcumulado - (totalAcumulado / 1.18)).toFixed(2));
    const subtotalTotal = Number((totalAcumulado - igvTotal).toFixed(2));

    // Fecha de vencimiento del pasivo: el PLAZO DE PAGO del proveedor (editable en
    // su ficha; default 30 días). Antes estaba fijo en +30 para todos.
    const provRows = (await sql`
      SELECT COALESCE(plazo_pago_dias, 30)::int AS plazo FROM proveedores WHERE id = ${proveedor_id}
    `) as Array<{ plazo: number }>;
    const plazoDias = provRows[0]?.plazo ?? 30;
    const fechaVencimiento = new Date(fecha);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + plazoDias);
    const fechaVencimientoStr = fechaVencimiento.toISOString().split('T')[0];

    // TODO en UNA transacción: compra + items + inventario + cuenta por pagar.
    // Si cualquier query falla, no queda una compra a medias (ítems sin stock,
    // compra sin pasivo, etc.). El id se genera aquí porque la transacción batch
    // del driver HTTP de Neon no permite encadenar el RETURNING de una query
    // en las siguientes.
    const compraId = crypto.randomUUID();
    await sql.transaction([
      sql`
        INSERT INTO compras (id, proveedor_id, fecha, tipo_doc, nro_doc, subtotal, igv, total, created_by, estado)
        VALUES (${compraId}, ${proveedor_id}, ${fecha}::date, ${tipo_doc}, ${nro_doc}, ${subtotalTotal}, ${igvTotal}, ${totalAcumulado}, ${session.user.id}, 'Completado')
      `,
      ...itemsProcesados.flatMap((item) => [
        sql`
          INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo)
          VALUES (${compraId}, ${item.producto_id}, ${item.jabas}, ${item.peso_bruto}, ${item.peso_tara}, ${item.peso_neto}, ${item.costo_unitario}, ${item.subtotalItem}, ${item.tipo})
        `,
        // Inventario: los SERVICIOS (pelada, flete…) no son mercadería y no tocan
        // stock ni kardex. La devolución RESTA (cantidad negativa, kardex propio).
        ...(!item.servicio
          ? [
              sql`
                INSERT INTO inventario_lotes (producto_id, cantidad)
                VALUES (${item.producto_id}, ${item.tipo === "devolucion" ? -item.peso_neto : item.peso_neto})
                ON CONFLICT (producto_id) DO UPDATE SET
                  cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
                  updated_at = (NOW() AT TIME ZONE 'America/Lima')
              `,
              sql`
                INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, usuario_id, referencia_id)
                VALUES (${item.producto_id}, ${item.tipo === "devolucion" ? -item.peso_neto : item.peso_neto}, ${item.tipo === "devolucion" ? "devolucion_compra" : "compra"}, ${session.user.id}, ${compraId})
              `,
            ]
          : []),
        // El costo real de la última compra pasa a ser el costo del catálogo
        // (rentabilidad deja de depender de un precio_compra desactualizado).
        // Solo filas de INGRESO de mercadería (ni devoluciones ni servicios).
        // La condición costo>0 va en JS: como parámetro SQL comparado con 0,
        // Postgres lo infería INTEGER y un costo con decimales rompía TODO el batch.
        ...(item.costo_unitario > 0 && item.tipo === "ingreso" && !item.servicio
          ? [sql`
              UPDATE productos SET precio_compra = ${item.costo_unitario}
              WHERE id = ${item.producto_id}
            `]
          : []),
      ]),
      // La deuda solo nace si la guía quedó con saldo (>0). Una guía cuyo total
      // quedó en 0 por devoluciones se registra igual, pero sin cuenta por pagar.
      ...(totalAcumulado > 0
        ? [
            sql`
              INSERT INTO cuentas_por_pagar (proveedor_id, compra_id, monto_deuda, monto_pagado, estado, fecha_vencimiento)
              VALUES (${proveedor_id}, ${compraId}, ${totalAcumulado}, 0, 'Pendiente', ${fechaVencimientoStr}::date)
            `,
          ]
        : []),
    ]);

    return NextResponse.json({ success: true, compraId });
  } catch (error: unknown) {
    console.error("Error al registrar compra:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error del servidor" }, { status: 500 });
  }
}

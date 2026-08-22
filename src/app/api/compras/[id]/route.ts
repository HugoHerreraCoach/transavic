// src/app/api/compras/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { esLineaSinPeso } from "@/lib/compras-lineas";
import { consultaBloqueoProveedor } from "@/lib/proveedores/pagos";
import { esViolacionLlaveForanea, mensajeErrorSql } from "@/lib/errores-sql";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const CompraItemSchema = z.object({
  producto_id: z.string().uuid(),
  jabas: z.number().int().nonnegative(),
  peso_bruto: z.number().positive(),
  peso_tara: z.number().nonnegative(),
  costo_unitario: z.number().nonnegative(),
  tipo: z.enum(["ingreso", "devolucion"]).default("ingreso"),
  jabas_macho: z.number().int().nonnegative().optional(),
  jabas_hembra: z.number().int().nonnegative().optional(),
  sueltos_macho: z.number().int().nonnegative().optional(),
  sueltos_hembra: z.number().int().nonnegative().optional(),
});

const CompraSchema = z.object({
  proveedor_id: z.string().uuid(),
  fecha: z.string(),
  tipo_doc: z.string(),
  nro_doc: z.string().min(1, { message: "El número de documento es requerido" }),
  items: z.array(CompraItemSchema).min(1, { message: "Debe ingresar al menos un producto" }),
});

export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID de compra inválido" }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Obtener cabecera de la compra con su monto pagado asociado
    const compras = await sql`
      SELECT c.*, p.razon_social AS proveedor_nombre,
             COALESCE(cxp.monto_pagado, 0)::float8 AS monto_pagado
      FROM compras c
      JOIN proveedores p ON c.proveedor_id = p.id
      LEFT JOIN cuentas_por_pagar cxp ON c.id = cxp.compra_id
      WHERE c.id = ${id}
    `;

    if (compras.length === 0) {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }

    // Obtener los ítems
    const items = await sql`
      SELECT ci.*, prod.nombre AS producto_nombre
      FROM compra_items ci
      JOIN productos prod ON ci.producto_id = prod.id
      WHERE ci.compra_id = ${id}
    `;

    return NextResponse.json({
      ...compras[0],
      items: items.map(item => ({
        ...item,
        jabas: Number(item.jabas),
        peso_bruto: Number(item.peso_bruto),
        peso_tara: Number(item.peso_tara),
        peso_neto: Number(item.peso_neto),
        costo_unitario: Number(item.costo_unitario),
        subtotal: Number(item.subtotal),
        jabas_macho: Number(item.jabas_macho || 0),
        jabas_hembra: Number(item.jabas_hembra || 0),
        sueltos_macho: Number(item.sueltos_macho || 0),
        sueltos_hembra: Number(item.sueltos_hembra || 0),
        total_pollos: Number(item.total_pollos || 0),
      }))
    });
  } catch (error: unknown) {
    console.error("Error al obtener detalle de compra:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID de compra inválido" }, { status: 400 });
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

    const { proveedor_id, fecha, tipo_doc, nro_doc, items: nuevosItems } = result.data;
    const sql = neon(process.env.DATABASE_URL!);

    // 1. Obtener la compra actual
    const comprasRows = await sql`
      SELECT id, proveedor_id, fecha, tipo_doc, nro_doc, estado, total
      FROM compras
      WHERE id = ${id}
    `;

    if (comprasRows.length === 0) {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }

    const compraActual = comprasRows[0];
    if (compraActual.estado === "Anulado") {
      return NextResponse.json({ error: "No se puede editar una compra anulada." }, { status: 409 });
    }

    // 2. Verificar la deuda y pagos aplicados
    const cxpRows = await sql`
      SELECT id, monto_pagado::float8 AS monto_pagado, estado
      FROM cuentas_por_pagar
      WHERE compra_id = ${id}
    `;

    const cpxDeuda = cxpRows[0];
    const tienePagos = cpxDeuda && cpxDeuda.monto_pagado > 0.009;

    // Obtener los ítems anteriores de la base de datos
    const itemsAnteriores = await sql`
      SELECT id, producto_id, jabas::float8 AS jabas, peso_bruto::float8 AS peso_bruto,
             peso_tara::float8 AS peso_tara, peso_neto::float8 AS peso_neto,
             costo_unitario::float8 AS costo_unitario, tipo
      FROM compra_items
      WHERE compra_id = ${id}
    `;

    // 3. Validar si cambiaron ítems físicos cuando ya hay pagos
    if (tienePagos) {
      let cambiaronItems = nuevosItems.length !== itemsAnteriores.length;

      if (!cambiaronItems) {
        for (const nuevo of nuevosItems) {
          const anterior = itemsAnteriores.find(
            (ant) =>
              ant.producto_id === nuevo.producto_id &&
              Math.abs(ant.peso_bruto - nuevo.peso_bruto) < 0.001 &&
              Math.abs(ant.peso_tara - nuevo.peso_tara) < 0.001 &&
              Math.abs(ant.costo_unitario - nuevo.costo_unitario) < 0.001 &&
              ant.tipo === nuevo.tipo
          );
          if (!anterior) {
            cambiaronItems = true;
            break;
          }
        }
      }

      if (cambiaronItems) {
        return NextResponse.json(
          {
            error: `No se pueden cambiar cantidades o precios de una compra que ya registra abonos (${cpxDeuda.monto_pagado} S/ pagados). Revierte primero los pagos en la Ficha del Proveedor.`,
          },
          { status: 409 }
        );
      }
    }

    // Obtener categorías de productos involucrados en la nueva lista
    const idsProductos = [...new Set(nuevosItems.map((i) => i.producto_id))];
    const categoriasRows = (await sql`
      SELECT id, categoria FROM productos WHERE id = ANY(${idsProductos}::uuid[])
    `) as Array<{ id: string; categoria: string | null }>;
    const categoriaPorProducto = new Map(
      categoriasRows.map((r) => [r.id, r.categoria])
    );

    // Preparar el array de queries de Neon para la transacción atómica
    const queries = [
      // Bloquear al proveedor
      consultaBloqueoProveedor(sql, proveedor_id),
    ];

    if (!tienePagos) {
      // A) Ajustar stock e inventario en memoria primero
      const stockAnterior = new Map<string, number>();
      for (const item of itemsAnteriores) {
        const anteriorCat = categoriaPorProducto.get(item.producto_id);
        const esServicio = esLineaSinPeso(anteriorCat);
        if (esServicio) continue;

        const signo = item.tipo === "devolucion" ? -1 : 1;
        const cantidad = (item.peso_neto) * signo;
        stockAnterior.set(item.producto_id, (stockAnterior.get(item.producto_id) ?? 0) + cantidad);
      }

      const stockNuevo = new Map<string, number>();
      for (const item of nuevosItems) {
        const nuevoCat = categoriaPorProducto.get(item.producto_id);
        const esServicio = esLineaSinPeso(nuevoCat);
        if (esServicio) continue;

        const signo = item.tipo === "devolucion" ? -1 : 1;
        const pesoNeto = Math.max(0, item.peso_bruto - item.peso_tara);
        const cantidad = pesoNeto * signo;
        stockNuevo.set(item.producto_id, (stockNuevo.get(item.producto_id) ?? 0) + cantidad);
      }

      // Obtener todos los productos afectados
      const todosProductos = new Set([...stockAnterior.keys(), ...stockNuevo.keys()]);

      for (const prodId of todosProductos) {
        const ant = stockAnterior.get(prodId) ?? 0;
        const nue = stockNuevo.get(prodId) ?? 0;
        const diferenciaStock = nue - ant;

        if (Math.abs(diferenciaStock) > 0.001) {
          queries.push(
            sql`
              INSERT INTO inventario_lotes (producto_id, cantidad)
              VALUES (${prodId}, ${diferenciaStock})
              ON CONFLICT (producto_id) DO UPDATE SET
                cantidad = inventario_lotes.cantidad + EXCLUDED.cantidad,
                updated_at = (NOW() AT TIME ZONE 'America/Lima')
            `
          );
          queries.push(
            sql`
              INSERT INTO inventario_movimientos (producto_id, cantidad_cambio, tipo, motivo, usuario_id, referencia_id)
              VALUES (${prodId}, ${diferenciaStock}, 'ajuste_compra', 'Edición de la compra', ${session.user.id}, ${id})
            `
          );
        }
      }

      // B) Re-escribir los ítems de compra
      queries.push(
        sql`
          DELETE FROM compra_items
          WHERE compra_id = ${id}
        `
      );

      let nuevoTotalAcumulado = 0;
      for (const item of nuevosItems) {
        const cat = categoriaPorProducto.get(item.producto_id);
        const esServicio = esLineaSinPeso(cat);
        const pesoNeto = esServicio ? item.peso_bruto : Math.max(0, item.peso_bruto - item.peso_tara);
        const subtotalItem = pesoNeto * item.costo_unitario;

        const factorSigno = item.tipo === "devolucion" ? -1 : 1;
        nuevoTotalAcumulado += subtotalItem * factorSigno;

        const jMacho = item.jabas_macho || 0;
        const jHembra = item.jabas_hembra || 0;
        const sMacho = item.sueltos_macho || 0;
        const sHembra = item.sueltos_hembra || 0;
        const total_pollos = (jMacho * 7) + sMacho + (jHembra * 9) + sHembra;

        queries.push(
          sql`
            INSERT INTO compra_items (
              compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo,
              jabas_macho, jabas_hembra, sueltos_macho, sueltos_hembra, total_pollos
            )
            VALUES (
              ${id}, ${item.producto_id}, ${item.jabas}, ${item.peso_bruto}, ${item.peso_tara}, ${pesoNeto}, ${item.costo_unitario}, ${subtotalItem}, ${item.tipo},
              ${jMacho}, ${jHembra}, ${sMacho}, ${sHembra}, ${total_pollos}
            )
          `
        );

        if (item.tipo === "ingreso" && item.costo_unitario > 0) {
          queries.push(
            sql`
              UPDATE productos
              SET precio_compra = ${item.costo_unitario}
              WHERE id = ${item.producto_id}
            `
          );
        }
      }

      nuevoTotalAcumulado = Math.max(0, nuevoTotalAcumulado);
      const nuevoSubtotalCabecera = nuevoTotalAcumulado / 1.18;
      const nuevoIgvCabecera = nuevoTotalAcumulado - nuevoSubtotalCabecera;

      queries.push(
        sql`
          UPDATE compras
          SET proveedor_id = ${proveedor_id},
              fecha = ${fecha}::date,
              tipo_doc = ${tipo_doc},
              nro_doc = ${nro_doc},
              subtotal = ${nuevoSubtotalCabecera},
              igv = ${nuevoIgvCabecera},
              total = ${nuevoTotalAcumulado},
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          WHERE id = ${id}
        `
      );

      if (cpxDeuda) {
        if (nuevoTotalAcumulado <= 0.009) {
          queries.push(
            sql`
              DELETE FROM cuentas_por_pagar
              WHERE id = ${cpxDeuda.id}
            `
          );
        } else {
          const dateObj = new Date(fecha);
          dateObj.setDate(dateObj.getDate() + 30);
          const fechaVencimientoStr = dateObj.toISOString().split("T")[0];

          queries.push(
            sql`
              UPDATE cuentas_por_pagar
              SET proveedor_id = ${proveedor_id},
                  monto_deuda = ${nuevoTotalAcumulado},
                  fecha_vencimiento = ${fechaVencimientoStr}::date,
                  updated_at = (NOW() AT TIME ZONE 'America/Lima')
              WHERE id = ${cpxDeuda.id}
            `
          );
        }
      }
    } else {
      // C) Si tiene pagos, solo actualizamos cabecera (tipo_doc, nro_doc, fecha)
      queries.push(
        sql`
          UPDATE compras
          SET fecha = ${fecha}::date,
              tipo_doc = ${tipo_doc},
              nro_doc = ${nro_doc},
              updated_at = (NOW() AT TIME ZONE 'America/Lima')
          WHERE id = ${id}
        `
      );

      if (cpxDeuda) {
        const dateObj = new Date(fecha);
        dateObj.setDate(dateObj.getDate() + 30);
        const fechaVencimientoStr = dateObj.toISOString().split("T")[0];

        queries.push(
          sql`
            UPDATE cuentas_por_pagar
            SET fecha_vencimiento = ${fechaVencimientoStr}::date,
                updated_at = (NOW() AT TIME ZONE 'America/Lima')
            WHERE id = ${cpxDeuda.id}
          `
        );
      }
    }

    // Ejecutar todas las transacciones generadas de forma segura
    await sql.transaction(queries);

    return NextResponse.json({ success: true, message: "Compra actualizada correctamente." });
  } catch (error: unknown) {
    console.error("Error al actualizar la compra:", error);
    return NextResponse.json(
      { error: mensajeErrorSql(error, "No se pudo guardar la compra.") },
      { status: esViolacionLlaveForanea(error) ? 409 : 500 }
    );
  }
}

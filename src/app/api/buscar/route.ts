// src/app/api/buscar/route.ts
// Búsqueda global — soporta el atajo Cmd+K / Ctrl+K del dashboard.
//
// Estrategia: query única `?q=<texto>` que devuelve TOP-5 de cada categoría
// (clientes, pedidos, comprobantes) con scoping por rol. La idea es que el
// usuario escriba "matías" o "F001-23" o "20567" y obtenga lo relevante en
// 1 paso sin tener que abrir 3 páginas.
//
// Scoping:
//   - admin: ve todo
//   - asesor: solo sus clientes y los pedidos/comprobantes asociados
//   - repartidor: 403 (no usa el cmd+K — su flujo es /mi-ruta)
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const LIMITE_POR_CATEGORIA = 5;

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const qRaw = (searchParams.get("q") ?? "").trim();
    // Mínimo 2 chars para evitar consultas demasiado caras.
    if (qRaw.length < 2) {
      return NextResponse.json({
        clientes: [],
        pedidos: [],
        comprobantes: [],
      });
    }
    const q = `%${qRaw.replace(/[%_]/g, (m) => "\\" + m)}%`; // escape ILIKE wildcards
    const sql = neon(process.env.DATABASE_URL!);
    const userId = session.user.id;
    const esAdmin = role === "admin";

    // Ejecutamos en paralelo — son queries independientes.
    const [clientes, pedidos, comprobantes] = await Promise.all([
      // CLIENTES — match en nombre, razón social o ruc/dni.
      esAdmin
        ? sql`
            SELECT id, nombre, ruc_dni, distrito, whatsapp
            FROM clientes
            WHERE nombre ILIKE ${q}
               OR razon_social ILIKE ${q}
               OR ruc_dni ILIKE ${q}
            ORDER BY nombre ASC
            LIMIT ${LIMITE_POR_CATEGORIA}
          `
        : sql`
            SELECT id, nombre, ruc_dni, distrito, whatsapp
            FROM clientes
            WHERE asesor_id = ${userId}::uuid
              AND (nombre ILIKE ${q}
                   OR razon_social ILIKE ${q}
                   OR ruc_dni ILIKE ${q})
            ORDER BY nombre ASC
            LIMIT ${LIMITE_POR_CATEGORIA}
          `,
      // PEDIDOS — match en cliente, detalle o id corto.
      // "id corto" = los primeros 8 chars del UUID que mostramos en la UI.
      esAdmin
        ? sql`
            SELECT id, cliente, detalle, estado, empresa, created_at,
              TO_CHAR(fecha_pedido, 'DD/MM/YYYY') AS fecha_pedido
            FROM pedidos
            WHERE cliente ILIKE ${q}
               OR detalle ILIKE ${q}
               OR LEFT(id::text, 8) ILIKE ${q}
            ORDER BY created_at DESC
            LIMIT ${LIMITE_POR_CATEGORIA}
          `
        : sql`
            SELECT id, cliente, detalle, estado, empresa, created_at,
              TO_CHAR(fecha_pedido, 'DD/MM/YYYY') AS fecha_pedido
            FROM pedidos
            WHERE asesor_id = ${userId}::uuid
              AND (cliente ILIKE ${q}
                   OR detalle ILIKE ${q}
                   OR LEFT(id::text, 8) ILIKE ${q})
            ORDER BY created_at DESC
            LIMIT ${LIMITE_POR_CATEGORIA}
          `,
      // COMPROBANTES — match en serie_numero o cliente_razon_social o doc.
      // La asesora solo ve los comprobantes de sus pedidos.
      esAdmin
        ? sql`
            SELECT id, serie_numero, tipo, empresa, estado, monto_total,
              cliente_razon_social, cliente_doc_num, created_at
            FROM comprobantes
            WHERE serie_numero ILIKE ${q}
               OR cliente_razon_social ILIKE ${q}
               OR cliente_doc_num ILIKE ${q}
            ORDER BY created_at DESC
            LIMIT ${LIMITE_POR_CATEGORIA}
          `
        : sql`
            SELECT c.id, c.serie_numero, c.tipo, c.empresa, c.estado, c.monto_total,
              c.cliente_razon_social, c.cliente_doc_num, c.created_at
            FROM comprobantes c
            WHERE c.pedido_id IN (
                    SELECT id FROM pedidos WHERE asesor_id = ${userId}::uuid
                  )
              AND (c.serie_numero ILIKE ${q}
                   OR c.cliente_razon_social ILIKE ${q}
                   OR c.cliente_doc_num ILIKE ${q})
            ORDER BY c.created_at DESC
            LIMIT ${LIMITE_POR_CATEGORIA}
          `,
    ]);

    return NextResponse.json({
      clientes,
      pedidos,
      comprobantes,
    });
  } catch (error) {
    console.error("Error GET /api/buscar:", error);
    return NextResponse.json({ error: "Error al buscar" }, { status: 500 });
  }
}

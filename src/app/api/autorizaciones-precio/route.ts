// src/app/api/autorizaciones-precio/route.ts
// GET  — admin: todas; asesora: las suyas. ?estado=pendiente|aprobada|rechazada
// POST — solo asesora: crea solicitud de precio mínimo + notifica al admin.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { crearNotificacion } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

const ItemSchema = z.object({
  nombre: z.string().min(1),
  precio_solicitado: z.number().positive(),
  precio_minimo: z.number().positive(),
  cantidad: z.number().positive(),
  codigo: z.string().optional(),
  unidad: z.string().optional(),
});

const ClienteSchema = z.object({
  numDocumento: z.string().optional(),
  razonSocial: z.string().optional(),
});

const CreateSchema = z.object({
  tipo: z.enum(["01", "03"]),
  empresa: z.enum(["transavic", "avicola"]),
  items: z.array(ItemSchema).min(1),
  razon: z.string().trim().max(500).optional(),
  cliente: ClienteSchema.optional(),
});

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "asesor"].includes(session.user.role)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const { searchParams } = new URL(request.url);
    const estado = searchParams.get("estado")?.trim() || null;

    let rows;
    if (session.user.role === "admin") {
      rows = estado
        ? await sql`
            SELECT * FROM autorizaciones_precio
            WHERE estado = ${estado}
            ORDER BY created_at DESC
          `
        : await sql`
            SELECT * FROM autorizaciones_precio
            ORDER BY created_at DESC
          `;
    } else {
      rows = estado
        ? await sql`
            SELECT * FROM autorizaciones_precio
            WHERE asesora_id = ${session.user.id} AND estado = ${estado}
            ORDER BY created_at DESC
          `
        : await sql`
            SELECT * FROM autorizaciones_precio
            WHERE asesora_id = ${session.user.id}
            ORDER BY created_at DESC
          `;
    }

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error GET /api/autorizaciones-precio:", error);
    return NextResponse.json({ error: "Error al obtener autorizaciones" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "asesor") {
      return NextResponse.json(
        { error: "Solo las asesoras pueden solicitar autorizaciones de precio" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const { tipo, empresa, items, razon, cliente } = parsed.data;
    const asesoraId = session.user.id;
    const asesoraNombre = session.user.name?.trim() || "Asesora";

    const tipoLabel: Record<string, string> = { "01": "Factura", "03": "Boleta" };
    const empresaLabel: Record<string, string> = {
      transavic: "Transavic",
      avicola: "Avícola de Tony",
    };

    const clienteJson =
      cliente && (cliente.numDocumento || cliente.razonSocial)
        ? JSON.stringify(cliente)
        : null;

    const result = (await sql`
      INSERT INTO autorizaciones_precio
        (asesora_id, asesora_nombre, tipo, empresa, items_json, razon, cliente_json, estado)
      VALUES (
        ${asesoraId},
        ${asesoraNombre},
        ${tipo},
        ${empresa},
        ${JSON.stringify(items)},
        ${razon ?? null},
        ${clienteJson},
        'pendiente'
      )
      RETURNING id
    `) as Array<{ id: string }>;

    const autorizacionId = result[0].id;

    // Notificar a todos los admins
    const admins = (await sql`SELECT id FROM users WHERE role = 'admin'`) as Array<{ id: string }>;
    const resumen = items
      .map((it) => `${it.nombre}: S/${it.precio_solicitado.toFixed(2)} (mín. S/${it.precio_minimo.toFixed(2)})`)
      .join(", ");

    for (const admin of admins) {
      await crearNotificacion({
        userId: admin.id,
        tipo: "autorizacion_solicitada",
        titulo: `Solicitud de precio — ${asesoraNombre}`,
        mensaje: `${asesoraNombre} quiere emitir una ${tipoLabel[tipo] ?? tipo} (${empresaLabel[empresa] ?? empresa}) con precio por debajo del mínimo: ${resumen}`,
        link: `/dashboard/autorizaciones`,
      });
    }

    return NextResponse.json({ id: autorizacionId }, { status: 201 });
  } catch (error) {
    console.error("Error POST /api/autorizaciones-precio:", error);
    return NextResponse.json({ error: "Error al crear solicitud" }, { status: 500 });
  }
}

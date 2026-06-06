// src/app/api/pedidos/[id]/guia-firmada/route.ts
// POST — recibir foto de guía firmada y guardarla como base64 en la DB.
// GET  — devolver la imagen para descargar/visualizar.
// Decisión: sin storage externo ($0 costo). 30 pedidos/día × ~200KB = ~6MB/día, manejable.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crearNotificacion } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const VALID_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const pedidoId = segments[segments.length - 2];
    if (!pedidoId) {
      return NextResponse.json(
        { error: "ID del pedido no encontrado" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("foto");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No se envió un archivo válido" },
        { status: 400 }
      );
    }

    const mime = file.type || "image/jpeg";
    if (!VALID_MIMES.includes(mime)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido: ${mime}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `Archivo muy grande (${(file.size / 1024 / 1024).toFixed(2)} MB). Máximo permitido: ${MAX_SIZE_BYTES / 1024 / 1024} MB`,
        },
        { status: 400 }
      );
    }

    // Convertir a base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const sql = neon(process.env.DATABASE_URL!);

    // Verificar permisos: admin pasa; repartidor SOLO si está asignado a este
    // pedido; asesor SOLO si el pedido es de su cartera.
    if (session.user.role !== "admin") {
      const ownership = (await sql`
        SELECT repartidor_id, asesor_id FROM pedidos WHERE id = ${pedidoId}::uuid
      `) as Array<{ repartidor_id: string | null; asesor_id: string | null }>;
      if (ownership.length === 0) {
        return NextResponse.json(
          { error: "Pedido no encontrado" },
          { status: 404 }
        );
      }
      const o = ownership[0];
      const userId = session.user.id;
      const esRepartidorAsignado =
        session.user.role === "repartidor" && o.repartidor_id === userId;
      const esAsesoraDueña =
        session.user.role === "asesor" && o.asesor_id === userId;
      if (!esRepartidorAsignado && !esAsesoraDueña) {
        return NextResponse.json(
          { error: "No tienes permiso para subir foto de este pedido" },
          { status: 403 }
        );
      }
    }

    await sql`
      UPDATE pedidos
      SET guia_firmada_data = ${base64},
          guia_firmada_mime = ${mime},
          guia_firmada_at = NOW()
      WHERE id = ${pedidoId}
    `;

    // Avisar a la asesora que la guía firmada quedó registrada (campanita).
    const info = (await sql`
      SELECT cliente, asesor_id FROM pedidos WHERE id = ${pedidoId}
    `) as Array<{ cliente: string | null; asesor_id: string | null }>;
    if (info.length > 0 && info[0].asesor_id) {
      await crearNotificacion({
        userId: info[0].asesor_id,
        tipo: "guia_firmada",
        titulo: "Orden firmada recibida",
        mensaje: `${info[0].cliente ?? "Pedido"} — se subió la foto de la orden firmada.`,
        link: "/dashboard",
        pedidoId,
      });
    }

    return NextResponse.json({
      message: "Orden firmada subida",
      size: file.size,
      url: `/api/pedidos/${pedidoId}/guia-firmada`,
    });
  } catch (error) {
    console.error("Error en POST /api/pedidos/[id]/guia-firmada:", error);
    return NextResponse.json(
      { error: "Error al subir la foto" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const pedidoId = segments[segments.length - 2];
    if (!pedidoId || !/^[0-9a-f-]{36}$/i.test(pedidoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const { role, id: userId } = session.user;

    // Repartidor nunca puede eliminar fotos
    if (role === "repartidor") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Admin pasa; asesora solo si el pedido es de su cartera
    if (role !== "admin") {
      const rows = await sql`SELECT asesor_id FROM pedidos WHERE id = ${pedidoId}::uuid`;
      if (rows.length === 0) {
        return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
      }
      if (rows[0].asesor_id !== userId) {
        return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
      }
    }

    await sql`
      UPDATE pedidos
      SET guia_firmada_data = NULL,
          guia_firmada_mime = NULL,
          guia_firmada_at   = NULL
      WHERE id = ${pedidoId}::uuid
    `;

    return NextResponse.json({ message: "Foto eliminada" });
  } catch (error) {
    console.error("Error en DELETE /api/pedidos/[id]/guia-firmada:", error);
    return NextResponse.json({ error: "Error al eliminar la foto" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const pedidoId = segments[segments.length - 2];
    if (!pedidoId || !/^[0-9a-f-]{36}$/i.test(pedidoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Privacy boundary en GET: admin ve cualquiera; repartidor solo SUS pedidos;
    // asesor solo pedidos de SU cartera.
    const role = session.user.role;
    const userId = session.user.id;
    const rows = (role === "admin"
      ? ((await sql`
          SELECT guia_firmada_data, guia_firmada_mime
          FROM pedidos
          WHERE id = ${pedidoId}::uuid
        `) as unknown)
      : role === "repartidor"
        ? ((await sql`
            SELECT guia_firmada_data, guia_firmada_mime
            FROM pedidos
            WHERE id = ${pedidoId}::uuid AND repartidor_id = ${userId}::uuid
          `) as unknown)
        : role === "asesor"
          ? ((await sql`
              SELECT guia_firmada_data, guia_firmada_mime
              FROM pedidos
              WHERE id = ${pedidoId}::uuid AND asesor_id = ${userId}::uuid
            `) as unknown)
          : []) as Array<{
      guia_firmada_data: string | null;
      guia_firmada_mime: string | null;
    }>;
    if (rows.length === 0 || !rows[0].guia_firmada_data) {
      return NextResponse.json(
        { error: "Esta orden todavía no fue firmada" },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(rows[0].guia_firmada_data as string, "base64");
    const mime = (rows[0].guia_firmada_mime as string) || "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error en GET /api/pedidos/[id]/guia-firmada:", error);
    return NextResponse.json(
      { error: "Error al obtener la foto" },
      { status: 500 }
    );
  }
}

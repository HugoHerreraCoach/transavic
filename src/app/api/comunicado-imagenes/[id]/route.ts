// src/app/api/comunicado-imagenes/[id]/route.ts
// GET — sirve la imagen binaria de un comunicado validando permisos del usuario (admin o destinatario)
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID de imagen inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Obtener la imagen e información del comunicado asociado
    const rows = (await sql`
      SELECT ci.imagen_base64, ci.imagen_mime, c.destinatarios
      FROM comunicado_imagenes ci
      JOIN comunicados c ON c.id = ci.comunicado_id
      WHERE ci.id = ${id}::uuid
      LIMIT 1
    `) as Array<{
      imagen_base64: string;
      imagen_mime: string;
      destinatarios: string[]; // UUID strings
    }>;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
    }

    const row = rows[0];

    // Verificar permisos
    const userRole = session.user.role;
    const userId = session.user.id;

    if (userRole !== "admin") {
      const isRecipient = row.destinatarios && row.destinatarios.includes(userId);
      if (!isRecipient) {
        return NextResponse.json({ error: "No autorizado a ver esta imagen" }, { status: 403 });
      }
    }

    // Convertir de base64 a buffer binario
    const buffer = Buffer.from(row.imagen_base64, "base64");
    const mime = row.imagen_mime || "image/webp";
    const ext = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpg";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="comunicado-imagen-${id}.${ext}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600", // Cachear por 1 hora
      },
    });
  } catch (error) {
    console.error("Error GET /api/comunicado-imagenes/[id]:", error);
    return NextResponse.json({ error: "Error al cargar la imagen" }, { status: 500 });
  }
}

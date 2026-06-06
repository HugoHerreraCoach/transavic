// src/app/api/pago-imagenes/[id]/route.ts
// GET  — sirve una imagen de pago individual por su UUID estable.
// DELETE — elimina esa imagen individual (asesora solo las suyas; admin cualquiera).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

async function resolverImagen(imgId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT pi.imagen_base64, pi.imagen_mime, pi.orden,
           f.asesor_id
    FROM pago_imagenes pi
    JOIN facturas f ON f.id = pi.factura_id
    WHERE pi.id = ${imgId}::uuid
    LIMIT 1
  `) as Array<{
    imagen_base64: string;
    imagen_mime: string;
    orden: number;
    asesor_id: string | null;
  }>;
  return { sql, img: rows[0] ?? null };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const imgId = url.pathname.split("/").pop() ?? "";
  if (!imgId || !/^[0-9a-f-]{36}$/i.test(imgId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { img } = await resolverImagen(imgId);
  if (!img) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }
  if (session.user.role !== "admin" && img.asesor_id !== session.user.id) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const buffer = Buffer.from(img.imagen_base64, "base64");
  const mime = img.imagen_mime || "image/webp";
  const ext = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpg";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="captura-pago-${imgId}.${ext}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const imgId = url.pathname.split("/").pop() ?? "";
    if (!imgId || !/^[0-9a-f-]{36}$/i.test(imgId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const { sql, img } = await resolverImagen(imgId);
    if (!img) {
      return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
    }
    if (session.user.role !== "admin" && img.asesor_id !== session.user.id) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    await sql`DELETE FROM pago_imagenes WHERE id = ${imgId}::uuid`;

    return NextResponse.json({ message: "Captura eliminada" });
  } catch (error) {
    console.error("Error en DELETE /api/pago-imagenes/[id]:", error);
    return NextResponse.json({ error: "Error al eliminar captura" }, { status: 500 });
  }
}

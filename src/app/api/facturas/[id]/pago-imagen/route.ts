// src/app/api/facturas/[id]/pago-imagen/route.ts
// Sirve la captura de pago (primera imagen por defecto).
// Acepta ?index=N (0-based) para imágenes adicionales.
// Lee de pago_imagenes primero; fallback a facturas.pago_img_base64 para registros
// migrados antes de la tabla nueva.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  // /api/facturas/[id]/pago-imagen → id en posición -2
  const id = segments[segments.length - 2];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const index = Math.max(0, parseInt(url.searchParams.get("index") ?? "0", 10) || 0);

  const sql = neon(process.env.DATABASE_URL!);

  // Verificar ownership.
  const rows = (await sql`
    SELECT asesor_id, pago_img_base64, pago_img_mime
    FROM facturas WHERE id = ${id}::uuid LIMIT 1
  `) as Array<{
    asesor_id: string | null;
    pago_img_base64: string | null;
    pago_img_mime: string | null;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Cobranza no encontrada" }, { status: 404 });
  }
  if (session.user.role !== "admin" && rows[0].asesor_id !== session.user.id) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  // Buscar en la tabla nueva primero.
  const imgs = (await sql`
    SELECT imagen_base64, imagen_mime
    FROM pago_imagenes
    WHERE factura_id = ${id}::uuid
    ORDER BY orden
    LIMIT 1 OFFSET ${index}
  `) as Array<{ imagen_base64: string; imagen_mime: string }>;

  let base64: string | null = null;
  let mime = "image/webp";

  if (imgs.length > 0) {
    base64 = imgs[0].imagen_base64;
    mime = imgs[0].imagen_mime;
  } else if (index === 0 && rows[0].pago_img_base64) {
    // Fallback a columna legacy (registros muy viejos sin migrar).
    base64 = rows[0].pago_img_base64;
    mime = rows[0].pago_img_mime || "image/webp";
  }

  if (!base64) {
    return NextResponse.json({ error: "Captura no encontrada." }, { status: 404 });
  }

  const buffer = Buffer.from(base64, "base64");
  const ext = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpg";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="comprobante-pago-${id}-${index}.${ext}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=60",
    },
  });
}

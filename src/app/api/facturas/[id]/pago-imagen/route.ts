// src/app/api/facturas/[id]/pago-imagen/route.ts
// Sirve la captura del comprobante de pago (guardada en base64 en `facturas`).
// Permite VER y DESCARGAR la imagen del pago, vinculada a la cobranza (y a su pedido).
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

  const sql = neon(process.env.DATABASE_URL!);
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
  const f = rows[0];

  // Ownership: asesor solo la suya; admin cualquiera (igual que el endpoint de pago).
  if (session.user.role !== "admin" && f.asesor_id !== session.user.id) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  if (!f.pago_img_base64) {
    return NextResponse.json({ error: "Esta cobranza no tiene captura de pago." }, { status: 404 });
  }

  const buffer = Buffer.from(f.pago_img_base64, "base64");
  const mime = f.pago_img_mime || "image/webp";
  const ext = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpg";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="comprobante-pago-${id}.${ext}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=60",
    },
  });
}

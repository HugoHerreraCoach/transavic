// src/app/api/cobranzas-planta/abonos/[id]/comprobante/route.ts
// GET — servir la foto del comprobante de un abono de planta (imagen binaria).
// Patrón de /api/avicola/abonos/[id]/comprobante: base64 en DB → Buffer + Content-Type.
// admin + produccion (el POS/planta lo operan los dos).
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const rows = (await sql`
      SELECT comprobante_data, comprobante_mime
      FROM abonos_planta
      WHERE id = ${id}
    `) as Array<{
      comprobante_data: string | null;
      comprobante_mime: string | null;
    }>;

    if (rows.length === 0 || !rows[0].comprobante_data) {
      return NextResponse.json(
        { error: "Este abono no tiene comprobante" },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(rows[0].comprobante_data, "base64");
    const mime = rows[0].comprobante_mime || "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    console.error("Error al obtener comprobante de abono de planta:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}

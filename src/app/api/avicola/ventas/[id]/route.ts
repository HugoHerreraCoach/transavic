// src/app/api/avicola/ventas/[id]/route.ts
// GET: guía completa de una venta del módulo Clientes Avícola (admin-only).
// Devuelve 200 { guia: GuiaAvicolaData } o 404 si la venta no existe.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guiaDeVenta } from "@/lib/avicola/guia";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await params;
  // Un id que no es UUID no puede existir (y rompería el cast en Postgres).
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const guia = await guiaDeVenta(sql, id);
    if (!guia) {
      return NextResponse.json(
        { error: "Venta no encontrada." },
        { status: 404 }
      );
    }
    return NextResponse.json({ guia });
  } catch (error) {
    console.error("Error al obtener la guía de la venta avícola:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

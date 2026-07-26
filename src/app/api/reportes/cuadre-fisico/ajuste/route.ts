// src/app/api/reportes/cuadre-fisico/ajuste/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const SaveAjusteSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX),
  producto_id: z.string().uuid(),
  kilos_ajuste: z.number(),
  motivo: z.string().min(3, { message: "El motivo debe tener al menos 3 caracteres" }),
});

const DeleteAjusteSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX),
  producto_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validation = SaveAjusteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { fecha, producto_id, kilos_ajuste, motivo } = validation.data;
    const usuario_id = session.user.id;

    const sql = neon(process.env.DATABASE_URL!);

    // Insertar o actualizar usando ON CONFLICT
    await sql`
      INSERT INTO public.ajustes_cuadre_fisico (fecha, producto_id, kilos_ajuste, motivo, usuario_id)
      VALUES (${fecha}::date, ${producto_id}::uuid, ${kilos_ajuste}, ${motivo}, ${usuario_id}::uuid)
      ON CONFLICT (fecha, producto_id)
      DO UPDATE SET 
        kilos_ajuste = EXCLUDED.kilos_ajuste,
        motivo = EXCLUDED.motivo,
        usuario_id = EXCLUDED.usuario_id,
        created_at = (NOW() AT TIME ZONE 'America/Lima')
    `;

    return NextResponse.json({ message: "Ajuste guardado correctamente" });
  } catch (error) {
    console.error("Error al guardar ajuste de cuadre físico:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const queryParams = {
      fecha: searchParams.get("fecha"),
      producto_id: searchParams.get("producto_id"),
    };

    const validation = DeleteAjusteSchema.safeParse(queryParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Parámetros inválidos", details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { fecha, producto_id } = validation.data;

    const sql = neon(process.env.DATABASE_URL!);

    await sql`
      DELETE FROM public.ajustes_cuadre_fisico
      WHERE fecha = ${fecha}::date AND producto_id = ${producto_id}::uuid
    `;

    return NextResponse.json({ message: "Ajuste eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar ajuste de cuadre físico:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

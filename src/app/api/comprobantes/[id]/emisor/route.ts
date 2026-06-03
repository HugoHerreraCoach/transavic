// src/app/api/comprobantes/[id]/emisor/route.ts
// PATCH { asesorId: string|null } — el ADMIN reasigna la asesora "encargada" de un
// comprobante reescribiendo la columna `emitido_por`.
//
// Por qué funciona la visibilidad: el scoping de `GET /api/comprobantes` (y los
// endpoints por id, vía `lib/comprobante-scope.ts`) deja que una asesora vea un
// comprobante si lo emitió ella — match de `emitido_por` contra su nombre
// (TRIM + lower, por los nombres con espacio — gotcha #11). Así, al poner aquí el
// nombre EXACTO de la asesora, el comprobante le aparece en SU lista. Pasar
// asesorId=null limpia el campo (vuelve a "—": solo el admin lo ve).
//
// Decisión de Antonio (jun 2026): se reescribe `emitido_por` directamente (no hay
// campo separado). Es solo-admin; los comprobantes fiscales (XML/CDR/montos) NO se
// tocan — esto solo cambia a quién se le atribuye/muestra en la lista interna.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  // null = quitar la asignación (deja "Emitido por" vacío).
  asesorId: z.string().uuid().nullable(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Solo el admin reasigna la asesora encargada de un comprobante.
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Solo un administrador puede cambiar la asesora." },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Si viene un asesorId, resolvemos su nombre EXACTO desde la tabla users (debe
  // ser un asesor) para que el match del scoping por nombre funcione. null → limpia.
  let nombre: string | null = null;
  if (parsed.data.asesorId) {
    const rows = (await sql`
      SELECT name FROM users
      WHERE id = ${parsed.data.asesorId}::uuid AND role = 'asesor'
      LIMIT 1
    `) as Array<{ name: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Asesora no encontrada." }, { status: 404 });
    }
    nombre = rows[0].name;
  }

  const upd = (await sql`
    UPDATE comprobantes SET emitido_por = ${nombre} WHERE id = ${id}::uuid RETURNING id
  `) as Array<{ id: string }>;
  if (upd.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, emitidoPor: nombre });
}

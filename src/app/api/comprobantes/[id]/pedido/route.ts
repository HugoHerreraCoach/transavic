// src/app/api/comprobantes/[id]/pedido/route.ts
// PATCH { pedidoId: string|null } — vincula (o desvincula) un comprobante a un pedido.
//
// Para qué: un comprobante emitido SIN pedido (venta de mostrador / factura manual)
// puede vincularse a un pedido existente más tarde. Esto da trazabilidad
// pedido↔comprobante↔cobranza y mejora la atribución de las metas: la vista
// `ventas_facturadas` usa la asesora del pedido como respaldo cuando el comprobante
// no tiene un `emitido_por` que matchee. pedidoId=null desvincula.
//
// Permisos: admin siempre; la asesora solo si puede VER el comprobante (es de su
// pedido o lo emitió ella) Y el pedido destino es suyo. No toca XML/CDR/montos —
// solo el vínculo interno (igual que el endpoint de `emisor`).

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";

export const dynamic = "force-dynamic";

const Schema = z.object({
  // null = desvincular (deja el comprobante sin pedido).
  pedidoId: z.string().uuid().nullable(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Detecta la marca de un valor de empresa, tolerando los dos formatos que conviven:
// comprobantes usa el slug ("transavic"/"avicola") y pedidos el nombre
// ("Transavic"/"Avícola de Tony"). Devuelve null si no se reconoce (no bloquea).
function marcaDe(empresa: string | null): "transavic" | "avicola" | null {
  const s = (empresa ?? "").toLowerCase();
  if (s.includes("transavic")) return "transavic";
  if (s.includes("avicola") || s.includes("avícola") || s.includes("tony")) return "avicola";
  return null;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const { pedidoId } = parsed.data;

  const sql = neon(process.env.DATABASE_URL!);

  // Leer el comprobante + la asesora del pedido vinculado (si lo tiene) para el
  // chequeo de permisos de la asesora.
  const comps = (await sql`
    SELECT c.empresa, c.emitido_por, p.asesor_id AS pedido_asesor_id
    FROM comprobantes c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    WHERE c.id = ${id}::uuid
    LIMIT 1
  `) as Array<{
    empresa: string | null;
    emitido_por: string | null;
    pedido_asesor_id: string | null;
  }>;
  if (comps.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado." }, { status: 404 });
  }
  const comp = comps[0];

  // Permisos: admin siempre; asesora solo si puede ver el comprobante.
  const puedeVer = asesoraPuedeVerComprobante(
    session.user.role,
    session.user.id,
    session.user.name,
    { pedidoAsesorId: comp.pedido_asesor_id, emitidoPor: comp.emitido_por }
  );
  if (!puedeVer) {
    return NextResponse.json(
      { error: "No puedes modificar este comprobante." },
      { status: 403 }
    );
  }

  // Si se vincula a un pedido, validar que exista, que sea de la misma empresa, y
  // —si es asesora— que el pedido destino sea suyo.
  if (pedidoId) {
    const peds = (await sql`
      SELECT id, empresa, asesor_id FROM pedidos WHERE id = ${pedidoId}::uuid LIMIT 1
    `) as Array<{ id: string; empresa: string | null; asesor_id: string | null }>;
    if (peds.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
    }
    const ped = peds[0];

    if (session.user.role === "asesor" && ped.asesor_id !== session.user.id) {
      return NextResponse.json(
        { error: "Solo puedes vincular a tus propios pedidos." },
        { status: 403 }
      );
    }

    const mC = marcaDe(comp.empresa);
    const mP = marcaDe(ped.empresa);
    if (mC && mP && mC !== mP) {
      return NextResponse.json(
        { error: "El pedido es de otra empresa que el comprobante." },
        { status: 400 }
      );
    }
  }

  // Vincular/desvincular: el comprobante y, si existe, su cobranza ligada.
  const upd = (await sql`
    UPDATE comprobantes SET pedido_id = ${pedidoId} WHERE id = ${id}::uuid RETURNING id
  `) as Array<{ id: string }>;
  if (upd.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado." }, { status: 404 });
  }
  // La cobranza ligada a este comprobante sigue al mismo pedido (trazabilidad).
  await sql`
    UPDATE facturas SET pedido_id = ${pedidoId} WHERE comprobante_id = ${id}::uuid
  `;

  return NextResponse.json({ ok: true, pedidoId });
}

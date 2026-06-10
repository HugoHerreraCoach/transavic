// src/app/api/guias/[id]/route.ts
// GET — obtener detalles de una Guía de Remisión específica.
// `id` puede ser el ID de la guía o un pedido_id (igual que /pedidos/[id]/gre).
// Devuelve además `impresion` (ítems, punto de llegada, M1/L, comprobante
// relacionado) para que el cliente genere el PDF descargable (pdf-guia.ts).

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";
import { parseDespatchItems, parseGuiaPuntoLlegada } from "@/lib/sunat/parse-cpe-items";
import { obtenerDistritoPorUbigeo } from "@/lib/sunat/ubigeos";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Cargar la guía (por id propio o por pedido_id) con su asesor para permisos,
    // el comprobante relacionado y la dirección de entrega del pedido.
    const rows = await sql`
      SELECT c.*,
             p.asesor_id AS pedido_asesor_id,
             p.cliente AS pedido_cliente,
             p.direccion AS pedido_direccion,
             p.distrito AS pedido_distrito,
             ref_c.serie_numero AS ref_serie_numero,
             ref_c.tipo AS ref_tipo,
             ref_c.ruc_emisor AS ref_ruc
      FROM comprobantes_guias c
      LEFT JOIN pedidos p ON c.pedido_id = p.id
      LEFT JOIN comprobantes ref_c ON c.comprobante_id = ref_c.id
      WHERE c.pedido_id = ${id}::uuid OR c.id = ${id}::uuid
      ORDER BY CASE WHEN c.pedido_id = ${id}::uuid THEN 0 ELSE 1 END, c.created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    const g = rows[0];

    // Scoping por rol
    if (!asesoraPuedeVerComprobante(session.user.role, session.user.id, session.user.name, {
      pedidoAsesorId: g.pedido_asesor_id,
      emitidoPor: g.emitido_por,
    })) {
      return NextResponse.json({ error: "Guía de remisión no encontrada" }, { status: 404 });
    }

    // ── Datos de impresión (misma lógica que /pedidos/[id]/gre/page.tsx) ──
    const xmlStr = g.xml_firmado_base64
      ? Buffer.from(g.xml_firmado_base64 as string, "base64").toString("utf-8")
      : "";

    // Ítems: del XML firmado (fiel a lo emitido) con fallback a pedido_items.
    let items: Array<{ descripcion: string; cantidad: number; unidad: string }> = [];
    if (xmlStr) {
      try {
        items = parseDespatchItems(xmlStr).map((it) => ({
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: it.unidadMedida,
        }));
      } catch { /* sigue al fallback */ }
    }
    if (items.length === 0 && g.pedido_id) {
      const pedidoItems = await sql`
        SELECT producto_nombre, COALESCE(cantidad_real, cantidad)::numeric AS cantidad, unidad
        FROM pedido_items WHERE pedido_id = ${g.pedido_id} ORDER BY producto_nombre ASC
      `;
      items = pedidoItems.map((it) => ({
        descripcion: it.producto_nombre as string,
        cantidad: Number(it.cantidad),
        unidad: it.unidad as string,
      }));
    }

    // Dirección de llegada: pedido → XML firmado.
    let direccionLlegada: string | null = (g.pedido_direccion as string) || null;
    let distritoLlegada: string | null = (g.pedido_distrito as string) || null;
    if (!direccionLlegada && xmlStr) {
      try {
        const pl = parseGuiaPuntoLlegada(xmlStr);
        if (pl) {
          direccionLlegada = pl.direccion || null;
          distritoLlegada = pl.ubigeo ? obtenerDistritoPorUbigeo(pl.ubigeo) : null;
        }
      } catch { /* sin dirección */ }
    }

    const indicadorM1L = xmlStr.includes("SUNAT_Envio_IndicadorTrasladoVehiculoM1L");

    return NextResponse.json({
      ...g,
      impresion: {
        items,
        direccionLlegada,
        distritoLlegada,
        indicadorM1L,
        comprobanteRelacionado: g.ref_serie_numero
          ? { serieNumero: g.ref_serie_numero, tipo: g.ref_tipo, ruc: g.ref_ruc }
          : null,
      },
    });
  } catch (error) {
    console.error("Error en GET /api/guias/[id]:", error);
    return NextResponse.json({ error: "Error al obtener la guía" }, { status: 500 });
  }
}

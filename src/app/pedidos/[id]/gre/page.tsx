// src/app/pedidos/[id]/gre/page.tsx
// Página HTML imprimible de la Guía de Remisión Electrónica SUNAT (GRE).
// El parámetro `id` puede ser:
//   - Un pedido_id (UUID): busca la guía vinculada a ese pedido.
//   - Un ID de guía (UUID): busca directamente la guía (para guías standalone sin pedido).

import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import GrePrintableClient from "./gre-printable-client";
import { obtenerUbigeoDistrito } from "@/lib/sunat/ubigeos";
import { obtenerDistritoPorUbigeo } from "@/lib/sunat/ubigeos";
import { parseDespatchItems, parseGuiaObservacion, parseGuiaPuntoLlegada } from "@/lib/sunat/parse-cpe-items";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GrePage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return <div className="p-8">No autorizado. Inicia sesión primero.</div>;
  }

  // Validar que `id` sea un UUID válido antes de mandarlo al SQL para evitar errores de casting
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-lg font-bold text-slate-800">ID inválido</h1>
        <p className="text-sm text-slate-500 mt-2">El identificador proporcionado no es válido.</p>
      </div>
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Intentar buscar por pedido_id primero; si no, buscar por el ID directo de la guía.
  // Esto permite soportar tanto /pedidos/<pedido_id>/gre como /pedidos/<guia_id>/gre.
  const guiasRows = await sql`
    SELECT c.*,
           p.direccion AS cliente_direccion,
           p.distrito AS cliente_distrito,
           p.whatsapp AS cliente_whatsapp,
           TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_entrega,
           u.name as asesor_name,
           ref_c.serie_numero AS ref_comprobante_serie_numero,
           ref_c.tipo AS ref_comprobante_tipo,
           ref_c.ruc_emisor AS ref_comprobante_ruc_emisor
    FROM comprobantes_guias c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    LEFT JOIN users u ON p.asesor_id = u.id
    LEFT JOIN comprobantes ref_c ON c.comprobante_id = ref_c.id
    WHERE c.pedido_id = ${id}::uuid OR c.id = ${id}::uuid
    ORDER BY
      -- Preferir la que tenga pedido_id coincidente sobre la búsqueda por id propio
      CASE WHEN c.pedido_id = ${id}::uuid THEN 0 ELSE 1 END,
      c.created_at DESC
    LIMIT 1
  `;

  if (guiasRows.length === 0) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-lg font-bold text-slate-800">No se encontró una Guía de Remisión Electrónica</h1>
        <p className="text-sm text-slate-500 mt-2">
          Debes emitir la guía legal ante la SUNAT desde el panel de despacho antes de poder visualizarla.
        </p>
      </div>
    );
  }

  const g = guiasRows[0];

  // ── Obtener los ítems de traslado ────────────────────────────────────────────
  // Si el pedido existe, cargamos desde pedido_items.
  // Si es una guía standalone (pedido_id null), parseamos el XML firmado.
  let items: Array<{ codigo: string; descripcion: string; cantidad: number; unidad: string }> = [];

  if (g.pedido_id) {
    const pedidoItems = await sql`
      SELECT producto_nombre,
             COALESCE(cantidad_real, cantidad)::numeric AS cantidad,
             unidad
      FROM pedido_items
      WHERE pedido_id = ${g.pedido_id}
      ORDER BY producto_nombre ASC
    `;
    items = pedidoItems
      .map((it) => ({
        producto_nombre: it.producto_nombre,
        cantidad: Number(it.cantidad),
        unidad: it.unidad,
      }))
      .filter((it) => it.cantidad > 0)
      .map((it, idx) => ({
        codigo: `P${String(idx + 1).padStart(3, "0")}`,
        descripcion: it.producto_nombre,
        cantidad: it.cantidad,
        unidad: it.unidad,
      }));
  } else if (g.xml_firmado_base64) {
    // Guía standalone: extraer ítems del XML firmado
    try {
      const xmlStr = Buffer.from(g.xml_firmado_base64, "base64").toString("utf-8");
      const despatchItems = parseDespatchItems(xmlStr);
      items = despatchItems.map((it, idx) => ({
        codigo: it.codigo || `P${String(idx + 1).padStart(3, "0")}`,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidadMedida,
      }));
    } catch {
      // Si falla el parseo, dejar items vacío
    }
  }

  // ── Resolver dirección del destinatario ──────────────────────────────────────
  // Para guías vinculadas a pedido: viene en cliente_direccion/cliente_distrito.
  // Para guías standalone: parsear del XML.
  let clienteDireccion: string | null = g.cliente_direccion || null;
  let clienteDistrito: string | null = g.cliente_distrito || null;
  let clienteUbigeo: string = g.cliente_distrito
    ? obtenerUbigeoDistrito(g.cliente_distrito)
    : "150000";

  if (!clienteDireccion && g.xml_firmado_base64) {
    try {
      const xmlStr = Buffer.from(g.xml_firmado_base64, "base64").toString("utf-8");
      const puntoLlegada = parseGuiaPuntoLlegada(xmlStr);
      if (puntoLlegada) {
        clienteUbigeo = puntoLlegada.ubigeo || "150000";
        clienteDireccion = puntoLlegada.direccion || null;
        clienteDistrito = puntoLlegada.ubigeo
          ? obtenerDistritoPorUbigeo(puntoLlegada.ubigeo)
          : null;
      }
    } catch {
      // Si falla, continuar sin dirección
    }
  }

  // Indicador M1/L: se lee del XML firmado (fuente de verdad), donde viaja como
  // SpecialInstructions. Sin migración; si no hay XML (guía pendiente) queda false.
  let indicadorM1L = false;
  if (g.xml_firmado_base64) {
    try {
      const xmlStr = Buffer.from(g.xml_firmado_base64, "base64").toString("utf-8");
      indicadorM1L = xmlStr.includes("SUNAT_Envio_IndicadorTrasladoVehiculoM1L");
    } catch {
      // Si falla el parseo, dejar indicadorM1L en false
    }
  }

  let observacionComprobante: string | null = g.observacion_comprobante || null;
  if (g.xml_firmado_base64) {
    try {
      const xmlStr = Buffer.from(g.xml_firmado_base64, "base64").toString("utf-8");
      observacionComprobante = parseGuiaObservacion(xmlStr) || observacionComprobante;
    } catch {
      // Si falla el parseo, usar la columna persistida.
    }
  }

  return (
    <GrePrintableClient
      guia={{
        id: g.id,
        rucEmisor: g.ruc_emisor,
        empresa: g.empresa,
        serieNumero: g.serie_numero,
        clienteDocTipo: g.cliente_doc_tipo,
        clienteDocNum: g.cliente_doc_num ?? null,
        clienteRazonSocial: g.cliente_razon_social ?? null,
        pesoBrutoTotal: Number(g.peso_bruto_total),
        totalBultos: g.total_bultos,
        modalidadTraslado: g.modalidad_traslado,
        motivoTraslado: g.motivo_traslado,
        indicadorM1L,
        fechaInicioTraslado: new Date(g.fecha_inicio_traslado).toLocaleDateString("es-PE", {
          timeZone: "UTC",
          day: "2-digit",
          month: "2-digit",
          year: "numeric"
        }),
        vehiculoPlaca: g.vehiculo_placa,
        choferDocNum: g.chofer_doc_num,
        choferLicencia: g.chofer_licencia,
        estado: g.estado,
        hashCpe: g.hash_cpe,
        created_at: new Date(g.created_at).toLocaleString("es-PE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        }),
        clienteDireccion,
        clienteDistrito,
        clienteUbigeo,
        asesor: g.asesor_name || "Asesor",
        observacionComprobante,
        comprobanteRelacionado: g.ref_comprobante_serie_numero ? {
          serieNumero: g.ref_comprobante_serie_numero,
          tipo: g.ref_comprobante_tipo,
          ruc: g.ref_comprobante_ruc_emisor
        } : null
      }}
      items={items}
    />
  );
}

// src/app/api/comprobantes/[id]/route.ts
// Devuelve el detalle completo de un comprobante (con items reconstruidos
// desde el pedido asociado, si existe) — necesario para generar PDF/XML/email.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { getSunatConfig } from "@/lib/sunat/config-transavic";
import type { EmpresaId } from "@/lib/sunat/types";
import {
  parseCpeItems,
  parseCpeClienteDireccion,
  parseCpeObservacion,
  parseCpeTotales,
  type CpeItem,
  type CpeTotales,
} from "@/lib/sunat/parse-cpe-items";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }
  // Validar UUID format antes de tocar DB (evita error 500 por cast inválido)
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Privacy boundary: admin ve todo, asesor SOLO comprobantes de SUS pedidos.
  // Otros roles (repartidor/produccion) no deben ver comprobantes.
  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  // Scoping (Antonio jun 2026): admin ve todo; la asesora SOLO sus comprobantes
  // (de sus pedidos o emitidos por ella). El chequeo va tras leer el comprobante,
  // con asesoraPuedeVerComprobante().
  const rows = (await sql`
        SELECT
          c.id, c.pedido_id, c.ruc_emisor, c.empresa, c.tipo, c.serie, c.numero,
          c.serie_numero, c.cliente_doc_tipo, c.cliente_doc_num, c.cliente_razon_social,
          c.monto_subtotal, c.monto_igv, c.monto_total, c.moneda,
          c.estado, c.hash_cpe, c.xml_firmado_base64, c.cdr_base64,
          c.observaciones, c.mensaje_sunat, c.created_at, c.fecha_emision,
          c.forma_pago, c.fecha_vencimiento, c.emitido_por, c.observacion_comprobante,
          p.asesor_id AS pedido_asesor_id,
          p.cliente AS pedido_cliente, p.direccion AS pedido_direccion,
          p.distrito AS pedido_distrito,
          p.whatsapp AS pedido_whatsapp
        FROM comprobantes c
        LEFT JOIN pedidos p ON p.id = c.pedido_id
        WHERE c.id = ${id}::uuid
        LIMIT 1
      `) as Array<{
    id: string;
    pedido_id: string | null;
    ruc_emisor: string;
    empresa: string;
    tipo: string;
    serie: string;
    numero: number;
    serie_numero: string;
    cliente_doc_tipo: string | null;
    cliente_doc_num: string | null;
    cliente_razon_social: string | null;
    monto_subtotal: string | number;
    monto_igv: string | number;
    monto_total: string | number;
    moneda: string | null;
    estado: string;
    hash_cpe: string | null;
    xml_firmado_base64: string | null;
    cdr_base64: string | null;
    observaciones: string | null;
    observacion_comprobante: string | null;
    mensaje_sunat: string | null;
    created_at: string | Date;
    fecha_emision: string | Date | null;
    forma_pago: string | null;
    fecha_vencimiento: string | Date | null;
    emitido_por: string | null;
    pedido_asesor_id: string | null;
    pedido_cliente: string | null;
    pedido_direccion: string | null;
    pedido_distrito: string | null;
    pedido_whatsapp: string | null;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];

  // Scoping por rol: la asesora solo accede a SUS comprobantes. 404 (no 403) para no
  // revelar la existencia de comprobantes de otras.
  if (!asesoraPuedeVerComprobante(role, session.user.id, session.user.name, {
    pedidoAsesorId: c.pedido_asesor_id,
    emitidoPor: c.emitido_por,
  })) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }

  // ÍTEMS PARA EL PDF — fuente de verdad por prioridad:
  //  (1) El XML firmado (lo que SUNAT recibió): fiel SIEMPRE e incluye el código.
  //      Cubre tanto facturas standalone como las emitidas desde un pedido.
  //  (2) pedido_items: solo si el comprobante aún no tiene XML (pendiente/error).
  //  (3) Línea "global": último recurso (sin XML ni pedido).
  // Antes se fabricaba siempre una línea genérica ("Venta a <cliente>", 1 UNIDAD)
  // cuando no había pedido → el PDF de las facturas standalone salía con
  // cantidad/unidad/código/descripción equivocados. El XML lo corrige.
  let items: CpeItem[] = [];
  // Dirección del CLIENTE: preferimos la del XML firmado (fiel a lo emitido y
  // declarado a SUNAT) y, si no, la del pedido. Antes solo se usaba la del pedido
  // → las facturas standalone salían sin dirección del cliente y el PDF mostraba
  // la del EMISOR con la etiqueta "Establecimiento del Emisor" (confundía).
  let clienteDireccionXml: string | null = null;
  let observacionXml: string | null = null;
  // Totales del XML firmado: el cbc:PayableAmount es la ÚNICA fuente de verdad del
  // importe ante SUNAT (la Consulta de Validez compara exacto al céntimo). El PDF
  // DEBE mostrar ese número, no `monto_total` de DB (que históricamente podía
  // diferir 1-2 céntimos por un recálculo paralelo, ya corregido en la emisión).
  let totalesXml: CpeTotales | null = null;

  // (1) XML firmado — la representación impresa DEBE coincidir con el XML.
  if (c.xml_firmado_base64) {
    try {
      const xml = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
      items = parseCpeItems(xml);
      clienteDireccionXml = parseCpeClienteDireccion(xml);
      observacionXml = parseCpeObservacion(xml);
      totalesXml = parseCpeTotales(xml);
    } catch {
      items = [];
    }
  }

  // (2) Fallback: ítems del pedido asociado (comprobante sin XML)
  if (items.length === 0 && c.pedido_id) {
    const itemRows = (await sql`
      SELECT
        pi.producto_nombre AS descripcion,
        pi.unidad AS unidad_medida,
        COALESCE(pi.cantidad_real, pi.cantidad, 0)::numeric AS cantidad,
        COALESCE(pi.precio_unitario, 0)::numeric AS precio_unitario,
        COALESCE(pi.subtotal_real, pi.subtotal, 0)::numeric AS subtotal,
        pr.codigo AS codigo
      FROM pedido_items pi
      LEFT JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = ${c.pedido_id}::uuid
      ORDER BY pi.created_at
    `) as Array<{
      descripcion: string;
      unidad_medida: string | null;
      cantidad: string | number;
      precio_unitario: string | number;
      subtotal: string | number;
      codigo: string | null;
    }>;

    items = itemRows
      .map((r) => {
        const cantidad = Number(r.cantidad);
        const precioUnitario = Number(r.precio_unitario);
        const valorVenta = Number(r.subtotal) || cantidad * precioUnitario;
        const montoIGV = Number((valorVenta * 0.18).toFixed(2));
        return {
          descripcion: r.descripcion,
          unidadMedida: r.unidad_medida || "NIU",
          cantidad,
          precioUnitario,
          valorVenta,
          montoIGV,
          precioTotal: Number((valorVenta + montoIGV).toFixed(2)),
          codigo: r.codigo || "",
        };
      })
      .filter((it) => it.cantidad > 0);
  }

  // (3) Último recurso: línea global desde los montos del comprobante
  if (items.length === 0) {
    const subtotal = Number(c.monto_subtotal);
    const igv = Number(c.monto_igv);
    items = [
      {
        descripcion: c.cliente_razon_social
          ? `Venta a ${c.cliente_razon_social}`
          : "Venta",
        unidadMedida: "NIU",
        cantidad: 1,
        precioUnitario: subtotal,
        valorVenta: subtotal,
        montoIGV: igv,
        precioTotal: subtotal + igv,
        codigo: "",
      },
    ];
  }

  // Datos del emisor (leídos desde env vars vía getSunatConfig)
  const empresaId = (c.empresa as EmpresaId) || "transavic";
  const sunatConfig = getSunatConfig(empresaId);
  const emisor = {
    ruc: c.ruc_emisor || sunatConfig.ruc,
    razonSocial: sunatConfig.razonSocial,
    nombreComercial: sunatConfig.nombreComercial,
    direccion: sunatConfig.direccion,
    ubigeo: sunatConfig.ubigeo,
    departamento: sunatConfig.departamento,
    provincia: sunatConfig.provincia,
    distrito: sunatConfig.distrito,
  };

  // fechaEmision: preferimos la columna `fecha_emision` (la fecha REAL del XML,
  // que puede ser retroactiva). Es un DATE puro (sin hora/zona), así que se usa
  // tal cual. Solo si está NULL (filas viejas sin backfill) caemos al cálculo
  // sobre created_at en zona Lima (UTC-5, NO UTC): un comprobante emitido a las
  // 21:00 Lima tiene created_at = 02:00 UTC del día siguiente; usar el UTC crudo
  // adelantaría la fecha 1 día respecto al XML firmado.
  const fechaEmisionLima = c.fecha_emision
    ? typeof c.fecha_emision === "string"
      ? c.fecha_emision.slice(0, 10)
      : c.fecha_emision.toISOString().slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(
        typeof c.created_at === "string" ? new Date(c.created_at) : c.created_at
      );

  // Vencimiento como "YYYY-MM-DD" (columna DATE; neon la devuelve string, Date por las dudas).
  const fechaVencimiento =
    c.fecha_vencimiento == null
      ? null
      : typeof c.fecha_vencimiento === "string"
        ? c.fecha_vencimiento.slice(0, 10)
        : c.fecha_vencimiento.toISOString().slice(0, 10);

  return NextResponse.json({
    id: c.id,
    pedidoId: c.pedido_id,
    rucEmisor: c.ruc_emisor,
    empresa: c.empresa,
    emisor, // override completo del emisor para el PDF
    tipo: c.tipo,
    serie: c.serie,
    numero: c.numero,
    serieNumero: c.serie_numero,
    fechaEmision: fechaEmisionLima, // YYYY-MM-DD en zona Lima
    cliente: {
      tipoDocumento: c.cliente_doc_tipo,
      numDocumento: c.cliente_doc_num,
      razonSocial: c.cliente_razon_social || c.pedido_cliente,
      direccion: clienteDireccionXml || c.pedido_direccion,
      distrito: c.pedido_distrito || null,
      whatsapp: c.pedido_whatsapp,
    },
    items,
    // Totales: si hay XML firmado, se usan SUS importes (== lo que SUNAT registró)
    // para que el PDF valide en la Consulta de Validez. Sin XML (pendiente/error),
    // se cae a los montos de DB.
    totales: {
      totalGravadas: totalesXml ? totalesXml.subtotal : Number(c.monto_subtotal),
      totalExoneradas: 0,
      totalInafectas: 0,
      totalIGV: totalesXml ? totalesXml.igv : Number(c.monto_igv),
      totalISC: 0,
      totalOtrosCargos: 0,
      importeTotal: totalesXml ? totalesXml.importeTotal : Number(c.monto_total),
    },
    moneda: c.moneda || "PEN",
    estado: c.estado,
    hashCpe: c.hash_cpe,
    xmlFirmadoBase64: c.xml_firmado_base64,
    cdrBase64: c.cdr_base64,
    observaciones: c.observaciones ? c.observaciones.split(" | ") : null,
    observacionComprobante: observacionXml || c.observacion_comprobante || null,
    mensajeSunat: c.mensaje_sunat,
    formaPago: c.forma_pago ?? null,
    fechaVencimiento,
  });
}

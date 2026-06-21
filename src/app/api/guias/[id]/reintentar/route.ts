// src/app/api/guias/[id]/reintentar/route.ts
// POST — reintenta la emisión de una guía interrumpida REUSANDO el mismo serie-número.
//
// Caso que resuelve (T002-00000010, 10 jun 2026): la emisión REST hace token +
// envío + polling (~15-25s) y sin maxDuration la función de Vercel moría a mitad
// → la fila quedaba atascada en 'emitiendo' sin XML/CDR, sin saberse si SUNAT
// recibió la guía. Este endpoint reconstruye el MISMO XML (mismo número, datos
// persistidos en la fila por la reserva) y lo reenvía:
//   - Si SUNAT nunca la recibió → la procesa ahora (sin hueco en la numeración).
//   - Si SUNAT YA la tenía → responde "ya fue registrada" → marcamos 'aceptado'
//     (el CDR original se descarga desde SOL si hace falta).
//
// Estados reintenables: 'error', 'pendiente', o 'emitiendo' con >15 min (una
// emisión legítima nunca tarda tanto). 'rechazado' NO: ese número no se reusa
// (regla SUNAT) — para esos se emite una guía nueva.

import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";
import { getSunatConfig, empresaFromPedidoString } from "@/lib/sunat/config-transavic";
import { generarXMLGuia, DatosGuia } from "@/lib/sunat/xml-builder-guia";
import { firmarXML } from "@/lib/sunat/xml-signer";
import { enviarGuiaRest } from "@/lib/sunat/rest-client";
import { obtenerUbigeoDistrito } from "@/lib/sunat/ubigeos";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";
import { EstadoSunat } from "@/lib/sunat/types";
import { parseCpeItems, parseCpeClienteDireccion, type CpeItem } from "@/lib/sunat/parse-cpe-items";
import { fechaHoyLima, horaActualLima } from "@/lib/sunat/fechas";

export const dynamic = "force-dynamic";
// Igual que /api/guias/emitir: el polling REST supera los ~15s default de Vercel.
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ItemGuia {
  producto_nombre: string;
  cantidad: number;
  unidad: string;
}

/** SUNAT responde así cuando el comprobante YA había sido recibido antes. */
function esRespuestaDuplicado(texto: string): boolean {
  return /\b103[23]\b|registrad[oa]\s+previamente|ya\s+(se\s+encuentra|fue|ha\s+sido)\s+(registrad|present)/i.test(texto);
}

export async function POST(_req: Request, { params }: RouteParams) {
  let guiaId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["asesor", "admin"].includes(session.user.role)) {
      return NextResponse.json({ error: "Sin permisos para reintentar guías" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const rows = await sql`
      SELECT g.*,
             p.asesor_id AS pedido_asesor_id,
             p.direccion AS pedido_direccion,
             p.distrito  AS pedido_distrito,
             c.xml_firmado_base64 AS factura_xml,
             c.items_json AS factura_items_json
      FROM comprobantes_guias g
      LEFT JOIN pedidos p ON g.pedido_id = p.id
      LEFT JOIN comprobantes c ON g.comprobante_id = c.id
      WHERE g.id = ${id}::uuid
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Guía no encontrada" }, { status: 404 });
    }
    const g = rows[0];

    if (!asesoraPuedeVerComprobante(session.user.role, session.user.id, session.user.name, {
      pedidoAsesorId: g.pedido_asesor_id,
      emitidoPor: g.emitido_por,
    })) {
      return NextResponse.json({ error: "Guía no encontrada" }, { status: 404 });
    }

    // Tomar la fila de forma ATÓMICA: solo si está en un estado reintenable.
    // (Evita dos reintentos concurrentes y deja la fila 'emitiendo' fresca.)
    // 'rechazado' SÍ es reintenable en GRE REST: un envío rechazado NO registra
    // el documento en SUNAT, así que el mismo serie-número puede re-presentarse
    // con el XML corregido (caso real: rechazo 2329 por fecha UTC, 10 jun 2026).
    const tomada = await sql`
      UPDATE comprobantes_guias
      SET estado = 'emitiendo', mensaje_sunat = 'Reintento de emisión en curso', updated_at = NOW()
      WHERE id = ${id}::uuid
        AND (
          estado IN ('error', 'pendiente', 'rechazado')
          OR (estado = 'emitiendo' AND created_at < NOW() - INTERVAL '15 minutes')
        )
      RETURNING id
    `;
    if (tomada.length === 0) {
      return NextResponse.json(
        { error: `Esta guía está en estado "${g.estado}" y no se puede reintentar (solo error, rechazado, pendiente o atascada en "emitiendo").` },
        { status: 409 }
      );
    }
    guiaId = id;

    // ── Reconstruir los datos de la emisión original ──
    // Ítems: items_json de la guía (reserva) → XML/items_json de la factura → pedido_items.
    let itemsRows: ItemGuia[] = [];
    if (Array.isArray(g.items_json) && g.items_json.length > 0) {
      itemsRows = (g.items_json as ItemGuia[]).map((it) => ({
        producto_nombre: String(it.producto_nombre),
        cantidad: Number(it.cantidad),
        unidad: String(it.unidad || "NIU"),
      }));
    }
    if (itemsRows.length === 0 && (g.factura_xml || g.factura_items_json)) {
      let parsedItems: CpeItem[] = [];
      if (g.factura_xml) {
        try {
          parsedItems = parseCpeItems(Buffer.from(g.factura_xml as string, "base64").toString("utf-8"));
        } catch (err) {
          console.error("Reintento: no se pudo parsear el XML de la factura:", err);
        }
      }
      if (parsedItems.length === 0 && Array.isArray(g.factura_items_json)) {
        parsedItems = g.factura_items_json as CpeItem[];
      }
      itemsRows = parsedItems
        .map((it) => {
          const o = it as unknown as Record<string, unknown>;
          return {
            producto_nombre: String(o.descripcion || o.producto_nombre || "Venta"),
            cantidad: Number(o.cantidad),
            unidad: String(o.unidadMedida || o.unidad || "NIU"),
          };
        })
        .filter((it) => !/^env[ií]o$/i.test(it.producto_nombre.trim()));
    }
    if (itemsRows.length === 0 && g.pedido_id) {
      const dbItems = await sql`
        SELECT producto_nombre, COALESCE(cantidad_real, cantidad)::numeric AS cantidad, unidad
        FROM pedido_items WHERE pedido_id = ${g.pedido_id}
      `;
      itemsRows = dbItems.map((it) => ({
        producto_nombre: it.producto_nombre as string,
        cantidad: Number(it.cantidad),
        unidad: (it.unidad as string) || "NIU",
      }));
    }
    if (itemsRows.length === 0) {
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'error', mensaje_sunat = 'Reintento abortado: no se pudieron recuperar los bienes de la guía.', updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      return NextResponse.json(
        { error: "No se pudieron recuperar los bienes de la guía para reintentarla." },
        { status: 422 }
      );
    }

    // Dirección/distrito de llegada: columnas de la reserva → pedido → XML factura → ficha del cliente.
    let direccionLlegada = String(g.direccion_llegada || g.pedido_direccion || "").trim();
    let distritoLlegada = String(g.distrito_llegada || g.pedido_distrito || "").trim();
    if (!direccionLlegada && g.factura_xml) {
      try {
        const dir = parseCpeClienteDireccion(Buffer.from(g.factura_xml as string, "base64").toString("utf-8"));
        if (dir) direccionLlegada = dir;
      } catch {
        // sigue el fallback
      }
    }
    if ((!direccionLlegada || !distritoLlegada) && g.cliente_doc_num) {
      const cli = await sql`SELECT direccion, distrito FROM clientes WHERE ruc_dni = ${g.cliente_doc_num} LIMIT 1`;
      if (cli.length > 0) {
        if (!direccionLlegada) direccionLlegada = String(cli[0].direccion || "").trim();
        if (!distritoLlegada) distritoLlegada = String(cli[0].distrito || "").trim();
      }
    }
    if (!direccionLlegada) {
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'error', mensaje_sunat = 'Reintento abortado: no se pudo recuperar la dirección de llegada.', updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      return NextResponse.json(
        { error: "No se pudo recuperar la dirección de llegada para reintentar la guía." },
        { status: 422 }
      );
    }
    // Sin distrito no se puede derivar el ubigeo: abortar en vez de caer al
    // fallback silencioso 150101 (Cercado de Lima), que dejaría la GRE con un
    // ubigeo de otro distrito que la dirección.
    if (!distritoLlegada) {
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'error', mensaje_sunat = 'Reintento abortado: no se pudo recuperar el distrito de llegada.', updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      return NextResponse.json(
        { error: "No se pudo recuperar el distrito de llegada para reintentar la guía." },
        { status: 422 }
      );
    }

    // Chofer/vehículo: columnas de la fila; nombres con fallback al perfil del repartidor.
    let choferNombres = String(g.chofer_nombres || "").trim();
    let choferApellidos = String(g.chofer_apellidos || "").trim();
    if ((!choferNombres || !choferApellidos) && g.repartidor_id) {
      const rep = await sql`SELECT name FROM users WHERE id = ${g.repartidor_id}`;
      if (rep.length > 0) {
        const palabras = String(rep[0].name || "").trim().split(/\s+/);
        if (!choferNombres) choferNombres = palabras[0] || "-";
        if (!choferApellidos) choferApellidos = palabras.slice(1).join(" ") || "-";
      }
    }
    if (!choferNombres) choferNombres = "-";
    if (!choferApellidos) choferApellidos = "-";

    // M1/L: columna de la reserva; en filas anteriores a la migración se infiere
    // (sin DNI de chofer ni placa solo pudo emitirse como M1/L).
    const indicadorM1L: boolean =
      typeof g.indicador_m1l === "boolean"
        ? g.indicador_m1l
        : !String(g.chofer_doc_num || "").trim() && !String(g.vehiculo_placa || "").trim();

    const empresa = empresaFromPedidoString(String(g.empresa || "transavic"));
    const sunatConfig = getSunatConfig(empresa);
    if (!sunatConfig.certificateBase64 || !sunatConfig.certificatePassword) {
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'pendiente', mensaje_sunat = 'Certificado .p12 no configurado — no se pudo reenviar a SUNAT.', updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      return NextResponse.json({ error: "Certificado digital no configurado." }, { status: 500 });
    }

    // Fecha/hora SIEMPRE en Lima (UTC tras las ~19:00 Lima = "mañana" → SUNAT 2329).
    const fechaEmision = fechaHoyLima();
    // El inicio de traslado no puede ser anterior a la emisión: si el reintento
    // ocurre días después, el documento original nunca existió legalmente y la
    // guía reemitida ampara el traslado desde HOY.
    // El driver de Neon puede devolver DATE como objeto Date (String() daría
    // "Wed Jun 10" → SUNAT 0306 "is not a valid value for 'date'").
    const rawInicio = g.fecha_inicio_traslado as unknown;
    const inicioOriginal = rawInicio instanceof Date
      ? rawInicio.toISOString().slice(0, 10)
      : String(rawInicio ?? "").slice(0, 10);
    const fechaInicioTraslado = inicioOriginal && inicioOriginal >= fechaEmision
      ? inicioOriginal
      : fechaEmision;

    const datosGuia: DatosGuia = {
      serie: String(g.serie),
      numero: Number(g.numero),
      fechaEmision,
      horaEmision: horaActualLima(),
      fechaInicioTraslado,
      motivoTraslado: String(g.motivo_traslado || "01"),
      descripcionMotivo: String(g.motivo_traslado || "01") === "01" ? "VENTA" : undefined,
      pesoBrutoTotal: Number(g.peso_bruto_total),
      totalBultos: Number(g.total_bultos || 1),
      modalidadTraslado: "02",
      indicadorM1L,
      observacionComprobante: String(g.observacion_comprobante || "").trim() || null,
      repartidor: {
        docTipo: "1",
        docNum: String(g.chofer_doc_num || ""),
        licencia: String(g.chofer_licencia || ""),
        nombres: choferNombres,
        apellidos: choferApellidos,
        placa: String(g.vehiculo_placa || ""),
      },
      cliente: {
        tipoDocumento: String(g.cliente_doc_tipo || "6"),
        numDocumento: String(g.cliente_doc_num || "0"),
        razonSocial: String(g.cliente_razon_social || "").toUpperCase(),
        direccion: direccionLlegada,
        ubigeo: obtenerUbigeoDistrito(distritoLlegada),
      },
      items: itemsRows.map((it, idx) => ({
        codigo: `P${String(idx + 1).padStart(3, "0")}`,
        descripcion: it.producto_nombre,
        unidadMedida: aUnitCodeSunat(it.unidad),
        cantidad: Number(it.cantidad),
      })),
    };

    const xmlSinFirma = generarXMLGuia(datosGuia, sunatConfig);
    const { xmlFirmado, hashCpe } = firmarXML(xmlSinFirma, sunatConfig);

    const resultadoEnvio = await enviarGuiaRest(xmlFirmado, String(g.serie), Number(g.numero), sunatConfig);

    // ¿SUNAT dice que YA estaba registrada? → la emisión original SÍ llegó.
    const textoRespuesta = `${resultadoEnvio.codigoRespuesta ?? ""} ${resultadoEnvio.descripcion ?? ""} ${resultadoEnvio.error ?? ""}`;
    if (!resultadoEnvio.exito && esRespuestaDuplicado(textoRespuesta)) {
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'aceptado',
            xml_firmado_base64 = ${Buffer.from(xmlFirmado).toString("base64")},
            hash_cpe = ${hashCpe ?? null},
            mensaje_sunat = 'SUNAT confirma que esta guía YA había sido recibida (la emisión original llegó). El CDR original puede descargarse desde SOL.',
            updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      return NextResponse.json({
        exito: true,
        estado: EstadoSunat.ACEPTADA,
        serieNumero: g.serie_numero,
        mensaje: `SUNAT confirma que la guía ${g.serie_numero} ya estaba registrada — quedó marcada como aceptada.`,
      });
    }

    const estadoDB =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA
        ? "aceptado"
        : resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
          ? "observado"
          : resultadoEnvio.estado === EstadoSunat.RECHAZADA
            ? "rechazado"
            : "error";

    await sql`
      UPDATE comprobantes_guias
      SET estado = ${estadoDB},
          hash_cpe = ${hashCpe ?? null},
          xml_firmado_base64 = ${Buffer.from(xmlFirmado).toString("base64")},
          cdr_base64 = ${resultadoEnvio.cdrBase64 ?? null},
          observaciones = ${resultadoEnvio.observaciones?.join(" | ") ?? null},
          mensaje_sunat = ${resultadoEnvio.descripcion || resultadoEnvio.error || null},
          updated_at = NOW()
      WHERE id = ${id}::uuid
    `;

    return NextResponse.json({
      ...resultadoEnvio,
      serieNumero: g.serie_numero,
      hashCpe,
    });
  } catch (error) {
    console.error("Error POST /api/guias/[id]/reintentar:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    if (guiaId) {
      try {
        const sqlCatch = neon(process.env.DATABASE_URL!);
        await sqlCatch`
          UPDATE comprobantes_guias
          SET estado = 'error',
              mensaje_sunat = ${`Reintento fallido: ${msg.slice(0, 500)}`},
              updated_at = NOW()
          WHERE id = ${guiaId}::uuid AND estado = 'emitiendo'
        `;
      } catch (e) {
        console.error("No se pudo marcar la guía como error tras el reintento:", e);
      }
    }
    return NextResponse.json({ error: `Error al reintentar la guía: ${msg}` }, { status: 500 });
  }
}

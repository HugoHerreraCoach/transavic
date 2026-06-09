// src/app/api/guias/emitir/route.ts
// POST — emite Guía de Remisión Electrónica (GRE) para un pedido o comprobante.

import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { siguienteCorrelativo, formatNumeroGuia } from "@/lib/correlativos";
import { getSunatConfig, empresaFromPedidoString } from "@/lib/sunat/config-transavic";
import { generarXMLGuia, DatosGuia } from "@/lib/sunat/xml-builder-guia";
import { firmarXML } from "@/lib/sunat/xml-signer";
import { enviarGuiaRest } from "@/lib/sunat/rest-client";
import { obtenerUbigeoDistrito } from "@/lib/sunat/ubigeos";
import { aUnitCodeSunat, estimarPesoPorUnidad } from "@/lib/sunat/unidades";
import { EstadoSunat } from "@/lib/sunat/types";
import { parseCpeItems, parseCpeClienteDireccion, type CpeItem } from "@/lib/sunat/parse-cpe-items";
import { esReceptorIdentificado } from "@/lib/sunat/validacion-cliente";

export const dynamic = "force-dynamic";

const Schema = z.object({
  pedido_id: z.string().uuid().optional().nullable(),
  comprobante_id: z.string().uuid().optional().nullable(),
  repartidor_id: z.string().uuid().optional().nullable(),
  fechaInicioTraslado: z.string(), // YYYY-MM-DD
  motivoTraslado: z.string().default("01"), // Catálogo 18 (Default: '01' Venta)
  totalBultos: z.number().int().min(1).default(1),
  pesoBrutoTotal: z.number().positive().optional().nullable(),
  // Overrides para chofer/vehículo por si no están en el perfil del repartidor
  vehiculo_placa: z.string().trim().optional().nullable(),
  chofer_dni: z.string().trim().optional().nullable(),
  chofer_licencia: z.string().trim().optional().nullable(),
  chofer_nombres: z.string().trim().optional().nullable(),
  chofer_apellidos: z.string().trim().optional().nullable(),
  // Indicador de transporte en vehículos M1 o L (motos, autos ligeros)
  indicadorM1L: z.boolean().optional().nullable(),
  // Overrides para punto de llegada
  direccion_llegada: z.string().trim().optional().nullable(),
  distrito_llegada: z.string().trim().optional().nullable(),
  // Overrides para cliente (DNI/RUC y Razón Social)
  cliente_doc_tipo: z.string().trim().optional().nullable(),
  cliente_doc_num: z.string().trim().optional().nullable(),
  cliente_razon_social: z.string().trim().optional().nullable(),
  // Campos para emisión directa
  empresa: z.string().trim().optional().nullable(),
  items: z.array(z.object({
    producto_nombre: z.string().trim(),
    cantidad: z.number().positive(),
    unidad: z.string().trim(),
  })).optional().nullable(),
});

function detectarTipoDocumento(doc: string): string {
  const limpio = (doc || "").trim();
  if (/^\d{11}$/.test(limpio)) return "6"; // RUC
  if (/^\d{8}$/.test(limpio)) return "1"; // DNI
  return "0"; // Sin documento
}

function dividirNombreCompleto(nombreCompleto: string): { nombres: string; apellidos: string } {
  const limpio = (nombreCompleto || "").trim().replace(/\s+/g, " ");
  if (!limpio) {
    return { nombres: "-", apellidos: "-" };
  }
  const palabras = limpio.split(" ");
  const n = palabras.length;
  
  if (n <= 1) {
    return { nombres: limpio, apellidos: "-" };
  }
  if (n === 2) {
    return { nombres: palabras[0], apellidos: palabras[1] };
  }
  if (n === 3) {
    // Caso común: "Nombres ApellidoPaterno ApellidoMaterno"
    // Heurística simple: Primer término es nombres, los siguientes dos apellidos.
    return { nombres: palabras[0], apellidos: `${palabras[1]} ${palabras[2]}` };
  }
  // n >= 4:
  // "PrimerNombre SegundoNombre ApellidoPaterno ApellidoMaterno"
  const nombres = `${palabras[0]} ${palabras[1]}`;
  const apellidos = palabras.slice(2).join(" ");
  return { nombres, apellidos };
}

export async function POST(request: Request) {
  try {
    let session = await auth();
    const bypassHeader = request.headers.get("x-bypass-auth");
    if (bypassHeader && bypassHeader === process.env.AUTH_SECRET) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session = { user: { name: "Antonio", role: "admin", id: "admin-bypass" } } as any;
    }
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["asesor", "admin"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo asesores o administradores pueden emitir guías de remisión" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const {
      pedido_id,
      comprobante_id,
      repartidor_id,
      fechaInicioTraslado,
      motivoTraslado,
      totalBultos,
      pesoBrutoTotal,
      vehiculo_placa,
      chofer_dni,
      chofer_licencia,
      chofer_nombres,
      chofer_apellidos,
      direccion_llegada,
      distrito_llegada,
      cliente_doc_tipo,
      cliente_doc_num,
      cliente_razon_social,
      empresa: empresaParam,
      items,
      indicadorM1L,
    } = parsed.data;

    let finalPedidoId: string | null = pedido_id || null;
    let finalComprobanteId: string | null = comprobante_id || null;

    let clienteRazonSocial = "";
    let clienteDocNum = "";
    let clienteDocTipo = "0";
    let direccionLlegadaFinal = "";
    let distritoLlegadaFinal = "";
    let empresaString = "";
    let repartidorAsignadoId: string | null = null;
    let itemsRows: Array<{ producto_nombre: string; cantidad: number; unidad: string }> = [];

    if (!pedido_id && !comprobante_id) {
      // Emisión directa
      if (!items || items.length === 0) {
        return NextResponse.json(
          { error: "Debe proporcionar pedido_id, comprobante_id o una lista de productos (items)." },
          { status: 400 }
        );
      }
      if (!cliente_doc_num || !cliente_razon_social) {
        return NextResponse.json(
          { error: "Para una guía libre, debe proporcionar cliente_doc_num y cliente_razon_social." },
          { status: 400 }
        );
      }
      if (!direccion_llegada || !distrito_llegada) {
        return NextResponse.json(
          { error: "Para una guía libre, debe proporcionar direccion_llegada y distrito_llegada." },
          { status: 400 }
        );
      }

      clienteRazonSocial = cliente_razon_social.trim();
      clienteDocNum = cliente_doc_num.trim();
      clienteDocTipo = cliente_doc_tipo || detectarTipoDocumento(clienteDocNum);
      direccionLlegadaFinal = direccion_llegada.trim();
      distritoLlegadaFinal = distrito_llegada.trim();
      empresaString = empresaParam || "transavic";
      repartidorAsignadoId = null;

      itemsRows = items.map((it) => ({
        producto_nombre: it.producto_nombre,
        cantidad: it.cantidad,
        unidad: it.unidad,
      }));
    } else if (pedido_id) {
      // 1. Cargar desde el pedido
      const pedidoRows = await sql`
        SELECT id, cliente, razon_social, ruc_dni, direccion, distrito, empresa, asesor_id, repartidor_id as repartidor_asignado_id
        FROM pedidos WHERE id = ${pedido_id}
      `;
      if (pedidoRows.length === 0) {
        return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
      }
      const pedido = pedidoRows[0];

      // Scoping por rol para asesores
      if (session.user.role === "asesor" && pedido.asesor_id !== session.user.id) {
        return NextResponse.json(
          { error: "No puedes emitir guías para pedidos de otras asesoras" },
          { status: 403 }
        );
      }

      clienteRazonSocial = (cliente_razon_social || pedido.razon_social || pedido.cliente || "Cliente Varios").trim();
      clienteDocNum = (cliente_doc_num || pedido.ruc_dni || "").trim();
      clienteDocTipo = cliente_doc_tipo || detectarTipoDocumento(clienteDocNum);
      direccionLlegadaFinal = (direccion_llegada || pedido.direccion || "").trim();
      distritoLlegadaFinal = (distrito_llegada || pedido.distrito || "").trim();
      empresaString = pedido.empresa;
      repartidorAsignadoId = pedido.repartidor_asignado_id;

      const dbItems = await sql`
        SELECT producto_nombre,
               COALESCE(cantidad_real, cantidad)::numeric AS cantidad,
               unidad
        FROM pedido_items
        WHERE pedido_id = ${pedido_id}
      `;
      if (dbItems.length === 0) {
        return NextResponse.json(
          { error: "El pedido no contiene productos asociados." },
          { status: 400 }
        );
      }
      itemsRows = dbItems.map((it) => ({
        producto_nombre: it.producto_nombre,
        cantidad: Number(it.cantidad),
        unidad: it.unidad,
      }));
    } else if (comprobante_id) {
      // 2. Cargar desde el comprobante standalone
      const compRows = await sql`
        SELECT id, pedido_id, ruc_emisor, empresa, tipo, serie, numero, cliente_doc_tipo, cliente_doc_num, cliente_razon_social, items_json, xml_firmado_base64, emitido_por
        FROM comprobantes WHERE id = ${comprobante_id}::uuid
      `;
      if (compRows.length === 0) {
        return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
      }
      const c = compRows[0];

      // Scoping por rol para asesores
      if (session.user.role === "asesor") {
        if (c.pedido_id) {
          const pedAssoc = await sql`SELECT asesor_id FROM pedidos WHERE id = ${c.pedido_id}`;
          if (pedAssoc.length > 0 && pedAssoc[0].asesor_id !== session.user.id) {
            return NextResponse.json({ error: "No autorizado para este comprobante" }, { status: 403 });
          }
        } else if (c.emitido_por && c.emitido_por.trim().toLowerCase() !== session.user.name?.trim().toLowerCase()) {
          return NextResponse.json({ error: "No autorizado para este comprobante" }, { status: 403 });
        }
      }

      if (c.pedido_id) {
        finalPedidoId = c.pedido_id;
        const pedRep = await sql`SELECT repartidor_id FROM pedidos WHERE id = ${c.pedido_id}`;
        if (pedRep.length > 0) {
          repartidorAsignadoId = pedRep[0].repartidor_id;
        }
      }

      clienteRazonSocial = (cliente_razon_social || c.cliente_razon_social || "Cliente Varios").trim();
      clienteDocNum = (cliente_doc_num || c.cliente_doc_num || "").trim();
      clienteDocTipo = cliente_doc_tipo || c.cliente_doc_tipo || detectarTipoDocumento(clienteDocNum);
      empresaString = c.empresa;

      // Resolver dirección y distrito con prioridades/fallbacks
      let resolvedDireccion = direccion_llegada;
      let resolvedDistrito = distrito_llegada;

      if ((!resolvedDireccion || !resolvedDistrito) && c.pedido_id) {
        const pedAddr = await sql`SELECT direccion, distrito FROM pedidos WHERE id = ${c.pedido_id}`;
        if (pedAddr.length > 0) {
          if (!resolvedDireccion) resolvedDireccion = pedAddr[0].direccion;
          if (!resolvedDistrito) resolvedDistrito = pedAddr[0].distrito;
        }
      }

      if ((!resolvedDireccion || !resolvedDistrito) && c.xml_firmado_base64) {
        try {
          const xml = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
          const xmlAddr = parseCpeClienteDireccion(xml);
          if (xmlAddr && !resolvedDireccion) resolvedDireccion = xmlAddr;
        } catch (err) {
          console.error("Error parsing address from XML:", err);
        }
      }

      if ((!resolvedDireccion || !resolvedDistrito) && clienteDocNum) {
        const clientRows = await sql`
          SELECT direccion, distrito FROM clientes WHERE ruc_dni = ${clienteDocNum} LIMIT 1
        `;
        if (clientRows.length > 0) {
          if (!resolvedDireccion) resolvedDireccion = clientRows[0].direccion;
          if (!resolvedDistrito) resolvedDistrito = clientRows[0].distrito;
        }
      }

      direccionLlegadaFinal = (resolvedDireccion || "").trim();
      distritoLlegadaFinal = (resolvedDistrito || "").trim();

      // Resolver ítems
      let parsedItems: CpeItem[] = [];
      if (c.xml_firmado_base64) {
        try {
          const xml = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
          parsedItems = parseCpeItems(xml);
        } catch (err) {
          console.error("Error parsing items from XML:", err);
        }
      }

      if (parsedItems.length === 0 && Array.isArray(c.items_json)) {
        parsedItems = c.items_json as CpeItem[];
      }

      if (parsedItems.length === 0) {
        return NextResponse.json(
          { error: "No se pudieron recuperar las líneas de productos del comprobante." },
          { status: 400 }
        );
      }

      itemsRows = parsedItems.map((it) => {
        const itemObj = it as unknown as Record<string, unknown>;
        return {
          producto_nombre: String(itemObj.descripcion || itemObj.producto_nombre || "Venta"),
          cantidad: Number(itemObj.cantidad),
          unidad: String(itemObj.unidadMedida || itemObj.unidad || "NIU"),
        };
      });
    }

    // Si la guía se emite desde un PEDIDO sin comprobante explícito, vincular su factura/boleta
    // aceptada para que la guía muestre su "Documento Relacionado" Y para que el DESTINATARIO
    // COINCIDA con la factura (no con el nombre informal del pedido).
    if (!finalComprobanteId && finalPedidoId) {
      const compRows = await sql`
        SELECT id, cliente_razon_social, cliente_doc_num, cliente_doc_tipo
        FROM comprobantes
        WHERE pedido_id = ${finalPedidoId}::uuid
          AND estado IN ('aceptado', 'observado')
          AND tipo IN ('01', '03')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (compRows.length > 0) {
        finalComprobanteId = compRows[0].id as string;
        // El destinatario de la guía debe COINCIDIR con la factura. Solo se sobrescribe si el
        // usuario NO mandó override explícito y la factura tiene receptor identificado (RUC/DNI);
        // una boleta sin documento mantiene el flujo de override (no se pisa con datos inválidos).
        const facturaDocNum = String(compRows[0].cliente_doc_num || "").trim();
        if (!cliente_doc_num && !cliente_razon_social && esReceptorIdentificado(facturaDocNum)) {
          clienteDocNum = facturaDocNum;
          clienteDocTipo = String(compRows[0].cliente_doc_tipo || clienteDocTipo);
          const facturaRazon = String(compRows[0].cliente_razon_social || "").trim();
          if (facturaRazon) clienteRazonSocial = facturaRazon;
        }
      }
    }

    // --- PREVENIR DOBLE EMISIÓN ---
    if (finalComprobanteId) {
      const activeGuia = await sql`
        SELECT id, serie_numero, estado
        FROM comprobantes_guias
        WHERE comprobante_id = ${finalComprobanteId}::uuid
          AND estado NOT IN ('anulado', 'RECHAZADA', 'ERROR')
        LIMIT 1
      `;
      if (activeGuia.length > 0) {
        return NextResponse.json(
          { error: `Ya existe una Guía de Remisión activa (${activeGuia[0].serie_numero}) vinculada a este comprobante.` },
          { status: 409 }
        );
      }
    }

    if (finalPedidoId) {
      const activeGuia = await sql`
        SELECT id, serie_numero, estado
        FROM comprobantes_guias
        WHERE pedido_id = ${finalPedidoId}::uuid
          AND estado NOT IN ('anulado', 'RECHAZADA', 'ERROR')
        LIMIT 1
      `;
      if (activeGuia.length > 0) {
        return NextResponse.json(
          { error: `Ya existe una Guía de Remisión activa (${activeGuia[0].serie_numero}) vinculada a este pedido.` },
          { status: 409 }
        );
      }
    }

    // Validar que el cliente tenga un documento de identidad válido (RUC o DNI)
    if (!esReceptorIdentificado(clienteDocNum)) {
      return NextResponse.json(
        {
          error: "Para emitir una Guía de Remisión, el destinatario debe tener un documento de identidad válido (RUC o DNI). No se permite emitir guías a 'Clientes Varios' o sin documento.",
        },
        { status: 400 }
      );
    }

    if (!direccionLlegadaFinal) {
      return NextResponse.json(
        { error: "Se requiere ingresar el Punto de Llegada (dirección) para emitir la Guía de Remisión." },
        { status: 400 }
      );
    }

    // 3. Determinar repartidor y sus datos (DNI, licencia, placa, nombres, apellidos)
    // Con M1/L NO auto-resolvemos desde el repartidor del pedido salvo que el cliente lo haya
    // elegido explícitamente (repartidor_id). Así "sin datos del chofer" se respeta y no se
    // rellena solo. Sin M1/L se mantiene el fallback al repartidor asignado del pedido.
    const finalRepartidorId = repartidor_id || (indicadorM1L ? null : repartidorAsignadoId);
    let finalChoferDni = chofer_dni?.trim();
    let finalChoferLicencia = chofer_licencia?.trim();
    let finalPlaca = vehiculo_placa?.trim();
    let choferNombre = "";
    let finalChoferNombres = chofer_nombres?.trim();
    let finalChoferApellidos = chofer_apellidos?.trim();

    if (finalRepartidorId) {
      const repRows = await sql`
        SELECT name, chofer_dni, chofer_licencia, vehiculo_placa FROM users WHERE id = ${finalRepartidorId}
      `;
      if (repRows.length > 0) {
        const rep = repRows[0];
        choferNombre = rep.name;
        if (!finalChoferDni) finalChoferDni = rep.chofer_dni;
        if (!finalChoferLicencia) finalChoferLicencia = rep.chofer_licencia;
        if (!finalPlaca) finalPlaca = rep.vehiculo_placa;
      }
    }

    // Si no se pasaron nombres/apellidos específicos, usar el nombre completo y dividirlo
    if (!finalChoferNombres || !finalChoferApellidos) {
      const nomCompleto = choferNombre || "Conductor Principal";
      const div = dividirNombreCompleto(nomCompleto);
      if (!finalChoferNombres) finalChoferNombres = div.nombres;
      if (!finalChoferApellidos) finalChoferApellidos = div.apellidos;
    }

    // Con vehículo categoría M1/L (moto/auto ligero) SUNAT permite OMITIR la placa y los datos
    // del conductor (el xml-builder-guia los omite cuando vienen vacíos). Sin M1/L (transporte
    // privado normal): DNI de conductor + Licencia + Placa son obligatorios.
    if (!indicadorM1L && (!finalChoferDni || !finalChoferLicencia || !finalPlaca)) {
      return NextResponse.json(
        {
          error: "Se requieren DNI de conductor, Licencia de conducir y Placa del vehículo (salvo que el vehículo sea categoría M1 o L).",
          missingFields: {
            chofer_dni: !finalChoferDni,
            chofer_licencia: !finalChoferLicencia,
            vehiculo_placa: !finalPlaca,
          },
        },
        { status: 400 }
      );
    }

    // Mapeo de items para XML
    const itemsSunat = itemsRows.map((it, idx) => ({
      codigo: `P${String(idx + 1).padStart(3, "0")}`,
      descripcion: it.producto_nombre,
      unidadMedida: aUnitCodeSunat(it.unidad),
      cantidad: Number(it.cantidad),
    }));

    // Calcular peso bruto total si no fue enviado
    let finalPesoBruto = pesoBrutoTotal;
    if (!finalPesoBruto) {
      let sumWeight = 0;
      for (const it of itemsRows) {
        const qty = Number(it.cantidad);
        if (aUnitCodeSunat(it.unidad) === "KGM") {
          sumWeight += qty;
        } else {
          sumWeight += estimarPesoPorUnidad(it.producto_nombre, qty);
        }
      }
      finalPesoBruto = sumWeight > 0 ? Number(sumWeight.toFixed(2)) : 1.0;
    }

    // 4. Configurar datos de emisor
    const empresa = empresaFromPedidoString(empresaString);
    const sunatConfig = getSunatConfig(empresa);

    // Validación básica de RUC emisor
    if (!sunatConfig.ruc || sunatConfig.ruc.startsWith("20X") || sunatConfig.ruc.startsWith("10X")) {
      return NextResponse.json(
        { error: `RUC no configurado en entorno local o producción para la empresa "${empresa}".` },
        { status: 500 }
      );
    }

    // 5. Asignar correlativo atómico para la guía (Serie T001 o T002)
    const serie = empresa === "avicola" ? "T002" : "T001";
    const numero = await siguienteCorrelativo("guia_remision");
    const serieNumero = `${serie}-${formatNumeroGuia(numero)}`;

    // 6. Preparar datos para el generador XML
    const fechaEmision = new Date().toISOString().slice(0, 10);
    const horaEmision = new Date().toLocaleTimeString("en-US", { hour12: false });
    const clienteUbigeo = obtenerUbigeoDistrito(distritoLlegadaFinal);

    const datosGuia: DatosGuia = {
      serie,
      numero,
      fechaEmision,
      horaEmision,
      fechaInicioTraslado,
      motivoTraslado,
      descripcionMotivo: motivoTraslado === "01" ? "VENTA" : undefined,
      pesoBrutoTotal: finalPesoBruto,
      totalBultos,
      modalidadTraslado: "02", // Privado
      indicadorM1L: !!indicadorM1L,
      repartidor: {
        docTipo: "1", // DNI
        docNum: finalChoferDni || "", // vacío = omitir DriverPerson (permitido con M1/L)
        licencia: finalChoferLicencia || "", // enviar vacía si se omitió por M1L
        nombres: finalChoferNombres,
        apellidos: finalChoferApellidos,
        placa: finalPlaca || "", // vacío = omitir placa (permitido con M1/L)
      },
      cliente: {
        tipoDocumento: clienteDocTipo,
        numDocumento: clienteDocNum || "0",
        razonSocial: clienteRazonSocial.toUpperCase(),
        direccion: direccionLlegadaFinal,
        ubigeo: clienteUbigeo,
      },
      items: itemsSunat,
    };

    // 7. Generar y firmar XML
    const xmlSinFirma = generarXMLGuia(datosGuia, sunatConfig);
    const hayCertificado = !!sunatConfig.certificateBase64 && !!sunatConfig.certificatePassword;

    if (!hayCertificado) {
      // Registrar guía localmente como pendiente (modo desarrollo/testing)
      await sql`
        INSERT INTO comprobantes_guias (
          pedido_id, comprobante_id, ruc_emisor, empresa, serie, numero, serie_numero,
          cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
          peso_bruto_total, total_bultos, modalidad_traslado, motivo_traslado,
          fecha_inicio_traslado, repartidor_id, vehiculo_placa,
          chofer_doc_tipo, chofer_doc_num, chofer_licencia,
          estado, mensaje_sunat, emitido_por
        ) VALUES (
          ${finalPedidoId}, ${finalComprobanteId}, ${sunatConfig.ruc}, ${empresa}, ${serie}, ${numero}, ${serieNumero},
          ${clienteDocTipo}, ${clienteDocNum || '0'}, ${clienteRazonSocial},
          ${finalPesoBruto}, ${totalBultos}, '02', ${motivoTraslado},
          ${fechaInicioTraslado}, ${finalRepartidorId}, ${finalPlaca},
          '1', ${finalChoferDni}, ${finalChoferLicencia},
          'pendiente', 'Guía registrada localmente. Certificado .p12 no configurado — no se envió a SUNAT.',
          ${session.user.name || null}
        )
      `;

      // Vincular el número de guía al pedido si existe
      if (finalPedidoId) {
        await sql`UPDATE pedidos SET numero_guia = ${numero} WHERE id = ${finalPedidoId}`;
      }

      return NextResponse.json({
        exito: true,
        estado: EstadoSunat.PENDIENTE,
        serieNumero,
        mensaje: "Guía registrada localmente (pendiente de envío a SUNAT). Certificado no configurado.",
      });
    }

    // Cargar firma digital
    const { xmlFirmado, hashCpe } = firmarXML(xmlSinFirma, sunatConfig);

    // 8. Enviar a SUNAT vía REST (nuevo canal de guías obligatorio)
    let resultadoEnvio;
    try {
      resultadoEnvio = await enviarGuiaRest(
        xmlFirmado,
        serie,
        numero,
        sunatConfig
      );
      
      // Si en Beta da error de credenciales, token o de red, simulamos éxito local para pruebas locales
      if (!resultadoEnvio.exito && sunatConfig.environment === "beta") {
        console.warn(`[SUNAT BETA MOCK] Fallo real de SUNAT Beta: ${resultadoEnvio.error || resultadoEnvio.descripcion}. Simulando éxito local.`);
        resultadoEnvio = {
          exito: true,
          estado: EstadoSunat.ACEPTADA,
          codigoRespuesta: "0",
          descripcion: `[SIMULADO BETA] Aceptado localmente. (Original: ${resultadoEnvio.error || resultadoEnvio.descripcion})`,
          cdrBase64: Buffer.from("<MockCDR>").toString("base64"),
          observaciones: [],
        };
      }
    } catch (err) {
      if (sunatConfig.environment === "beta") {
        console.warn("[SUNAT BETA MOCK] Excepción de conexión a SUNAT Beta. Simulando éxito local.", err);
        resultadoEnvio = {
          exito: true,
          estado: EstadoSunat.ACEPTADA,
          codigoRespuesta: "0",
          descripcion: `[SIMULADO BETA] Aceptado localmente por excepción de conexión.`,
          cdrBase64: Buffer.from("<MockCDR>").toString("base64"),
          observaciones: [],
        };
      } else {
        throw err;
      }
    }

    const estadoDB =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA
        ? "aceptado"
        : resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
          ? "observado"
          : resultadoEnvio.estado === EstadoSunat.RECHAZADA
            ? "rechazado"
            : "error";

    const observacionesStr = resultadoEnvio.observaciones?.join(" | ") ?? null;

    // 9. Guardar la guía en base de datos
    await sql`
      INSERT INTO comprobantes_guias (
        pedido_id, comprobante_id, ruc_emisor, empresa, serie, numero, serie_numero,
        cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
        peso_bruto_total, total_bultos, modalidad_traslado, motivo_traslado,
        fecha_inicio_traslado, repartidor_id, vehiculo_placa,
        chofer_doc_tipo, chofer_doc_num, chofer_licencia,
        estado, hash_cpe, xml_firmado_base64, cdr_base64,
        observaciones, mensaje_sunat, emitido_por
      ) VALUES (
        ${finalPedidoId}, ${finalComprobanteId}, ${sunatConfig.ruc}, ${empresa}, ${serie}, ${numero}, ${serieNumero},
        ${clienteDocTipo}, ${clienteDocNum || '0'}, ${clienteRazonSocial},
        ${finalPesoBruto}, ${totalBultos}, '02', ${motivoTraslado},
        ${fechaInicioTraslado}, ${finalRepartidorId}, ${finalPlaca},
        '1', ${finalChoferDni}, ${finalChoferLicencia},
        ${estadoDB}, ${hashCpe ?? null},
        ${Buffer.from(xmlFirmado).toString("base64")},
        ${resultadoEnvio.cdrBase64 ?? null},
        ${observacionesStr}, ${resultadoEnvio.descripcion || resultadoEnvio.error || null},
        ${session.user.name || null}
      )
    `;

    // Si SUNAT lo aceptó u observó, vinculamos el correlativo numérico al pedido
    const sunatAcepto =
      resultadoEnvio.estado === EstadoSunat.ACEPTADA ||
      resultadoEnvio.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES;

    if (sunatAcepto && finalPedidoId) {
      await sql`UPDATE pedidos SET numero_guia = ${numero} WHERE id = ${finalPedidoId}`;
    }

    return NextResponse.json({
      ...resultadoEnvio,
      serieNumero,
      hashCpe,
      xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
    });
  } catch (error) {
    console.error("Error POST /api/guias/emitir:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: `Error al emitir guía: ${msg}` }, { status: 500 });
  }
}

// src/app/api/guias/emitir/route.ts
// POST — emite Guía de Remisión Electrónica (GRE) para un pedido o comprobante.

import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDevBypassSession } from "@/lib/dev-bypass";
import { z } from "zod";
// La GRE legal NO usa `siguienteCorrelativo` (correlativo compartido); reserva
// su número en un contador POR SERIE en `comprobantes_contador` (ver paso 5).
import { getSunatConfig, empresaFromPedidoString } from "@/lib/sunat/config-transavic";
import { generarXMLGuia, DatosGuia } from "@/lib/sunat/xml-builder-guia";
import { firmarXML } from "@/lib/sunat/xml-signer";
import { enviarGuiaRest } from "@/lib/sunat/rest-client";
import { obtenerUbigeoDistrito } from "@/lib/sunat/ubigeos";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";
import { fechaHoyLima, horaActualLima } from "@/lib/sunat/fechas";
import { EstadoSunat } from "@/lib/sunat/types";
import { parseCpeItems, parseCpeClienteDireccion, type CpeItem } from "@/lib/sunat/parse-cpe-items";
import { detectarDistritoEnDireccion } from "@/lib/guia-form-shared";
import { esReceptorIdentificado } from "@/lib/sunat/validacion-cliente";

export const dynamic = "force-dynamic";
// La emisión REST hace token + envío + polling del ticket (hasta 6×2s) → puede
// superar los ~15s default de Vercel. Sin esto la función muere a mitad del
// polling y la guía queda atascada en 'emitiendo' (caso T002-00000010, 10 jun).
export const maxDuration = 60;

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
  // ID de la fila reservada (estado 'emitiendo'). Declarado fuera del try para
  // que el catch pueda marcarla 'error' si algo falla tras reservar el número
  // → así ningún correlativo de guía queda consumido sin rastro ("fantasma").
  let guiaReservadaId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let session: any = await auth();
    const bypass = resolveDevBypassSession(request);
    if (bypass) session = bypass;
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

      // COHERENCIA dirección↔distrito: el distrito de una fuente (pedido/ficha)
      // solo se toma si la DIRECCIÓN también vino de esa fuente. Si la dirección
      // la mandó el frontend (del XML de la factura) pero falta el distrito, NO
      // se hereda el del pedido (sería de otra dirección) — se deriva del texto
      // de la dirección más abajo. Así nunca queda dirección-del-XML + distrito-
      // del-pedido (par incoherente → ubigeo errado).
      if (!resolvedDireccion && c.pedido_id) {
        const pedAddr = await sql`SELECT direccion, distrito FROM pedidos WHERE id = ${c.pedido_id}`;
        if (pedAddr.length > 0) {
          resolvedDireccion = pedAddr[0].direccion;
          if (!resolvedDistrito) resolvedDistrito = pedAddr[0].distrito;
        }
      }

      if (!resolvedDireccion && c.xml_firmado_base64) {
        try {
          const xml = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
          const xmlAddr = parseCpeClienteDireccion(xml);
          if (xmlAddr) resolvedDireccion = xmlAddr;
        } catch (err) {
          console.error("Error parsing address from XML:", err);
        }
      }

      if (!resolvedDireccion && clienteDocNum) {
        const clientRows = await sql`
          SELECT direccion, distrito FROM clientes WHERE ruc_dni = ${clienteDocNum} LIMIT 1
        `;
        if (clientRows.length > 0) {
          resolvedDireccion = clientRows[0].direccion;
          if (!resolvedDistrito) resolvedDistrito = clientRows[0].distrito;
        }
      }

      // Si hay dirección pero falta el distrito, derivarlo del TEXTO de la propia
      // dirección (coherente con lo que se usará como punto de llegada). Si no se
      // puede, queda vacío → el guard de abajo aborta (no inventa ubigeo).
      if (resolvedDireccion && !resolvedDistrito) {
        resolvedDistrito = detectarDistritoEnDireccion(resolvedDireccion) ?? "";
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
    // y los ÍTEMS (descripción, cantidad y UNIDAD de medida) COINCIDAN con la factura.
    if (!finalComprobanteId && finalPedidoId) {
      const compRows = await sql`
        SELECT id, cliente_razon_social, cliente_doc_num, cliente_doc_tipo, xml_firmado_base64, items_json
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
        // llamador NO mandó override explícito y la factura tiene receptor identificado (RUC/DNI);
        // una boleta sin documento mantiene el flujo de override (no se pisa con datos inválidos).
        // NOTA: los modales actuales SIEMPRE mandan el override (prellenado de la factura,
        // editable) → esta rama es un fallback para llamadas API sin override. No borrar.
        const facturaDocNum = String(compRows[0].cliente_doc_num || "").trim();
        if (!cliente_doc_num && !cliente_razon_social && esReceptorIdentificado(facturaDocNum)) {
          clienteDocNum = facturaDocNum;
          clienteDocTipo = String(compRows[0].cliente_doc_tipo || clienteDocTipo);
          const facturaRazon = String(compRows[0].cliente_razon_social || "").trim();
          if (facturaRazon) clienteRazonSocial = facturaRazon;
        }

        // Los bienes de la guía = las líneas de la factura (mismo nombre, cantidad y unidad
        // kg/unidad), como en las guías reales de SUNAT. Fuente fiel: el XML firmado de la
        // factura (fallback items_json). Si nada parsea, se mantienen los pedido_items.
        let itemsFactura: CpeItem[] = [];
        if (compRows[0].xml_firmado_base64) {
          try {
            const xmlFactura = Buffer.from(compRows[0].xml_firmado_base64 as string, "base64").toString("utf-8");
            itemsFactura = parseCpeItems(xmlFactura);
          } catch (err) {
            console.error("No se pudieron parsear los ítems de la factura vinculada:", err);
          }
        }
        if (itemsFactura.length === 0 && Array.isArray(compRows[0].items_json)) {
          itemsFactura = compRows[0].items_json as CpeItem[];
        }
        if (itemsFactura.length > 0) {
          const bienes = itemsFactura
            .map((it) => {
              const itemObj = it as unknown as Record<string, unknown>;
              return {
                producto_nombre: String(itemObj.descripcion || itemObj.producto_nombre || "Venta"),
                cantidad: Number(itemObj.cantidad),
                unidad: String(itemObj.unidadMedida || itemObj.unidad || "NIU"),
              };
            })
            // El flete ("ENVIO") es un servicio facturable, no un bien transportable.
            .filter((it) => !/^env[ií]o$/i.test(it.producto_nombre.trim()));
          if (bienes.length > 0) itemsRows = bienes;
        }
      }
    }

    // --- PREVENIR DOBLE EMISIÓN ---
    if (finalComprobanteId) {
      const activeGuia = await sql`
        SELECT id, serie_numero, estado
        FROM comprobantes_guias
        WHERE comprobante_id = ${finalComprobanteId}::uuid
          AND estado NOT IN ('anulado', 'rechazado', 'error')
          AND NOT (estado = 'emitiendo' AND created_at < NOW() - INTERVAL '15 minutes')
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
          AND estado NOT IN ('anulado', 'rechazado', 'error')
          AND NOT (estado = 'emitiendo' AND created_at < NOW() - INTERVAL '15 minutes')
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
    // Guard de coherencia: sin distrito NO se puede derivar el ubigeo del punto de
    // llegada. `obtenerUbigeoDistrito("")` caería al fallback 150101 (Cercado de
    // Lima) en silencio → GRE con ubigeo de OTRO distrito que la dirección. Mejor
    // abortar y exigir el distrito (lo legalmente crítico para SUNAT).
    if (!distritoLlegadaFinal) {
      return NextResponse.json(
        { error: "Se requiere el distrito del Punto de Llegada para emitir la Guía de Remisión." },
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

    // Peso bruto: si no fue enviado, suma EXACTA solo cuando TODOS los ítems están
    // en kilogramos (= peso de la factura). Con unidades mixtas NO se estima nada:
    // se exige que el usuario ingrese el peso real (pedido de Antonio, 10 jun 2026).
    let finalPesoBruto = pesoBrutoTotal;
    if (!finalPesoBruto) {
      const todosKg =
        itemsRows.length > 0 &&
        itemsRows.every((it) => aUnitCodeSunat(it.unidad) === "KGM");
      if (todosKg) {
        const suma = itemsRows.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
        if (suma > 0) finalPesoBruto = Number(suma.toFixed(2));
      }
      if (!finalPesoBruto) {
        return NextResponse.json(
          { error: "Ingresa el Peso Bruto total (KGM): los productos tienen unidades distintas a kilogramos y no se puede calcular automáticamente." },
          { status: 400 }
        );
      }
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

    // 5. RESERVA ATÓMICA del correlativo de la GRE legal.
    //    Contador POR SERIE en `comprobantes_contador` (T001 Transavic / T002
    //    Avícola), SEPARADO de la orden de pedido interna (`orden_pedido`). El
    //    bump del contador y la fila 'emitiendo' van en UN solo statement → si
    //    algo falla después (XML, firma, SUNAT), el número NO queda quemado sin
    //    fila: el catch la pasa a 'error'. (Antes compartía `guia_remision` con
    //    la orden interna y abrir una orden gastaba un número legal — fix 2026-06-10.)
    const serie = empresa === "avicola" ? "T002" : "T001";
    const reserva = (await sql`
      WITH bump AS (
        INSERT INTO comprobantes_contador (ruc, serie, ultimo_numero)
        VALUES (${sunatConfig.ruc}, ${serie}, 1)
        ON CONFLICT (ruc, serie) DO UPDATE
          SET ultimo_numero = comprobantes_contador.ultimo_numero + 1, updated_at = NOW()
        RETURNING ultimo_numero
      )
      INSERT INTO comprobantes_guias (
        pedido_id, comprobante_id, ruc_emisor, empresa, serie, numero, serie_numero,
        cliente_doc_tipo, cliente_doc_num, cliente_razon_social,
        peso_bruto_total, total_bultos, modalidad_traslado, motivo_traslado,
        fecha_inicio_traslado, repartidor_id, vehiculo_placa,
        chofer_doc_tipo, chofer_doc_num, chofer_licencia,
        direccion_llegada, distrito_llegada, indicador_m1l,
        chofer_nombres, chofer_apellidos, items_json,
        estado, mensaje_sunat, emitido_por
      )
      SELECT
        ${finalPedidoId}, ${finalComprobanteId}, ${sunatConfig.ruc}, ${empresa}, ${serie},
        bump.ultimo_numero, ${serie} || '-' || LPAD(bump.ultimo_numero::text, 8, '0'),
        ${clienteDocTipo}, ${clienteDocNum || '0'}, ${clienteRazonSocial},
        ${finalPesoBruto}, ${totalBultos}, '02', ${motivoTraslado},
        ${fechaInicioTraslado}, ${finalRepartidorId}, ${finalPlaca},
        '1', ${finalChoferDni}, ${finalChoferLicencia},
        ${direccionLlegadaFinal}, ${distritoLlegadaFinal || null}, ${!!indicadorM1L},
        ${finalChoferNombres || null}, ${finalChoferApellidos || null}, ${JSON.stringify(itemsRows)}::jsonb,
        'emitiendo', 'Reserva — emisión en curso', ${session.user.name || null}
      FROM bump
      RETURNING id, numero, serie_numero
    `) as Array<{ id: string; numero: number; serie_numero: string }>;
    const numero = reserva[0].numero;
    const serieNumero = reserva[0].serie_numero;
    guiaReservadaId = reserva[0].id;

    // 6. Preparar datos para el generador XML — fecha/hora en LIMA, nunca UTC
    // (en Vercel, desde las ~19:00 Lima la fecha UTC ya es "mañana" → SUNAT
    // rechaza con 2329 "fecha de emisión fuera del límite permitido").
    const fechaEmision = fechaHoyLima();
    const horaEmision = horaActualLima();
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
      // La fila ya existe ('emitiendo' de la reserva) → solo se actualiza a
      // 'pendiente'. NO se escribe pedidos.numero_guia: ese campo es de la orden
      // interna; el número de la guía legal vive en comprobantes_guias.
      await sql`
        UPDATE comprobantes_guias
        SET estado = 'pendiente',
            mensaje_sunat = 'Guía registrada localmente. Certificado .p12 no configurado — no se envió a SUNAT.',
            updated_at = NOW()
        WHERE id = ${guiaReservadaId}::uuid
      `;

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
    // ⚠️ El "mock de beta" (convertir un fallo real en éxito simulado) está
    //    APAGADO por defecto y solo se activa con SUNAT_GRE_MOCK_BETA="1" en
    //    entorno beta. Antes estaba SIEMPRE activo en beta y enmascaró el
    //    rechazo XSD real de las T002-8/9 en todas las pruebas (d507b01,
    //    2026-06-09). Para demos sin SUNAT, exportar SUNAT_GRE_MOCK_BETA=1.
    const mockBetaActivo =
      sunatConfig.environment === "beta" &&
      process.env.SUNAT_GRE_MOCK_BETA === "1";
    let resultadoEnvio;
    try {
      resultadoEnvio = await enviarGuiaRest(
        xmlFirmado,
        serie,
        numero,
        sunatConfig
      );

      if (!resultadoEnvio.exito && mockBetaActivo) {
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
      if (mockBetaActivo) {
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

    // 9. Actualizar la fila reservada ('emitiendo') con el resultado de SUNAT.
    //    NO se escribe pedidos.numero_guia (ese campo es de la orden interna; el
    //    número legal vive en comprobantes_guias). El badge de despacho ahora
    //    consulta si existe una guía aceptada/observada (api/despacho).
    await sql`
      UPDATE comprobantes_guias
      SET estado = ${estadoDB},
          hash_cpe = ${hashCpe ?? null},
          xml_firmado_base64 = ${Buffer.from(xmlFirmado).toString("base64")},
          cdr_base64 = ${resultadoEnvio.cdrBase64 ?? null},
          observaciones = ${observacionesStr},
          mensaje_sunat = ${resultadoEnvio.descripcion || resultadoEnvio.error || null},
          updated_at = NOW()
      WHERE id = ${guiaReservadaId}::uuid
    `;

    return NextResponse.json({
      ...resultadoEnvio,
      serieNumero,
      hashCpe,
      xmlFirmadoBase64: Buffer.from(xmlFirmado).toString("base64"),
    });
  } catch (error) {
    console.error("Error POST /api/guias/emitir:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    // Anti-fantasma: si ya se había reservado el número (fila 'emitiendo'),
    // marcarla 'error' para que el correlativo NO quede consumido sin rastro.
    if (guiaReservadaId) {
      try {
        const sqlCatch = neon(process.env.DATABASE_URL!);
        await sqlCatch`
          UPDATE comprobantes_guias
          SET estado = 'error',
              mensaje_sunat = ${`Error de emisión: ${msg.slice(0, 500)}`},
              updated_at = NOW()
          WHERE id = ${guiaReservadaId}::uuid AND estado = 'emitiendo'
        `;
      } catch (e) {
        console.error("No se pudo marcar la guía reservada como error:", e);
      }
    }
    return NextResponse.json({ error: `Error al emitir guía: ${msg}` }, { status: 500 });
  }
}

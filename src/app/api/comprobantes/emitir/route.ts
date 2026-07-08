// src/app/api/comprobantes/emitir/route.ts
// POST — emite comprobante para un pedido (factura o boleta).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { emitirComprobante } from "@/lib/sunat";
import {
  TipoComprobante,
  TipoDocIdentidad,
  EstadoSunat,
} from "@/lib/sunat/types";
import { empresaFromPedidoString } from "@/lib/sunat/config-transavic";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";
import {
  esRucValido,
  esReceptorIdentificado,
} from "@/lib/sunat/validacion-cliente";
import { buscarComprobanteDuplicado } from "@/lib/sunat/duplicado";
import { controlarPrecioMinimo } from "@/lib/autorizaciones-precio";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";
import { validarFechaEmision } from "@/lib/sunat/fechas";
import {
  MAX_OBSERVACION_CPE,
  validarObservacionSunat,
} from "@/lib/sunat/observaciones";

export const dynamic = "force-dynamic";
// El envío a SUNAT puede superar los ~15s default de Vercel (gotcha #30b).
export const maxDuration = 60;

const Schema = z.object({
  pedido_id: z.string().uuid(),
  tipo: z.enum(["01", "03"]),
  empresa: z.enum(["transavic", "avicola"]).optional(),
  formaPago: z.enum(["Contado", "Credito"]).default("Contado"),
  plazoDias: z.number().int().min(0).max(120).default(0),
  // Fecha de emisión (YYYY-MM-DD). Opcional: si no viene, el motor usa hoy en Lima.
  // El rango permitido (hoy, o retroactiva 3 días factura / 7 boleta) se valida abajo.
  fechaEmision: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  observacionComprobante: z.string().optional().nullable(),
  // Si la asesora ya confirmó el aviso de "comprobante duplicado", emite igual.
  confirmarDuplicado: z.boolean().default(false),
  // ID de autorización de precio mínimo (aprobada por el admin).
  autorizacion_id: z.string().uuid().optional().nullable(),
  // Datos del receptor desde el form (al facturar desde el modal). Si no vienen,
  // se usan los del pedido en DB. Evita el error SUNAT 2021 (razón social vacía).
  cliente_override: z
    .object({
      numDocumento: z.string().trim().optional(),
      razonSocial: z.string().trim().optional(),
      direccion: z.string().trim().max(250).optional(),
    })
    .optional(),
  // Items opcionales: si se pasan, se usan estos (para edits "antes de emitir").
  // Si no, se usan los items del pedido tal cual están en DB.
  items_override: z
    .array(
      z.object({
        producto_nombre: z.string(),
        cantidad: z.number().positive(),
        unidad: z.string(),
        precio_unitario: z.number().positive(),
        codigo: z.string().trim().optional(),
      })
    )
    .optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["asesor", "admin"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo asesores o admin pueden emitir comprobantes" },
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

    // Fecha de emisión: si la mandaron, validar el rango por tipo (no futura;
    // factura hasta 3 días atrás, boleta 7). Defensa en servidor: una asesora no
    // puede saltarse el límite manipulando el request.
    if (parsed.data.fechaEmision) {
      const v = validarFechaEmision(parsed.data.fechaEmision, parsed.data.tipo);
      if (!v.ok) {
        return NextResponse.json({ error: v.motivo }, { status: 400 });
      }
    }
    const obs = validarObservacionSunat(
      parsed.data.observacionComprobante,
      MAX_OBSERVACION_CPE
    );
    if (!obs.ok) {
      return NextResponse.json({ error: obs.error }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Cargar pedido + verificar ownership
    const pedidoRows = (await sql`
      SELECT cliente_id, cliente, razon_social, ruc_dni, empresa, asesor_id, origen
      FROM pedidos WHERE id = ${parsed.data.pedido_id}
    `) as Array<{
      cliente_id: string | null;
      cliente: string;
      razon_social: string | null;
      ruc_dni: string | null;
      empresa: string;
      asesor_id: string | null;
      origen: string | null;
    }>;

    if (pedidoRows.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    const pedido = pedidoRows[0];

    if (session.user.role === "asesor" && pedido.asesor_id !== session.user.id) {
      return NextResponse.json(
        { error: "No puedes emitir comprobantes de pedidos ajenos" },
        { status: 403 }
      );
    }

    // Datos del receptor: preferir lo que mandó el form (cliente_override) y, si
    // no, lo del pedido. Se usa `||` (no `??`) a propósito: un razon_social ""
    // (string vacío) cae al nombre del cliente → evita el error SUNAT 2021
    // ("RegistrationName del receptor vacío").
    const ov = parsed.data.cliente_override;
    const cliNumDoc = (ov?.numDocumento?.trim() || pedido.ruc_dni || "").trim();
    const cliRazon = (
      ov?.razonSocial?.trim() ||
      pedido.razon_social?.trim() ||
      pedido.cliente ||
      ""
    ).trim();
    const cliDireccion = ov?.direccion?.trim() || undefined;
    // Documento del receptor: validación robusta (rechaza relleno como 00000000).
    const docPresente = cliNumDoc.length > 0 && cliNumDoc !== "0";
    const tieneRuc = esRucValido(cliNumDoc);
    const identificado = esReceptorIdentificado(cliNumDoc); // DNI válido o RUC válido

    // Validación: factura requiere RUC del cliente (11 dígitos) + razón social.
    if (parsed.data.tipo === "01" && !tieneRuc) {
      return NextResponse.json(
        {
          error:
            "Para emitir FACTURA el cliente debe tener RUC (11 dígitos). Para personas naturales emitir BOLETA.",
        },
        { status: 400 }
      );
    }
    if (parsed.data.tipo === "01" && !cliRazon) {
      return NextResponse.json(
        { error: "La factura requiere la razón social del cliente." },
        { status: 400 }
      );
    }

    // Cargar items (de override o de DB)
    let items: Array<{
      producto_nombre: string;
      cantidad: number;
      unidad: string;
      precio_unitario: number;
      codigo?: string;
    }>;
    if (parsed.data.items_override) {
      items = parsed.data.items_override;
    } else {
      const rows = (await sql`
        SELECT producto_nombre,
          COALESCE(cantidad_real, cantidad)::numeric AS cantidad,
          unidad,
          COALESCE(precio_unitario, 0)::numeric AS precio_unitario
        FROM pedido_items
        WHERE pedido_id = ${parsed.data.pedido_id}
      `) as Array<{
        producto_nombre: string;
        cantidad: string | number;
        unidad: string;
        precio_unitario: string | number;
      }>;
      items = rows
        .map((r) => ({
          producto_nombre: r.producto_nombre,
          cantidad: Number(r.cantidad),
          unidad: r.unidad,
          precio_unitario: Number(r.precio_unitario),
        }))
        .filter((it) => it.cantidad > 0);
    }

    if (items.length === 0 || items.every((it) => it.precio_unitario === 0)) {
      return NextResponse.json(
        {
          error:
            "Los items no tienen precio definido. Asegúrate de que los productos tengan precio en /dashboard/precios.",
        },
        { status: 400 }
      );
    }

    const empresa = parsed.data.empresa || empresaFromPedidoString(pedido.empresa);

    // ── Validación de precio mínimo (solo asesoras) ──
    // El admin puede emitir cualquier precio. El helper compartido usa la
    // autorización enviada O busca automáticamente una aprobada sin usar que
    // cubra los ítems (la asesora ya no depende del link de la notificación).
    let autorizacionUsadaId: string | null = null;
    if (session.user.role === "asesor") {
      const control = await controlarPrecioMinimo(sql, {
        items: items.map((it) => ({
          nombre: it.producto_nombre,
          precioUnitario: it.precio_unitario,
          cantidad: it.cantidad,
        })),
        asesoraId: session.user.id,
        autorizacionId: parsed.data.autorizacion_id ?? null,
        empresa,
        tipo: parsed.data.tipo,
        clienteNumDoc: cliNumDoc || null,
      });
      if (!control.ok) {
        return NextResponse.json(control.body, { status: control.status });
      }
      autorizacionUsadaId = control.autorizacionId;
    }

    // ════════════════════════════════════════════════════════════════════
    // CONVENCIÓN CRÍTICA DE PRECIOS (decisión de negocio Transavic 2026):
    //
    // Los precios en `productos.precio_venta` y `pedido_items.precio_unitario`
    // se ALMACENAN CON IGV INCLUIDO (lo que Antonio cobra al cliente final).
    //
    // Razones:
    //   1. Antonio piensa en "vendo el pollo a S/12" (con IGV), no en
    //      "S/10.17 + IGV". Carga precios "como los cobra".
    //   2. Las asesoras ven precios CON IGV en el ticket que se manda por WA.
    //   3. SUNAT solo necesita el desglose en el XML (lo calculamos abajo).
    //
    // Por eso ANTES de mandar a SUNAT dividimos entre 1.18 para obtener el
    // valor neto (sin IGV). El IGV se suma automáticamente en xml-builder.
    //
    // Si esta convención cambia, actualizar:
    //   - CLAUDE.md §12 (gotchas)
    //   - /dashboard/precios (UI debería decir "Precio CON IGV")
    //   - scripts/seed-precios-2026.mjs (verificar)
    // ════════════════════════════════════════════════════════════════════
    const IGV_FACTOR = 1.18;

    // Código interno por producto (SellersItemIdentification): lookup en el
    // catálogo por nombre (código estable); fallback secuencial si el producto
    // no está catalogado. Así el XML siempre lleva el código del producto.
    const codRows = (await sql`
      SELECT LOWER(TRIM(nombre)) AS nom, codigo
      FROM productos WHERE codigo IS NOT NULL AND codigo <> ''
    `) as Array<{ nom: string; codigo: string }>;
    const codMap = new Map(codRows.map((r) => [r.nom, r.codigo]));

    const itemsSunat = items.map((it, idx) => {
      const precioConIgv = it.precio_unitario;
      const precioSinIgv = precioConIgv / IGV_FACTOR;
      // Sanity check: detectar precios sospechosos (negativos, infinitos, NaN)
      if (
        !Number.isFinite(precioSinIgv) ||
        precioSinIgv <= 0 ||
        precioConIgv > 100000
      ) {
        throw new Error(
          `Precio inválido para "${it.producto_nombre}": ${it.precio_unitario}. Revisar catálogo.`
        );
      }
      return {
        codigo:
          it.codigo ||
          codMap.get(it.producto_nombre.trim().toLowerCase()) ||
          `P${String(idx + 1).padStart(3, "0")}`,
        descripcion: it.producto_nombre,
        unidadMedida: aUnitCodeSunat(it.unidad),
        cantidad: it.cantidad,
        precioUnitario: Number(precioSinIgv.toFixed(4)),
        igvPorcentaje: 18,
      };
    });

    // Sanity check global: el total con IGV debe ser razonable (>0, <500K).
    const totalConIgv = items.reduce(
      (sum, it) => sum + it.precio_unitario * it.cantidad,
      0
    );
    if (totalConIgv <= 0 || totalConIgv > 500000) {
      return NextResponse.json(
        {
          error: `Total del comprobante fuera de rango (S/ ${totalConIgv.toFixed(2)}). Revisar precios y cantidades.`,
        },
        { status: 400 }
      );
    }

    // Boleta: validar documento e identificación del cliente.
    if (parsed.data.tipo === "03") {
      if (docPresente && !identificado) {
        // Pusieron un documento pero no es válido (ej. 00000000 de relleno).
        return NextResponse.json(
          {
            error: `El documento del cliente ("${cliNumDoc}") no es válido. Corrige el DNI (8 dígitos) o RUC del cliente antes de emitir la boleta.`,
          },
          { status: 400 }
        );
      }
      if (totalConIgv > 700 && !identificado) {
        // SUNAT exige identificar al cliente en boletas ≥ S/700.
        return NextResponse.json(
          {
            error:
              "Las boletas mayores a S/700 requieren el DNI o RUC del cliente (regla SUNAT). Edita el cliente y agrega su documento.",
          },
          { status: 400 }
        );
      }
      // Sin documento válido y < S/700: NO se traba — la boleta sale a "CLIENTES
      // VARIOS" (ver el cliente abajo). El nombre del cliente igual queda en el pedido.
    }

    // Anti-duplicado: avisar si ya hay un comprobante igual reciente (mismo
    // cliente identificado + tipo + monto), salvo que ya se haya confirmado.
    if (!parsed.data.confirmarDuplicado && identificado) {
      const dup = await buscarComprobanteDuplicado({
        empresa,
        tipo: parsed.data.tipo,
        clienteDocNum: cliNumDoc,
        montoTotal: totalConIgv,
      });
      if (dup) {
        return NextResponse.json(
          {
            duplicado: dup,
            mensaje: `Ya emitiste un comprobante igual (${dup.serieNumero}) por S/ ${totalConIgv.toFixed(2)} a este cliente.`,
          },
          { status: 409 }
        );
      }
    }

    const resultado = await emitirComprobante({
      empresa,
      tipo: parsed.data.tipo as TipoComprobante,
      pedidoId: parsed.data.pedido_id,
      cliente: identificado
        ? {
            tipoDocumento: tieneRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
            numDocumento: cliNumDoc,
            razonSocial: cliRazon.toUpperCase(),
            direccion: cliDireccion,
          }
        : {
            // Boleta < S/700 sin documento válido: SUNAT permite emitirla A NOMBRE
            // del cliente (tipo doc "0", número "0"). Si el pedido/form trae un
            // nombre lo respetamos; si no, "CLIENTES VARIOS". No inventamos DNI de ceros.
            tipoDocumento: TipoDocIdentidad.SIN_DOCUMENTO,
            numDocumento: "0",
            razonSocial: cliRazon ? cliRazon.toUpperCase() : "CLIENTES VARIOS",
            direccion: cliDireccion,
          },
      items: itemsSunat,
      formaPago: parsed.data.formaPago,
      plazoDias: parsed.data.plazoDias,
      fechaEmision: parsed.data.fechaEmision,
      observacionComprobante: obs.value,
      emitidoPor: session.user.name?.trim() || undefined,
    });

    // P2.10 — Notificar al admin (y a la asesora del pedido) si SUNAT rechaza
    // o hay error de infra. Silencioso si falla — no rompe la respuesta.
    if (
      resultado.estado === EstadoSunat.RECHAZADA ||
      resultado.estado === EstadoSunat.ERROR
    ) {
      await notificarComprobanteConProblema({
        comprobanteId: "",
        serieNumero: resultado.serieNumero ?? null,
        tipo: parsed.data.tipo,
        estado: resultado.estado === EstadoSunat.RECHAZADA ? "RECHAZADA" : "ERROR",
        mensajeSunat: resultado.mensaje ?? resultado.error ?? null,
        pedidoId: parsed.data.pedido_id,
        empresa,
        asesorId: pedido.asesor_id ?? null,
      });
    }

    // Regla del negocio (Transavic, jun 2026): TODA venta —factura O boleta,
    // Contado o Crédito— crea SIEMPRE una cobranza, sin excepción. El "contado"
    // casi siempre se cobra días después; si el cliente ya pagó, la asesora marca
    // la cobranza como pagada a mano en /cobranzas. (Se quitó el check "¿ya pagó
    // en el acto?" porque confundía y dejaba ventas sin cobranza.) Solo se crea
    // si SUNAT aceptó (o quedó pendiente por falta de cert); si fue rechazado/
    // erró, no registramos deuda inválida ni duplicamos al reintentar.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    const esCredito = parsed.data.formaPago === "Credito";
    // El POS de planta lleva su PROPIA cobranza (cobranzas_planta para el crédito; el
    // contado ya se cobró en caja). NO crear cobranza en `facturas` para un pedido POS:
    // duplicaría la deuda y la reinyectaría en la cartera de ejecutivas (el comprobante
    // SUNAT igual se emite; solo se omite esta cobranza-fantasma).
    const esPos = pedido.origen === "pos_planta";
    const debeCrearCobranza = !!resultado.serieNumero && emisionOk && !esPos;

    if (debeCrearCobranza) {
      // Si la empresa emisora seleccionada en UI difiere de la del pedido, la sincronizamos en DB
      // para evitar descuadres entre reportes de pedidos y comprobantes.
      if (parsed.data.empresa && parsed.data.empresa !== empresaFromPedidoString(pedido.empresa)) {
        try {
          const nuevaEmpresaLabel = parsed.data.empresa === "avicola" ? "Avícola de Tony" : "Transavic";
          await sql`
            UPDATE pedidos
            SET empresa = ${nuevaEmpresaLabel}
            WHERE id = ${parsed.data.pedido_id}
          `;
        } catch (errUpdate) {
          console.error("Error al actualizar la empresa del pedido:", errUpdate);
        }
      }

      try {
        const { vincularCobranzaAComprobante, plazoDeCobranza } = await import("@/lib/cobranzas");
        // Asesor responsable de la cobranza, en cascada: el del PEDIDO (la venta
        // es suya aunque el ADMIN emita el comprobante) → la emisora si es
        // asesora → el de la ficha del cliente. Antes era solo "session si es
        // asesora" y las emisiones del admin dejaban cobranzas SIN asesor
        // (bug reportado 11 jun 2026).
        let cobranzaAsesorId: string | null = pedido.asesor_id ?? null;
        if (!cobranzaAsesorId && session.user.role === "asesor") {
          cobranzaAsesorId = session.user.id;
        }
        if (!cobranzaAsesorId && pedido.cliente_id) {
          const cliRows = await sql`SELECT asesor_id FROM clientes WHERE id = ${pedido.cliente_id}`;
          cobranzaAsesorId = (cliRows[0]?.asesor_id as string | null) ?? null;
        }
        // "Un pedido = una cobranza": si el pedido ya tiene cobranza (la creada al
        // entregar, sin comprobante), la ACTUALIZA con este comprobante en vez de
        // duplicar la deuda; si no, crea una nueva.
        await vincularCobranzaAComprobante({
          pedidoId: parsed.data.pedido_id,
          // Mismo nombre que fue al comprobante (cliRazon ya resuelve override del
          // form → razón social del pedido → nombre del cliente). Se usa `||` (no
          // `??`): un razon_social "" (vacío, no null) dejaba la cobranza SIN nombre
          // → la lista de /cobranzas mostraba solo el número de comprobante.
          clienteNombre: cliRazon || pedido.cliente || "Cliente",
          clienteId: pedido.cliente_id,
          asesorId: cobranzaAsesorId,
          // Total EMITIDO (== PayableAmount del XML), no el bruto crudo: la deuda
          // coincide EXACTO con el comprobante legal.
          monto: resultado.total ?? totalConIgv,
          // Crédito → plazo del form. Contado → plazo del CLIENTE
          // (plazo_pago_dias) o el default del negocio, en vez de vencer hoy.
          plazoDias: esCredito
            ? parsed.data.plazoDias
            : await plazoDeCobranza(pedido.cliente_id),
          numeroComprobante: resultado.serieNumero!,
          // Vencimiento y fecha_emision de la cobranza desde la fecha del comprobante
          // (no "hoy"), para que coincidan con el XML cuando la emisión es retroactiva.
          fechaEmision: parsed.data.fechaEmision,
        });
      } catch (errCobranza) {
        console.error(
          "Comprobante emitido para pedido pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
      }
    }

    // Recuperar el id del comprobante recién creado para que el ticket de éxito
    // muestre el botón "Descargar PDF" (igual que la emisión standalone).
    let comprobanteId: string | undefined;
    if (resultado.serieNumero) {
      try {
        const idRows = (await sql`
          SELECT id FROM comprobantes
          WHERE empresa = ${empresa} AND serie_numero = ${resultado.serieNumero}
          ORDER BY created_at DESC LIMIT 1
        `) as Array<{ id: string }>;
        comprobanteId = idRows[0]?.id;
      } catch {
        // si el lookup falla, el ticket igual ofrece "Ver comprobantes"
      }
    }

    // Marcar la autorización de precio como usada (una sola emisión por
    // autorización). SOLO se consume `autorizacionUsadaId` — la que el control
    // validó/auto-matcheó y la emisión realmente necesitó. El id del body
    // NUNCA se consume a ciegas: quemaba autorizaciones en emisiones que no
    // las usaban (asesora con link viejo y precios normales) y dejaba al admin
    // estampar usada_at en autorizaciones ajenas/pendientes. El guard
    // estado/usada_at hace el consumo atómico (dos emisiones concurrentes no
    // queman la misma dos veces sin que quede rastro).
    if (autorizacionUsadaId && emisionOk) {
      await sql`
        UPDATE autorizaciones_precio SET usada_at = NOW()
        WHERE id = ${autorizacionUsadaId}
          AND estado = 'aprobada' AND usada_at IS NULL
      `.catch(() => {});
    }

    return NextResponse.json({ ...resultado, id: comprobanteId });
  } catch (error) {
    console.error("Error en POST /api/comprobantes/emitir:", error);
    return NextResponse.json(
      { error: "Error al emitir comprobante" },
      { status: 500 }
    );
  }
}

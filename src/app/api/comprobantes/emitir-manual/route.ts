// src/app/api/comprobantes/emitir-manual/route.ts
// POST — emite un comprobante (factura/boleta) SIN pedido asociado.
// Para ventas de mostrador, ajustes, o comprobantes sueltos.
//
// Convención de precios: el form envía precio_unitario CON IGV (igual que el
// resto del sistema). Acá lo dividimos entre 1.18 antes de mandar a SUNAT.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDevBypassSession } from "@/lib/dev-bypass";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import {
  emitirComprobante,
  VentaCampoYaFacturadaError,
} from "@/lib/sunat";
import { TipoComprobante, TipoDocIdentidad, EstadoSunat } from "@/lib/sunat/types";
import { crearFacturaStandalone, plazoDeCobranza } from "@/lib/cobranzas";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";
import {
  esRucValido,
  esReceptorIdentificado,
} from "@/lib/sunat/validacion-cliente";
import { buscarComprobanteDuplicado } from "@/lib/sunat/duplicado";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";
import { controlarPrecioMinimo } from "@/lib/autorizaciones-precio";
import { validarFechaEmision } from "@/lib/sunat/fechas";
import {
  MAX_OBSERVACION_CPE,
  validarObservacionSunat,
} from "@/lib/sunat/observaciones";
import { consultarRuc } from "@/lib/apisperu";

export const dynamic = "force-dynamic";
// El envío a SUNAT puede superar los ~15s default de Vercel (gotcha #30b).
export const maxDuration = 60;

const ItemSchema = z.object({
  codigo: z.string().trim().optional(), // código interno (SellersItemIdentification)
  descripcion: z.string().trim().min(1, "Descripción requerida"),
  unidad: z.string().trim().min(1).default("NIU"),
  cantidad: z.number().positive(),
  precio_unitario: z.number().positive(), // CON IGV
});

const Schema = z.object({
  tipo: z.enum(["01", "03"]), // 01 = factura, 03 = boleta
  empresa: z.enum(["transavic", "avicola"]),
  // Documento y nombre son OPCIONALES: una boleta < S/700 puede ir a cliente
  // genérico ("CLIENTES VARIOS"). Las reglas por tipo/monto se validan abajo.
  cliente: z.object({
    id: z.string().uuid().optional().nullable(),
    numDocumento: z.string().trim().default(""),
    razonSocial: z.string().trim().default(""),
    direccion: z.string().trim().max(250).optional(), // opcional (SUNAT no la exige)
  }),
  items: z.array(ItemSchema).min(1, "Agrega al menos un ítem"),
  // Forma de pago: "Credito" genera una cobranza automática (factura en /cobranzas).
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
  // VENTA EN CAMPO: id de la fila `ventas_avicola` que se está facturando. Si viene,
  // el comprobante se enlaza a esa venta y NO se crea cobranza en `facturas` (la deuda
  // ya vive en el saldo avícola) — ver gotcha #47.
  ventaAvicolaId: z.string().uuid().optional().nullable(),
  // Solo para Campo: CPE 01/03 RECHAZADO que esta nueva emisión corrige.
  // SUNAT ya respondió sobre el anterior, por lo que se conserva su XML/CDR y
  // se consume un correlativo nuevo en vez de reenviar el XML rechazado.
  reemplazaComprobanteId: z.string().uuid().optional().nullable(),
});

/** Mapea la unidad a código SUNAT — delegado al helper compartido (un solo origen
 *  de verdad para todos los flujos de emisión). Acepta "kg"/"uni" crudos y los
 *  códigos "KGM"/"NIU" del form (idempotente, nunca degrada KGM→NIU). */
function mapUnidad(u: string): string {
  return aUnitCodeSunat(u);
}

type VentaCampoValidacion = {
  id: string;
  total: string | number;
  anulada: boolean;
  cliente_id: string;
  cliente_nombre: string;
  cliente_ruc_dni: string | null;
  cliente_empresa: string;
  items: Array<{
    producto_nombre: string;
    peso_kg: string | number;
    precio_kg: string | number;
    subtotal: string | number;
  }>;
};

const normalizarTextoComparacion = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleUpperCase("es-PE");

/**
 * La venta de campo es la fuente contable del saldo. El CPE debe ser una
 * representación fiel de esa venta; si Antonio necesita cambiar peso/precio,
 * primero debe editar la venta y recién después facturarla.
 */
function errorCoherenciaVentaCampo(
  venta: VentaCampoValidacion,
  payload: z.infer<typeof Schema>
): string | null {
  const empresaVenta = normalizarTextoComparacion(venta.cliente_empresa).startsWith("AV")
    ? "avicola"
    : "transavic";
  if (payload.empresa !== empresaVenta) {
    return "La empresa del comprobante no coincide con la empresa de la venta de campo.";
  }
  if (payload.cliente.id && payload.cliente.id !== venta.cliente_id) {
    return "El cliente del comprobante no corresponde al cliente de la venta de campo.";
  }

  const documentoGuardado = (venta.cliente_ruc_dni ?? "").trim();
  const documentoPayload = payload.cliente.numDocumento.trim();
  // Un cliente puede empezar con DNI y luego pedir factura con su RUC. Ese
  // upgrade es legítimo y se persiste después de emitir; otros cambios de un
  // documento ya identificado se bloquean para no facturar a un tercero.
  const upgradeDniARuc =
    documentoGuardado.length === 8 && documentoPayload.length === 11;
  if (
    documentoGuardado &&
    documentoPayload !== documentoGuardado &&
    !upgradeDniARuc
  ) {
    return "El documento del cliente no coincide con el documento guardado en la venta de campo.";
  }
  // En boletas sin documento, el nombre es el único identificador del receptor.
  // Con RUC/DNI permitimos la razón social oficial devuelta por la consulta SUNAT.
  if (
    !documentoPayload &&
    normalizarTextoComparacion(payload.cliente.razonSocial) !==
      normalizarTextoComparacion(venta.cliente_nombre)
  ) {
    return "El nombre del cliente no coincide con el cliente de la venta de campo.";
  }

  const ordenarItems = <T extends { descripcion: string; cantidad: number; precio: number }>(
    values: T[]
  ) =>
    [...values].sort((a, b) => {
      const porNombre = normalizarTextoComparacion(a.descripcion).localeCompare(
        normalizarTextoComparacion(b.descripcion),
        "es"
      );
      if (porNombre !== 0) return porNombre;
      if (a.cantidad !== b.cantidad) return a.cantidad - b.cantidad;
      return a.precio - b.precio;
    });

  const itemsVenta = ordenarItems(
    venta.items.map((item) => ({
      descripcion: item.producto_nombre,
      cantidad: Number(item.peso_kg),
      precio: Number(item.precio_kg),
      subtotal: Number(item.subtotal),
    }))
  );
  const itemsPayload = ordenarItems(
    payload.items.map((item) => ({
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio: item.precio_unitario,
      unidad: mapUnidad(item.unidad),
      subtotal: Math.round(item.cantidad * item.precio_unitario * 100) / 100,
    }))
  );

  if (itemsVenta.length !== itemsPayload.length) {
    return "Los ítems del comprobante no coinciden con los de la venta de campo.";
  }
  // Peso, precio y subtotal se almacenan con 2 decimales. Se admite solo la
  // tolerancia técnica de un céntimo; no ajustes comerciales durante la emisión.
  const TOLERANCIA = 0.011;
  for (let i = 0; i < itemsVenta.length; i += 1) {
    const esperado = itemsVenta[i];
    const recibido = itemsPayload[i];
    if (
      recibido.unidad !== "KGM" ||
      normalizarTextoComparacion(recibido.descripcion) !==
        normalizarTextoComparacion(esperado.descripcion) ||
      Math.abs(recibido.cantidad - esperado.cantidad) > TOLERANCIA ||
      Math.abs(recibido.precio - esperado.precio) > TOLERANCIA ||
      Math.abs(recibido.subtotal - esperado.subtotal) > TOLERANCIA
    ) {
      return `El ítem "${esperado.descripcion}" fue modificado. Ajusta primero la venta de campo y vuelve a facturarla.`;
    }
  }

  const totalPayload = itemsPayload.reduce((sum, item) => sum + item.subtotal, 0);
  if (Math.abs(totalPayload - Number(venta.total)) > TOLERANCIA) {
    return "El total del comprobante no coincide con el total de la venta de campo.";
  }
  return null;
}

export async function POST(request: Request) {
  let claimCampo: { ventaId: string; token: string } | null = null;
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
        { error: "Solo asesores o admin pueden emitir comprobantes" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // `ventaAvicolaId` cambia la clasificación y evita crear una cobranza en
    // `facturas`; por eso nunca se acepta desde una sesión de asesora.
    if (parsed.data.ventaAvicolaId && session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el administrador puede facturar ventas de campo." },
        { status: 403 }
      );
    }
    if (parsed.data.reemplazaComprobanteId && !parsed.data.ventaAvicolaId) {
      return NextResponse.json(
        { error: "Un comprobante de reemplazo debe estar vinculado a una venta de campo." },
        { status: 400 }
      );
    }

    // Claim temprano: se adquiere ANTES de validar/leer la venta y antes de
    // consumir correlativo. Cierra tanto el doble clic como la carrera con
    // editar/anular. Un token huérfano se puede recuperar tras 15 minutos.
    if (parsed.data.ventaAvicolaId) {
      const token = crypto.randomUUID();
      const sqlClaim = neon(process.env.DATABASE_URL!);
      const reemplazaId = parsed.data.reemplazaComprobanteId ?? null;
      const claimed = (await sqlClaim`
        UPDATE ventas_avicola v
        SET facturacion_claim_token = ${token}::uuid,
            facturacion_claim_at = NOW()
        WHERE v.id = ${parsed.data.ventaAvicolaId}::uuid
          AND NOT v.anulada
          AND (
            v.facturacion_claim_token IS NULL
            OR v.facturacion_claim_at < NOW() - INTERVAL '15 minutes'
          )
          AND (
            (
              ${reemplazaId}::uuid IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM comprobantes c
                WHERE c.venta_avicola_id = v.id AND c.tipo IN ('01', '03')
              )
            )
            OR (
              ${reemplazaId}::uuid IS NOT NULL
              -- El id enviado debe ser exactamente el último CPE de la venta.
              AND ${reemplazaId}::uuid = (
                SELECT ultimo.id
                FROM comprobantes ultimo
                WHERE ultimo.venta_avicola_id = v.id
                  AND ultimo.tipo IN ('01', '03')
                ORDER BY ultimo.created_at DESC, ultimo.id DESC
                LIMIT 1
              )
              AND EXISTS (
                SELECT 1 FROM comprobantes rechazado
                WHERE rechazado.id = ${reemplazaId}::uuid
                  AND rechazado.venta_avicola_id = v.id
                  AND rechazado.tipo IN ('01', '03')
                  AND rechazado.estado = 'rechazado'
              )
              AND NOT EXISTS (
                SELECT 1 FROM comprobantes hijo
                WHERE hijo.reemplaza_comprobante_id = ${reemplazaId}::uuid
                  AND hijo.tipo IN ('01', '03')
              )
              -- Error, pendiente, emitiendo o aceptado bloquean uno nuevo.
              AND NOT EXISTS (
                SELECT 1 FROM comprobantes activo
                WHERE activo.venta_avicola_id = v.id
                  AND activo.tipo IN ('01', '03')
                  AND activo.estado <> 'rechazado'
              )
            )
          )
        RETURNING v.id
      `) as Array<{ id: string }>;
      if (claimed.length === 0) {
        const rows = (await sqlClaim`
          SELECT
            v.id, v.anulada,
            v.facturacion_claim_token IS NOT NULL
              AND v.facturacion_claim_at >= NOW() - INTERVAL '15 minutes' AS facturando,
            c.id AS comprobante_id, c.serie_numero, c.estado AS comprobante_estado,
            EXISTS (
              SELECT 1 FROM comprobantes hijo
              WHERE hijo.reemplaza_comprobante_id = c.id
                AND hijo.tipo IN ('01', '03')
            ) AS comprobante_tiene_reemplazo
          FROM ventas_avicola v
          LEFT JOIN LATERAL (
            SELECT id, serie_numero, estado
            FROM comprobantes
            WHERE venta_avicola_id = v.id AND tipo IN ('01', '03')
            ORDER BY created_at DESC, id DESC LIMIT 1
          ) c ON TRUE
          WHERE v.id = ${parsed.data.ventaAvicolaId}::uuid
          LIMIT 1
        `) as Array<{
          id: string;
          anulada: boolean;
          facturando: boolean;
          comprobante_id: string | null;
          serie_numero: string | null;
          comprobante_estado: string | null;
          comprobante_tiene_reemplazo: boolean;
        }>;
        const actual = rows[0];
        if (!actual) {
          return NextResponse.json(
            { error: "La venta de campo no existe." },
            { status: 404 }
          );
        }
        if (actual.anulada) {
          return NextResponse.json(
            { error: "No se puede facturar una venta de campo anulada." },
            { status: 409 }
          );
        }
        if (reemplazaId) {
          if (actual.facturando) {
            return NextResponse.json(
              {
                codigo: "venta_campo_en_facturacion",
                error: "Esta venta ya se está facturando o corrigiendo en otra pestaña. Espera a que termine.",
              },
              { status: 409 }
            );
          }
          const reemplazoValido =
            actual.comprobante_id === reemplazaId &&
            actual.comprobante_estado === "rechazado" &&
            !actual.comprobante_tiene_reemplazo;
          if (!reemplazoValido) {
            return NextResponse.json(
              {
                codigo: "reemplazo_campo_invalido",
                comprobanteId: actual.comprobante_id,
                serieNumero: actual.serie_numero,
                estado: actual.comprobante_estado,
                error:
                  "Solo se puede corregir el último comprobante rechazado de la venta cuando todavía no tiene un reemplazo.",
              },
              { status: 409 }
            );
          }
        }
        if (actual.comprobante_id) {
          return NextResponse.json(
            {
              codigo: "venta_campo_ya_facturada",
              comprobanteId: actual.comprobante_id,
              serieNumero: actual.serie_numero,
              estado: actual.comprobante_estado,
              error:
                actual.comprobante_estado === "rechazado"
                  ? `Esta venta ya tiene el comprobante ${actual.serie_numero} rechazado. Usa "Corregir y emitir nuevo" para conservarlo y generar otro correlativo.`
                  : actual.comprobante_estado === "error"
                    ? `Esta venta ya tiene el comprobante ${actual.serie_numero} con error. Reintenta ese mismo comprobante; no emitas otro.`
                    : `Esta venta ya tiene el comprobante ${actual.serie_numero}. No se puede facturar dos veces.`,
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          {
            codigo: "venta_campo_en_facturacion",
            error: actual.facturando
              ? "Esta venta ya se está facturando en otra pestaña. Espera a que termine."
              : "No se pudo reservar la venta para facturar. Intenta de nuevo.",
          },
          { status: 409 }
        );
      }
      claimCampo = { ventaId: parsed.data.ventaAvicolaId, token };
    }

    // Fecha de emisión: si la mandaron, validar el rango por tipo (no futura;
    // factura hasta 3 días atrás, boleta 7). Defensa en servidor.
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

    // Validar TODO el vínculo antes de consumir correlativo o llamar a SUNAT.
    // Esto también impide usar un UUID inventado para saltarse la cobranza.
    let ventaCampo: VentaCampoValidacion | null = null;
    if (parsed.data.ventaAvicolaId) {
      const sqlCampo = neon(process.env.DATABASE_URL!);
      const ventas = (await sqlCampo`
        SELECT
          v.id, v.total, v.anulada,
          c.id AS cliente_id, c.nombre AS cliente_nombre,
          c.ruc_dni AS cliente_ruc_dni, c.empresa AS cliente_empresa,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'producto_nombre', vi.producto_nombre,
                'peso_kg', vi.peso_kg,
                'precio_kg', vi.precio_kg,
                'subtotal', vi.subtotal
              ) ORDER BY vi.created_at, vi.producto_nombre, vi.id
            ) FILTER (WHERE vi.id IS NOT NULL),
            '[]'::jsonb
          ) AS items
        FROM ventas_avicola v
        JOIN clientes_avicola c ON c.id = v.cliente_id
        LEFT JOIN venta_avicola_items vi ON vi.venta_id = v.id
        WHERE v.id = ${parsed.data.ventaAvicolaId}::uuid
        GROUP BY v.id, v.total, v.anulada, c.id, c.nombre, c.ruc_dni, c.empresa
        LIMIT 1
      `) as VentaCampoValidacion[];
      ventaCampo = ventas[0] ?? null;
      if (!ventaCampo) {
        return NextResponse.json(
          { error: "La venta de campo no existe." },
          { status: 404 }
        );
      }
      if (ventaCampo.anulada) {
        return NextResponse.json(
          { error: "No se puede facturar una venta de campo anulada." },
          { status: 409 }
        );
      }
      const errorCoherencia = errorCoherenciaVentaCampo(ventaCampo, parsed.data);
      if (errorCoherencia) {
        return NextResponse.json({ error: errorCoherencia }, { status: 409 });
      }
    }

    const { tipo, empresa, cliente, items } = parsed.data;
    const numDoc = (cliente.numDocumento || "").trim();
    const razon = (cliente.razonSocial || "").trim();

    // Documento del receptor: validación robusta (rechaza relleno como 00000000).
    const docPresente = numDoc !== "" && numDoc !== "0";
    const esRuc = esRucValido(numDoc);
    const identificado = esReceptorIdentificado(numDoc); // DNI válido o RUC válido

    // Total con IGV (necesario para las reglas por monto).
    const totalConIgv = items.reduce(
      (sum, it) => sum + it.precio_unitario * it.cantidad,
      0
    );
    if (totalConIgv <= 0 || totalConIgv > 500000) {
      return NextResponse.json(
        { error: `Total fuera de rango (S/ ${totalConIgv.toFixed(2)}). Revisa precios y cantidades.` },
        { status: 400 }
      );
    }

    // ── Reglas SUNAT de identificación del cliente ───────────────────────────
    // Si ingresaron un documento, debe ser válido (rechaza relleno como 00000000).
    if (docPresente && !identificado) {
      return NextResponse.json(
        { error: `El documento "${numDoc}" no es válido. DNI = 8 dígitos reales; RUC = 11 dígitos que empiezan en 10/15/16/17/20.` },
        { status: 400 }
      );
    }
    if (tipo === "01") {
      // FACTURA: siempre RUC válido + razón social.
      if (!esRuc) {
        return NextResponse.json(
          { error: "Para FACTURA el receptor debe tener un RUC válido (11 dígitos que empiezan en 10/15/16/17/20). Para personas naturales emite BOLETA." },
          { status: 400 }
        );
      }
      if (!razon) {
        return NextResponse.json(
          { error: "La FACTURA requiere la razón social del cliente." },
          { status: 400 }
        );
      }
    } else {
      // BOLETA.
      if (totalConIgv > 700 && !identificado) {
        // SUNAT exige identificar al cliente en boletas ≥ S/700.
        return NextResponse.json(
          { error: "Las boletas mayores a S/700 requieren el DNI (8 dígitos) o RUC del cliente (regla SUNAT)." },
          { status: 400 }
        );
      }
      // Sin documento válido y < S/700: NO se traba la emisión — la boleta sale a
      // NOMBRE del cliente si lo hay, o a "CLIENTES VARIOS" si no (ver clienteFinal).
      // 400 de 404 clientes no tienen doc, así que exigirlo frenaría casi todas las
      // boletas (decisión de Antonio, jun 2026).
    }

    // Campo + RUC: el servidor vuelve a consultar la fuente oficial y usa esos
    // datos aunque el campo visible haya sido editado. Así un POST directo no
    // puede emitir con RUC válido pero razón social arbitraria.
    let razonSocialFinal = razon;
    let direccionCliente = cliente.direccion?.trim() || undefined;
    if (parsed.data.ventaAvicolaId && esRuc) {
      const consulta = await consultarRuc(numDoc);
      if (!consulta.ok) {
        const status =
          consulta.code === "NO_ENCONTRADO"
            ? 404
            : consulta.code === "FORMATO"
              ? 400
              : consulta.code === "CUOTA"
                ? 429
                : consulta.code === "TOKEN"
                  ? 503
                  : 502;
        return NextResponse.json(
          {
            error: `No se pudo validar la razón social oficial del RUC: ${consulta.mensaje}`,
            code: consulta.code,
          },
          { status }
        );
      }
      const rucOficial = consulta.ruc.trim();
      const razonOficial = consulta.razonSocial.trim();
      if (rucOficial !== numDoc || !razonOficial) {
        return NextResponse.json(
          {
            error:
              "La consulta oficial no devolvió una razón social válida para el RUC ingresado. No se emitirá el comprobante.",
          },
          { status: 502 }
        );
      }
      razonSocialFinal = razonOficial;
      direccionCliente = consulta.direccion?.trim() || direccionCliente;
    }

    // Cliente final: si está identificado, usar su documento; si es una boleta sin
    // documento (< S/700), va a cliente genérico SUNAT (tipo "0" = sin documento).
    const clienteFinal = identificado
      ? {
          tipoDocumento: esRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
          numDocumento: numDoc,
          razonSocial: (razonSocialFinal || "CLIENTES VARIOS").toUpperCase(),
          direccion: direccionCliente,
        }
      : {
          // Boleta < S/700 sin DNI/RUC válido: SUNAT permite emitirla A NOMBRE del
          // cliente (tipo doc "0", número "0") — no exige documento en este tramo.
          // Si la asesora escribió un nombre, lo respetamos; si lo dejó vacío,
          // recién ahí cae a "CLIENTES VARIOS" (consumidor final genérico).
          tipoDocumento: TipoDocIdentidad.SIN_DOCUMENTO, // "0"
          numDocumento: "0",
          razonSocial: razon ? razon.toUpperCase() : "CLIENTES VARIOS",
          direccion: direccionCliente,
        };

    // ── Validación de precio mínimo (solo asesoras) ──
    // El admin puede emitir cualquier precio. El helper compartido usa la
    // autorización enviada O busca automáticamente una aprobada sin usar que
    // cubra los ítems (la asesora ya no depende del link de la notificación).
    let autorizacionUsadaId: string | null = null;
    if (session.user.role === "asesor") {
      const sqlPrices = neon(process.env.DATABASE_URL!);
      const control = await controlarPrecioMinimo(sqlPrices, {
        items: items.map((it) => ({
          nombre: it.descripcion,
          precioUnitario: it.precio_unitario,
          cantidad: it.cantidad,
        })),
        asesoraId: session.user.id,
        autorizacionId: parsed.data.autorizacion_id ?? null,
        empresa: parsed.data.empresa,
        tipo: parsed.data.tipo,
        clienteNumDoc: cliente.numDocumento || null,
      });
      if (!control.ok) {
        return NextResponse.json(control.body, { status: control.status });
      }
      autorizacionUsadaId = control.autorizacionId;
    }

    // Precios CON IGV → sin IGV + código interno por línea (SellersItemIdentification).
    // Si el ítem no trae código, se asigna uno secuencial ("P001"…) para que el XML
    // siempre incluya el código del producto.
    const IGV_FACTOR = 1.18;
    const itemsSunat = items.map((it, idx) => {
      const precioSinIgv = it.precio_unitario / IGV_FACTOR;
      if (!Number.isFinite(precioSinIgv) || precioSinIgv <= 0 || it.precio_unitario > 100000) {
        throw new Error(`Precio inválido para "${it.descripcion}": ${it.precio_unitario}.`);
      }
      return {
        codigo: (it.codigo || "").trim() || `P${String(idx + 1).padStart(3, "0")}`,
        descripcion: it.descripcion,
        unidadMedida: mapUnidad(it.unidad),
        cantidad: it.cantidad,
        precioUnitario: Number(precioSinIgv.toFixed(4)),
        igvPorcentaje: 18,
      };
    });

    // Aceptado/observado mantiene la confirmación blanda por posible venta
    // legítima. Un comprobante incierto bloquea incluso si el cliente intenta
    // reutilizar `confirmarDuplicado` desde otra pestaña.
    if (!parsed.data.ventaAvicolaId && identificado) {
      const dup = await buscarComprobanteDuplicado({
        empresa,
        tipo,
        clienteDocNum: numDoc,
        montoTotal: totalConIgv,
      });
      if (dup && (dup.bloqueante || !parsed.data.confirmarDuplicado)) {
        return NextResponse.json(
          {
            duplicado: dup,
            mensaje: dup.bloqueante
              ? `El comprobante ${dup.serieNumero} todavía debe resolverse con SUNAT. Verifica o reintenta ese mismo número; no emitas otro.`
              : `Ya emitiste un comprobante igual (${dup.serieNumero}) por S/ ${totalConIgv.toFixed(2)} a este cliente.`,
          },
          { status: 409 }
        );
      }
    }

    // Anti-doble-factura de Campo DURO. Sin reemplazo no puede existir ningún
    // CPE. Con reemplazo, el id debe ser exactamente el último CPE, estar
    // rechazado, no tener hijo y no coexistir con otro CPE no rechazado.
    if (parsed.data.ventaAvicolaId) {
      const sqlChk = neon(process.env.DATABASE_URL!);
      const previos = (await sqlChk`
        SELECT
          c.id, c.serie_numero, c.estado,
          EXISTS (
            SELECT 1 FROM comprobantes hijo
            WHERE hijo.reemplaza_comprobante_id = c.id
              AND hijo.tipo IN ('01', '03')
          ) AS tiene_reemplazo,
          EXISTS (
            SELECT 1 FROM comprobantes activo
            WHERE activo.venta_avicola_id = ${parsed.data.ventaAvicolaId}
              AND activo.tipo IN ('01', '03')
              AND activo.estado <> 'rechazado'
          ) AS tiene_activo
        FROM comprobantes c
        WHERE c.venta_avicola_id = ${parsed.data.ventaAvicolaId}
          AND c.tipo IN ('01', '03')
        ORDER BY c.created_at DESC, c.id DESC LIMIT 1
      `) as Array<{
        id: string;
        serie_numero: string;
        estado: string;
        tiene_reemplazo: boolean;
        tiene_activo: boolean;
      }>;
      const previo = previos[0];
      const reemplazaId = parsed.data.reemplazaComprobanteId ?? null;
      if (reemplazaId) {
        const valido =
          !!previo &&
          previo.id === reemplazaId &&
          previo.estado === "rechazado" &&
          !previo.tiene_reemplazo &&
          !previo.tiene_activo;
        if (!valido) {
          return NextResponse.json(
            {
              codigo: "reemplazo_campo_invalido",
              comprobanteId: previo?.id ?? null,
              serieNumero: previo?.serie_numero ?? null,
              estado: previo?.estado ?? null,
              error:
                "El comprobante a corregir ya no es el último rechazo disponible o ya fue reemplazado. Refresca la lista antes de continuar.",
            },
            { status: 409 }
          );
        }
      } else if (previo) {
        return NextResponse.json(
          {
            codigo: "venta_campo_ya_facturada",
            comprobanteId: previo.id,
            serieNumero: previo.serie_numero,
            estado: previo.estado,
            error:
              previo.estado === "rechazado"
                ? `Esta venta ya tiene el comprobante ${previo.serie_numero} rechazado. Usa "Corregir y emitir nuevo".`
                : previo.estado === "error"
                  ? `Esta venta ya tiene el comprobante ${previo.serie_numero} con error. Reintenta ese mismo comprobante; no emitas uno nuevo.`
                  : `Esta venta de campo ya tiene el comprobante ${previo.serie_numero}. No se puede facturar dos veces.`,
          },
          { status: 409 }
        );
      }
    }

    const resultado = await emitirComprobante({
      empresa,
      tipo: tipo as TipoComprobante,
      cliente: clienteFinal,
      items: itemsSunat,
      formaPago: parsed.data.formaPago,
      plazoDias: parsed.data.plazoDias, // crédito → cuota con vencimiento en el XML
      fechaEmision: parsed.data.fechaEmision,
      observacionComprobante: obs.value,
      emitidoPor: session.user.name?.trim() || undefined,
      clienteId: cliente.id ?? null,
      // Venta de campo (Clientes Avícola): enlaza el comprobante a la venta y activa
      // el guard anti-cobranza de abajo. Para ejecutivas/suelto va null.
      ventaAvicolaId: parsed.data.ventaAvicolaId ?? null,
      reemplazaComprobanteId: parsed.data.reemplazaComprobanteId ?? null,
      // sin pedidoId → comprobante suelto
    });

    // Recuperar el id del comprobante recién creado para que el front pueda
    // descargar su PDF al toque (serie_numero es único por empresa).
    let comprobanteId: string | undefined;
    if (resultado.serieNumero) {
      try {
        const sql = neon(process.env.DATABASE_URL!);
        const idRows = (await sql`
          SELECT id FROM comprobantes
          WHERE empresa = ${empresa} AND serie_numero = ${resultado.serieNumero}
          ORDER BY created_at DESC LIMIT 1
        `) as Array<{ id: string }>;
        comprobanteId = idRows[0]?.id;
      } catch {
        // si el lookup falla no rompemos la respuesta; el PDF igual se baja desde /comprobantes
      }
    }

    // La aceptacion real 01/03 ya aplica cartera dentro de `emitirComprobante`
    // mediante un unico postproceso con claim atomico (el cron puede retomarlo).
    // Este bloque queda solo para el modo local SIN certificado, cuyo estado
    // PENDIENTE nunca fue enviado a SUNAT y conserva el comportamiento historico.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    const esCredito = parsed.data.formaPago === "Credito";
    // VENTA EN CAMPO: NO crear cobranza en `facturas` (cartera de ejecutivas). La deuda
    // ya vive en el saldo avícola (ventas_avicola/abonos_avicola); crear una factura la
    // DUPLICARÍA y la reinyectaría en la cartera de ejecutivas. Mismo patrón que `esPos`
    // del POS de planta (gotcha #42). El comprobante SUNAT igual se emite.
    const esCampo = !!parsed.data.ventaAvicolaId;
    const debeCrearCobranza =
      !!resultado.serieNumero &&
      resultado.estado === EstadoSunat.PENDIENTE &&
      !esCampo;

    if (debeCrearCobranza) {
      try {
        // Asesor responsable de la cobranza: la emisora si es asesora → el de la
        // ficha del cliente. Antes, las emisiones del ADMIN dejaban cobranzas
        // SIN asesor (bug reportado 11 jun 2026).
        let cobranzaAsesorId: string | null =
          session.user.role === "asesor" ? session.user.id : null;
        if (!cobranzaAsesorId && cliente.id) {
          const sqlAsesor = neon(process.env.DATABASE_URL!);
          const cliRows = await sqlAsesor`SELECT asesor_id FROM clientes WHERE id = ${cliente.id}::uuid`;
          cobranzaAsesorId = (cliRows[0]?.asesor_id as string | null) ?? null;
        }
        await crearFacturaStandalone({
          clienteNombre: clienteFinal.razonSocial,
          clienteId: cliente.id ?? null,
          asesorId: cobranzaAsesorId,
          // Monto = el TOTAL emitido (== PayableAmount del XML), no el bruto crudo:
          // así la deuda coincide EXACTO con el comprobante legal (con cantidades
          // fraccionarias el bruto sumado podía diferir 1 céntimo del XML).
          monto: resultado.total ?? totalConIgv,
          // Crédito → plazo del form. Contado (factura sin "ya cobrado") →
          // plazo del CLIENTE (plazo_pago_dias) o el default del negocio, en vez
          // de vencer hoy: la mayoría paga días después.
          plazoDias: esCredito
            ? parsed.data.plazoDias
            : await plazoDeCobranza(cliente.id ?? null),
          // Vencimiento y fecha_emision de la cobranza desde la fecha del comprobante
          // (no "hoy"), para que coincidan con el XML cuando la emisión es retroactiva.
          fechaEmision: parsed.data.fechaEmision,
          numeroComprobante: resultado.serieNumero,
          // Vínculo sólido por empresa: si la factura/boleta se anula con NC, la
          // cobranza se anula sola por este id (no por la serie-número, que las
          // dos empresas comparten).
          comprobanteId: comprobanteId ?? null,
        });
      } catch (errCobranza) {
        console.error(
          "Comprobante emitido pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
      }
    }

    // Completar la ficha del cliente: si es un cliente registrado que NO tenía un
    // documento válido y ahora tenemos uno (consultado en SUNAT), lo guardamos para
    // que la próxima vez no haya que buscarlo. Solo si su doc actual no es válido
    // (no pisa uno bueno). No-bloqueante.
    if (parsed.data.cliente.id && identificado) {
      try {
        const sqlCli = neon(process.env.DATABASE_URL!);
        await sqlCli`
          UPDATE clientes SET ruc_dni = ${numDoc}
          WHERE id = ${parsed.data.cliente.id}::uuid
            AND COALESCE(ruc_dni, '') !~ '^([0-9]{8}|[0-9]{11})$'
        `;
      } catch (e) {
        console.error("No se pudo guardar el documento en la ficha del cliente:", e);
      }
    }

    // Venta de campo: el cliente NO está en `clientes` sino en `clientes_avicola`.
    // Guardar el documento consultado para reutilizarlo. También permite el
    // upgrade DNI→RUC validado arriba cuando el cliente empieza a pedir factura.
    if (esCampo && identificado) {
      try {
        const sqlCampo = neon(process.env.DATABASE_URL!);
        await sqlCampo`
          UPDATE clientes_avicola SET ruc_dni = ${numDoc}
          WHERE id = (SELECT cliente_id FROM ventas_avicola WHERE id = ${parsed.data.ventaAvicolaId})
            AND COALESCE(ruc_dni, '') IS DISTINCT FROM ${numDoc}
        `;
      } catch (e) {
        console.error("No se pudo guardar el RUC/DNI en el cliente de campo:", e);
      }
    }

    // P2.10 — Si SUNAT rechazó o hubo error, notificamos al admin (y a la
    // asesora dueña si es emisión desde pedido — acá es standalone, asesor
    // = usuario actual si rol === "asesor"). No-bloqueante.
    if (
      resultado.estado === EstadoSunat.RECHAZADA ||
      resultado.estado === EstadoSunat.ERROR
    ) {
      await notificarComprobanteConProblema({
        comprobanteId: comprobanteId ?? "",
        serieNumero: resultado.serieNumero ?? null,
        tipo: parsed.data.tipo,
        estado: resultado.estado === EstadoSunat.RECHAZADA ? "RECHAZADA" : "ERROR",
        mensajeSunat: resultado.mensaje ?? resultado.error ?? null,
        pedidoId: null,
        empresa,
        asesorId: session.user.role === "asesor" ? session.user.id : null,
      });
    }

    // Marcar la autorización de precio como usada (una sola emisión por
    // autorización). SOLO se consume `autorizacionUsadaId` — la que el control
    // validó/auto-matcheó y la emisión realmente necesitó (el id del body a
    // ciegas quemaba autorizaciones sin usarlas). Guard estado/usada_at =
    // consumo atómico.
    if (autorizacionUsadaId && emisionOk) {
      try {
        const sqlAuth = neon(process.env.DATABASE_URL!);
        await sqlAuth`
          UPDATE autorizaciones_precio SET usada_at = NOW()
          WHERE id = ${autorizacionUsadaId}
            AND estado = 'aprobada' AND usada_at IS NULL`;
      } catch {
        // no-bloqueante
      }
    }

    return NextResponse.json({
      ...resultado,
      id: comprobanteId,
      clienteRazonSocial: clienteFinal.razonSocial,
    });
  } catch (error) {
    if (error instanceof VentaCampoYaFacturadaError) {
      try {
        const sql = neon(process.env.DATABASE_URL!);
        const rows = (await sql`
          SELECT id, serie_numero, estado
          FROM comprobantes
          WHERE venta_avicola_id = ${error.ventaAvicolaId}::uuid
            AND tipo IN ('01', '03')
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `) as Array<{ id: string; serie_numero: string; estado: string }>;
        const existente = rows[0];
        return NextResponse.json(
          {
            codigo: "venta_campo_ya_facturada",
            comprobanteId: existente?.id ?? null,
            serieNumero: existente?.serie_numero ?? null,
            estado: existente?.estado ?? "emitiendo",
            error: existente
              ? existente.estado === "rechazado"
                ? `El último comprobante es ${existente.serie_numero} y está rechazado. Refresca la venta y usa "Corregir y emitir nuevo"; no se envió un duplicado.`
                : `Esta venta ya tiene el comprobante ${existente.serie_numero} en estado ${existente.estado}. No se enviará otro a SUNAT.`
              : "Esta venta ya está siendo facturada. No se enviará otro comprobante a SUNAT.",
          },
          { status: 409 }
        );
      } catch (lookupError) {
        console.error("No se pudo recuperar el comprobante de Campo ya reservado:", lookupError);
        return NextResponse.json(
          {
            codigo: "venta_campo_ya_facturada",
            error: "Esta venta ya está siendo facturada. No se enviará otro comprobante a SUNAT.",
          },
          { status: 409 }
        );
      }
    }
    console.error("Error en POST /api/comprobantes/emitir-manual:", error);
    const mensaje = error instanceof Error ? error.message : "Error al emitir comprobante";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  } finally {
    if (claimCampo) {
      try {
        const sqlClaim = neon(process.env.DATABASE_URL!);
        await sqlClaim`
          UPDATE ventas_avicola
          SET facturacion_claim_token = NULL,
              facturacion_claim_at = NULL
          WHERE id = ${claimCampo.ventaId}::uuid
            AND facturacion_claim_token = ${claimCampo.token}::uuid
        `;
      } catch (error) {
        console.error("No se pudo liberar el claim de facturación de Campo:", error);
      }
    }
  }
}

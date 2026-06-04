// src/app/api/comprobantes/emitir-manual/route.ts
// POST — emite un comprobante (factura/boleta) SIN pedido asociado.
// Para ventas de mostrador, ajustes, o comprobantes sueltos.
//
// Convención de precios: el form envía precio_unitario CON IGV (igual que el
// resto del sistema). Acá lo dividimos entre 1.18 antes de mandar a SUNAT.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { emitirComprobante } from "@/lib/sunat";
import { TipoComprobante, TipoDocIdentidad, EstadoSunat } from "@/lib/sunat/types";
import { crearFacturaStandalone, plazoDeCobranza } from "@/lib/cobranzas";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";
import {
  esRucValido,
  esReceptorIdentificado,
} from "@/lib/sunat/validacion-cliente";
import { buscarComprobanteDuplicado } from "@/lib/sunat/duplicado";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";

export const dynamic = "force-dynamic";

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
  // Para FACTURAS contado: si el usuario lo marca, NO crea cobranza (cash de mano).
  // Default false = se crea cobranza también para contado (refleja realidad del
  // negocio Transavic: la mayoría son "contado" pero el cliente paga después).
  yaCobrado: z.boolean().default(false),
  // Si la asesora ya confirmó el aviso de "comprobante duplicado", emite igual.
  confirmarDuplicado: z.boolean().default(false),
});

/** Mapea la unidad a código SUNAT — delegado al helper compartido (un solo origen
 *  de verdad para todos los flujos de emisión). Acepta "kg"/"uni" crudos y los
 *  códigos "KGM"/"NIU" del form (idempotente, nunca degrada KGM→NIU). */
function mapUnidad(u: string): string {
  return aUnitCodeSunat(u);
}

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

    const body = await request.json().catch(() => null);
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
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

    // Cliente final: si está identificado, usar su documento; si es una boleta sin
    // documento (< S/700), va a cliente genérico SUNAT (tipo "0" = sin documento).
    const direccionCliente = cliente.direccion?.trim() || undefined;
    const clienteFinal = identificado
      ? {
          tipoDocumento: esRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
          numDocumento: numDoc,
          razonSocial: (razon || "CLIENTES VARIOS").toUpperCase(),
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

    // Anti-duplicado: si ya hay un comprobante igual reciente (mismo cliente
    // identificado + tipo + monto), avisar antes de duplicar — salvo que la
    // asesora ya haya confirmado "emitir igual".
    if (!parsed.data.confirmarDuplicado && identificado) {
      const dup = await buscarComprobanteDuplicado({
        empresa,
        tipo,
        clienteDocNum: numDoc,
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
      tipo: tipo as TipoComprobante,
      cliente: clienteFinal,
      items: itemsSunat,
      formaPago: parsed.data.formaPago,
      plazoDias: parsed.data.plazoDias, // crédito → cuota con vencimiento en el XML
      emitidoPor: session.user.name?.trim() || undefined,
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

    // Regla del negocio (Transavic, jun 2026): TODA venta —factura O boleta— crea
    // una cobranza por defecto, sea Contado o Crédito, porque el "contado" casi
    // siempre se cobra días después (el cliente no paga el mismo día). Excepción:
    // el usuario marca `yaCobrado` (pagó cash de mano) → no se crea cobranza.
    // Solo se crea si SUNAT aceptó (o quedó pendiente por falta de cert); si fue
    // rechazado/erró, no registramos deuda inválida ni duplicamos al reintentar.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    const esCredito = parsed.data.formaPago === "Credito";
    // Contado sin "ya cobrado" también crea cobranza (paga después). Aplica por
    // igual a factura y boleta — incluido "CLIENTES VARIOS" (decisión de Antonio).
    const debeCrearCobranza =
      !!resultado.serieNumero && emisionOk && (esCredito || !parsed.data.yaCobrado);

    if (debeCrearCobranza) {
      try {
        await crearFacturaStandalone({
          clienteNombre: clienteFinal.razonSocial,
          clienteId: cliente.id ?? null,
          asesorId: session.user.role === "asesor" ? session.user.id : null,
          monto: totalConIgv,
          // Crédito → plazo del form. Contado (factura sin "ya cobrado") →
          // plazo del CLIENTE (plazo_pago_dias) o el default del negocio, en vez
          // de vencer hoy: la mayoría paga días después.
          plazoDias: esCredito
            ? parsed.data.plazoDias
            : await plazoDeCobranza(cliente.id ?? null),
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
        mensajeSunat: resultado.mensaje ?? null,
        pedidoId: null,
        empresa,
        asesorId: session.user.role === "asesor" ? session.user.id : null,
      });
    }

    return NextResponse.json({ ...resultado, id: comprobanteId });
  } catch (error) {
    console.error("Error en POST /api/comprobantes/emitir-manual:", error);
    const mensaje = error instanceof Error ? error.message : "Error al emitir comprobante";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

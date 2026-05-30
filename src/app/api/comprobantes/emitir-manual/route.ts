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
import { crearFacturaStandalone } from "@/lib/cobranzas";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";

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
});

/** Mapea unidades comunes al catálogo 03 de SUNAT (unidad de medida). */
function mapUnidad(u: string): string {
  const up = (u || "").trim().toUpperCase();
  const codigos = ["KGM", "NIU", "ZZ", "BX", "GLL", "LTR", "MTR", "GRM", "DZN"];
  if (codigos.includes(up)) return up;
  if (["KG", "KILO", "KILOS", "KILOGRAMO", "KILOGRAMOS"].includes(up)) return "KGM";
  return "NIU"; // unidad (por defecto)
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

    const esRuc = /^\d{11}$/.test(numDoc);
    const esRucValido = /^(10|15|16|17|20)\d{9}$/.test(numDoc);
    const esDni = /^\d{8}$/.test(numDoc);
    const identificado = esDni || esRuc;

    // Total con IGV (necesario para las reglas por monto).
    const totalConIgv = items.reduce(
      (sum, it) => sum + it.precio_unitario * it.cantidad,
      0
    );
    if (totalConIgv <= 0 || totalConIgv > 500000) {
      return NextResponse.json(
        { error: `Total fuera de rango (S/ ${totalConIgv.toFixed(2)}). Revisá precios y cantidades.` },
        { status: 400 }
      );
    }

    // ── Reglas SUNAT de identificación del cliente ───────────────────────────
    if (tipo === "01") {
      // FACTURA: siempre RUC válido + razón social.
      if (!esRucValido) {
        return NextResponse.json(
          { error: "Para FACTURA el receptor debe tener un RUC válido (11 dígitos que empiezan en 10/15/16/17/20). Para personas naturales emití BOLETA." },
          { status: 400 }
        );
      }
      if (!razon) {
        return NextResponse.json(
          { error: "La FACTURA requiere la razón social del cliente." },
          { status: 400 }
        );
      }
    } else if (totalConIgv > 700 && !identificado) {
      // BOLETA ≥ S/700: SUNAT exige identificar con DNI o RUC.
      return NextResponse.json(
        { error: "Las boletas mayores a S/700 requieren el DNI (8 dígitos) o RUC del cliente (regla SUNAT)." },
        { status: 400 }
      );
    }

    // Cliente final: si está identificado, usar su documento; si es una boleta sin
    // documento (< S/700), va a cliente genérico SUNAT (tipo "0" = sin documento).
    const direccionCliente = cliente.direccion?.trim() || undefined;
    const clienteFinal = identificado
      ? {
          tipoDocumento: esRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
          numDocumento: numDoc,
          razonSocial: razon || "CLIENTES VARIOS",
          direccion: direccionCliente,
        }
      : {
          tipoDocumento: TipoDocIdentidad.SIN_DOCUMENTO, // "0"
          numDocumento: "0",
          razonSocial: razon || "CLIENTES VARIOS",
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

    const resultado = await emitirComprobante({
      empresa,
      tipo: tipo as TipoComprobante,
      cliente: clienteFinal,
      items: itemsSunat,
      formaPago: parsed.data.formaPago,
      plazoDias: parsed.data.plazoDias, // crédito → cuota con vencimiento en el XML
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

    // Regla del negocio: por defecto TODA factura (tipo 01) crea una cobranza, sea
    // Contado o Crédito, porque en Transavic la mayoría se emite "Contado" pero el
    // cliente paga después. Excepción: el usuario marca `yaCobrado` (cash de mano)
    // → no se crea cobranza. Boletas (tipo 03) NUNCA crean cobranza (consumidor cash).
    // Solo se crea si SUNAT aceptó (o el comprobante quedó pendiente por falta de cert);
    // si fue rechazado/erró, no registramos deuda inválida ni duplicamos al reintentar.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    const esCredito = parsed.data.formaPago === "Credito";
    const facturaContadoSinCobrar =
      parsed.data.tipo === "01" && !esCredito && !parsed.data.yaCobrado;
    const debeCrearCobranza =
      !!resultado.serieNumero && emisionOk && (esCredito || facturaContadoSinCobrar);

    if (debeCrearCobranza) {
      try {
        await crearFacturaStandalone({
          clienteNombre: clienteFinal.razonSocial,
          clienteId: cliente.id ?? null,
          asesorId: session.user.role === "asesor" ? session.user.id : null,
          monto: totalConIgv,
          // Contado-sin-cobrar → vencimiento = hoy (plazo 0).
          // Crédito → plazo del form (default 7).
          plazoDias: esCredito ? parsed.data.plazoDias : 0,
          numeroComprobante: resultado.serieNumero,
        });
      } catch (errCobranza) {
        console.error(
          "Comprobante emitido pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
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

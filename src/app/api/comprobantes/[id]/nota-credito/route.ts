// src/app/api/comprobantes/[id]/nota-credito/route.ts
// POST { motivo, tipoNotaCredito? } — emite una Nota de Crédito (07) de
// anulación/devolución TOTAL de un comprobante ya aceptado.
//
// A diferencia de la Comunicación de Baja (/anular, solo facturas, ≤7 días),
// la Nota de Crédito sirve para facturas Y boletas y es el mecanismo general.
//
// V1 acredita todos los ítems y el total del XML original. Por eso solo admite
// códigos SUNAT de anulación/devolución total (01, 02, 06); una corrección
// parcial requiere seleccionar ítems/montos y todavía no está modelada. La emite el admin o la ASESORA dueña del
// comprobante (de sus pedidos) — las asesoras son las que facturan.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  emitirComprobante,
  NotaCreditoYaReservadaError,
} from "@/lib/sunat";
import {
  TipoComprobante,
  TipoNotaCredito,
  TipoDocIdentidad,
  TipoAfectacionIGV,
  EstadoSunat,
  type EmpresaId,
  type ComprobanteItem,
} from "@/lib/sunat/types";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";
import { asesoraPuedeVerComprobante } from "@/lib/comprobante-scope";
import { anularCobranzasDeComprobante } from "@/lib/cobranzas";
import { anularCobranzasPlantaDeComprobante } from "@/lib/planta/saldos";
import { parseCpeItems } from "@/lib/sunat/parse-cpe-items";

export const dynamic = "force-dynamic";

const Schema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "Motivo mínimo 5 caracteres")
    .max(250, "Motivo máximo 250 caracteres"),
  tipoNotaCredito: z
    .enum(["01", "02", "06"])
    .default("01"), // solo anulación/devolución TOTAL en esta versión
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!["asesor", "admin"].includes(session.user.role))
    return NextResponse.json(
      { error: "Solo asesores o admin pueden emitir notas de crédito" },
      { status: 403 }
    );

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT c.empresa, c.tipo, c.serie, c.numero, c.serie_numero, c.estado,
           c.monto_subtotal, c.cliente_doc_tipo, c.cliente_doc_num, c.cliente_razon_social,
           c.observaciones, c.pedido_id, c.emitido_por, c.xml_firmado_base64,
           c.venta_avicola_id, p.asesor_id, p.origen AS pedido_origen
    FROM comprobantes c
    LEFT JOIN pedidos p ON c.pedido_id = p.id
    WHERE c.id = ${id}::uuid LIMIT 1
  `) as Array<{
    empresa: string;
    tipo: string;
    serie: string;
    numero: number;
    serie_numero: string;
    estado: string;
    monto_subtotal: string | number;
    cliente_doc_tipo: string | null;
    cliente_doc_num: string | null;
    cliente_razon_social: string | null;
    observaciones: string | null;
    pedido_id: string | null;
    emitido_por: string | null;
    xml_firmado_base64: string | null;
    venta_avicola_id: string | null;
    asesor_id: string | null;
    pedido_origen: string | null;
  }>;
  if (rows.length === 0)
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  const c = rows[0];

  // Scoping (Antonio jun 2026): la asesora solo puede acreditar SUS comprobantes
  // (los de sus pedidos o los que ella emitió); el admin, cualquiera. (El check de
  // rol asesor/admin ya se hizo arriba.)
  if (
    !asesoraPuedeVerComprobante(session.user.role, session.user.id, session.user.name, {
      pedidoAsesorId: c.asesor_id,
      emitidoPor: c.emitido_por,
    })
  ) {
    return NextResponse.json(
      { error: "Solo puedes emitir notas de crédito sobre tus propios comprobantes." },
      { status: 403 }
    );
  }

  if (c.tipo !== "01" && c.tipo !== "03")
    return NextResponse.json(
      { error: "Solo se emite Nota de Crédito sobre una factura o boleta." },
      { status: 400 }
    );
  if (c.estado !== "aceptado" && c.estado !== "observado")
    return NextResponse.json(
      {
        error: `Solo se acredita un comprobante aceptado u observado. Estado actual: ${c.estado}.`,
      },
      { status: 409 }
    );

  // Anti-duplicado: una NC válida/en curso bloquea otra. Una NC en `error` que
  // YA tiene XML también bloquea: el transporte fue ambiguo y debe reintentarse
  // con el mismo correlativo. Solo `rechazado`, `anulado` o un error anterior a
  // firmar (sin XML) permiten crear una NC nueva.
  const ncPrevias = (await sql`
    SELECT id, serie_numero, estado, (xml_firmado_base64 IS NOT NULL) AS tiene_xml
    FROM comprobantes
    WHERE referencia_comprobante_id = ${id}::uuid
      AND tipo = '07'
      AND (
        estado NOT IN ('error', 'rechazado', 'anulado')
        OR (estado = 'error' AND xml_firmado_base64 IS NOT NULL)
      )
    ORDER BY created_at LIMIT 1
  `) as Array<{ id: string; serie_numero: string; estado: string; tiene_xml: boolean }>;
  const ncHistorica = /nota de cr[eé]dito\s+(\S+)\s+\(ACEPTADA/i.exec(c.observaciones ?? "");
  if (ncPrevias.length > 0 || ncHistorica) {
    const ncRef = ncPrevias[0]?.serie_numero ?? ncHistorica?.[1] ?? "una previa";
    const ncPrevia = ncPrevias[0];
    return NextResponse.json(
      {
        codigo:
          ncPrevia?.estado === "error" && ncPrevia.tiene_xml
            ? "nota_credito_error_reintentable"
            : "nota_credito_ya_existente",
        notaCreditoId: ncPrevia?.id ?? null,
        error:
          ncPrevia?.estado === "error" && ncPrevia.tiene_xml
            ? `La Nota de Crédito ${ncRef} quedó con error después de firmarse. Reintenta esa misma nota; no emitas otro correlativo.`
            : `Este comprobante (${c.serie_numero}) ya tiene la Nota de Crédito ${ncRef}; no se puede emitir otra sobre el mismo comprobante.`,
      },
      { status: 409 }
    );
  }

  const subtotalNeto = Number(c.monto_subtotal);
  if (!Number.isFinite(subtotalNeto) || subtotalNeto <= 0)
    return NextResponse.json({ error: "El comprobante no tiene monto válido." }, { status: 400 });

  const docNum = c.cliente_doc_num ?? "0";
  // La NC debe repetir EXACTAMENTE el tipo de documento del comprobante base.
  // Esto es especialmente importante para boletas sin documento (tipo 0,
  // número 0): convertirlas a DNI "0" genera un XML inválido para SUNAT.
  const tipoDocCliente = (() => {
    if (c.cliente_doc_tipo === TipoDocIdentidad.SIN_DOCUMENTO) {
      return TipoDocIdentidad.SIN_DOCUMENTO;
    }
    if (c.cliente_doc_tipo === TipoDocIdentidad.RUC) {
      return TipoDocIdentidad.RUC;
    }
    if (c.cliente_doc_tipo === TipoDocIdentidad.DNI) {
      return TipoDocIdentidad.DNI;
    }
    // Fallback solo para filas históricas sin cliente_doc_tipo.
    if (/^\d{11}$/.test(docNum)) return TipoDocIdentidad.RUC;
    if (/^\d{8}$/.test(docNum)) return TipoDocIdentidad.DNI;
    return TipoDocIdentidad.SIN_DOCUMENTO;
  })();
  const refNumero = String(c.numero).padStart(8, "0");

  // Las líneas de la NC = las MISMAS de la factura (de su XML firmado) → el total de
  // la NC coincide EXACTO con la factura. Antes se consolidaba TODO en 1 línea y se
  // recalculaba el IGV sobre el subtotal, lo que daba hasta 1 céntimo de más → SUNAT
  // rechazaba con 3286 ("el monto de la NC supera al de la factura"). Fallback: 1
  // línea por el subtotal neto (solo si no se pueden leer las líneas de la factura).
  // La NC copia las líneas con sus importes EXACTOS del XML firmado de la factura
  // (valorVenta + IGV por línea). `calcularTotales` respeta esos importes (no los
  // re-calcula) → NC == factura al céntimo, incluso si la factura es vieja y su
  // total no es "redondo". Así nunca se supera a la factura (evita SUNAT 3286).
  let itemsNC: ComprobanteItem[] | null = null;
  if (c.xml_firmado_base64) {
    try {
      const xmlFactura = Buffer.from(c.xml_firmado_base64, "base64").toString("utf-8");
      const lineas = parseCpeItems(xmlFactura);
      if (lineas.length > 0) {
        itemsNC = lineas.map((it) => ({
          codigo: it.codigo || undefined,
          descripcion: it.descripcion || "Item",
          unidadMedida: it.unidadMedida || "NIU",
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario, // valor unitario SIN IGV, igual que la factura
          tipoAfectacionIGV: TipoAfectacionIGV.GRAVADA_ONEROSA,
          porcentajeIGV: 18,
          // Importes EXACTOS de la línea de la factura → la NC los reproduce tal cual.
          valorVenta: it.valorVenta,
          montoIGV: it.montoIGV,
        }));
      }
    } catch (e) {
      console.error("No se pudieron leer las líneas de la factura para la NC:", e);
    }
  }
  if (!itemsNC) {
    itemsNC = [
      {
        descripcion: `${parsed.data.motivo} (ref. ${c.serie}-${refNumero})`.slice(0, 250),
        unidadMedida: "NIU",
        cantidad: 1,
        precioUnitario: Number(subtotalNeto.toFixed(2)),
        tipoAfectacionIGV: TipoAfectacionIGV.GRAVADA_ONEROSA,
        porcentajeIGV: 18,
      },
    ];
  }

  // Claim del CPE base ANTES de pedir un correlativo de NC. Dos pestañas no
  // consumen dos números ni llegan al SOAP; el índice de NC activa queda como
  // segunda barrera. Claims huérfanos se recuperan tras 15 minutos.
  const claimToken = crypto.randomUUID();
  const claim = (await sql`
    UPDATE comprobantes base
    SET nota_credito_claim_token = ${claimToken}::uuid,
        nota_credito_claim_at = NOW()
    WHERE base.id = ${id}::uuid
      AND (
        base.nota_credito_claim_token IS NULL
        OR base.nota_credito_claim_at < NOW() - INTERVAL '15 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM comprobantes nc
        WHERE nc.referencia_comprobante_id = base.id
          AND nc.tipo = '07'
          AND (
            nc.estado NOT IN ('error', 'rechazado', 'anulado')
            OR (nc.estado = 'error' AND nc.xml_firmado_base64 IS NOT NULL)
          )
      )
    RETURNING base.id
  `) as Array<{ id: string }>;
  if (claim.length === 0) {
    const activa = (await sql`
      SELECT id, serie_numero, estado
      FROM comprobantes
      WHERE referencia_comprobante_id = ${id}::uuid
        AND tipo = '07'
        AND (
          estado NOT IN ('error', 'rechazado', 'anulado')
          OR (estado = 'error' AND xml_firmado_base64 IS NOT NULL)
        )
      ORDER BY created_at DESC LIMIT 1
    `) as Array<{ id: string; serie_numero: string; estado: string }>;
    return NextResponse.json(
      {
        codigo: "nota_credito_ya_reservada",
        notaCreditoId: activa[0]?.id ?? null,
        serieNumero: activa[0]?.serie_numero ?? null,
        estado: activa[0]?.estado ?? "emitiendo",
        error: activa[0]
          ? `El comprobante ya tiene la Nota de Crédito ${activa[0].serie_numero} en estado ${activa[0].estado}.`
          : "Este comprobante ya está siendo acreditado en otra pestaña.",
      },
      { status: 409 }
    );
  }

  try {
    const resultado = await emitirComprobante({
      empresa: c.empresa as EmpresaId,
      tipo: TipoComprobante.NOTA_CREDITO,
      cliente: {
        tipoDocumento: tipoDocCliente,
        numDocumento:
          tipoDocCliente === TipoDocIdentidad.SIN_DOCUMENTO ? "0" : docNum,
        razonSocial: c.cliente_razon_social ?? "CLIENTE",
      },
      items: itemsNC,
      documentoReferencia: {
        tipoComprobante: c.tipo as TipoComprobante,
        serie: c.serie,
        numero: c.numero,
        tipoNotaCredito: parsed.data.tipoNotaCredito as TipoNotaCredito,
        motivo: parsed.data.motivo,
      },
      // Vincula la NC con la fila del comprobante original (factura/boleta): se
      // guarda en `comprobantes.referencia_comprobante_id`. Sirve para mostrar el
      // enlace "anula F001-5" en la lista y para que la factura aparezca "con N. Crédito".
      referenciaComprobanteId: id,
      // Hereda el origen Campo del comprobante acreditado. Así la NC permanece
      // en la vista de Campo y nunca contamina facturación/metas de ejecutivas.
      ventaAvicolaId: c.venta_avicola_id,
      // Rastro: quién emitió esta nota de crédito (cualquier asesora/admin puede).
      emitidoPor: session.user.name?.trim() || undefined,
    });

    // Vincular la NC con el comprobante original (auditoría)
    if (resultado.serieNumero) {
      await sql`
        UPDATE comprobantes
        SET observaciones = COALESCE(observaciones || ' | ', '') ||
          ${`Nota de crédito ${resultado.serieNumero} (${resultado.estado}) — ${parsed.data.motivo}`}
        WHERE id = ${id}::uuid
      `;
    }

    // Anular automáticamente la cobranza ligada a la factura/boleta que esta NC
    // acredita: una venta anulada con Nota de Crédito ya no es deuda. Solo si la
    // NC fue aceptada/observada (no rechazada/erró) y la cobranza NO está pagada
    // (una pagada implica devolución → la revisa una persona). No bloqueante: si
    // algo falla, la NC igual quedó emitida.
    const esAnulacionTotal = ["01", "02", "06"].includes(parsed.data.tipoNotaCredito);
    if (
      esAnulacionTotal &&
      (resultado.estado === EstadoSunat.ACEPTADA ||
        resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES)
    ) {
      try {
        const motivoCobranza = `Anulada por Nota de Crédito ${resultado.serieNumero ?? ""}`.trim();
        const anuladas = c.venta_avicola_id
          ? ((await sql`
              UPDATE ventas_avicola
              SET anulada = TRUE,
                  anulada_at = NOW(),
                  anulada_por = ${session.user.id}::uuid,
                  anulacion_motivo = ${motivoCobranza}
              WHERE id = ${c.venta_avicola_id}::uuid
                AND NOT anulada
              RETURNING id
            `) as Array<{ id: string }>).length
          : c.pedido_origen === "pos_planta"
            ? await anularCobranzasPlantaDeComprobante(sql, {
                comprobanteId: id,
                pedidoId: c.pedido_id,
                motivo: motivoCobranza,
                anuladaPor: session.user.id,
              })
            : await anularCobranzasDeComprobante({
                comprobanteId: id,
                pedidoId: c.pedido_id ?? null,
                serieNumero: c.serie_numero,
                motivo: motivoCobranza,
                anuladaPor: session.user.name?.trim() || "Sistema (NC)",
              });
        if (anuladas > 0) {
          console.log(`NC ${resultado.serieNumero}: ${anuladas} cobranza(s) anulada(s).`);
        }
      } catch (e) {
        console.error("No se pudo anular la cobranza ligada a la NC:", e);
      }
    }

    // P2.10 — Si la NC fue rechazada o falló, avisar. La NC ahora también la puede
    // emitir la asesora dueña, así que notificamos al admin y a la asesora del
    // comprobante (si lo tiene) para que se entere de que su nota de crédito falló.
    if (
      resultado.estado === EstadoSunat.RECHAZADA ||
      resultado.estado === EstadoSunat.ERROR
    ) {
      await notificarComprobanteConProblema({
        comprobanteId: id,
        serieNumero: resultado.serieNumero ?? null,
        tipo: "07",
        estado: resultado.estado === EstadoSunat.RECHAZADA ? "RECHAZADA" : "ERROR",
        mensajeSunat: resultado.mensaje ?? resultado.error ?? null,
        pedidoId: c.pedido_id ?? null,
        empresa: c.empresa,
        asesorId: c.asesor_id ?? null,
      });
    }

    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof NotaCreditoYaReservadaError) {
      const existentes = (await sql`
        SELECT id, serie_numero, estado
        FROM comprobantes
        WHERE referencia_comprobante_id = ${err.referenciaComprobanteId}::uuid
          AND tipo = '07'
          AND (
            estado NOT IN ('error', 'rechazado', 'anulado')
            OR (estado = 'error' AND xml_firmado_base64 IS NOT NULL)
          )
        ORDER BY created_at DESC
        LIMIT 1
      `) as Array<{ id: string; serie_numero: string; estado: string }>;
      const existente = existentes[0];
      return NextResponse.json(
        {
          codigo: "nota_credito_ya_reservada",
          notaCreditoId: existente?.id ?? null,
          serieNumero: existente?.serie_numero ?? null,
          estado: existente?.estado ?? "emitiendo",
          error: existente
            ? `El comprobante ya tiene la Nota de Crédito ${existente.serie_numero} en estado ${existente.estado}. No se enviará otra a SUNAT.`
            : "Este comprobante ya está siendo acreditado. No se enviará otra Nota de Crédito a SUNAT.",
        },
        { status: 409 }
      );
    }
    console.error("Error emitiendo nota de crédito:", err);
    const mensaje = err instanceof Error ? err.message : "Error al emitir nota de crédito";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  } finally {
    try {
      await sql`
        UPDATE comprobantes
        SET nota_credito_claim_token = NULL,
            nota_credito_claim_at = NULL
        WHERE id = ${id}::uuid
          AND nota_credito_claim_token = ${claimToken}::uuid
      `;
    } catch (error) {
      console.error("No se pudo liberar el claim de Nota de Crédito:", error);
    }
  }
}
